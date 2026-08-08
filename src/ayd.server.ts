// Server-only module — Deno APIs, yt-dlp subprocess, filesystem.
//
// The `.server.ts` suffix + a DYNAMIC import from the cell is the whole boundary:
// the build marks these imports external, so none of this reaches the browser
// bundle (docs/build/imports.md §2). Cell methods run on the server, so the
// import only ever executes there.

import { fromFileUrl, join } from "@std/path";
import { log } from "aio";
import type { AccessOpts, Codec, VideoMeta } from "./cell.ts";

const BUNDLED = fromFileUrl(new URL("../dep/yt-dlp/yt-dlp", import.meta.url));

/** yt-dlp to run: `AYD_YTDLP` override → the bundled dev copy (dep/ is not in a
 *  compiled build) → `yt-dlp` on PATH. */
async function ytdlp(): Promise<string> {
  return Deno.env.get("AYD_YTDLP") ??
    await Deno.stat(BUNDLED).then(() => BUNDLED, () => "yt-dlp");
}

/** The line a user needs from yt-dlp's stderr: its last `ERROR:`, else all of it.
 *  The full text goes to the log. */
function failure(stderr: string, code: number): Error {
  const text = stderr.trim();
  if (text) log.error("ayd", `yt-dlp exited ${code}: ${text}`);
  const last = text.split("\n").filter((l) => l.startsWith("ERROR:")).pop();
  return new Error(last ?? (text || `yt-dlp exited ${code}`));
}

async function spawn(
  args: string[],
  signal?: AbortSignal,
): Promise<Deno.ChildProcess> {
  const bin = await ytdlp();
  try {
    return new Deno.Command(bin, {
      args,
      stdout: "piped",
      stderr: "piped",
      signal,
    }).spawn();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error("yt-dlp not found — put it in dep/yt-dlp/ or on PATH.");
    }
    throw e;
  }
}

async function runYt(args: string[], signal?: AbortSignal): Promise<string> {
  const child = await spawn(args, signal);
  const [status, stdout, stderr] = await Promise.all([
    child.status,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (!status.success) throw failure(stderr, status.code);
  return stdout;
}

/** yt-dlp flags for the optional access settings. */
function accessArgs(o: AccessOpts): string[] {
  const args: string[] = [];
  if (o.cookiesPath) args.push("--cookies", o.cookiesPath);
  if (o.userAgent) args.push("--user-agent", o.userAgent);
  if (o.playerClient && o.playerClient !== "default") {
    args.push("--extractor-args", `youtube:player_client=${o.playerClient}`);
  }
  return args;
}

/** Fetch formats + metadata for a URL. Full dump (not --flat-playlist) so each
 *  format keeps its codecs — classification needs them. `--` ends options, so a
 *  pasted "URL" can never be read as a yt-dlp flag. */
export async function inspect(
  url: string,
  signal: AbortSignal,
  opts: AccessOpts,
): Promise<VideoMeta> {
  const data = JSON.parse(
    await runYt(
      ["--no-warnings", ...accessArgs(opts), "--dump-single-json", "--", url],
      signal,
    ),
  );
  return {
    id: String(data.id ?? ""),
    title: data.title ?? url,
    thumbnail: data.thumbnail,
    duration: data.duration,
    formats: (data.formats ?? []).filter(
      (f: VideoMeta["formats"][number]) =>
        f.resolution !== undefined || f.vcodec !== undefined ||
        f.acodec !== undefined,
    ),
  };
}

/** `[download]  42.3% of 12.34MiB …` → 42.3; anything else → -1. */
export function parseProgress(line: string): number {
  const m = line.match(/^\[download\]\s+([\d.]+)%/);
  return m ? Number(m[1]) : -1;
}

export type Progress = {
  progress: (pct: number) => void;
  status: (text: string) => void;
};

/** Run a yt-dlp download, streaming progress. `--retries`/`--fragment-retries`
 *  make yt-dlp resilient to network errors; a whole-command retry catches
 *  what it cannot. A cancel (aborted signal) is never retried. */
async function runDownload(
  args: string[],
  cb: Progress,
  signal: AbortSignal,
  opts: AccessOpts,
): Promise<void> {
  const attempts = 3;
  for (let i = 1;; i++) {
    const child = await spawn([
      "--newline",
      "--progress-delta",
      "0.5", // ≤2 progress commits/s, not one per chunk
      "--no-part",
      "--retries",
      "10",
      "--fragment-retries",
      "10",
      "--extractor-retries",
      "5",
      ...accessArgs(opts),
      ...args,
    ], signal);
    let stream = 0;
    const onLine = (line: string) => {
      const pct = parseProgress(line);
      if (pct >= 0) cb.progress(pct);
      else if (line.startsWith("[download] Destination:")) {
        cb.status(++stream === 1 ? "Downloading…" : "Downloading audio…");
      } else if (line.startsWith("[Merger]")) cb.status("Merging…");
    };
    const pump = (async () => {
      let buf = "";
      for await (
        const chunk of child.stdout.pipeThrough(new TextDecoderStream())
      ) {
        const lines = (buf + chunk).split("\n");
        buf = lines.pop()!;
        lines.forEach(onLine);
      }
    })();
    const [status, stderr] = await Promise.all([
      child.status,
      new Response(child.stderr).text(),
      pump,
    ]);
    if (status.success) return;
    if (signal.aborted) throw signal.reason;
    if (i === attempts) throw failure(stderr, status.code);
    log.warn("ayd", `download attempt ${i}/${attempts} failed, retrying`);
    await new Promise((r) => setTimeout(r, 1500 * i));
  }
}

/** Download one format into `dir`. */
export function download(
  formatId: string,
  dir: string,
  url: string,
  cb: Progress,
  signal: AbortSignal,
  opts: AccessOpts,
): Promise<void> {
  return runDownload(
    ["-f", formatId, "-o", join(dir, "%(title)s.%(ext)s"), "--", url],
    cb,
    signal,
    opts,
  );
}

const OPTIMAL: Record<Codec, { selector: string; label: string }> = {
  h264: {
    selector: "bestvideo[vcodec^=avc1]+bestaudio[acodec^=mp4a]",
    label: "h264-aac",
  },
  vp9: {
    selector: "bestvideo[vcodec^=vp9]+bestaudio[acodec^=opus]",
    label: "vp9-opus",
  },
  "vp9-1080p": {
    selector: "bestvideo[vcodec^=vp9][height<=1080]+bestaudio[acodec^=opus]",
    label: "vp9-opus",
  },
};

/** Best video + best audio of the chosen codec family, merged by ffmpeg into one
 *  mp4. H.264/AAC (default) plays everywhere and is hardware-decoded; VP9/Opus is
 *  higher quality but CPU-heavy. The selector fixes the codecs, so the filename
 *  postfix (`[1080p-h264-aac]`) needs only the height from the template — one
 *  yt-dlp run, and it never overwrites a plain download. */
export function downloadOptimal(
  dir: string,
  url: string,
  codec: Codec,
  cb: Progress,
  signal: AbortSignal,
  opts: AccessOpts,
): Promise<void> {
  const { selector, label } = OPTIMAL[codec];
  return runDownload(
    [
      "-f",
      selector,
      "--merge-output-format",
      "mp4",
      "-o",
      join(dir, `%(title)s [%(height)sp-${label}].%(ext)s`),
      "--",
      url,
    ],
    cb,
    signal,
    opts,
  );
}

/** Update the yt-dlp binary in place. */
export async function update(): Promise<string> {
  const out = (await runYt(["--update"])).trim();
  return out.split("\n").pop() || "yt-dlp is up to date";
}

/** The default download directory: `~/.ayd/downloads`. */
export function defaultDir(): string {
  const home = Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
  return join(home, ".ayd", "downloads");
}

export type DirEntry = { name: string; path: string };

/** Immediate child directories of `path` (no symlinks), sorted by name. */
export async function listDirs(
  path: string,
  signal: AbortSignal,
): Promise<DirEntry[]> {
  const out: DirEntry[] = [];
  for await (const e of Deno.readDir(path)) {
    if (signal.aborted) break;
    if (e.isDirectory && !e.isSymlink) {
      out.push({ name: e.name, path: join(path, e.name) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Whether `ffmpeg` and `ffprobe` are on PATH — needed to merge video + audio. */
export async function hasFFmpeg(): Promise<boolean> {
  const ok = (bin: string) =>
    new Deno.Command(bin, {
      args: ["-version"],
      stdout: "null",
      stderr: "null",
    })
      .output().then((o) => o.success, () => false);
  return (await Promise.all([ok("ffmpeg"), ok("ffprobe")])).every(Boolean);
}

/** Reveal a folder in the OS file manager, creating it first (the default dir
 *  does not exist before the first download). */
export async function openInFileManager(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
  const { openExternal } = await import("aio/server");
  await openExternal(path);
}

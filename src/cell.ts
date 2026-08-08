// Cell — pure state + methods; UI and server both import from here.
//
// Everything that touches yt-dlp, the filesystem, or a subprocess lives in
// ./ayd.server.ts behind a DYNAMIC import (docs/build/imports.md §2), so none of it
// reaches the browser bundle. Long-running work takes `s.$signal` and is cancelled
// by `stop` (docs/state/methods.md#cancellation--cancelon--ssignal).
//
// Every await is a commit point (docs/state/transactional-methods.md §1): what a
// method needs is gathered before its first await, and later writes go through
// `patch`, which finds the item by id in the CURRENT state — it may have moved
// or been removed meanwhile.

import { cell, type MethodDraftMeta } from "aio";

export type Format = {
  format_id: string;
  ext: string;
  resolution?: string;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
};

export type VideoMeta = {
  id: string;
  title: string;
  thumbnail?: string;
  duration?: number;
  formats: Format[];
};

export type Codec = "h264" | "vp9" | "vp9-1080p";

/** Optional yt-dlp access options: cookies, user agent, player client. */
export type AccessOpts = {
  cookiesPath: string;
  userAgent: string;
  playerClient: string;
};

type Status = "ready" | "loading" | "downloading" | "finished" | "error";

/** One entry in the download queue. Each item owns its own formats and state. */
export type QueueItem = {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  formats: Format[];
  selected: string;
  bestCombined: string;
  bestVideoOnly: string;
  bestAudioOnly: string;
  status: Status;
  statusText: string;
  progress: number;
  error: string | null;
};

type State = {
  url: string;
  queue: QueueItem[];
  activeId: string;
  building: boolean;
  dir: string;
  error: string | null;
  notice: string;
  browseOpen: boolean;
  browsePath: string;
  browseDirs: { name: string; path: string }[];
  ffmpeg: boolean;
  codecPref: Codec;
} & AccessOpts;

type Draft = State & Partial<MethodDraftMeta>;

/** A codec field is "present" only when it is a real codec, not "none"/missing. */
function hasCodec(c?: string): boolean {
  return Boolean(c && c !== "none");
}

/** A format is "video-only" when it has a video codec and no audio codec. */
export function isVideoOnly(f: Format): boolean {
  return hasCodec(f.vcodec) && !hasCodec(f.acodec);
}
/** A format is "audio-only" when it has an audio codec and no video codec. */
export function isAudioOnly(f: Format): boolean {
  return hasCodec(f.acodec) && !hasCodec(f.vcodec);
}
/** A format carries both audio and video (best combined quality). */
export function isCombined(f: Format): boolean {
  return hasCodec(f.vcodec) && hasCodec(f.acodec);
}

/** Parse a resolution string ("1080p", "1920x1080") into a comparable number. */
function resOf(s?: string): number {
  const m = s?.match(/(\d{3,4})/);
  return m ? Number(m[1]) : 0;
}

/** Pick the "best" format of a set: highest resolution, then fps, then bitrate. */
export function pickBest(list: Format[]): Format | undefined {
  return list.reduce<Format | undefined>((best, f) => {
    if (!best) return f;
    const r = resOf(f.resolution), rb = resOf(best.resolution);
    const b = f.fps ?? 0, bb = best.fps ?? 0;
    const t = f.tbr ?? f.filesize ?? 0, tb = best.tbr ?? best.filesize ?? 0;
    if (r !== rb) return r > rb ? f : best;
    if (b !== bb) return b > bb ? f : best;
    return t > tb ? f : best;
  }, undefined);
}

/** Tag the best of each class, list them first, preselect the best combined. */
export function classify(formats: Format[]) {
  const best = (p: (f: Format) => boolean) =>
    pickBest(formats.filter(p))?.format_id ?? "";
  const bestCombined = best(isCombined);
  const bestAudioOnly = best(isAudioOnly);
  const bestVideoOnly = best(isVideoOnly);
  const order = [bestCombined, bestAudioOnly, bestVideoOnly];
  const rank = (f: Format) => {
    const i = order.indexOf(f.format_id);
    return i < 0 ? order.length : i;
  };
  return {
    formats: [...formats].sort((a, b) => rank(a) - rank(b)),
    bestCombined,
    bestVideoOnly,
    bestAudioOnly,
    selected: bestCombined || bestVideoOnly || bestAudioOnly,
  };
}

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

const access = (s: State): AccessOpts => ({
  cookiesPath: s.cookiesPath,
  userAgent: s.userAgent,
  playerClient: s.playerClient,
});

/** Write onto queue item `id` as it is NOW (no-op if it was removed). */
function patch(s: State, id: string, p: Partial<QueueItem>): void {
  const item = s.queue.find((q) => q.id === id);
  if (item) Object.assign(item, p);
}

function newItem(url: string): QueueItem {
  return {
    id: crypto.randomUUID(),
    url,
    title: "",
    thumbnail: "",
    formats: [],
    selected: "",
    bestCombined: "",
    bestVideoOnly: "",
    bestAudioOnly: "",
    status: "ready",
    statusText: "Queued",
    progress: 0,
    error: null,
  };
}

type Io = typeof import("./ayd.server.ts");
type Work = (
  io: Io,
  dir: string,
  cb: import("./ayd.server.ts").Progress,
  signal: AbortSignal,
) => Promise<void>;

/** Shared body of `download` and `buildOne`: status, progress, finish/cancel/fail. */
async function transfer(s: Draft, id: string, label: string, work: Work) {
  const dir = s.dir;
  patch(s, id, {
    status: "downloading",
    statusText: label,
    error: null,
    progress: 0,
  });
  s.$commit!();
  const signal = s.$signal!;
  try {
    const io = await import("./ayd.server.ts");
    const out = dir || io.defaultDir();
    await work(io, out, {
      progress: (progress) => {
        patch(s, id, { progress });
        s.$commit!();
      },
      status: (statusText) => {
        patch(s, id, { statusText });
        s.$commit!();
      },
    }, signal);
    patch(s, id, {
      progress: 100,
      status: "finished",
      statusText: `Finished → ${out}`,
    });
  } catch (e) {
    patch(
      s,
      id,
      signal.aborted
        ? { status: "ready", statusText: "Cancelled" }
        : { status: "error", error: message(e), statusText: "Failed" },
    );
  }
}

/** UI-only fields: never stored. */
const TRANSIENT = [
  "url",
  "building",
  "error",
  "notice",
  "browseOpen",
  "browsePath",
  "browseDirs",
  "ffmpeg",
] as const;

export const ayd = cell("ayd", {
  // Settings + queue survive a restart; UI-transient fields do not, and a queue
  // item is stored as just its link + title (a mid-flight run restarts clean).
  persist: { exclude: [...TRANSIENT] },
  // v0 stored every field; v1 drops the transient ones from that old store.
  version: 1,
  onMigrate: (s) =>
    Object.fromEntries(
      Object.entries(s).filter(([k]) => !TRANSIENT.includes(k as never)),
    ) as typeof s,
  onPersist: (s) => ({
    ...s,
    queue: (s.queue as QueueItem[]).map((q) => ({
      ...newItem(q.url),
      id: q.id,
      title: q.title,
      thumbnail: q.thumbnail,
    })),
  }),
  long: ["loadFormats", "download", "buildOne", "buildOptimal", "updateYtdlp"],
  cancelOn: {
    loadFormats: ["ayd:stop"],
    download: ["ayd:stop"],
    buildOne: ["ayd:stop"],
    buildOptimal: ["ayd:stop"],
  },

  state: {
    url: "",
    queue: [] as QueueItem[],
    activeId: "",
    building: false,
    dir: "",
    error: null as string | null,
    notice: "",
    browseOpen: false,
    browsePath: "",
    browseDirs: [] as { name: string; path: string }[],
    ffmpeg: false,
    codecPref: "h264" as Codec,
    cookiesPath: "",
    userAgent: "",
    playerClient: "default",
  },

  methods: {
    /** Update the URL input as the user types. */
    setUrl(s: State, url: string) {
      s.url = url;
    },

    /** Add the entered URL to the queue and clear the input. */
    addToQueue(s: State) {
      const target = s.url.trim();
      if (!target) {
        s.error = "Enter a YouTube link first.";
        return;
      }
      if (s.queue.some((q) => q.url === target)) {
        s.error = "That link is already in the queue.";
        return;
      }
      const item = newItem(target);
      s.queue.push(item);
      s.activeId = item.id;
      s.url = "";
      s.error = null;
    },

    /** Remove an item from the queue. */
    removeFromQueue(s: State, id: string) {
      s.queue = s.queue.filter((q) => q.id !== id);
      if (s.activeId === id) s.activeId = s.queue[0]?.id ?? "";
    },

    /** Select an item to view its details. */
    selectItem(s: State, id: string) {
      s.activeId = id;
      s.error = null;
    },

    /** Cancel whatever is running (load, download, build). */
    stop(_s: State) {},

    /** Check for ffmpeg once at start — the optimal build needs it. */
    async probe(s: Draft) {
      const io = await import("./ayd.server.ts");
      s.ffmpeg = await io.hasFFmpeg();
    },

    /** Fetch formats for the active item. */
    async loadFormats(s: Draft) {
      const id = s.activeId;
      const item = s.queue.find((q) => q.id === id);
      if (!item) {
        s.error = "Select an item from the queue first.";
        return;
      }
      const { url } = item;
      const opts = access(s);
      const signal = s.$signal!;
      patch(s, id, {
        status: "loading",
        statusText: "Loading formats…",
        error: null,
      });
      s.$commit!();
      try {
        const io = await import("./ayd.server.ts");
        const meta = await io.inspect(url, signal, opts);
        const found = classify(meta.formats);
        const n = found.formats.length;
        patch(s, id, {
          ...found,
          title: meta.title,
          thumbnail: meta.thumbnail ?? "",
          status: n ? "ready" : "error",
          statusText: n ? `${n} formats` : "No formats",
          error: n ? null : "No downloadable formats found for this video.",
        });
      } catch (e) {
        patch(
          s,
          id,
          signal.aborted
            ? { status: "ready", statusText: "Cancelled" }
            : { status: "error", error: message(e), statusText: "Failed" },
        );
      }
    },

    /** Mark a format as the download target for the active item. */
    select(s: State, formatId: string) {
      patch(s, s.activeId, { selected: formatId });
    },

    /** Download the selected format of the active item. */
    async download(s: Draft) {
      const item = s.queue.find((q) => q.id === s.activeId);
      if (!item) {
        s.error = "Select an item from the queue first.";
        return;
      }
      if (!item.selected) {
        patch(s, item.id, { status: "error", error: "Select a format." });
        return;
      }
      const { url, selected } = item;
      const opts = access(s);
      await transfer(
        s,
        item.id,
        "Downloading…",
        (io, dir, cb, signal) =>
          io.download(selected, dir, url, cb, signal, opts),
      );
    },

    /** Build the optimal version for one item (best video + best audio merged). */
    async buildOne(s: Draft, id: string) {
      const item = s.queue.find((q) => q.id === id);
      if (!item) return;
      if (!s.ffmpeg) {
        patch(s, id, {
          status: "error",
          error: "ffmpeg not found — install it and restart.",
        });
        return;
      }
      const { url } = item;
      const codec = s.codecPref;
      const opts = access(s);
      await transfer(
        s,
        id,
        "Building optimal version…",
        (io, dir, cb, signal) =>
          io.downloadOptimal(dir, url, codec, cb, signal, opts),
      );
    },

    /** Build every queued item, one by one. Items added meanwhile are picked up;
     *  a finished item leaves the queue, a failed one stays with its error. */
    async buildOptimal(s: Draft) { // aio-ok: re-reads the live queue on purpose — it grows while building
      if (s.building) return;
      s.building = true;
      s.error = null;
      s.$commit!();
      const signal = s.$signal!;
      const tried = new Set<string>();
      try {
        while (!signal.aborted) {
          const next = s.queue.find((q) => !tried.has(q.id));
          if (!next) break;
          tried.add(next.id);
          s.activeId = next.id;
          s.$commit!();
          await ayd.buildOne(next.id);
          if (s.queue.find((q) => q.id === next.id)?.status === "finished") {
            s.queue = s.queue.filter((q) => q.id !== next.id);
            s.activeId = s.queue[0]?.id ?? "";
          }
        }
      } finally {
        s.building = false;
      }
    },

    /** Reveal the download folder in the OS file manager. */
    async open(s: Draft) {
      const dir = s.dir;
      try {
        const io = await import("./ayd.server.ts");
        await io.openInFileManager(dir || io.defaultDir());
      } catch (e) {
        s.error = message(e);
      }
    },

    /** Set the download directory from the UI (a manual path entry). */
    setDir(s: State, dir: string) {
      s.dir = dir;
    },

    /** Choose the codec family for the optimal version (H.264 default). */
    setCodecPref(s: State, pref: Codec) {
      s.codecPref = pref;
    },

    /** Path to a browser cookies file (Netscape format). Empty = anonymous. */
    setCookiesPath(s: State, path: string) {
      s.cookiesPath = path;
    },

    /** Custom User-Agent. Empty = yt-dlp default. */
    setUserAgent(s: State, ua: string) {
      s.userAgent = ua;
    },

    /** YouTube player client (default / web / tv / android). */
    setPlayerClient(s: State, client: string) {
      s.playerClient = client;
    },

    /** Open the in-app folder picker at `path` (default: the download dir). */
    async browse(s: Draft, path = "") {
      const from = path || s.dir;
      const signal = s.$signal!;
      const io = await import("./ayd.server.ts");
      const target = from || io.defaultDir();
      s.browseOpen = true;
      s.browsePath = target;
      s.$commit!();
      try {
        const dirs = await io.listDirs(target, signal);
        // aio-ok: a newer browse owns the picker — this result is stale
        if (s.browsePath === target) s.browseDirs = dirs;
      } catch {
        // aio-ok: same staleness guard; a missing/unreadable folder lists empty
        if (s.browsePath === target) s.browseDirs = [];
      }
    },

    /** Walk one level up in the folder picker. */
    browseUp(s: State) {
      const parent = s.browsePath.replace(/\/+$/, "").replace(/\/[^/]+$/, "") ||
        "/";
      if (s.browsePath && parent !== s.browsePath) ayd.browse(parent);
    },

    /** Confirm the current browse path as the download directory. */
    browseSelect(s: State) {
      s.dir = s.browsePath;
      s.browseOpen = false;
      s.browseDirs = [];
    },

    /** Close the folder picker without changing the directory. */
    browseClose(s: State) {
      s.browseOpen = false;
      s.browseDirs = [];
    },

    /** Update yt-dlp in place; the result shows as a notice. */
    async updateYtdlp(s: Draft) {
      s.error = null;
      s.notice = "Updating yt-dlp…";
      s.$commit!();
      try {
        const io = await import("./ayd.server.ts");
        s.notice = await io.update();
      } catch (e) {
        s.notice = "";
        s.error = message(e);
      }
    },
  },

  selectors: {
    /** The currently active queue item, or null. */
    active: (s: State) => s.queue.find((q) => q.id === s.activeId) ?? null,
  },
});

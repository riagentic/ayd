// Test helper — a fake yt-dlp (+ ffmpeg/ffprobe) so every flow runs with no
// network. The URL picks the behavior: "fail" errors, "slow" hangs until killed,
// anything else succeeds. Everything it creates is removed afterwards.
import { join } from "@std/path";

const FORMATS = JSON.stringify({
  id: "x",
  title: "Fake video",
  formats: [
    { format_id: "a1", ext: "m4a", vcodec: "none", acodec: "mp4a" },
    {
      format_id: "v1",
      ext: "mp4",
      vcodec: "avc1",
      acodec: "none",
      resolution: "1920x1080",
    },
    {
      format_id: "c1",
      ext: "mp4",
      vcodec: "avc1",
      acodec: "mp4a",
      resolution: "640x360",
    },
  ],
});

const YTDLP = `#!/bin/sh
for a; do url="$a"; done
case "$*" in
  *--update*) echo "Latest version: fake"; echo "yt-dlp is up to date (fake)"; exit 0 ;;
esac
case "$url" in
  *fail*) echo "WARNING: noise" >&2; echo "ERROR: fake failure" >&2; exit 1 ;;
  *slow*) exec sleep 30 ;;
esac
case "$*" in
  *--dump-single-json*) echo '${FORMATS}' ;;
  *) echo "[download] Destination: out.mp4"
     echo "[download]  50.0% of 1MiB"
     echo "[download] 100.0% of 1MiB" ;;
esac
`;

/** Run `fn` with AYD_YTDLP and PATH pointing at the fakes, then clean up. */
export async function withFake<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "ayd-fake-" });
  const put = (name: string, body: string) =>
    Deno.writeTextFile(join(dir, name), body, { mode: 0o755 });
  await put("yt-dlp", YTDLP);
  await put("ffmpeg", "#!/bin/sh\nexit 0\n");
  await put("ffprobe", "#!/bin/sh\nexit 0\n");
  const path = Deno.env.get("PATH") ?? "";
  Deno.env.set("AYD_YTDLP", join(dir, "yt-dlp"));
  Deno.env.set("PATH", `${dir}:${path}`);
  try {
    return await fn();
  } finally {
    Deno.env.delete("AYD_YTDLP");
    Deno.env.set("PATH", path);
    await Deno.remove(dir, { recursive: true });
  }
}

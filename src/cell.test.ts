// Tests for ayd. The format classification and best-format selection are pure
// functions — tested directly, no network. Queue behavior is tested with
// testCell against the real cell; yt-dlp flows run against a fake (no network).
import { assertEquals } from "@std/assert";
import { testCell } from "aio/testing";
import {
  ayd,
  classify,
  isAudioOnly,
  isCombined,
  isVideoOnly,
  pickBest,
} from "./cell.ts";
import type { Format } from "./cell.ts";
import { parseProgress } from "./ayd.server.ts";
import { withFake } from "./fake-ytdlp.ts";

const fmt = (
  id: string,
  v: string | undefined,
  a: string | undefined,
  res?: string,
  fps?: number,
  tbr?: number,
): Format => ({
  format_id: id,
  ext: "mp4",
  vcodec: v,
  acodec: a,
  resolution: res,
  fps,
  tbr,
});

Deno.test("isVideoOnly / isAudioOnly / isCombined classify formats", () => {
  assertEquals(isVideoOnly(fmt("v", "avc1", undefined, "1080p")), true);
  assertEquals(isVideoOnly(fmt("v", "avc1", "none", "1080p")), true);
  assertEquals(isVideoOnly(fmt("a", undefined, "mp4a")), false);
  assertEquals(isAudioOnly(fmt("a", undefined, "mp4a")), true);
  assertEquals(isAudioOnly(fmt("a", "none", "mp4a")), true);
  assertEquals(isAudioOnly(fmt("v", "avc1", undefined)), false);
  assertEquals(isCombined(fmt("c", "avc1", "mp4a", "720p")), true);
  assertEquals(isCombined(fmt("v", "avc1", undefined)), false);
  assertEquals(isCombined(fmt("n", "none", "mp4a")), false);
});

Deno.test("pickBest prefers higher resolution, then fps, then bitrate", () => {
  const list = [
    fmt("low", "avc1", "mp4a", "480p", 30, 1000),
    fmt("high", "avc1", "mp4a", "1080p", 60, 5000),
    fmt("med", "avc1", "mp4a", "720p", 30, 2000),
  ];
  assertEquals(pickBest(list)?.format_id, "high");
  assertEquals(pickBest([]), undefined);
});

Deno.test("pickBest breaks resolution ties by fps", () => {
  const list = [
    fmt("s30", "avc1", "mp4a", "1080p", 30),
    fmt("s60", "avc1", "mp4a", "1080p", 60),
  ];
  assertEquals(pickBest(list)?.format_id, "s60");
});

testCell(ayd, "addToQueue adds an item and clears the input", async (t) => {
  await t.send.setUrl("https://example.com/v1");
  await t.send.addToQueue();
  const s = t.getState();
  assertEquals(s.queue.length, 1);
  assertEquals(s.queue[0]!.url, "https://example.com/v1");
  assertEquals(s.url, "");
  assertEquals(s.activeId, s.queue[0]!.id);
});

testCell(ayd, "addToQueue rejects duplicates and empty input", async (t) => {
  await t.send.setUrl("https://example.com/v1");
  await t.send.addToQueue();
  await t.send.setUrl("https://example.com/v1");
  await t.send.addToQueue();
  assertEquals(t.getState().queue.length, 1, "duplicate not added");

  await t.send.setUrl("   ");
  await t.send.addToQueue();
  assertEquals(t.getState().queue.length, 1, "blank not added");
});

testCell(ayd, "removeFromQueue removes the item and reselects", async (t) => {
  await t.send.setUrl("https://example.com/v1");
  await t.send.addToQueue();
  await t.send.setUrl("https://example.com/v2");
  await t.send.addToQueue();
  const first = t.getState().queue[0]!.id;
  await t.send.removeFromQueue(first);
  const s = t.getState();
  assertEquals(s.queue.length, 1);
  assertEquals(s.queue[0]!.url, "https://example.com/v2");
  assertEquals(s.activeId, s.queue[0]!.id);
});

testCell(ayd, "selectItem switches the active item", async (t) => {
  await t.send.setUrl("https://example.com/v1");
  await t.send.addToQueue();
  await t.send.setUrl("https://example.com/v2");
  await t.send.addToQueue();
  const first = t.getState().queue[0]!.id;
  await t.send.selectItem(first);
  assertEquals(t.getState().activeId, first);
});

testCell(ayd, "setDir and setCodecPref update their fields", async (t) => {
  await t.send.setDir("/tmp/out");
  await t.send.setCodecPref("vp9");
  const s = t.getState();
  assertEquals(s.dir, "/tmp/out");
  assertEquals(s.codecPref, "vp9");
});

Deno.test("classify tags the best of each class, lists them first, preselects", () => {
  const c = classify([
    fmt("v-low", "avc1", "none", "480p"),
    fmt("c", "avc1", "mp4a", "720p"),
    fmt("v", "avc1", "none", "1080p"),
    fmt("a", "none", "mp4a"),
  ]);
  assertEquals(c.bestCombined, "c");
  assertEquals(c.bestVideoOnly, "v");
  assertEquals(c.bestAudioOnly, "a");
  assertEquals(c.selected, "c");
  assertEquals(c.formats.map((f) => f.format_id), ["c", "a", "v", "v-low"]);
  assertEquals(classify([fmt("a", "none", "mp4a")]).selected, "a");
});

Deno.test("parseProgress reads yt-dlp --newline progress lines only", () => {
  assertEquals(parseProgress("[download]  42.3% of 12.34MiB at 1MiB/s"), 42.3);
  assertEquals(parseProgress("[download] Destination: 50% off.mp4"), -1);
  assertEquals(parseProgress("[Merger] Merging formats"), -1);
});

const add = async (
  t: {
    send: {
      setUrl: (u: string) => Promise<unknown>;
      addToQueue: () => Promise<unknown>;
    };
  },
  url: string,
) => {
  await t.send.setUrl(url);
  await t.send.addToQueue();
};

testCell(
  ayd,
  "loadFormats classifies and preselects the best combined",
  (t) =>
    withFake(async () => {
      await add(t, "https://example.com/ok");
      await t.send.loadFormats();
      const item = t.getState().queue[0]!;
      assertEquals(item.status, "ready");
      assertEquals(item.title, "Fake video");
      assertEquals(item.selected, "c1");
      assertEquals(item.bestVideoOnly, "v1");
      assertEquals(item.bestAudioOnly, "a1");
    }),
);

testCell(
  ayd,
  "download reports progress and finishes",
  (t) =>
    withFake(async () => {
      await t.send.setDir("/nonexistent-ayd-out");
      await add(t, "https://example.com/ok");
      await t.send.loadFormats();
      await t.send.download();
      const item = t.getState().queue[0]!;
      assertEquals(item.status, "finished");
      assertEquals(item.progress, 100);
      assertEquals(item.statusText, "Finished → /nonexistent-ayd-out");
    }),
);

testCell(
  ayd,
  "a yt-dlp failure shows its ERROR line",
  (t) =>
    withFake(async () => {
      await add(t, "https://example.com/fail");
      await t.send.loadFormats();
      const item = t.getState().queue[0]!;
      assertEquals(item.status, "error");
      assertEquals(item.error, "ERROR: fake failure");
    }),
);

testCell(ayd, "stop cancels a running download", (t) =>
  withFake(async () => {
    await add(t, "https://example.com/slow");
    await t.send.select("c1");
    const running = t.send.download();
    await new Promise((r) => setTimeout(r, 300));
    await t.send.stop();
    await running;
    const item = t.getState().queue[0]!;
    assertEquals(item.status, "ready");
    assertEquals(item.statusText, "Cancelled");
  }));

testCell(
  ayd,
  "buildOptimal removes finished items and keeps failed ones",
  (t) =>
    withFake(async () => {
      await t.send.probe();
      assertEquals(t.getState().ffmpeg, true);
      await add(t, "https://example.com/ok1");
      await add(t, "https://example.com/fail");
      await add(t, "https://example.com/ok2");
      await t.send.buildOptimal();
      const s = t.getState();
      assertEquals(s.queue.map((q) => q.url), ["https://example.com/fail"]);
      assertEquals(s.queue[0]!.error, "ERROR: fake failure");
      assertEquals(s.building, false);
    }),
);

testCell(ayd, "buildOne refuses without ffmpeg", async (t) => {
  await add(t, "https://example.com/v1");
  await t.send.buildOne(t.getState().queue[0]!.id);
  assertEquals(t.getState().queue[0]!.status, "error");
});

testCell(
  ayd,
  "updateYtdlp shows yt-dlp's last line as a notice",
  (t) =>
    withFake(async () => {
      await t.send.updateYtdlp();
      assertEquals(t.getState().notice, "yt-dlp is up to date (fake)");
      assertEquals(t.getState().error, null);
    }),
);

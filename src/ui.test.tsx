// UI test — renders the real App and drives it semantically (no selectors, no
// network). The browse flow reads the actual filesystem, so it runs headless
// without ever hitting YouTube.
import { assert } from "@std/assert";
import { join } from "@std/path";
import { testUI } from "aio/testing";
import App from "./App.tsx";
import { ayd } from "./cell.ts";
import { withFake } from "./fake-ytdlp.ts";

Deno.test("ayd UI: renders header and browse flow against the real filesystem", async () => {
  const root = await Deno.makeTempDir({ prefix: "ayd-ui-" });
  await Deno.mkdir(join(root, "music"));
  await Deno.mkdir(join(root, "video"));
  try {
    await using ui = await testUI(App);
    await ayd.setDir(root);
    await ui.settle();

    // The UI shows the app title and the default status.
    assert(ui.surface().text.includes("ayd"), "app header renders");
    assert(ui.surface().text.includes("Add"), "add button renders");
    assert(ui.surface().text.includes("Update"), "update button renders");
    assert(ui.surface().text.includes("Open"), "open-folder button renders");
    assert(ui.surface().text.includes("Browse"), "browse button renders");

    // Open the folder picker and list the temp dir's children.
    ui.browse.click();
    await ui.waitFor(() => ayd.browseOpen === true, "browse dialog opens");
    await ui.waitFor(() => ayd.browseDirs.length >= 2, "child dirs are listed");
    assert(
      ayd.browseDirs.some((d) => d.name === "music"),
      "a child folder is listed",
    );
    assert(
      ayd.browseDirs.some((d) => d.name === "video"),
      "both child folders are listed",
    );

    // Confirm a directory as the download target.
    ui.Browser["dir-video"].click();
    await ui.waitFor(
      () => ayd.browsePath === join(root, "video"),
      "drilled into video",
    );
    ui.Browser.browseSelect.click();
    await ui.waitFor(() => ayd.browseOpen === false, "picker closes");
    assert(
      ayd.dir === join(root, "video"),
      "picked folder becomes the download dir",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ayd UI: add to queue, select, and remove items", async () => {
  await using ui = await testUI(App);
  await ui.settle();

  // Add two items via the input + Add button.
  ui.url.type("https://example.com/v1");
  ui.add.click();
  await ui.waitFor(() => ayd.queue.length === 1, "first item queued");
  assert(ayd.queue[0]!.url === "https://example.com/v1", "first url stored");

  ui.url.type("https://example.com/v2");
  ui.add.click();
  await ui.waitFor(() => ayd.queue.length === 2, "second item queued");

  // The queue list is visible with both items.
  assert(ayd.queue.length === 2, "two items in queue state");
  assert(ayd.queue[0]!.url === "https://example.com/v1", "first url stored");
  assert(ayd.queue[1]!.url === "https://example.com/v2", "second url stored");

  // Select the first item.
  ui["queue-0"].click();
  await ui.waitFor(
    () => ayd.activeId === ayd.queue[0]!.id,
    "first item selected",
  );

  // Remove the first item.
  ui["remove-0"].click();
  await ui.waitFor(() => ayd.queue.length === 1, "item removed");
  assert(ayd.queue[0]!.url.endsWith("v2"), "remaining item is v2");
});

Deno.test("ayd UI: get formats, recommended preselected, download finishes", () =>
  withFake(async () => {
    await using ui = await testUI(App);
    ui.url.type("https://example.com/ok");
    ui.add.click();
    await ui.waitFor(() => ayd.queue.length === 1, "item queued");
    ui.load.click();
    await ui.waitFor(
      () => ayd.active()?.formats.length === 3,
      "formats listed",
    );
    await ui.waitFor(
      () => ui.ItemDetails.text.includes("recommended"),
      "best combined tagged",
    );
    assert(ayd.active()?.selected === "c1", "recommended preselected");
    ui.download.click();
    await ui.waitFor(
      () => ayd.active()?.status === "finished",
      "download finished",
    );
    assert(ayd.active()?.progress === 100, "progress at 100%");
  }));

Deno.test("ayd UI: Update shows yt-dlp's answer as a notice", () =>
  withFake(async () => {
    await using ui = await testUI(App);
    ui.updateYtdlp.click();
    await ui.waitFor(
      () => ui.notice.text.includes("up to date"),
      "notice rendered",
    );
  }));

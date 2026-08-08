// Entry — zero-config: cells self-register on import; appId/version/baseDir
// are inferred from deno.json + this file's location.
import { ayd } from "./cell.ts";
import { aio } from "aio";

// aio-ok: single-user local app — every client needs every key
await aio.run({
  // docs/state/lifecycle.md — onStart is the door for boot-time work.
  onStart: () => ayd.probe(),
});

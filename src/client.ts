// Thin CLI client — live view of a running server's state over WebSocket.
// Run it against a dev server (`deno run -A src/client.ts`); the
// `cli-client` build target compiles it into a standalone client binary
// (add "cli-client" to build.targets, then `deno task build`). No local server.
import { connectCli } from "aio/server";
import { log } from "aio";

const url = Deno.args[0] || "ws://localhost:8000/ws";
log.info("cli", `connecting to ${url} ...`);
const app = connectCli(url);
await app.ready;
log.info("cli", `state: ${JSON.stringify(app.state, null, 2)}`);
app.subscribe(() => log.info("cli", `state: ${JSON.stringify(app.state)}`));

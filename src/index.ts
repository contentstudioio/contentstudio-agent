/**
 * contentstudio — CLI for the ContentStudio public API.
 *
 *   contentstudio --help
 *   contentstudio auth:login --api-key cs_...
 *   contentstudio --json posts:list --per-page 5
 *   contentstudio posts:create --content "Hi" --account 12345 --publish-type draft --dry-run
 *
 * Entry point — wires all command groups onto a single yargs instance.
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { VERSION } from "./api";
import { registerAuth } from "./commands/auth";
import { registerComments } from "./commands/comments";
import { registerCrud } from "./commands/crud";
import { registerConnect } from "./commands/connect";
import { registerFacebook } from "./commands/facebook";
import { registerLookups } from "./commands/lookups";
import { registerMedia } from "./commands/media";
import { registerPosts } from "./commands/posts";
import { registerWorkspaces } from "./commands/workspaces";
import { maybeNotifyUpdate } from "./updateCheck";

// Print "update available" banner if a newer version is on npm. Cached for
// 24h, fire-and-forget, never blocks. Honors --json / --help / non-TTY /
// CONTENTSTUDIO_NO_UPDATE_CHECK=1 to stay quiet when appropriate.
maybeNotifyUpdate(VERSION);

let cli = yargs(hideBin(process.argv))
  .scriptName("contentstudio")
  .usage("$0 <command> [options]")
  .version(VERSION)
  .option("json", {
    type: "boolean",
    default: false,
    describe: "Emit a JSON envelope to stdout for agent consumption.",
  })
  .option("workspace", {
    type: "string",
    describe: "Override the active workspace ID for this call.",
  })
  .option("base-url", {
    type: "string",
    describe: "Override the API base URL.",
  })
  .strict()
  .help("h")
  .alias("h", "help")
  .alias("v", "version")
  .demandCommand(1, "Specify a command. Run `contentstudio --help` for the full list.")
  .recommendCommands();

cli = registerAuth(cli);
cli = registerWorkspaces(cli);
cli = registerLookups(cli);
cli = registerCrud(cli);
cli = registerConnect(cli);
cli = registerFacebook(cli);
cli = registerMedia(cli);
cli = registerPosts(cli);
cli = registerComments(cli);

cli.parse();

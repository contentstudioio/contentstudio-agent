import type { Argv } from "yargs";

import { addComment, listComments } from "../api";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

export function registerComments<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "comments:list <post_id>",
      "List comments / internal notes on a post.",
      (y) =>
        y
          .positional("post_id", { type: "string", demandOption: true })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listComments(client, wid, String(argv.post_id), {
          page: argv.page,
          per_page: argv["per-page"] ?? argv.perPage,
        });
        const items = (resp.data as any[]) ?? [];
        out.emitSuccess(
          resp.data,
          g,
          () =>
            out.table(
              ["ID", "Author", "Note?", "Comment"],
              items.map((c) => [
                String(c.id ?? c._id ?? "-"),
                c?.author?.full_name ?? c?.user_name ?? "-",
                c.is_note ? "yes" : "no",
                String(c.comment ?? "").slice(0, 60),
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "comments:add <post_id> <message>",
      "Add a public comment or internal note on a post.",
      (y) =>
        y
          .positional("post_id", { type: "string", demandOption: true })
          .positional("message", { type: "string", demandOption: true })
          .option("note", {
            type: "boolean",
            default: false,
            describe: "Mark as internal note (not a public comment).",
          })
          .option("mention", {
            type: "string",
            array: true,
            describe: "User ID to mention. Repeatable.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mentions = argv.mention as string[] | undefined;
        const body: Record<string, unknown> = { comment: argv.message };
        if (argv.note) body.is_note = true;
        if (mentions && mentions.length) body.mentioned_users = mentions;
        if (argv["dry-run"] ?? argv.dryRun) {
          out.emitSuccess(
            {
              dry_run: true,
              endpoint: `POST /workspaces/${wid}/posts/${argv.post_id}/comments`,
              body,
            },
            g,
            () => {
              out.info(`DRY RUN — would add comment to ${argv.post_id}`);
              console.log(JSON.stringify(body, null, 2));
            },
          );
          return;
        }
        const data = await addComment(
          client,
          wid,
          String(argv.post_id),
          String(argv.message),
          { isNote: !!argv.note, mentionedUsers: mentions },
        );
        out.emitSuccess(data, g, () => out.success("Comment added."));
      }),
    );
}

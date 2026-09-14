import type { Argv } from "yargs";

import { listMedia, uploadMedia } from "../api";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

export function registerMedia<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "media:list",
      "List media assets in the workspace.",
      (y) =>
        y
          .option("type", { type: "string", choices: ["images", "videos"] })
          .option("sort", {
            type: "string",
            choices: ["recent", "oldest", "size", "a2z", "z2a"],
          })
          .option("search", { type: "string" })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listMedia(client, wid, {
          type: argv.type,
          sort: argv.sort,
          search: argv.search,
          page: argv.page,
          per_page: argv["per-page"] ?? argv.perPage,
        });
        const items = (resp.data as any[]) ?? [];
        out.emitSuccess(
          resp.data,
          g,
          () =>
            out.table(
              ["ID", "Type", "Name", "Size"],
              items.map((m) => [
                String(m.id ?? m._id ?? "-"),
                m.mime_type ?? m.type ?? "-",
                m.name ?? m.filename ?? "-",
                String(m.size ?? m.file_size ?? "-"),
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "media:upload",
      "Upload a file (--file) OR import from a URL (--url).",
      (y) =>
        y
          .option("file", { type: "string", describe: "Local file path." })
          .option("url", { type: "string", describe: "External URL to import." })
          .option("folder-id", { type: "string", describe: "Folder ID." })
          .option("dry-run", {
            type: "boolean",
            default: false,
            describe: "Print payload that would be uploaded without calling the API.",
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const folderId = argv["folder-id"] ?? argv.folderId;
        const dryRun = !!(argv["dry-run"] ?? argv.dryRun);
        const preview = {
          workspace_id: wid,
          file: argv.file ?? null,
          url: argv.url ?? null,
          folder_id: folderId ?? null,
        };
        if (dryRun) {
          out.emitSuccess(
            {
              dry_run: true,
              endpoint: `POST /workspaces/${wid}/media (multipart)`,
              body: preview,
            },
            g,
            () => {
              out.info(`DRY RUN — would POST /workspaces/${wid}/media`);
              console.log(JSON.stringify(preview, null, 2));
            },
          );
          return;
        }
        const data: any = await uploadMedia(client, wid, {
          filePath: argv.file,
          url: argv.url,
          folderId,
        });
        out.emitSuccess(data, g, (d: any) => {
          out.success("Uploaded.");
          out.status(
            "ID",
            String(d?.id ?? d?._id ?? d?.data?.id ?? d?.data?._id ?? "-"),
          );
        });
      }),
    );
}

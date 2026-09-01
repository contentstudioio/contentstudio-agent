import type { Argv } from "yargs";

import {
  archiveMedia,
  createMediaFolder,
  deleteMedia,
  deleteMediaFolder,
  flagMediaBrandAsset,
  getMediaStorage,
  listMedia,
  listMediaFolders,
  moveMedia,
  renameMediaFolder,
  unflagMediaBrandAsset,
  updateMediaNote,
  uploadMedia,
} from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import {
  buildClient,
  emitDryRun,
  isDryRun,
  resolveWorkspace,
  run,
} from "../cliCtx";

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
          .option("per-page", { type: "number" })
          .option("folder-id", { type: "string", describe: "Restrict to one folder." })
          .option("archived", { type: "boolean", describe: "List archived media instead." }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listMedia(client, wid, {
          type: argv.type,
          sort: argv.sort,
          search: argv.search,
          page: argv.page,
          per_page: argv["per-page"] ?? argv.perPage,
          folder_id: argv["folder-id"] ?? argv.folderId,
          archived: argv.archived,
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
    )
    .command(
      "media:folders:list",
      "List media folders in the workspace.",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await listMediaFolders(client, wid);
        out.emitSuccess(data, g, (d: any) => {
          // The real API returns the array under `folders`, not `data` —
          // fall back through both shapes so this survives either envelope.
          const folders: any[] = Array.isArray(d?.folders)
            ? d.folders
            : Array.isArray(d?.data)
              ? d.data
              : Array.isArray(d)
                ? d
                : [];
          out.table(
            ["ID", "Name", "Count"],
            folders.map((f: any) => [
              String(f.id ?? f._id ?? "-"),
              f.folder_name ?? f.name ?? "-",
              String(f.count ?? "-"),
            ]),
          );
        });
      }),
    )
    .command(
      "media:folders:create",
      "Create a media folder.",
      (y) =>
        y
          .option("name", { type: "string", demandOption: true, describe: "Folder name (3-40 chars)." })
          .option("parent-id", { type: "string", describe: "Parent folder ID for a nested folder." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const parentId = argv["parent-id"] ?? argv.parentId;
        const body = {
          folder_name: argv.name,
          ...(parentId ? { parent_folder_id: parentId } : {}),
        };
        if (isDryRun(argv)) {
          emitDryRun(g, `POST /workspaces/${wid}/media/folders`, body, "create a media folder");
          return;
        }
        const data: any = await createMediaFolder(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Folder created.");
          const id = d?.id ?? d?._id;
          if (id) out.status("ID", String(id));
        });
      }),
    )
    .command(
      "media:folders:rename",
      "Rename a media folder.",
      (y) =>
        y
          .option("folder-id", { type: "string", demandOption: true })
          .option("name", { type: "string", demandOption: true, describe: "New name (3-40 chars)." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const folderId = argv["folder-id"] ?? argv.folderId;
        const body = { folder_name: argv.name };
        if (isDryRun(argv)) {
          emitDryRun(g, `PUT /workspaces/${wid}/media/folders/${folderId}`, body, "rename a media folder");
          return;
        }
        const data: any = await renameMediaFolder(client, wid, folderId, body);
        out.emitSuccess(data, g, () => out.success("Folder renamed."));
      }),
    )
    .command(
      "media:folders:delete",
      "Delete a media folder. IRREVERSIBLE — requires --yes.",
      (y) =>
        y
          .option("folder-id", { type: "string", demandOption: true })
          .option("yes", { type: "boolean", default: false, describe: "Confirm this irreversible deletion." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const folderId = argv["folder-id"] ?? argv.folderId;
        if (isDryRun(argv)) {
          emitDryRun(g, `DELETE /workspaces/${wid}/media/folders/${folderId}`, {}, "delete a media folder");
          return;
        }
        if (!argv.yes) {
          throw new ConfigError(
            "Deleting a folder is irreversible. Re-run with --yes to confirm.",
          );
        }
        const data: any = await deleteMediaFolder(client, wid, folderId);
        out.emitSuccess(data, g, () => out.success("Folder deleted."));
      }),
    )
    .command(
      "media:storage",
      "Show media storage usage for the workspace.",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await getMediaStorage(client, wid);
        out.emitSuccess(data, g, (d: any) => {
          for (const [k, v] of Object.entries(d ?? {})) {
            out.status(k, String(v));
          }
        });
      }),
    )
    .command(
      "media:archive",
      "Archive or restore media. Reversible — use this for cleanup, not media:delete.",
      (y) =>
        y
          .option("media-id", { type: "array", demandOption: true, describe: "Media ID (repeatable, max 100)." })
          .option("unarchive", { type: "boolean", default: false, describe: "Restore instead of archive." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const body = {
          media_ids: (argv["media-id"] ?? argv.mediaId).map(String),
          archived: !argv.unarchive,
        };
        if (isDryRun(argv)) {
          emitDryRun(g, `POST /workspaces/${wid}/media/archive`, body, "archive media");
          return;
        }
        const data: any = await archiveMedia(client, wid, body);
        out.emitSuccess(data, g, () =>
          out.success(argv.unarchive ? "Media restored." : "Media archived."),
        );
      }),
    )
    .command(
      "media:move",
      "Move media into a folder (omit --folder-id to move to uncategorized).",
      (y) =>
        y
          .option("media-id", { type: "array", demandOption: true, describe: "Media ID (repeatable, max 100)." })
          .option("folder-id", { type: "string", describe: "Destination folder ID." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const folderId = argv["folder-id"] ?? argv.folderId ?? null;
        const body = {
          media_ids: (argv["media-id"] ?? argv.mediaId).map(String),
          folder_id: folderId,
        };
        if (isDryRun(argv)) {
          emitDryRun(g, `POST /workspaces/${wid}/media/move`, body, "move media");
          return;
        }
        const data: any = await moveMedia(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Media moved.");
          if (d?.skipped?.length) out.warning(`Skipped: ${d.skipped.join(", ")}`);
        });
      }),
    )
    .command(
      "media:note",
      "Set or clear the note on a media item.",
      (y) =>
        y
          .option("media-id", { type: "string", demandOption: true })
          .option("note", { type: "string", describe: "Note text (max 500 chars)." })
          .option("clear", { type: "boolean", default: false, describe: "Clear the existing note." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mediaId = argv["media-id"] ?? argv.mediaId;
        if (!argv.clear && argv.note === undefined) {
          throw new ConfigError("Pass --note <text> to set a note, or --clear to remove it.");
        }
        const body = { note: argv.clear ? null : argv.note };
        if (isDryRun(argv)) {
          emitDryRun(g, `PUT /workspaces/${wid}/media/${mediaId}/note`, body, "write a media note");
          return;
        }
        const data: any = await updateMediaNote(client, wid, mediaId, body);
        out.emitSuccess(data, g, () =>
          out.success(argv.clear ? "Note cleared." : "Note saved."),
        );
      }),
    )
    .command(
      "media:brand-asset",
      "Flag or unflag a media item as a brand asset.",
      (y) =>
        y
          .option("media-id", { type: "string", demandOption: true })
          .option("profile-id", { type: "string", describe: "Brand profile ID (defaults to the workspace profile)." })
          .option("unflag", { type: "boolean", default: false })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mediaId = argv["media-id"] ?? argv.mediaId;
        const profileId = argv["profile-id"] ?? argv.profileId;
        const path = `/workspaces/${wid}/media/${mediaId}/brand-asset`;
        if (isDryRun(argv)) {
          emitDryRun(
            g,
            `${argv.unflag ? "DELETE" : "POST"} ${path}`,
            argv.unflag ? {} : profileId ? { profile_id: profileId } : {},
            argv.unflag ? "unflag a brand asset" : "flag a brand asset",
          );
          return;
        }
        const data: any = argv.unflag
          ? await unflagMediaBrandAsset(client, wid, mediaId)
          : await flagMediaBrandAsset(client, wid, mediaId, profileId ? { profile_id: profileId } : {});
        out.emitSuccess(data, g, () =>
          out.success(argv.unflag ? "Brand asset flag removed." : "Flagged as brand asset."),
        );
      }),
    )
    .command(
      "media:delete",
      "PERMANENTLY delete a media item. IRREVERSIBLE — requires --yes. Prefer media:archive.",
      (y) =>
        y
          .option("media-id", { type: "string", demandOption: true })
          .option("yes", { type: "boolean", default: false, describe: "Confirm this irreversible deletion." })
          .option("confirmed", {
            type: "boolean",
            default: false,
            describe: "Also delete when the media backs scheduled posts (breaks them).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mediaId = argv["media-id"] ?? argv.mediaId;
        if (isDryRun(argv)) {
          emitDryRun(
            g,
            `DELETE /workspaces/${wid}/media/${mediaId}`,
            argv.confirmed ? { confirmed: true } : {},
            "permanently delete media",
          );
          return;
        }
        if (!argv.yes) {
          throw new ConfigError(
            "Permanent deletion is irreversible. Re-run with --yes to confirm, or use media:archive instead.",
          );
        }
        const data: any = await deleteMedia(client, wid, mediaId, {
          confirmed: argv.confirmed,
        });
        out.emitSuccess(data, g, (d: any) => {
          out.success("Media deleted.");
          const affected = d?.affected_scheduled_posts ?? [];
          if (affected.length) {
            out.warning(`Affected scheduled posts: ${affected.join(", ")}`);
          }
        });
      }),
    );
}

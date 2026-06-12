import type { Argv } from "yargs";

import {
  Client,
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  updateWorkspace,
} from "../api";
import { ConfigError } from "../errors";
import { loadConfig, saveConfig } from "../config";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

export function registerWorkspaces<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "workspaces:list",
      "List workspaces visible to the authenticated user.",
      (y) =>
        y
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { client } = buildClient(g);
        const resp = await listWorkspaces(client, {
          page: argv.page,
          per_page: argv["per-page"] ?? argv.perPage,
        });
        const items = (resp.data as any[]) ?? [];
        out.emitSuccess(
          resp.data,
          g,
          () =>
            out.table(
              ["ID", "Name", "Slug", "Timezone"],
              items.map((w) => [
                w._id ?? "-",
                w.name ?? "-",
                w.slug ?? "-",
                w.timezone ?? "-",
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "workspaces:use <workspace_id>",
      "Set the active workspace ID (persisted in config.json).",
      (y) => y.positional("workspace_id", { type: "string", demandOption: true }),
      run(async (argv: any, g) => {
        const cfg = loadConfig();
        let name: string | null = null;
        try {
          cfg.requireApiKey();
          const client = new Client(cfg);
          const list = await listWorkspaces(client, { per_page: 100 });
          const items = (list.data as any[]) ?? [];
          const hit = items.find((w) => w._id === argv.workspace_id);
          if (hit) name = hit.name ?? null;
        } catch {
          /* best-effort name lookup */
        }
        cfg.activeWorkspaceId = argv.workspace_id;
        cfg.activeWorkspaceName = name;
        const path = saveConfig(cfg);
        const data = {
          active_workspace_id: cfg.activeWorkspaceId,
          active_workspace_name: cfg.activeWorkspaceName,
          config_path: path,
        };
        out.emitSuccess(data, g, (d) =>
          out.success(
            `Active workspace set to ${d.active_workspace_id}` +
              (d.active_workspace_name ? ` (${d.active_workspace_name})` : ""),
          ),
        );
      }),
    )
    .command(
      "workspaces:current",
      "Show the currently active workspace.",
      (y) => y,
      run(async (_argv, g) => {
        const cfg = loadConfig();
        const data = {
          active_workspace_id: cfg.effectiveWorkspaceId(),
          active_workspace_name: cfg.activeWorkspaceName,
        };
        out.emitSuccess(data, g, (d) => {
          out.status("Workspace ID", d.active_workspace_id ?? "(none)");
          out.status("Name", d.active_workspace_name ?? "-");
        });
      }),
    )
    .command(
      "workspaces:create",
      "Create a new workspace.",
      (y) =>
        y
          .option("name", {
            type: "string",
            describe: "Workspace name (≤35 chars; letters, spaces, digits, period only).",
          })
          .option("logo", { type: "string", describe: "Workspace logo URL." })
          .option("timezone", { type: "string", describe: "IANA timezone, e.g. Asia/Karachi." })
          .option("super-admin-id", {
            type: "string",
            describe: "Account owner to create the workspace under (required when you manage multiple super admins).",
          })
          .option("note", { type: "string", describe: "Optional free-text note." })
          .option("instagram-posting-method", {
            type: "string",
            choices: ["api", "mobile"],
            describe: "Instagram posting method.",
          })
          .option("first-day-day", {
            type: "string",
            describe: "First day of week name, e.g. Monday (use with --first-day-key).",
          })
          .option("first-day-key", {
            type: "number",
            describe: "First day index (Sunday=0 … Saturday=6).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { client } = buildClient(g);
        const body = buildWorkspaceBody(argv, true);
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, "POST /workspaces", body, "create workspace");
        }
        const data = await createWorkspace(client, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Workspace created.");
          out.status("ID", String(d?._id ?? d?.id ?? "-"));
          out.status("Name", d?.name ?? "-");
        });
      }),
    )
    .command(
      "workspaces:update [workspace_id]",
      "Update a workspace (only provided fields change). Defaults to the active workspace.",
      (y) =>
        y
          .positional("workspace_id", { type: "string" })
          .option("name", { type: "string" })
          .option("logo", { type: "string" })
          .option("timezone", { type: "string" })
          .option("note", { type: "string" })
          .option("instagram-posting-method", {
            type: "string",
            choices: ["api", "mobile"],
          })
          .option("first-day-day", { type: "string" })
          .option("first-day-key", { type: "number" })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = argv.workspace_id
          ? String(argv.workspace_id)
          : resolveWorkspace(cfg, g);
        const body = buildWorkspaceBody(argv, false);
        if (!Object.keys(body).length) {
          throw new ConfigError(
            "At least one field is required to update the workspace.",
            { hint: "Pass --name / --logo / --timezone / --note / --instagram-posting-method / --first-day-day + --first-day-key." },
          );
        }
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `PUT /workspaces/${wid}`, body, `update workspace ${wid}`);
        }
        const data = await updateWorkspace(client, wid, body);
        out.emitSuccess(data, g, () => out.success(`Updated workspace ${wid}.`));
      }),
    )
    .command(
      "workspaces:delete <workspace_id>",
      "Delete a workspace.",
      (y) =>
        y
          .positional("workspace_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { client } = buildClient(g);
        const wid = String(argv.workspace_id);
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `DELETE /workspaces/${wid}`, {}, `delete workspace ${wid}`);
        }
        const data = await deleteWorkspace(client, wid);
        out.emitSuccess(data, g, () => out.success(`Deleted workspace ${wid}.`));
      }),
    );
}

function buildWorkspaceBody(argv: any, isCreate: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (argv.name !== undefined) body.name = argv.name;
  if (argv.logo !== undefined) body.logo = argv.logo;
  if (argv.timezone !== undefined) body.timezone = argv.timezone;
  if (argv.note !== undefined) body.note = argv.note;
  const igMethod =
    argv["instagram-posting-method"] ?? argv.instagramPostingMethod;
  if (igMethod !== undefined) body.instagram_posting_method = igMethod;
  if (isCreate) {
    const superAdminId = argv["super-admin-id"] ?? argv.superAdminId;
    if (superAdminId !== undefined) body.super_admin_id = superAdminId;
  }
  const day = argv["first-day-day"] ?? argv.firstDayDay;
  const key = argv["first-day-key"] ?? argv.firstDayKey;
  if (day !== undefined || key !== undefined) {
    body.first_day = { day, key };
  }
  return body;
}

function emitDryRun(
  g: any,
  endpoint: string,
  body: Record<string, unknown>,
  label: string,
): void {
  out.emitSuccess(
    { dry_run: true, endpoint, body },
    g,
    () => {
      out.info(`DRY RUN — would ${label}`);
      console.log(JSON.stringify(body, null, 2));
    },
  );
}

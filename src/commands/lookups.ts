/**
 * Read-only "list" commands for accounts, campaigns, categories, labels,
 * team-members. Each is a one-liner over the corresponding API wrapper.
 */

import type { Argv } from "yargs";

import {
  listAccounts,
  listApprovalWorkflows,
  listCampaigns,
  listContentCategories,
  listLabels,
  listTeamMembers,
} from "../api";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

export function registerLookups<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "accounts:list",
      "List social accounts in the active workspace.",
      (y) =>
        y
          .option("platform", {
            type: "string",
            describe:
              "Filter by platform (facebook, linkedin, twitter, instagram, youtube, tiktok, pinterest, gmb).",
          })
          .option("search", { type: "string" })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listAccounts(client, wid, {
          platform: argv.platform,
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
              ["ID", "Platform", "Name", "Type"],
              items.map((a) => [
                String(a.id ?? a._id ?? a.platform_identifier ?? "-"),
                a.platform ?? a.channel ?? "-",
                a.account_name ?? a.name ?? a.username ?? "-",
                a.account_type ?? "-",
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "campaigns:list",
      "List campaigns (folders) in the active workspace.",
      (y) =>
        y
          .option("search", { type: "string" })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listCampaigns(client, wid, {
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
              ["ID", "Name"],
              items.map((c) => [c.id ?? c._id ?? "-", c.name ?? "-"]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "categories:list",
      "List content categories in the active workspace.",
      (y) =>
        y
          .option("search", { type: "string" })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listContentCategories(client, wid, {
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
              ["ID", "Name"],
              items.map((c) => [c.id ?? c._id ?? "-", c.name ?? "-"]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "labels:list",
      "List labels in the active workspace.",
      (y) =>
        y
          .option("search", { type: "string" })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listLabels(client, wid, {
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
              ["ID", "Name"],
              items.map((l) => [l.id ?? l._id ?? "-", l.name ?? "-"]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "team:list",
      "List team members of the active workspace.",
      (y) =>
        y
          .option("search", { type: "string" })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listTeamMembers(client, wid, {
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
              ["ID", "Name", "Email", "Role"],
              items.map((t) => [
                t.id ?? t.user_id ?? t._id ?? "-",
                t.full_name ?? t.name ?? "-",
                t.email ?? "-",
                t.role ?? t.permission ?? "-",
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "approval-workflows:list",
      "List approval workflows in the active workspace. Use an item's id as --approval-workflow-id on posts:create / posts:update.",
      (y) =>
        y
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listApprovalWorkflows(client, wid, {
          page: argv.page,
          per_page: argv["per-page"] ?? argv.perPage,
        });
        const items = (resp.data as any[]) ?? [];
        out.emitSuccess(
          resp.data,
          g,
          () =>
            out.table(
              ["ID", "Name", "Default", "Levels"],
              items.map((w) => [
                String(w.id ?? w._id ?? "-"),
                w.name ?? "-",
                w.is_default ? "yes" : "no",
                String(Array.isArray(w.levels) ? w.levels.length : 0),
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    );
}

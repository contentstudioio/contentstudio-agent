/**
 * Write (create / update / delete) commands for labels, campaigns, and
 * team-members. Read-only `*:list` commands for these live in `lookups.ts`.
 *
 * All commands are workspace-scoped (resolve via --workspace / active) and
 * carry a --dry-run that prints {dry_run, endpoint, body} without calling the
 * API.
 */

import type { Argv } from "yargs";

import {
  addTeamMember,
  createCampaign,
  createLabel,
  deleteCampaign,
  deleteLabel,
  removeTeamMember,
  updateCampaign,
  updateLabel,
  updateTeamMember,
} from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

function emitDryRun(
  g: any,
  endpoint: string,
  body: Record<string, unknown> | undefined,
  label: string,
): void {
  out.emitSuccess(
    { dry_run: true, endpoint, body: body ?? {} },
    g,
    () => {
      out.info(`DRY RUN — would ${label}`);
      console.log(JSON.stringify(body ?? {}, null, 2));
    },
  );
}

function parseJsonOption(raw: unknown, flag: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch (e) {
    throw new ConfigError(`${flag}: invalid JSON — ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(`${flag}: JSON must be an object.`);
  }
  return parsed as Record<string, unknown>;
}

export function registerCrud<T>(yargs: Argv<T>): Argv<T> {
  return registerTeam(registerCampaigns(registerLabels(yargs)));
}

function registerLabels<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "labels:create",
      "Create a label in the active workspace.",
      (y) =>
        y
          .option("name", { type: "string", describe: "Label name (≤100 chars)." })
          .option("color", {
            type: "string",
            describe: "Label color: color_1 … color_20.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        if (!argv.name || !argv.color) {
          throw new ConfigError("--name and --color are required.");
        }
        const body = { name: String(argv.name), color: String(argv.color) };
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `POST /workspaces/${wid}/labels`, body, "create label");
        }
        const data = await createLabel(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Label created.");
          out.status("ID", String(d?._id ?? d?.id ?? "-"));
        });
      }),
    )
    .command(
      "labels:update <label_id>",
      "Update a label (name/color).",
      (y) =>
        y
          .positional("label_id", { type: "string", demandOption: true })
          .option("name", { type: "string" })
          .option("color", { type: "string", describe: "color_1 … color_20." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const lid = String(argv.label_id);
        const body: Record<string, unknown> = {};
        if (argv.name !== undefined) body.name = argv.name;
        if (argv.color !== undefined) body.color = argv.color;
        if (!Object.keys(body).length) {
          throw new ConfigError("Pass --name and/or --color to update.");
        }
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `PUT /workspaces/${wid}/labels/${lid}`, body, `update label ${lid}`);
        }
        const data = await updateLabel(client, wid, lid, body);
        out.emitSuccess(data, g, () => out.success(`Updated label ${lid}.`));
      }),
    )
    .command(
      "labels:delete <label_id>",
      "Delete a label.",
      (y) =>
        y
          .positional("label_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const lid = String(argv.label_id);
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `DELETE /workspaces/${wid}/labels/${lid}`, {}, `delete label ${lid}`);
        }
        const data = await deleteLabel(client, wid, lid);
        out.emitSuccess(data, g, () => out.success(`Deleted label ${lid}.`));
      }),
    );
}

function registerCampaigns<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "campaigns:create",
      "Create a campaign in the active workspace.",
      (y) =>
        y
          .option("name", { type: "string", describe: "Campaign name (≤100 chars)." })
          .option("color", {
            type: "string",
            describe: "Campaign color: color_1 … color_20.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        if (!argv.name || !argv.color) {
          throw new ConfigError("--name and --color are required.");
        }
        const body = { name: String(argv.name), color: String(argv.color) };
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `POST /workspaces/${wid}/campaigns`, body, "create campaign");
        }
        const data = await createCampaign(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Campaign created.");
          out.status("ID", String(d?._id ?? d?.id ?? "-"));
        });
      }),
    )
    .command(
      "campaigns:update <campaign_id>",
      "Update a campaign (name/color).",
      (y) =>
        y
          .positional("campaign_id", { type: "string", demandOption: true })
          .option("name", { type: "string" })
          .option("color", { type: "string", describe: "color_1 … color_20." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.campaign_id);
        const body: Record<string, unknown> = {};
        if (argv.name !== undefined) body.name = argv.name;
        if (argv.color !== undefined) body.color = argv.color;
        if (!Object.keys(body).length) {
          throw new ConfigError("Pass --name and/or --color to update.");
        }
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `PUT /workspaces/${wid}/campaigns/${cid}`, body, `update campaign ${cid}`);
        }
        const data = await updateCampaign(client, wid, cid, body);
        out.emitSuccess(data, g, () => out.success(`Updated campaign ${cid}.`));
      }),
    )
    .command(
      "campaigns:delete <campaign_id>",
      "Delete a campaign.",
      (y) =>
        y
          .positional("campaign_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.campaign_id);
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `DELETE /workspaces/${wid}/campaigns/${cid}`, {}, `delete campaign ${cid}`);
        }
        const data = await deleteCampaign(client, wid, cid);
        out.emitSuccess(data, g, () => out.success(`Deleted campaign ${cid}.`));
      }),
    );
}

function registerTeam<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "team:add",
      "Invite a member to the active workspace.",
      (y) =>
        y
          .option("email", { type: "string", describe: "Email address to invite." })
          .option("role", {
            type: "string",
            choices: ["admin", "approver", "collaborator"],
            describe: "Member role.",
          })
          .option("membership", {
            type: "string",
            choices: ["team", "client"],
            describe: "Membership type (default team).",
          })
          .option("permissions", {
            type: "string",
            describe:
              "Role-aware permissions object as a JSON string. See SKILL.md for the per-role keys.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        if (!argv.email || !argv.role) {
          throw new ConfigError("--email and --role are required.");
        }
        const body: Record<string, unknown> = {
          role: String(argv.role),
          email: String(argv.email),
        };
        if (argv.membership !== undefined) body.membership = argv.membership;
        if (argv.permissions !== undefined) {
          body.permissions = parseJsonOption(argv.permissions, "--permissions");
        }
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `POST /workspaces/${wid}/team-members`, body, "add team member");
        }
        const data = await addTeamMember(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Team member added.");
          out.status("ID", String(d?._id ?? d?.member_id ?? "-"));
        });
      }),
    )
    .command(
      "team:update <member_id>",
      "Update a team member's role/permissions. member_id is the membership id from team:list.",
      (y) =>
        y
          .positional("member_id", { type: "string", demandOption: true })
          .option("role", {
            type: "string",
            choices: ["admin", "approver", "collaborator"],
            describe: "New member role (required).",
          })
          .option("membership", {
            type: "string",
            choices: ["team", "client"],
          })
          .option("permissions", {
            type: "string",
            describe:
              "Role-aware permissions object as a JSON string (required by the backend).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mid = String(argv.member_id);
        if (!argv.role) {
          throw new ConfigError("--role is required.");
        }
        if (argv.permissions === undefined) {
          throw new ConfigError(
            "--permissions (JSON object) is required by the backend for team updates.",
          );
        }
        const body: Record<string, unknown> = {
          role: String(argv.role),
          permissions: parseJsonOption(argv.permissions, "--permissions"),
        };
        if (argv.membership !== undefined) body.membership = argv.membership;
        if (argv["dry-run"] ?? argv.dryRun) {
          return emitDryRun(g, `PUT /workspaces/${wid}/team-members/${mid}`, body, `update team member ${mid}`);
        }
        const data = await updateTeamMember(client, wid, mid, body);
        out.emitSuccess(data, g, () => out.success(`Updated team member ${mid}.`));
      }),
    )
    .command(
      "team:remove <member_id>",
      "Remove a team member. member_id is the membership id from team:list.",
      (y) =>
        y
          .positional("member_id", { type: "string", demandOption: true })
          .option("confirmed", {
            type: "boolean",
            default: false,
            describe:
              "Confirm removal when the member is in approval workflows / in-flight posts (sends ?confirmed=true).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mid = String(argv.member_id);
        const confirmed = !!argv.confirmed;
        if (argv["dry-run"] ?? argv.dryRun) {
          const qs = confirmed ? "?confirmed=true" : "";
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/team-members/${mid}${qs}`,
            {},
            `remove team member ${mid}`,
          );
        }
        const data = await removeTeamMember(client, wid, mid, { confirmed });
        out.emitSuccess(data, g, () => out.success(`Removed team member ${mid}.`));
      }),
    );
}

/**
 * Approval workflows — multi-level review chains a post can be routed through.
 *
 * `approval-workflows:list` (read-only) lives in `lookups.ts`; the rest is
 * here. EVERY route in this group — the list included — requires the
 * `manage_workflow` permission, so a caller who can read posts may still get a
 * 403 here.
 *
 * Two commands can answer 202 instead of 200: an update with `--confirmed` and
 * a delete with `--force`. Both mean "the write landed, and a background
 * cascade is now re-applying it to posts already in flight" — the envelope
 * carries `cascade_job_id`, which `approval-workflows:cascade-job` polls.
 */

import type { Argv } from "yargs";

import {
  createApprovalWorkflow,
  deleteApprovalWorkflow,
  duplicateApprovalWorkflow,
  getApprovalCascadeJob,
  getApprovalWorkflow,
  removeDefaultApprovalWorkflow,
  setDefaultApprovalWorkflow,
  updateApprovalWorkflow,
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

const LEVELS_SHAPE =
  'JSON array of levels: [{"level_number":1,"title":"Editors","rule":"anyone|everyone","members":[{"user_id":"<id>"}]}]. ' +
  "level_number is unique across the payload; members[].user_id must be on the workspace team.";

export function registerApprovalWorkflows<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "approval-workflows:get <workflow_id>",
      "Read one approval workflow.",
      (y) => y.positional("workflow_id", { type: "string", demandOption: true }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await getApprovalWorkflow(
          client,
          wid,
          String(argv.workflow_id),
        );
        out.emitSuccess(data, g, renderWorkflow);
      }),
    )
    .command(
      "approval-workflows:create",
      "Create an approval workflow.",
      (y) =>
        y
          .option("name", { type: "string", describe: "Workflow name (≤120 chars)." })
          .option("levels", { type: "string", describe: LEVELS_SHAPE })
          .option("draft", {
            type: "boolean",
            describe:
              "Store as a draft → is_draft. A workflow with an unstaffed level is a draft regardless, and a draft cannot be the default.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        if (!argv.name || !argv.levels) {
          throw new ConfigError("--name and --levels are required.");
        }
        const body: Record<string, unknown> = {
          name: String(argv.name),
          levels: parseLevels(argv.levels),
        };
        if (argv.draft !== undefined) body.is_draft = !!argv.draft;

        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/approval-workflows`,
            body,
            "create approval workflow",
          );
        }
        const data = await createApprovalWorkflow(client, wid, body as any);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Approval workflow created.");
          out.status("ID", String(d?.id ?? d?._id ?? "-"));
        });
      }),
    )
    .command(
      "approval-workflows:update <workflow_id>",
      "Update an approval workflow (partial). With --confirmed the change is also re-applied to posts already in review — that answers 202 with a cascade_job_id.",
      (y) =>
        y
          .positional("workflow_id", { type: "string", demandOption: true })
          .option("name", { type: "string" })
          .option("levels", { type: "string", describe: LEVELS_SHAPE })
          .option("draft", { type: "boolean", describe: "Set/clear is_draft." })
          .option("confirmed", {
            type: "boolean",
            describe:
              "Re-apply the edited workflow to in-flight posts. Returns 202 + cascade_job_id; poll it with approval-workflows:cascade-job.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.workflow_id);
        const body: Record<string, unknown> = {};
        if (argv.name !== undefined) body.name = argv.name;
        if (argv.levels !== undefined) body.levels = parseLevels(argv.levels);
        if (argv.draft !== undefined) body.is_draft = !!argv.draft;
        if (argv.confirmed !== undefined) body.confirmed = !!argv.confirmed;
        if (!Object.keys(body).length) {
          throw new ConfigError(
            "Pass at least one of --name / --levels / --draft / --confirmed.",
          );
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/approval-workflows/${id}`,
            body,
            `update approval workflow ${id}`,
          );
        }
        const data: any = await updateApprovalWorkflow(
          client,
          wid,
          id,
          body as any,
        );
        out.emitSuccess(data, g, (d: any) => {
          if (d?.cascade_job_id) {
            out.success(`Updated workflow ${id}; a cascade is re-applying it.`);
            out.status("Cascade job", String(d.cascade_job_id));
            out.info(
              `Poll it: contentstudio --json approval-workflows:cascade-job ${d.cascade_job_id}`,
            );
            return;
          }
          out.success(`Updated approval workflow ${id}.`);
        });
      }),
    )
    .command(
      "approval-workflows:delete <workflow_id>",
      "Delete an approval workflow. With posts in review the backend refuses (422 REQUIRES_FORCE_DELETE) until --force is passed.",
      (y) =>
        y
          .positional("workflow_id", { type: "string", demandOption: true })
          .option("force", {
            type: "boolean",
            default: false,
            describe:
              "Delete even with posts in review → ?force=true. Answers 202 + cascade_job_id + was_default.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.workflow_id);
        const force = !!argv.force;
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/approval-workflows/${id}${force ? "?force=true" : ""}`,
            {},
            `delete approval workflow ${id}`,
          );
        }
        const data: any = await deleteApprovalWorkflow(client, wid, id, {
          force,
        });
        out.emitSuccess(data, g, (d: any) => {
          out.success(`Deleted approval workflow ${id}.`);
          if (d?.was_default) {
            out.warning(
              "That was the workspace's DEFAULT workflow — the workspace now has none until another is promoted.",
            );
          }
          if (d?.cascade_job_id) {
            out.status("Cascade job", String(d.cascade_job_id));
          }
        });
      }),
    )
    .command(
      "approval-workflows:duplicate <workflow_id>",
      "Copy an approval workflow into a new one.",
      (y) =>
        y
          .positional("workflow_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.workflow_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/approval-workflows/${id}/duplicate`,
            {},
            `duplicate approval workflow ${id}`,
          );
        }
        const data = await duplicateApprovalWorkflow(client, wid, id);
        out.emitSuccess(data, g, (d: any) => {
          out.success(`Duplicated approval workflow ${id}.`);
          out.status("New ID", String(d?.id ?? d?._id ?? "-"));
        });
      }),
    )
    .command(
      "approval-workflows:set-default <workflow_id>",
      "Make this the workspace's default approval workflow. A draft is refused with CANNOT_SET_DRAFT_AS_DEFAULT (422).",
      (y) =>
        y
          .positional("workflow_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.workflow_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/approval-workflows/${id}/set-default`,
            {},
            `set approval workflow ${id} as default`,
          );
        }
        const data = await setDefaultApprovalWorkflow(client, wid, id);
        out.emitSuccess(data, g, () =>
          out.success(`Approval workflow ${id} is now the default.`),
        );
      }),
    )
    .command(
      "approval-workflows:remove-default <workflow_id>",
      "Clear the default flag, leaving the workspace with no default workflow.",
      (y) =>
        y
          .positional("workflow_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.workflow_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/approval-workflows/${id}/remove-default`,
            {},
            `remove the default flag from approval workflow ${id}`,
          );
        }
        const data = await removeDefaultApprovalWorkflow(client, wid, id);
        out.emitSuccess(data, g, () =>
          out.success(`Approval workflow ${id} is no longer the default.`),
        );
      }),
    )
    .command(
      "approval-workflows:cascade-job <cascade_job_id>",
      "Poll a background cascade started by a confirmed update or a forced delete.",
      (y) =>
        y.positional("cascade_job_id", { type: "string", demandOption: true }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await getApprovalCascadeJob(
          client,
          wid,
          String(argv.cascade_job_id),
        );
        out.emitSuccess(data, g, (d: any) => {
          out.status("Status", String(d?.status ?? "-"));
          out.status("Type", String(d?.type ?? "-"));
          out.status(
            "Progress",
            `${d?.processed_count ?? 0}/${d?.total_count ?? 0} (${d?.failed_count ?? 0} failed)`,
          );
        });
      }),
    );
}

function renderWorkflow(d: any): void {
  out.success(`Workflow ${d?.name ?? "-"}`);
  out.status("ID", String(d?.id ?? d?._id ?? "-"));
  out.status("Default", d?.is_default ? "yes" : "no");
  out.status("Draft", d?.is_draft ? "yes" : "no");
  out.table(
    ["Level", "Title", "Rule", "Members"],
    ((d?.levels as any[]) ?? []).map((l) => [
      String(l.level_number ?? "-"),
      l.title ?? "-",
      l.rule ?? "-",
      ((l.members as any[]) ?? []).map((m) => m.user_id).join(", ") || "-",
    ]),
  );
}

/** Parse the `--levels` JSON array, with a readable error on a shape mismatch. */
function parseLevels(raw: unknown): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch (e) {
    throw new ConfigError(`--levels: invalid JSON — ${(e as Error).message}`, {
      hint: LEVELS_SHAPE,
    });
  }
  if (!Array.isArray(parsed)) {
    throw new ConfigError("--levels: JSON must be an array.", {
      hint: LEVELS_SHAPE,
    });
  }
  return parsed;
}

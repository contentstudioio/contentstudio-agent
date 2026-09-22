/**
 * Planner share links — a public URL that lets someone outside the workspace
 * view scheduled content, and optionally comment on it or approve it.
 *
 * NOT the same thing as the analytics `share-links:*` group, which shares a
 * live analytics dashboard. These share POSTS; those share NUMBERS. Hence the
 * longer group name — the two would otherwise collide.
 *
 * Throughout this group `<link_id>` is the RECORD id (the resource's `id`),
 * never the public `link_id` slug that appears in the shareable URL. The
 * resource returns both, which is exactly why it is worth stating.
 */

import type { Argv } from "yargs";

import {
  createPlannerShareLink,
  deletePlannerShareLink,
  getPlannerShareLink,
  getPlannerShareLinkActivity,
  listPlannerShareLinks,
  sendPlannerShareLinkInvitations,
  updatePlannerShareLink,
} from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import {
  buildClient,
  emitDryRun,
  isDryRun,
  parseJsonOption,
  resolveWorkspace,
  run,
} from "../cliCtx";

const SCOPES = ["selection", "future", "all"] as const;
const VIEWS = ["list", "calendar", "compact_list"] as const;
const APPROVAL_OPTIONS = ["anyone", "everyone"] as const;

export function registerPlannerShareLinks<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "planner-share-links:list",
      "List the workspace's planner share links.",
      (y) =>
        y.option("page", { type: "number" }).option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listPlannerShareLinks(client, wid, {
          page: argv.page,
          per_page: argv["per-page"] ?? argv.perPage,
        });
        const items = (resp.data as any[]) ?? [];
        out.emitSuccess(
          resp.data,
          g,
          () =>
            out.table(
              ["ID", "Name", "Scope", "View", "Disabled", "Pending invites"],
              items.map((l) => [
                String(l.id ?? l._id ?? "-"),
                l.name ?? "-",
                l.scope ?? "-",
                l.view ?? "-",
                l.is_disabled ? "yes" : "no",
                String(l.outstanding_invitations_count ?? 0),
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "planner-share-links:get <link_id>",
      "Read one planner share link. <link_id> is the record id, not the public slug.",
      (y) => y.positional("link_id", { type: "string", demandOption: true }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await getPlannerShareLink(
          client,
          wid,
          String(argv.link_id),
        );
        out.emitSuccess(data, g, renderLink);
      }),
    )
    .command(
      "planner-share-links:create",
      "Create a planner share link. One of --plan / --note is required on EVERY create.",
      (y) =>
        applySharedOptions(y)
          .option("plan", {
            type: "string",
            array: true,
            describe:
              "Post (plan) ID to share. Repeatable, max 500 → plans[]. Required unless --note is given. Create-only — update refuses `plans`.",
          })
          .option("single-post", {
            type: "boolean",
            describe:
              "Share exactly one post → is_single_post. Needs --scope selection and exactly one --plan.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        if (!argv.name) {
          throw new ConfigError(
            "--name is required (3–255 chars, letters/digits/spaces only — punctuation is refused).",
          );
        }
        const body = sharedBody(argv);
        body.name = String(argv.name);

        const plans = argv.plan as string[] | undefined;
        const notes = argv.note as string[] | undefined;
        if (plans?.length) body.plans = plans;
        if (!plans?.length && !notes?.length) {
          throw new ConfigError(
            "Every share link must share something: pass --plan and/or --note.",
          );
        }
        const singlePost = argv["single-post"] ?? argv.singlePost;
        if (singlePost !== undefined) body.is_single_post = !!singlePost;

        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/share-links`,
            body,
            "create planner share link",
          );
        }
        const data = await createPlannerShareLink(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Planner share link created.");
          out.status("ID", String(d?.id ?? d?._id ?? "-"));
          if (d?.url) out.status("URL", d.url);
        });
      }),
    )
    .command(
      "planner-share-links:update <link_id>",
      "Update a planner share link (partial). `plans` and `filters` are create-only and are refused here.",
      (y) =>
        applySharedOptions(
          y.positional("link_id", { type: "string", demandOption: true }),
        )
          .option("disabled", {
            type: "boolean",
            describe: "Disable (or re-enable with --no-disabled) the link → is_disabled.",
          })
          .option("approval-flow", {
            type: "boolean",
            describe:
              "Turn the approval flow on/off → approval_flow. When true, --approval-email and --approval-option are required.",
          })
          .option("approval-email", {
            type: "string",
            array: true,
            describe: "Approver email. Repeatable, 1–10 → approval_emails[].",
          })
          .option("approval-option", {
            type: "string",
            choices: [...APPROVAL_OPTIONS],
            describe: "anyone = one approval suffices; everyone = all must approve.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.link_id);
        const body = sharedBody(argv);
        if (argv.name !== undefined) body.name = String(argv.name);

        const disabled = argv.disabled;
        if (disabled !== undefined) body.is_disabled = !!disabled;
        const approvalFlow = argv["approval-flow"] ?? argv.approvalFlow;
        if (approvalFlow !== undefined) body.approval_flow = !!approvalFlow;
        const approvalEmails = (argv["approval-email"] ?? argv.approvalEmail) as
          | string[]
          | undefined;
        if (approvalEmails !== undefined) body.approval_emails = approvalEmails;
        const approvalOption = argv["approval-option"] ?? argv.approvalOption;
        if (approvalOption !== undefined) {
          body.approval_option = String(approvalOption);
        }

        if (!Object.keys(body).length) {
          throw new ConfigError("Pass at least one field to update.");
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/share-links/${id}`,
            body,
            `update planner share link ${id}`,
          );
        }
        const data = await updatePlannerShareLink(client, wid, id, body);
        out.emitSuccess(data, g, () =>
          out.success(`Updated planner share link ${id}.`),
        );
      }),
    )
    .command(
      "planner-share-links:delete <link_id>",
      "Delete a planner share link. Prefer --disabled on update when the pause is temporary — deleting is not reversible.",
      (y) =>
        y
          .positional("link_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.link_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/share-links/${id}`,
            {},
            `delete planner share link ${id}`,
          );
        }
        const data = await deletePlannerShareLink(client, wid, id);
        out.emitSuccess(data, g, () =>
          out.success(`Deleted planner share link ${id}.`),
        );
      }),
    )
    .command(
      "planner-share-links:send-invitations <link_id>",
      "Turn the approval flow on and email 1–10 people an invitation to review.",
      (y) =>
        y
          .positional("link_id", { type: "string", demandOption: true })
          .option("email", {
            type: "string",
            array: true,
            describe: "Approver email. Repeatable, 1–10 → approval_emails[].",
          })
          .option("approval-option", {
            type: "string",
            choices: [...APPROVAL_OPTIONS],
            describe:
              "Required. anyone = one approval suffices; everyone = all must approve.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.link_id);
        const emails = (argv.email as string[] | undefined) ?? [];
        const approvalOption = argv["approval-option"] ?? argv.approvalOption;
        if (!emails.length || !approvalOption) {
          throw new ConfigError(
            "--email (1–10, repeatable) and --approval-option are required.",
          );
        }
        const body = {
          approval_emails: emails,
          approval_option: String(approvalOption) as "anyone" | "everyone",
        };
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/share-links/${id}/send-invitations`,
            body,
            `email ${emails.length} invitation(s) for share link ${id}`,
          );
        }
        const data = await sendPlannerShareLinkInvitations(
          client,
          wid,
          id,
          body,
        );
        out.emitSuccess(data, g, () =>
          out.success(`Sent ${emails.length} invitation(s) for link ${id}.`),
        );
      }),
    )
    .command(
      "planner-share-links:activity <link_id>",
      "What clients did on the other side of the link — comments and approve/reject actions, newest-first.",
      (y) =>
        y
          .positional("link_id", { type: "string", demandOption: true })
          .option("type", {
            type: "string",
            choices: ["comment", "action"],
            describe: "Narrow to one kind of entry. Omit for both.",
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await getPlannerShareLinkActivity(
          client,
          wid,
          String(argv.link_id),
          argv.type ? { type: argv.type as "comment" | "action" } : {},
        );
        out.emitSuccess(resp, g, (d) => {
          out.info(`${d.total} entr${d.total === 1 ? "y" : "ies"}`);
          out.table(
            ["When", "Type", "Post", "Who", "Action", "Comment"],
            d.data.map((e: any) => [
              e.created_at ?? "-",
              e.type ?? "-",
              String(e.post_id ?? "-"),
              e.name || e.email || "-",
              e.action ?? "-",
              String(e.comment ?? "").slice(0, 40),
            ]),
          );
        });
      }),
    );
}

/** Options shared by create and update. */
function applySharedOptions<T>(y: Argv<T>): Argv<T> {
  return y
    .option("name", {
      type: "string",
      describe:
        "Link name, 3–255 chars. Letters, digits and spaces ONLY — punctuation is refused, because the name is slugified into the public URL.",
    })
    .option("scope", {
      type: "string",
      choices: [...SCOPES],
      describe:
        "What the link shows. `future` and `all` are calendar-only (need --view calendar), require --calendar-date, and cannot collect external approvals.",
    })
    .option("view", {
      type: "string",
      choices: [...VIEWS],
      describe: "How the shared page renders.",
    })
    .option("calendar-date", {
      type: "string",
      describe:
        "Anchors the future/all window. Required for those scopes and REFUSED for `selection`. Free-form, e.g. \"2026-01-01 - 2026-03-31\".",
    })
    .option("note", {
      type: "string",
      array: true,
      describe: "Planner note ID to share. Repeatable, max 500 → notes[].",
    })
    .option("show-notes", { type: "boolean", describe: "→ show_notes." })
    .option("password", {
      type: "string",
      describe:
        "Password for the link (≥4 chars). Implies --password-protected unless you pass it explicitly.",
    })
    .option("password-protected", {
      type: "boolean",
      describe: "→ is_password_protected. Pass --no-password-protected to lift it.",
    })
    .option("allow-comments", {
      type: "boolean",
      describe: "Let viewers comment → allow_external_comments.",
    })
    .option("allow-approval-actions", {
      type: "boolean",
      describe:
        "Let viewers approve/reject → allow_external_approval_actions. Unavailable on scope future/all.",
    })
    .option("social-selections", {
      type: "string",
      describe: "JSON object passed through verbatim → social_selections.",
    });
}

/** Build the fields create and update have in common. Omitted flags stay out. */
function sharedBody(argv: any): Record<string, unknown> {
  const body: Record<string, unknown> = {};

  if (argv.scope !== undefined) body.scope = String(argv.scope);
  if (argv.view !== undefined) body.view = String(argv.view);

  const calendarDate = argv["calendar-date"] ?? argv.calendarDate;
  if (calendarDate !== undefined) body.calendar_date = String(calendarDate);

  const notes = argv.note as string[] | undefined;
  if (notes !== undefined) body.notes = notes;

  const showNotes = argv["show-notes"] ?? argv.showNotes;
  if (showNotes !== undefined) body.show_notes = !!showNotes;

  const passwordProtected =
    argv["password-protected"] ?? argv.passwordProtected;
  if (argv.password !== undefined) {
    body.password = String(argv.password);
    // A password with no explicit toggle means "protect it" — sending the
    // password alone would store one the link never asks for.
    body.is_password_protected =
      passwordProtected === undefined ? true : !!passwordProtected;
  } else if (passwordProtected !== undefined) {
    body.is_password_protected = !!passwordProtected;
  }

  const allowComments = argv["allow-comments"] ?? argv.allowComments;
  if (allowComments !== undefined) {
    body.allow_external_comments = !!allowComments;
  }

  const allowApprovalActions =
    argv["allow-approval-actions"] ?? argv.allowApprovalActions;
  if (allowApprovalActions !== undefined) {
    body.allow_external_approval_actions = !!allowApprovalActions;
  }

  const socialSelections =
    argv["social-selections"] ?? argv.socialSelections;
  if (socialSelections !== undefined) {
    body.social_selections = parseJsonOption(
      socialSelections,
      "--social-selections",
    );
  }

  return body;
}

function renderLink(d: any): void {
  out.success(`Share link ${d?.name ?? "-"}`);
  out.status("ID", String(d?.id ?? d?._id ?? "-"));
  out.status("Public slug", String(d?.link_id ?? "-"));
  if (d?.url) out.status("URL", d.url);
  out.status("Scope", String(d?.scope ?? "-"));
  out.status("View", String(d?.view ?? "-"));
  out.status("Disabled", d?.is_disabled ? "yes" : "no");
  out.status("Password protected", d?.is_password_protected ? "yes" : "no");
  out.status("External comments", d?.allow_external_comments ? "yes" : "no");
  out.status(
    "External approvals",
    d?.allow_external_approval_actions ? "yes" : "no",
  );
  out.status(
    "Pending invitations",
    String(d?.outstanding_invitations_count ?? 0),
  );
}

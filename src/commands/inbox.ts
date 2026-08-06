/**
 * Social Inbox commands — conversations (DMs), post comments, reviews,
 * contacts, and tags.
 *
 * Vocabulary:
 *  - **element** — the unified inbox unit: a conversation, a commented post,
 *    or a review. Addressed by `element_ref`, returned by `inbox:list`.
 *  - **platform_id** — the connected social account the item belongs to.
 *    Most write endpoints need it because the backend fans out to the
 *    provider API using that account's token.
 *
 * Every mutating command carries `--dry-run`, matching the rest of the CLI.
 */

import type { Argv } from "yargs";

import {
  MAX_INBOX_BULK_REFS,
  MAX_INBOX_LIMIT,
  addInboxNote,
  addInboxPostComment,
  attachInboxTags,
  bulkUpdateInboxElements,
  createInboxTag,
  deleteInboxComment,
  deleteInboxMessage,
  deleteInboxReviewReply,
  deleteInboxTags,
  detachInboxTag,
  getInboxContact,
  inboxSummary,
  listInboxBookmarks,
  listInboxMessages,
  listInboxNotes,
  listInboxPostComments,
  listInboxTags,
  markInboxElementRead,
  mergeInboxTags,
  searchInboxElements,
  sendInboxMessage,
  setInboxCommentHidden,
  setInboxCommentLike,
  setInboxMessageBookmark,
  updateInboxContact,
  updateInboxTag,
  upsertInboxReviewReply,
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

const INBOX_TYPES = ["conversation", "post", "review"] as const;

/**
 * Percent-encode a path segment, mirroring `api.ts`, so a `--dry-run` preview
 * shows the URL that would actually be requested.
 */
const enc = encodeURIComponent;

/** Normalise a repeatable string option into a clean array. */
function strList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const arr = (Array.isArray(v) ? v : [v]).map(String).filter((s) => s.length);
  return arr.length ? arr : undefined;
}

/**
 * Resolve a display name from the inbox's `from` shape: it is an array, and
 * `name` may be empty where `first_name` / `last_name` are populated.
 */
function personName(from: any): string | undefined {
  const p = Array.isArray(from) ? from[0] : from;
  if (!p || typeof p !== "object") return undefined;
  if (p.name) return String(p.name);
  const full = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return full || undefined;
}

/** Truncate a cell so human tables stay readable. */
function trim(v: unknown, n = 48): string {
  const s = v === undefined || v === null ? "" : String(v);
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat || "-";
}

/**
 * `--dry-run` for endpoints whose payload is query params rather than a body.
 * Renders the querystring into the printed endpoint so the preview is honest.
 */
function endpointWithQuery(base: string, params: Record<string, unknown>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `${base}?${qs}` : base;
}

export function registerInbox<T>(yargs: Argv<T>): Argv<T> {
  return registerTags(
    registerReviews(registerComments(registerConversations(registerElements(yargs)))),
  );
}

// ─────────────────────────────────────────────────────────────────
// Elements — the unified inbox list, summary, state, and contacts.
// ─────────────────────────────────────────────────────────────────

function registerElements<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "inbox:list",
      "Search the inbox (conversations, commented posts, reviews).",
      (y) =>
        y
          .option("type", {
            type: "string",
            array: true,
            choices: INBOX_TYPES as unknown as string[],
            describe: "Inbox types to include. Repeatable. Default: all types.",
          })
          .option("action", {
            type: "string",
            describe:
              "Status bucket: all, marked_done, archived, assigned (default all).",
          })
          .option("search", { type: "string", describe: "Free-text search term." })
          .option("tag", {
            type: "string",
            array: true,
            describe: "Filter by tag id. Repeatable.",
          })
          .option("channels", {
            type: "string",
            describe:
              'Restrict to accounts, as JSON: \'{"facebook":["<account_id>"]}\'. Default: all channels.',
          })
          .option("element", {
            type: "string",
            describe: "Fetch one specific element by ref (targeted_element).",
          })
          .option("page", { type: "number", describe: "Page number (default 1)." })
          .option("limit", {
            type: "number",
            alias: "per-page",
            describe: `Items per page (default 20, max ${MAX_INBOX_LIMIT}).`,
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);

        const body: Record<string, unknown> = {};
        const types = strList(argv.type);
        if (types) body.inbox_types = types;
        if (argv.action) body.action = String(argv.action);
        if (argv.search) body.search_term = String(argv.search);
        const tags = strList(argv.tag);
        if (tags) body.tags = tags;
        if (argv.channels !== undefined) {
          body.all_channels = parseJsonOption(argv.channels, "--channels");
        }
        if (argv.element) body.targeted_element = String(argv.element);
        if (argv.page !== undefined) body.page = Number(argv.page);
        if (argv.limit !== undefined) body.limit = Number(argv.limit);

        const { data, pagination } = await searchInboxElements(client, wid, body);
        out.emitSuccess(
          data,
          g,
          (d) => {
            // A conversation carries `last_message`, a post carries
            // `last_comment`, and the sender is in that object's `from[]`.
            const rows = out.listish(d).map((e: any) => {
              const latest = e?.last_message ?? e?.last_comment;
              const unread =
                (e?.unread_message_count ?? 0) + (e?.unread_comment_count ?? 0);
              return [
                trim(e?.element_ref, 26),
                trim(e?.inbox_type, 12),
                trim(e?.platform, 9),
                trim(
                  personName(latest?.from) ??
                    e?.inbox_details?.posted_by?.name,
                  18,
                ),
                unread ? String(unread) : "-",
                trim(
                  latest?.message ??
                    e?.element_details?.post_message ??
                    e?.element_details?.snippet,
                  38,
                ),
              ];
            });
            out.section("Inbox");
            out.table(
              ["REF", "TYPE", "PLATFORM", "FROM", "UNREAD", "LATEST"],
              rows,
            );
          },
          { pagination },
        );
      }),
    )
    .command(
      "inbox:summary",
      "Inbox counts per bucket (unread / pending / assigned).",
      (y) =>
        y
          .option("type", {
            type: "string",
            array: true,
            choices: INBOX_TYPES as unknown as string[],
            describe: "Inbox types to count. Repeatable.",
          })
          .option("channels", {
            type: "string",
            describe: 'Restrict to accounts, as JSON: \'{"facebook":["<id>"]}\'.',
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const body: Record<string, unknown> = {};
        const types = strList(argv.type);
        if (types) body.inbox_types = types;
        if (argv.channels !== undefined) {
          body.all_channels = parseJsonOption(argv.channels, "--channels");
        }
        const data = await inboxSummary(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.section("Inbox summary");
          if (d && typeof d === "object" && !Array.isArray(d)) {
            for (const [k, v] of Object.entries(d)) {
              out.status(k, typeof v === "object" ? JSON.stringify(v) : String(v));
            }
          } else {
            console.log(JSON.stringify(d, null, 2));
          }
        });
      }),
    )
    .command(
      "inbox:mark-read <element_ref>",
      "Mark an inbox element as read (idempotent).",
      (y) =>
        y
          .positional("element_ref", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const ref = String(argv.element_ref);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/inbox/elements/${enc(ref)}/read`,
            {},
            `mark element ${ref} read`,
          );
        }
        const data = await markInboxElementRead(client, wid, ref);
        out.emitSuccess(data, g, () => out.success(`Marked ${ref} as read.`));
      }),
    )
    .command(
      "inbox:update",
      "Bulk-update inbox elements: mark done/pending, archive, or assign.",
      (y) =>
        y
          .option("element", {
            type: "string",
            array: true,
            describe: `Element id from element_details.element_id. Repeatable, max ${MAX_INBOX_BULK_REFS}.`,
          })
          .option("status", {
            type: "string",
            choices: ["done", "pending"],
            describe:
              "Mark elements done or pending. Exactly one operation per call.",
          })
          .option("archived", {
            type: "boolean",
            describe: "Archive (--archived) or unarchive (--no-archived).",
          })
          .option("assigned", {
            type: "boolean",
            describe: "Set assignment on/off. Pair with --assigned-to.",
          })
          .option("assigned-to", {
            type: "string",
            describe: 'Assignee object as JSON, e.g. \'{"id":"<user_id>"}\'.',
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const refs = strList(argv.element);
        if (!refs) {
          throw new ConfigError(
            "--element is required (repeat it to update several at once).",
          );
        }
        const body: Record<string, unknown> = { element_refs: refs };
        if (argv.status !== undefined) body.status = String(argv.status);
        if (argv.archived !== undefined) body.archived = !!argv.archived;
        if (argv.assigned !== undefined) body.assigned = !!argv.assigned;
        const assignedTo = argv["assigned-to"] ?? argv.assignedTo;
        if (assignedTo !== undefined) {
          body.assigned_to = parseJsonOption(assignedTo, "--assigned-to");
        }
        // The API accepts exactly one operation per call (422 otherwise), and
        // caps a batch at 100 refs. Check here too so --dry-run catches it.
        const ops = ["status", "archived", "assigned"].filter(
          (k) => body[k] !== undefined,
        );
        if (ops.length !== 1) {
          throw new ConfigError(
            ops.length === 0
              ? "Supply exactly one operation: --status, --archived, or --assigned."
              : `Supply exactly one operation per call — got ${ops.length} (${ops.join(", ")}). Run separate commands.`,
          );
        }
        if (refs.length > MAX_INBOX_BULK_REFS) {
          throw new ConfigError(
            `A bulk update may address at most ${MAX_INBOX_BULK_REFS} elements (got ${refs.length}). Split it into batches.`,
          );
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PATCH /workspaces/${wid}/inbox/elements`,
            body,
            `update ${refs.length} element(s)`,
          );
        }
        const data = await bulkUpdateInboxElements(client, wid, body as any);
        // The API answers 207 for a partial update and names the elements it
        // could not touch in `missing_ids`. Never report that as a clean pass.
        out.emitSuccess(data, g, (d: any) => {
          const missing: string[] = Array.isArray(d?.missing_ids)
            ? d.missing_ids
            : [];
          if (missing.length) {
            out.warning(
              `Partially applied: ${refs.length - missing.length}/${refs.length} updated.`,
            );
            out.status("Not updated", missing.join(", "));
          } else {
            out.success(`Updated ${refs.length} element(s).`);
          }
        });
      }),
    )
    .command(
      "inbox:contact <element_ref>",
      "Show the contact profile behind an inbox element.",
      (y) =>
        y
          .positional("element_ref", { type: "string", demandOption: true })
          .option("platform-id", {
            type: "string",
            describe:
              "Narrows resolution when the same provider id exists under two accounts.",
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const params: { platform_id?: string } = {};
        const pid = argv["platform-id"] ?? argv.platformId;
        if (pid) params.platform_id = String(pid);
        const data = await getInboxContact(
          client,
          wid,
          String(argv.element_ref),
          params,
        );
        out.emitSuccess(data, g, (d: any) => {
          out.section("Contact");
          for (const k of ["name", "email", "phone", "company"]) {
            out.status(k, trim(d?.[k], 60));
          }
        });
      }),
    )
    .command(
      "inbox:contact-update <element_ref>",
      "Update a contact. NOTE: applies to EVERY element for that contact on this account.",
      (y) =>
        y
          .positional("element_ref", { type: "string", demandOption: true })
          .option("platform-id", {
            type: "string",
            describe: "Connected account id (required).",
          })
          .option("name", { type: "string" })
          .option("email", { type: "string" })
          .option("phone", { type: "string" })
          .option("company", { type: "string" })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const ref = String(argv.element_ref);
        const pid = argv["platform-id"] ?? argv.platformId;
        if (!pid) throw new ConfigError("--platform-id is required.");
        const body: Record<string, unknown> = { platform_id: String(pid) };
        for (const k of ["name", "email", "phone", "company"]) {
          if (argv[k] !== undefined) body[k] = String(argv[k]);
        }
        if (Object.keys(body).length === 1) {
          throw new ConfigError(
            "Pass at least one of --name, --email, --phone, --company.",
          );
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PATCH /workspaces/${wid}/inbox/elements/${enc(ref)}/contact`,
            body,
            `update contact for ${ref}`,
          );
        }
        const data = await updateInboxContact(client, wid, ref, body);
        // A contact is a person, not a per-element attribute — the API applies
        // this to every element for that contact and reports `updated_count`.
        out.emitSuccess(data, g, (d: any) => {
          const n = d?.updated_count;
          out.success(
            typeof n === "number"
              ? `Updated contact across ${n} element(s).`
              : `Updated contact for ${ref}.`,
          );
        });
      }),
    );
}

// ─────────────────────────────────────────────────────────────────
// Conversations — messages (DMs), notes, bookmarks.
// ─────────────────────────────────────────────────────────────────

function registerConversations<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "inbox:messages <conversation_id>",
      "List messages in a conversation. Id = element_details.element_id.",
      (y) =>
        y
          .positional("conversation_id", { type: "string", demandOption: true })
          .option("page", { type: "number" })
          .option("limit", {
            type: "number",
            alias: "per-page",
            describe: `Items per page (max ${MAX_INBOX_LIMIT}).`,
          })
          .option("sort-order", {
            type: "string",
            choices: ["asc", "desc"],
            describe: "Time order of returned messages.",
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const params: Record<string, unknown> = {};
        if (argv.page !== undefined) params.page = Number(argv.page);
        if (argv.limit !== undefined) params.limit = Number(argv.limit);
        const so = argv["sort-order"] ?? argv.sortOrder;
        if (so) params.sort_order = String(so);

        const { data, pagination } = await listInboxMessages(
          client,
          wid,
          String(argv.conversation_id),
          params,
        );
        out.emitSuccess(
          data,
          g,
          (d) => {
            // A thread interleaves real messages with activity events. An
            // event has `message: null` and an `action` block naming the
            // teammate who did it — render it as an event, not a blank row.
            const rows = out.listish(d).map((m: any) => {
              const act = m?.action;
              if (act?.type) {
                return [
                  trim(m?.message_id, 24),
                  trim(act?.action_performed_by?.user_name, 18),
                  `— ${String(act.type).toLowerCase().replace(/_/g, " ")} —`,
                  " ",
                  trim(m?.created_time, 20),
                ];
              }
              return [
                trim(m?.message_id, 24),
                trim(personName(m?.from), 18),
                trim(m?.message, 46),
                m?.is_starred ? "★" : " ",
                trim(m?.created_time, 20),
              ];
            });
            out.section("Messages");
            out.table(["ID", "FROM", "MESSAGE", "★", "AT"], rows);
          },
          { pagination },
        );
      }),
    )
    .command(
      "inbox:send <conversation_id>",
      "Send a DM in a conversation (text, attachment, or both).",
      (y) =>
        y
          .positional("conversation_id", { type: "string", demandOption: true })
          .option("platform-type", {
            type: "string",
            choices: ["facebook", "instagram"],
            describe: "Platform of the conversation (required).",
          })
          .option("platform-id", {
            type: "string",
            describe: "Connected account id sending the DM (required).",
          })
          .option("message", { type: "string", describe: "Message text." })
          .option("file", { type: "string", describe: "Path to an attachment." })
          .option("file-type", {
            type: "string",
            describe: "Attachment type hint, e.g. image / video.",
          })
          .option("idempotency-key", {
            type: "string",
            describe:
              "De-duplicates a sequential retry. Does not protect concurrent sends.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.conversation_id);
        const platformType = argv["platform-type"] ?? argv.platformType;
        const platformId = argv["platform-id"] ?? argv.platformId;
        if (!platformType || !platformId) {
          throw new ConfigError("--platform-type and --platform-id are required.");
        }
        if (!argv.message && !argv.file) {
          throw new ConfigError("Provide --message and/or --file.");
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/inbox/conversations/${enc(cid)}/messages`,
            {
              platform_type: String(platformType),
              platform_id: String(platformId),
              message: argv.message ? String(argv.message) : undefined,
              file: argv.file ? String(argv.file) : undefined,
              file_type: argv["file-type"] ?? argv.fileType,
            },
            `send a DM in conversation ${cid}`,
          );
        }
        const data = await sendInboxMessage(client, wid, cid, {
          platformType: String(platformType),
          platformId: String(platformId),
          message: argv.message ? String(argv.message) : undefined,
          filePath: argv.file ? String(argv.file) : undefined,
          fileType: (argv["file-type"] ?? argv.fileType) as string | undefined,
          idempotencyKey: (argv["idempotency-key"] ?? argv.idempotencyKey) as
            | string
            | undefined,
        });
        out.emitSuccess(data, g, (d: any) => {
          const sent = d?.sent_message;
          out.success("Message sent.");
          if (sent?.external_id) out.status("Platform id", String(sent.external_id));
          // The platform accepted the send but returned no id, so there is
          // nothing to reconcile against later. Say so rather than implying
          // a fully confirmed delivery.
          if (sent?.id_status === "unavailable") {
            out.warning(
              "The platform returned no message id — delivery cannot be confirmed by id.",
            );
          }
        });
      }),
    )
    .command(
      "inbox:bookmarks <conversation_id>",
      "List starred messages in a conversation. Takes the PLATFORM conversation id.",
      (y) =>
        y
          .positional("conversation_id", { type: "string", demandOption: true })
          .option("page", { type: "number" })
          .option("limit", {
            type: "number",
            alias: "per-page",
            describe: `Items per page (max ${MAX_INBOX_LIMIT}).`,
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const params: Record<string, unknown> = {};
        if (argv.page !== undefined) params.page = Number(argv.page);
        if (argv.limit !== undefined) params.limit = Number(argv.limit);
        const { data, pagination } = await listInboxBookmarks(
          client,
          wid,
          String(argv.conversation_id),
          params,
        );
        out.emitSuccess(
          data,
          g,
          (d) => {
            const rows = out.listish(d).map((m: any) => [
              trim(m?.message_id, 24),
              trim(personName(m?.from), 18),
              trim(m?.message, 46),
              trim(m?.created_time, 20),
            ]);
            out.section("Starred messages");
            out.table(["ID", "FROM", "MESSAGE", "AT"], rows);
          },
          { pagination },
        );
      }),
    )
    .command(
      "inbox:star <message_id>",
      "Star a message (idempotent).",
      (y) =>
        y
          .positional("message_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mid = String(argv.message_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/inbox/messages/${enc(mid)}/bookmark`,
            {},
            `star message ${mid}`,
          );
        }
        const data = await setInboxMessageBookmark(client, wid, mid, true);
        out.emitSuccess(data, g, () => out.success(`Starred message ${mid}.`));
      }),
    )
    .command(
      "inbox:unstar <message_id>",
      "Unstar a message (idempotent).",
      (y) =>
        y
          .positional("message_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mid = String(argv.message_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/inbox/messages/${enc(mid)}/bookmark`,
            {},
            `unstar message ${mid}`,
          );
        }
        const data = await setInboxMessageBookmark(client, wid, mid, false);
        out.emitSuccess(data, g, () => out.success(`Unstarred message ${mid}.`));
      }),
    )
    .command(
      "inbox:message-delete <message_id>",
      "Delete a message (soft delete).",
      (y) =>
        y
          .positional("message_id", { type: "string", demandOption: true })
          .option("platform-id", {
            type: "string",
            describe: "Connected account id (required).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const mid = String(argv.message_id);
        const pid = argv["platform-id"] ?? argv.platformId;
        if (!pid) throw new ConfigError("--platform-id is required.");
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            endpointWithQuery(
              `DELETE /workspaces/${wid}/inbox/messages/${enc(mid)}`,
              { platform_id: pid },
            ),
            {},
            `delete message ${mid}`,
          );
        }
        const data = await deleteInboxMessage(client, wid, mid, {
          platform_id: String(pid),
        });
        out.emitSuccess(data, g, () => out.success(`Deleted message ${mid}.`));
      }),
    )
    .command(
      "inbox:notes <conversation_id>",
      "List internal notes on a conversation. Takes the PLATFORM conversation id.",
      (y) =>
        y
          .positional("conversation_id", { type: "string", demandOption: true })
          .option("page", { type: "number" })
          .option("limit", {
            type: "number",
            alias: "per-page",
            describe: `Items per page (max ${MAX_INBOX_LIMIT}).`,
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const params: Record<string, unknown> = {};
        if (argv.page !== undefined) params.page = Number(argv.page);
        if (argv.limit !== undefined) params.limit = Number(argv.limit);
        const { data, pagination } = await listInboxNotes(
          client,
          wid,
          String(argv.conversation_id),
          params,
        );
        out.emitSuccess(
          data,
          g,
          (d) => {
            const rows = out.listish(d).map((n: any) => [
              trim(n?._id ?? n?.id, 24),
              trim(personName(n?.from) ?? n?.user?.name ?? n?.created_by, 18),
              trim(n?.message, 46),
              trim(n?.created_time ?? n?.created_at, 20),
            ]);
            out.section("Internal notes");
            out.table(["ID", "BY", "NOTE", "AT"], rows);
          },
          { pagination },
        );
      }),
    )
    .command(
      "inbox:note-add <conversation_id>",
      "Add an internal note to a conversation (not visible to the customer).",
      (y) =>
        y
          .positional("conversation_id", { type: "string", demandOption: true })
          .option("message", { type: "string", describe: "Note text (required)." })
          .option("platform-type", {
            type: "string",
            describe: "Platform of the conversation (required).",
          })
          .option("platform-id", {
            type: "string",
            describe: "Connected account id (required).",
          })
          .option("mention", {
            type: "string",
            array: true,
            describe: "Team member id to mention. Repeatable.",
          })
          .option("idempotency-key", { type: "string" })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.conversation_id);
        const platformType = argv["platform-type"] ?? argv.platformType;
        const platformId = argv["platform-id"] ?? argv.platformId;
        if (!argv.message || !platformType || !platformId) {
          throw new ConfigError(
            "--message, --platform-type and --platform-id are required.",
          );
        }
        const body: any = {
          message: String(argv.message),
          platform_type: String(platformType),
          platform_id: String(platformId),
        };
        const mentions = strList(argv.mention);
        if (mentions) body.mentioned_users = mentions;
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/inbox/conversations/${enc(cid)}/notes`,
            body,
            `add a note to conversation ${cid}`,
          );
        }
        const data = await addInboxNote(client, wid, cid, body, {
          idempotencyKey: (argv["idempotency-key"] ?? argv.idempotencyKey) as
            | string
            | undefined,
        });
        out.emitSuccess(data, g, () => out.success("Note added."));
      }),
    );
}

// ─────────────────────────────────────────────────────────────────
// Post comments — list, reply, moderate.
// ─────────────────────────────────────────────────────────────────

function registerComments<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "inbox:comments <post_id>",
      "List a post's comments (threaded). Id = element_details.post_id.",
      (y) =>
        y
          .positional("post_id", { type: "string", demandOption: true })
          .option("page", { type: "number" })
          .option("limit", {
            type: "number",
            alias: "per-page",
            describe: `Items per page (max ${MAX_INBOX_LIMIT}).`,
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const params: Record<string, unknown> = {};
        if (argv.page !== undefined) params.page = Number(argv.page);
        if (argv.limit !== undefined) params.limit = Number(argv.limit);

        const { data, pagination } = await listInboxPostComments(
          client,
          wid,
          String(argv.post_id),
          params,
        );
        out.emitSuccess(
          data,
          g,
          (d) => {
            const rows = out.listish(d).map((c: any) => [
              trim(c?.comment_id, 26),
              trim(personName(c?.from), 18),
              trim(c?.message, 46),
              trim(c?.created_time, 20),
            ]);
            out.section("Comments");
            out.table(["ID", "FROM", "COMMENT", "AT"], rows);
          },
          { pagination },
        );
      }),
    )
    .command(
      "inbox:comment-add <post_id>",
      "Comment on a post, reply to a comment, or send a Facebook private reply.",
      (y) =>
        y
          .positional("post_id", { type: "string", demandOption: true })
          .option("platform-type", {
            type: "string",
            describe: "Platform of the post (required).",
          })
          .option("platform-id", {
            type: "string",
            describe: "Connected account id (required).",
          })
          .option("message", { type: "string", describe: "Comment text." })
          .option("comment-id", {
            type: "string",
            describe: "Reply to this comment id instead of the post.",
          })
          .option("private-reply", {
            type: "boolean",
            default: false,
            describe: "Send as a Facebook private reply (DM) instead of a comment.",
          })
          .option("attachment", { type: "string", describe: "Path to an attachment." })
          .option("idempotency-key", { type: "string" })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const pid = String(argv.post_id);
        const platformType = argv["platform-type"] ?? argv.platformType;
        const platformId = argv["platform-id"] ?? argv.platformId;
        if (!platformType || !platformId) {
          throw new ConfigError("--platform-type and --platform-id are required.");
        }
        if (!argv.message && !argv.attachment) {
          throw new ConfigError("Provide --message and/or --attachment.");
        }
        const commentId = argv["comment-id"] ?? argv.commentId;
        const privateReply = !!(argv["private-reply"] ?? argv.privateReply);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/inbox/posts/${enc(pid)}/comments`,
            {
              platform_type: String(platformType),
              platform_id: String(platformId),
              message: argv.message ? String(argv.message) : undefined,
              comment_id: commentId ? String(commentId) : undefined,
              is_private_reply: privateReply || undefined,
              attachment_file: argv.attachment ? String(argv.attachment) : undefined,
            },
            `comment on post ${pid}`,
          );
        }
        const data = await addInboxPostComment(client, wid, pid, {
          platformType: String(platformType),
          platformId: String(platformId),
          message: argv.message ? String(argv.message) : undefined,
          commentId: commentId ? String(commentId) : undefined,
          isPrivateReply: privateReply,
          attachmentPath: argv.attachment ? String(argv.attachment) : undefined,
          idempotencyKey: (argv["idempotency-key"] ?? argv.idempotencyKey) as
            | string
            | undefined,
        });
        // The API reports what it actually created: `resource_type` is
        // "comment", or "message" when it became a private reply.
        out.emitSuccess(data, g, (d: any) => {
          const kind = d?.sent_comment?.resource_type;
          if (kind === "message") out.success("Private reply sent as a DM.");
          else if (kind === "comment") out.success("Comment posted.");
          else out.success(privateReply ? "Private reply sent." : "Comment posted.");
        });
      }),
    )
    .command(
      "inbox:comment-delete <comment_id>",
      "Delete a comment.",
      (y) =>
        y
          .positional("comment_id", { type: "string", demandOption: true })
          .option("platform-type", { type: "string", describe: "Required." })
          .option("platform-id", { type: "string", describe: "Required." })
          .option("comment-urn", {
            type: "string",
            describe: "Required for LinkedIn comments.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.comment_id);
        const platformType = argv["platform-type"] ?? argv.platformType;
        const platformId = argv["platform-id"] ?? argv.platformId;
        if (!platformType || !platformId) {
          throw new ConfigError("--platform-type and --platform-id are required.");
        }
        const urn = argv["comment-urn"] ?? argv.commentUrn;
        const params: any = {
          platform_type: String(platformType),
          platform_id: String(platformId),
        };
        if (urn) params.comment_urn = String(urn);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            endpointWithQuery(
              `DELETE /workspaces/${wid}/inbox/comments/${enc(cid)}`,
              params,
            ),
            {},
            `delete comment ${cid}`,
          );
        }
        const data = await deleteInboxComment(client, wid, cid, params);
        out.emitSuccess(data, g, () => out.success(`Deleted comment ${cid}.`));
      }),
    )
    .command(
      "inbox:comment-hide <comment_id>",
      "Hide a comment (idempotent).",
      (y) =>
        y
          .positional("comment_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.comment_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/inbox/comments/${enc(cid)}/hidden`,
            {},
            `hide comment ${cid}`,
          );
        }
        const data = await setInboxCommentHidden(client, wid, cid, true);
        out.emitSuccess(data, g, () => out.success(`Hid comment ${cid}.`));
      }),
    )
    .command(
      "inbox:comment-unhide <comment_id>",
      "Unhide a comment (idempotent).",
      (y) =>
        y
          .positional("comment_id", { type: "string", demandOption: true })
          .option("platform-type", { type: "string", describe: "Required." })
          .option("platform-id", { type: "string", describe: "Required." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.comment_id);
        const platformType = argv["platform-type"] ?? argv.platformType;
        const platformId = argv["platform-id"] ?? argv.platformId;
        if (!platformType || !platformId) {
          throw new ConfigError(
            "--platform-type and --platform-id are required to unhide.",
          );
        }
        const params = {
          platform_type: String(platformType),
          platform_id: String(platformId),
        };
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            endpointWithQuery(
              `DELETE /workspaces/${wid}/inbox/comments/${enc(cid)}/hidden`,
              params,
            ),
            {},
            `unhide comment ${cid}`,
          );
        }
        const data = await setInboxCommentHidden(client, wid, cid, false, params);
        out.emitSuccess(data, g, () => out.success(`Unhid comment ${cid}.`));
      }),
    )
    .command(
      "inbox:comment-like <comment_id>",
      "Like a comment (Facebook, idempotent).",
      (y) =>
        y
          .positional("comment_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.comment_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/inbox/comments/${enc(cid)}/like`,
            {},
            `like comment ${cid}`,
          );
        }
        const data = await setInboxCommentLike(client, wid, cid, true);
        out.emitSuccess(data, g, () => out.success(`Liked comment ${cid}.`));
      }),
    )
    .command(
      "inbox:comment-unlike <comment_id>",
      "Unlike a comment (Facebook, idempotent).",
      (y) =>
        y
          .positional("comment_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.comment_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/inbox/comments/${enc(cid)}/like`,
            {},
            `unlike comment ${cid}`,
          );
        }
        const data = await setInboxCommentLike(client, wid, cid, false);
        out.emitSuccess(data, g, () => out.success(`Unliked comment ${cid}.`));
      }),
    );
}

// ─────────────────────────────────────────────────────────────────
// Reviews — reply upsert / delete.
// ─────────────────────────────────────────────────────────────────

function registerReviews<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "inbox:review-reply <review_id>",
      "Add or replace the reply to a review (upsert).",
      (y) =>
        y
          .positional("review_id", { type: "string", demandOption: true })
          .option("platform-id", {
            type: "string",
            describe: "Connected account id (required).",
          })
          .option("reply", { type: "string", describe: "Reply text (required)." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const rid = String(argv.review_id);
        const pid = argv["platform-id"] ?? argv.platformId;
        if (!pid || !argv.reply) {
          throw new ConfigError("--platform-id and --reply are required.");
        }
        const body = {
          platform_id: String(pid),
          review_reply: String(argv.reply),
        };
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/inbox/reviews/${enc(rid)}/reply`,
            body,
            `reply to review ${rid}`,
          );
        }
        const data = await upsertInboxReviewReply(client, wid, rid, body);
        out.emitSuccess(data, g, () => out.success(`Replied to review ${rid}.`));
      }),
    )
    .command(
      "inbox:review-reply-delete <review_id>",
      "Delete the reply on a review.",
      (y) =>
        y
          .positional("review_id", { type: "string", demandOption: true })
          .option("platform-id", {
            type: "string",
            describe: "Connected account id (required).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const rid = String(argv.review_id);
        const pid = argv["platform-id"] ?? argv.platformId;
        if (!pid) throw new ConfigError("--platform-id is required.");
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            endpointWithQuery(
              `DELETE /workspaces/${wid}/inbox/reviews/${enc(rid)}/reply`,
              { platform_id: pid },
            ),
            {},
            `delete the reply on review ${rid}`,
          );
        }
        const data = await deleteInboxReviewReply(client, wid, rid, {
          platform_id: String(pid),
        });
        out.emitSuccess(data, g, () =>
          out.success(`Deleted reply on review ${rid}.`),
        );
      }),
    );
}

// ─────────────────────────────────────────────────────────────────
// Tags — workspace tag catalogue + per-element attachment.
// ─────────────────────────────────────────────────────────────────

function registerTags<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "inbox:tags",
      "List the workspace's inbox tags.",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data = await listInboxTags(client, wid);
        out.emitSuccess(data, g, (d) => {
          const rows = out.listish(d).map((t: any) => [
            trim(t?._id ?? t?.id ?? t?.tag_id, 26),
            trim(t?.tag_name ?? t?.name, 30),
            trim(t?.tag_color ?? t?.color, 12),
          ]);
          out.section("Inbox tags");
          out.table(["ID", "NAME", "COLOR"], rows);
        });
      }),
    )
    .command(
      "inbox:tag-create",
      "Create an inbox tag.",
      (y) =>
        y
          .option("name", {
            type: "string",
            describe: "Tag name (required, max 50 chars).",
          })
          .option("color", { type: "string", describe: "Tag color (required)." })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        if (!argv.name || !argv.color) {
          throw new ConfigError("--name and --color are required.");
        }
        const body = {
          tag_name: String(argv.name),
          tag_color: String(argv.color),
        };
        if (isDryRun(argv)) {
          return emitDryRun(g, `POST /workspaces/${wid}/inbox/tags`, body, "create tag");
        }
        const data = await createInboxTag(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Tag created.");
          out.status("ID", String(d?._id ?? d?.id ?? "-"));
        });
      }),
    )
    .command(
      "inbox:tag-update <tag_id>",
      "Rename or recolour an inbox tag.",
      (y) =>
        y
          .positional("tag_id", { type: "string", demandOption: true })
          .option("name", { type: "string" })
          .option("color", { type: "string" })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const tid = String(argv.tag_id);
        const body: Record<string, string> = {};
        if (argv.name !== undefined) body.tag_name = String(argv.name);
        if (argv.color !== undefined) body.tag_color = String(argv.color);
        if (!Object.keys(body).length) {
          throw new ConfigError("Pass --name and/or --color to update.");
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PATCH /workspaces/${wid}/inbox/tags/${enc(tid)}`,
            body,
            `update tag ${tid}`,
          );
        }
        const data = await updateInboxTag(client, wid, tid, body);
        out.emitSuccess(data, g, () => out.success(`Updated tag ${tid}.`));
      }),
    )
    .command(
      "inbox:tag-delete",
      "Delete one or more inbox tags.",
      (y) =>
        y
          .option("tag", {
            type: "string",
            array: true,
            describe: "Tag id to delete. Repeatable. Required.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const ids = strList(argv.tag);
        if (!ids) throw new ConfigError("--tag is required (repeatable).");
        const body = { tag_ids: ids };
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/inbox/tags`,
            body,
            `delete ${ids.length} tag(s)`,
          );
        }
        const data = await deleteInboxTags(client, wid, ids);
        out.emitSuccess(data, g, () => out.success(`Deleted ${ids.length} tag(s).`));
      }),
    )
    .command(
      "inbox:tag-merge",
      "Merge several tags into a new one.",
      (y) =>
        y
          .option("name", { type: "string", describe: "Name of the new tag (required)." })
          .option("color", { type: "string", describe: "Color of the new tag (required)." })
          .option("tag", {
            type: "string",
            array: true,
            describe: "Tag id to merge in. Repeatable. Required.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const ids = strList(argv.tag);
        if (!argv.name || !argv.color || !ids) {
          throw new ConfigError("--name, --color and --tag (repeatable) are required.");
        }
        const body = {
          tag_name: String(argv.name),
          tag_color: String(argv.color),
          tag_ids: ids,
        };
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/inbox/tags/merge`,
            body,
            `merge ${ids.length} tag(s)`,
          );
        }
        const data = await mergeInboxTags(client, wid, body);
        out.emitSuccess(data, g, () => out.success(`Merged ${ids.length} tag(s).`));
      }),
    )
    .command(
      "inbox:tag-attach <element_ref>",
      "Attach tags to an element. Id = element_details.element_id.",
      (y) =>
        y
          .positional("element_ref", { type: "string", demandOption: true })
          .option("tag", {
            type: "string",
            array: true,
            describe: "Tag id to attach. Repeatable. Required.",
          })
          .option("platform-id", { type: "string", describe: "Required." })
          .option("inbox-type", {
            type: "string",
            choices: INBOX_TYPES as unknown as string[],
            describe: "Element's inbox type (required).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const ref = String(argv.element_ref);
        const ids = strList(argv.tag);
        const pid = argv["platform-id"] ?? argv.platformId;
        const itype = argv["inbox-type"] ?? argv.inboxType;
        if (!ids || !pid || !itype) {
          throw new ConfigError(
            "--tag (repeatable), --platform-id and --inbox-type are required.",
          );
        }
        const body = {
          tags: ids,
          platform_id: String(pid),
          inbox_type: String(itype) as "conversation" | "post" | "review",
        };
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/inbox/elements/${enc(ref)}/tags`,
            body,
            `attach ${ids.length} tag(s) to ${ref}`,
          );
        }
        const data = await attachInboxTags(client, wid, ref, body);
        out.emitSuccess(data, g, () =>
          out.success(`Attached ${ids.length} tag(s) to ${ref}.`),
        );
      }),
    )
    .command(
      "inbox:tag-detach <element_ref> <tag_id>",
      "Detach a tag from an element. Id = element_details.element_id.",
      (y) =>
        y
          .positional("element_ref", { type: "string", demandOption: true })
          .positional("tag_id", { type: "string", demandOption: true })
          .option("platform-id", { type: "string", describe: "Required." })
          .option("inbox-type", {
            type: "string",
            choices: INBOX_TYPES as unknown as string[],
            describe: "Element's inbox type (required).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const ref = String(argv.element_ref);
        const tid = String(argv.tag_id);
        const pid = argv["platform-id"] ?? argv.platformId;
        const itype = argv["inbox-type"] ?? argv.inboxType;
        if (!pid || !itype) {
          throw new ConfigError("--platform-id and --inbox-type are required.");
        }
        const params = { platform_id: String(pid), inbox_type: String(itype) };
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            endpointWithQuery(
              `DELETE /workspaces/${wid}/inbox/elements/${enc(ref)}/tags/${enc(tid)}`,
              params,
            ),
            {},
            `detach tag ${tid} from ${ref}`,
          );
        }
        const data = await detachInboxTag(client, wid, ref, tid, params);
        out.emitSuccess(data, g, () =>
          out.success(`Detached tag ${tid} from ${ref}.`),
        );
      }),
    );
}

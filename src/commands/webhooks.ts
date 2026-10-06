/**
 * Webhooks — outbound event subscriptions (CONT-3684).
 *
 * A webhook belongs to the API key's USER, not to a workspace: every
 * workspace the user is a member of lists the same webhooks. The workspace
 * (--workspace / active) only decides whose API credits the call uses — one
 * credit per call. Each user can have 5 webhooks.
 *
 * The signing secret is returned ONLY by `webhooks:create` and
 * `webhooks:rotate-secret`, once. Human output prints it with a "store it
 * now" warning; JSON output carries it as `data.secret`.
 */

import type { Argv } from "yargs";

import {
  createWebhook,
  deleteWebhook,
  getWebhook,
  listWebhookDeliveries,
  listWebhookEventTypes,
  listWebhooks,
  rotateWebhookSecret,
  updateWebhook,
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

const STATUSES = ["enabled", "disabled"] as const;
const DELIVERY_STATUSES = ["all", "successful", "failed"] as const;

export function registerWebhooks<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "webhooks:event-types",
      "List the event types a webhook can subscribe to (pass `value` to --event-type).",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data = await listWebhookEventTypes(client, wid);
        const items = Array.isArray(data) ? data : [];
        out.emitSuccess(data, g, () =>
          out.table(
            ["Value", "Group", "Label", "Payload schema"],
            items.map((e: any) => [
              e.value ?? "-",
              e.group ?? "-",
              e.label ?? "-",
              e.payload_schema ?? "-",
            ]),
          ),
        );
      }),
    )
    .command(
      "webhooks:list",
      "List your webhooks (user-owned — the same list in every workspace), with used/limit.",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listWebhooks(client, wid);
        out.emitSuccess(resp, g, (d) => {
          out.info(`${d.used} of ${d.limit} webhooks used`);
          out.table(
            ["ID", "Name", "URL", "Status", "Events", "Last delivery"],
            d.data.map((w: any) => [
              String(w.id ?? w._id ?? "-"),
              w.name ?? "-",
              w.url ?? "-",
              w.status ?? "-",
              String((w.event_types ?? []).length),
              w.last_delivery_status
                ? `${w.last_delivery_status} @ ${w.last_delivery_at ?? "-"}`
                : "-",
            ]),
          );
        });
      }),
    )
    .command(
      "webhooks:get <webhook_id>",
      "Read one webhook. Never includes the secret — only `has_secret`.",
      (y) => y.positional("webhook_id", { type: "string", demandOption: true }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data = await getWebhook(client, wid, String(argv.webhook_id));
        out.emitSuccess(data, g, renderWebhook);
      }),
    )
    .command(
      "webhooks:create",
      "Create a webhook. The backend refuses internal URLs and pings the URL (must answer 2xx within 5s) before saving. Prints the signing secret ONCE.",
      (y) =>
        applyWritableOptions(y)
          .option("secret", {
            type: "string",
            describe:
              "Your own signing secret, `whsec_<base64>`. Omit it and one is generated.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const eventTypes = eventTypesOf(argv);
        if (!argv.url || !eventTypes?.length) {
          throw new ConfigError(
            "--url (https) and at least one --event-type are required. See `webhooks:event-types`.",
          );
        }
        const body: {
          url: string;
          event_types: string[];
          name?: string;
          secret?: string;
          custom_headers?: Record<string, unknown>;
        } = { url: String(argv.url), event_types: eventTypes };
        if (argv.name !== undefined) body.name = String(argv.name);
        if (argv.secret !== undefined) body.secret = String(argv.secret);
        const headers = customHeadersOf(argv);
        if (headers !== undefined) body.custom_headers = headers;

        if (isDryRun(argv)) {
          // Never echo a caller-supplied secret into transcripts/logs.
          const shown = body.secret ? { ...body, secret: "whsec_…(redacted)" } : body;
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/webhooks`,
            shown,
            "create webhook",
          );
        }
        const data = await createWebhook(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Webhook created.");
          out.status("ID", String(d?.id ?? d?._id ?? "-"));
          out.status("URL", String(d?.url ?? "-"));
          out.status("Status", String(d?.status ?? "-"));
          out.status("Events", (d?.event_types ?? []).join(", ") || "-");
          renderSecret(d);
        });
      }),
    )
    .command(
      "webhooks:update <webhook_id>",
      "Update a webhook (partial). A new --url is re-checked and pinged like create.",
      (y) =>
        applyWritableOptions(
          y.positional("webhook_id", { type: "string", demandOption: true }),
        )
          .option("status", {
            type: "string",
            choices: [...STATUSES],
            describe:
              "disabled pauses deliveries; enabled resumes them (also resumes a `disabled_by_system` webhook and resets its failure count).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.webhook_id);
        const body: Record<string, unknown> = {};
        if (argv.url !== undefined) body.url = String(argv.url);
        const eventTypes = eventTypesOf(argv);
        if (eventTypes !== undefined) body.event_types = eventTypes;
        if (argv.name !== undefined) body.name = String(argv.name);
        const headers = customHeadersOf(argv);
        if (headers !== undefined) body.custom_headers = headers;
        if (argv.status !== undefined) body.status = String(argv.status);

        if (!Object.keys(body).length) {
          throw new ConfigError(
            "Pass at least one of --url / --event-type / --name / --custom-headers / --status.",
          );
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/webhooks/${id}`,
            body,
            `update webhook ${id}`,
          );
        }
        const data = await updateWebhook(client, wid, id, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success(`Updated webhook ${id}.`);
          out.status("Status", String(d?.status ?? "-"));
        });
      }),
    )
    .command(
      "webhooks:disable <webhook_id>",
      "Pause deliveries (PUT status=disabled). Reversible with webhooks:enable.",
      (y) =>
        y
          .positional("webhook_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => setStatus(argv, g, "disabled")),
    )
    .command(
      "webhooks:enable <webhook_id>",
      "Resume deliveries (PUT status=enabled). Also resumes a `disabled_by_system` webhook.",
      (y) =>
        y
          .positional("webhook_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => setStatus(argv, g, "enabled")),
    )
    .command(
      "webhooks:delete <webhook_id>",
      "Delete a webhook. Prefer webhooks:disable when the pause is temporary — deleting is not reversible.",
      (y) =>
        y
          .positional("webhook_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.webhook_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/webhooks/${id}`,
            {},
            `delete webhook ${id}`,
          );
        }
        const data = await deleteWebhook(client, wid, id);
        out.emitSuccess(data ?? null, g, () =>
          out.success(`Deleted webhook ${id}.`),
        );
      }),
    )
    .command(
      "webhooks:rotate-secret <webhook_id>",
      "Issue a new signing secret (printed ONCE). The previous secret keeps signing for 24h.",
      (y) =>
        y
          .positional("webhook_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.webhook_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/webhooks/${id}/rotate-secret`,
            {},
            `rotate the signing secret of webhook ${id}`,
          );
        }
        const data = await rotateWebhookSecret(client, wid, id);
        out.emitSuccess(data, g, (d: any) => {
          out.success(`Rotated the signing secret of webhook ${id}.`);
          renderSecret(d);
          if (d?.previous_secret_expires_at) {
            out.info(
              `The previous secret keeps signing until ${d.previous_secret_expires_at} — deploy the new one to your receiver before then.`,
            );
          }
        });
      }),
    )
    .command(
      "webhooks:deliveries <webhook_id>",
      "Delivery log, newest first — the \"why did events stop arriving\" diagnostic. Kept 30 days.",
      (y) =>
        y
          .positional("webhook_id", { type: "string", demandOption: true })
          .option("status", {
            type: "string",
            choices: [...DELIVERY_STATUSES],
            describe:
              "all (default; includes retrying + skipped_out_of_credits), successful (delivered only), failed (failed only).",
          })
          .option("event-type", {
            type: "string",
            describe: "Only this event type, e.g. post.published.",
          })
          .option("from", {
            type: "string",
            describe: "ISO 8601 lower bound. No offset = UTC.",
          })
          .option("to", {
            type: "string",
            describe: "ISO 8601 upper bound. No offset = UTC.",
          })
          .option("search", {
            type: "string",
            describe: "An exact event ID, or part of an event type.",
          })
          .option("page", { type: "number", describe: "Page number (default 1)." })
          .option("per-page", { type: "number", describe: "1–100 (default 25)." }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listWebhookDeliveries(
          client,
          wid,
          String(argv.webhook_id),
          {
            status: argv.status,
            event_type: argv["event-type"] ?? argv.eventType,
            from: argv.from,
            to: argv.to,
            search: argv.search,
            page: argv.page,
            per_page: argv["per-page"] ?? argv.perPage,
          },
        );
        const items = (resp.data as any[]) ?? [];
        out.emitSuccess(
          resp.data,
          g,
          () =>
            out.table(
              ["When (UTC)", "Event", "Outcome", "HTTP", "ms", "Test", "Event ID"],
              items.map((d) => [
                d.created_at ?? "-",
                d.event_type ?? "-",
                d.outcome ?? "-",
                d.response_status == null ? "-" : String(d.response_status),
                d.duration_ms == null ? "-" : String(d.duration_ms),
                d.is_test ? "yes" : "no",
                d.event_id ?? "-",
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    );
}

/** Options shared by create and update. */
function applyWritableOptions<T>(y: Argv<T>): Argv<T> {
  return y
    .option("url", {
      type: "string",
      describe:
        "https endpoint, publicly reachable. Internal addresses are refused; the URL is pinged and must answer 2xx within 5s.",
    })
    .option("event-type", {
      type: "string",
      array: true,
      describe:
        "Event to subscribe to (a `value` from webhooks:event-types). Repeatable → event_types[]. On update it REPLACES the list.",
    })
    .option("name", { type: "string", describe: "Display name, ≤120 chars." })
    .option("custom-headers", {
      type: "string",
      describe:
        "JSON object of string headers sent with every delivery → custom_headers, e.g. '{\"X-Tenant\":\"acme\"}'. Cannot replace the signing/system headers.",
    });
}

function eventTypesOf(argv: any): string[] | undefined {
  const raw = (argv["event-type"] ?? argv.eventType) as string[] | undefined;
  if (raw === undefined) return undefined;
  return raw.map(String).filter(Boolean);
}

function customHeadersOf(argv: any): Record<string, unknown> | undefined {
  const raw = argv["custom-headers"] ?? argv.customHeaders;
  if (raw === undefined) return undefined;
  return parseJsonOption(raw, "--custom-headers");
}

async function setStatus(
  argv: any,
  g: any,
  status: (typeof STATUSES)[number],
): Promise<void> {
  const { cfg, client } = buildClient(g);
  const wid = resolveWorkspace(cfg, g);
  const id = String(argv.webhook_id);
  const body = { status };
  if (isDryRun(argv)) {
    return emitDryRun(
      g,
      `PUT /workspaces/${wid}/webhooks/${id}`,
      body,
      `${status === "enabled" ? "enable" : "disable"} webhook ${id}`,
    );
  }
  const data = await updateWebhook(client, wid, id, body);
  out.emitSuccess(data, g, () =>
    out.success(`Webhook ${id} ${status === "enabled" ? "enabled" : "disabled"}.`),
  );
}

function renderSecret(d: any): void {
  if (!d?.secret) return;
  out.warning(
    "Store this signing secret NOW — it will not be shown again (list/get only report has_secret).",
  );
  out.status("Secret", String(d.secret));
}

function renderWebhook(d: any): void {
  out.success(`Webhook ${d?.name ?? d?.id ?? "-"}`);
  out.status("ID", String(d?.id ?? d?._id ?? "-"));
  out.status("URL", String(d?.url ?? "-"));
  out.status("Status", String(d?.status ?? "-"));
  out.status("Events", (d?.event_types ?? []).join(", ") || "-");
  out.status("Has secret", d?.has_secret ? "yes" : "no");
  const headers = d?.custom_headers;
  if (headers && typeof headers === "object" && Object.keys(headers).length) {
    out.status("Custom headers", JSON.stringify(headers));
  }
  out.status("Last delivery", String(d?.last_delivery_status ?? "-"));
  out.status("Last delivery at", String(d?.last_delivery_at ?? "-"));
  out.status("Created", String(d?.created_at ?? "-"));
  out.status("Updated", String(d?.updated_at ?? "-"));
}

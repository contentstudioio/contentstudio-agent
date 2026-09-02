/**
 * Analytics REPORT commands — report generation, report schedules, shareable links and
 * competitor benchmarking.
 *
 * Separate module from `analytics.ts` on purpose: that file is the read surface (one command per
 * analytics endpoint, per platform). This one is the management surface — it creates, schedules,
 * shares and deletes. They were written independently against the same filename and merged here by
 * splitting rather than interleaving 7,000 lines; the command namespaces do not overlap
 * (`analytics:*` there, `reports:* / report-schedules:* / share-links:* / competitor*:*` here).
 *
 * Report generation is asynchronous. `reports:generate` returns a report id
 * immediately; `reports:get` is the poll, and `--wait` polls for you until the
 * report is ready or fails. All mutating commands carry `--dry-run`.
 */

import type { Argv } from "yargs";

import {
  createCompetitorReport,
  createReportSchedule,
  createShareLink,
  deleteCompetitorReport,
  deleteReport,
  deleteReportSchedule,
  deleteShareLink,
  generateReport,
  getCompetitorComparison,
  getCompetitorReport,
  getReport,
  getReportSchedule,
  getShareLink,
  listCompetitorReports,
  listReportOptions,
  listReportSchedules,
  listReports,
  listShareLinks,
  retryReport,
  runReportScheduleNow,
  searchCompetitors,
  setReportScheduleState,
  setShareLinkDisabled,
  updateCompetitorReport,
  updateReportSchedule,
  updateShareLink,
  type CompetitorEntry,
} from "../api";
import { ConfigError, ValidationError } from "../errors";
import * as out from "../output";
import {
  buildClient,
  emitDryRun,
  isDryRun,
  resolveWorkspace,
  run,
} from "../cliCtx";

/** Terminal states for a generation job — anything else is still in flight. */
const DONE = new Set(["completed", "failed", "error"]);

const POLL_INTERVAL_MS = 5_000;
/** Competitor search hits the social platform live; the upstream alone can take minutes. */
const COMPETITOR_SEARCH_TIMEOUT_MS = 240_000;
const DEFAULT_WAIT_SECONDS = 300;

function csv(v: unknown): string[] | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Competitors are objects, not ids: `--competitors '<json array>'`, or the
 * shorthand `id:Name,id:Name`. The API silently ignores bare strings, so the
 * shorthand is expanded here rather than passed through.
 */
function parseCompetitors(raw: unknown, flag: string): CompetitorEntry[] {
  const text = String(raw ?? "").trim();
  if (!text) throw new ConfigError(`${flag} is required.`);

  if (text.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new ConfigError(`${flag}: invalid JSON — ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new ConfigError(`${flag}: expected a non-empty JSON array.`);
    }
    return parsed.map((entry, i) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new ConfigError(
          `${flag}[${i}]: each competitor must be an object with competitor_id and name.`,
        );
      }
      const e = entry as Record<string, unknown>;
      if (!e.competitor_id || !e.name) {
        throw new ConfigError(
          `${flag}[${i}]: competitor_id and name are both required.`,
        );
      }
      return e as unknown as CompetitorEntry;
    });
  }

  return text.split(",").map((pair) => {
    const idx = pair.indexOf(":");
    if (idx < 1 || idx === pair.length - 1) {
      throw new ConfigError(
        `${flag}: use 'id:Name,id:Name' or a JSON array. Got "${pair.trim()}".`,
      );
    }
    return {
      competitor_id: pair.slice(0, idx).trim(),
      name: pair.slice(idx + 1).trim(),
    };
  });
}

function reportRows(items: any[]): string[][] {
  return items.map((r) => [
    String(r.id ?? "-"),
    String(r.name ?? "-"),
    String(r.platform_type ?? "-"),
    String(r.status ?? "-"),
    r.export_url ? "yes" : "no",
  ]);
}

/**
 * Reject an unknown --platform-type before the request goes out.
 *
 * The valid set is READ FROM THE API (reports:options), never hardcoded here. That is the whole point:
 * a new report family — threads was the most recent — becomes usable the moment the service exposes it,
 * with no release of this CLI. A literal list would have to be edited for every platform and would go
 * stale silently, rejecting a type the backend accepts.
 *
 * FAILS OPEN. If the options call errors — no permission, a network blip, an older backend without the
 * endpoint — validation is skipped and the generate proceeds. A pre-flight check must not become a new
 * way for a working command to fail; the API is still the authority and will reject a bad type itself.
 */
/**
 * Where each --metric puts its rows.
 *
 * Every metric hits a DIFFERENT endpoint and each names its array after itself, so a single
 * hardcoded key only ever worked for the default. `top-and-least-performing-posts` does not even
 * follow the pattern — it answers under `top_posts`. Reading the wrong key made the CLI print
 * "No comparison rows for that period." while the API had returned real data.
 *
 * Verified against the live API for all seven metrics rather than derived from the names.
 */
const COMPETITOR_METRIC_KEYS: Record<string, string> = {
  "data-table-metrics": "data_table_metrics",
  "post-engagement-by-competitor": "post_engagement_by_competitor",
  "followers-growth-comparison": "followers_growth_comparison",
  "posting-activity-graph-by-types": "posting_activity_graph_by_types",
  "top-and-least-performing-posts": "top_posts",
  "top-hashtags": "top_hashtags",
  "biography-data": "biography_data",
};

/** Keys that are never worth a column: ids, image urls, and nested payloads. */
const COMPETITOR_NOISE_KEYS = new Set([
  "image",
  "slug",
  "facebook_id",
  "instagram_id",
  "page_id",
  "id",
  "_id",
]);

/** Identity-ish columns, in the order they should appear when a row has one. */
const COMPETITOR_LABEL_KEYS = [
  "name",
  "page_name",
  "companies_name",
  "hashtag",
  "mediaType",
  "dayOfWeek",
];

/** One table cell. A series renders as its length; anything unset renders as a dash, never "0". */
export function formatCompetitorCell(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} pts`;
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

/**
 * Pull the row array for the requested metric out of a comparison payload.
 *
 * Falls back to the first array-of-objects in the response that is not `data_prev` — so a metric
 * added to the backend later still renders instead of silently reporting nothing. `data_prev` is
 * excluded by name because it is the PREVIOUS period: picking it up would answer a different
 * question than the caller's date flags asked.
 */
export function selectCompetitorRows(
  payload: any,
  metric: string,
): { rows: any[]; key: string | null } {
  const d = payload?.data ?? payload;
  if (!d || typeof d !== "object") return { rows: [], key: null };

  const preferred = COMPETITOR_METRIC_KEYS[metric];
  if (preferred && Array.isArray(d[preferred])) {
    return { rows: d[preferred], key: preferred };
  }
  for (const [k, v] of Object.entries(d)) {
    if (k === "data_prev") continue;
    if (Array.isArray(v) && (v.length === 0 || typeof v[0] === "object")) {
      return { rows: v as any[], key: k };
    }
  }
  return { rows: [], key: null };
}

/**
 * Columns for a metric whose row shape the CLI does not curate.
 *
 * The seven metrics return seven different shapes — hashtags, biographies and posting activity
 * share no fields with the default table — so a fixed Competitor/Followers/Avg-engagement header
 * printed empty cells or, worse, mislabelled ones. These columns come from the row itself.
 */
export function genericCompetitorColumns(row: any, limit = 6): string[] {
  if (!row || typeof row !== "object") return [];
  const keys = Object.keys(row).filter(
    (k) =>
      !COMPETITOR_NOISE_KEYS.has(k) &&
      k !== "state" &&
      // Arrays are KEPT (rendered as a point count by formatCompetitorCell): followers-growth
      // returns its series under `followers`, and dropping it left a table of names and nothing
      // else — which read as "no data" when the real answer is "the series has 0 points because
      // the crawl failed". Only nested objects are dropped, having no one-cell rendering.
      (row[k] === null || typeof row[k] !== "object" || Array.isArray(row[k])),
  );
  const labels = COMPETITOR_LABEL_KEYS.filter((k) => keys.includes(k));
  const rest = keys.filter((k) => !labels.includes(k));
  const cols = [...labels, ...rest].slice(0, limit);
  if ("state" in row) cols.push("state");
  return cols;
}

export async function assertReportType(
  client: Parameters<typeof listReportOptions>[0],
  workspaceId: string,
  platformType: string,
): Promise<void> {
  let types: string[];
  try {
    const data: any = await listReportOptions(client, workspaceId);
    types = data?.report_types ?? data?.data?.report_types ?? [];
  } catch {
    return;
  }
  if (!Array.isArray(types) || types.length === 0) return;
  if (types.includes(platformType)) return;

  throw new ValidationError(`unknown report type "${platformType}".`, {
    hint: `Valid types: ${types.join(", ")}. Run \`reports:options\` for the sections each one accepts.`,
  });
}

export function registerAnalyticsReports<T>(yargs: Argv<T>): Argv<T> {
  return (
    yargs
      // ── reports ────────────────────────────────────────────────
      .command(
        "reports:options",
        "Show what a report can be built from: types and their sections.",
        (y) =>
          y.option("platform-type", {
            type: "string",
            describe: "Limit to one report type (e.g. facebook).",
          }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await listReportOptions(client, wid, {
            platform_type: argv["platform-type"] ?? argv.platformType,
          });
          out.emitSuccess(data, g, (d: any) => {
            const types: string[] = d?.report_types ?? [];
            out.section("Report types");
            for (const t of types) {
              const sections = d?.sections?.[t] ?? [];
              out.status(t, `${sections.length} section(s)`);
            }
          });
        }),
      )
      .command(
        "reports:list",
        "List generated reports in the active workspace.",
        (y) => y,
        run(async (_argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await listReports(client, wid);
          const items = (data as any)?.reports ?? out.listish(data);
          out.emitSuccess(items, g, () =>
            out.table(
              ["ID", "Name", "Platform", "Status", "Ready"],
              reportRows(items as any[]),
            ),
          );
        }),
      )
      .command(
        "reports:get <report_id>",
        "Read one report's state, and its download URL once ready.",
        (y) =>
          y
            .positional("report_id", { type: "string", demandOption: true })
            .option("wait", {
              type: "boolean",
              default: false,
              describe: "Poll until the report is ready or fails.",
            })
            .option("timeout", {
              type: "number",
              default: DEFAULT_WAIT_SECONDS,
              describe: `Seconds to wait with --wait (default ${DEFAULT_WAIT_SECONDS}).`,
            }),
          run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const rid = String(argv.report_id);

          let payload = await getReport(client, wid, rid);
          if (argv.wait) {
            const deadline = Date.now() + Number(argv.timeout) * 1000;
            while (!DONE.has(String((payload as any)?.report?.status ?? ""))) {
              if (Date.now() >= deadline) {
                throw new ConfigError(
                  `Report ${rid} was still "${(payload as any)?.report?.status}" after ` +
                    `${argv.timeout}s. Raise --timeout, or poll again later.`,
                );
              }
              await sleep(POLL_INTERVAL_MS);
              payload = await getReport(client, wid, rid);
            }
          }

          out.emitSuccess(payload, g, (d: any) => {
            const r = d?.report ?? d;
            out.status("ID", String(r?.id ?? "-"));
            out.status("Status", String(r?.status ?? "-"));
            out.status("Progress", `${r?.progress ?? 0}%`);
            if (r?.export_url) out.status("Download", String(r.export_url));
          });
        }),
      )
      .command(
        "reports:generate",
        "Generate a report. Returns immediately with an id to poll.",
        (y) =>
          y
            .option("name", { type: "string", demandOption: true })
            .option("platform-type", {
              type: "string",
              demandOption: true,
              describe: "Report type — see reports:options.",
            })
            .option("accounts", {
              type: "string",
              describe: "Comma-separated account ids.",
            })
            .option("sections", {
              type: "string",
              describe: "Comma-separated section keys — see reports:options.",
            })
            .option("date", {
              type: "string",
              describe: 'Range as "YYYY-MM-DD - YYYY-MM-DD".',
            })
            .option("timezone", { type: "string" })
            .option("callback-url", {
              type: "string",
              describe: "Notify this URL when the report finishes, instead of polling.",
            })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const body = {
            name: String(argv.name),
            platform_type: String(argv["platform-type"] ?? argv.platformType),
            accounts: csv(argv.accounts),
            sections: csv(argv.sections),
            date: argv.date,
            timezone: argv.timezone,
            callback_url: argv["callback-url"] ?? argv.callbackUrl,
          };
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `POST /workspaces/${wid}/analytics/reports`,
              body,
              "generate report",
            );
          }
          // After the dry-run branch on purpose: --dry-run must touch no API, and a check that fires
          // before it would turn a "show me what you would send" into a request.
          await assertReportType(client, wid, String(body.platform_type));
          const data = await generateReport(client, wid, body as any);
          out.emitSuccess(data, g, (d: any) => {
            const r = d?.report ?? d;
            out.success("Report queued.");
            out.status("ID", String(r?.id ?? "-"));
            out.info(`Poll with: contentstudio reports:get ${r?.id} --wait`);
          });
        }),
      )
      .command(
        "reports:retry <report_id>",
        "Retry a failed report from its stored definition.",
        (y) =>
          y
            .positional("report_id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const rid = String(argv.report_id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `POST /workspaces/${wid}/analytics/reports/${rid}/retry`,
              undefined,
              "retry report",
            );
          }
          const data = await retryReport(client, wid, rid);
          out.emitSuccess(data, g, () => out.success("Report retry queued."));
        }),
      )
      .command(
        "reports:delete <report_id>",
        "Delete a generated report.",
        (y) =>
          y
            .positional("report_id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const rid = String(argv.report_id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `DELETE /workspaces/${wid}/analytics/reports/${rid}`,
              undefined,
              "delete report",
            );
          }
          const data = await deleteReport(client, wid, rid);
          out.emitSuccess(data, g, () => out.success("Report deleted."));
        }),
      )

      // ── report schedules ───────────────────────────────────────
      .command(
        "report-schedules:list",
        "List recurring report schedules.",
        (y) => y,
        run(async (_argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await listReportSchedules(client, wid);
          const items = (data as any)?.report_schedules ?? out.listish(data);
          out.emitSuccess(items, g, () =>
            out.table(
              ["ID", "Name", "Frequency", "Active", "Next run"],
              (items as any[]).map((s) => [
                String(s.id ?? "-"),
                String(s.name ?? "-"),
                String(s.frequency ?? "-"),
                s.active ? "yes" : "no",
                String(s.next_run_at ?? "-"),
              ]),
            ),
          );
        }),
      )
      .command(
        "report-schedules:get <schedule_id>",
        "Read one report schedule.",
        (y) => y.positional("schedule_id", { type: "string", demandOption: true }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await getReportSchedule(client, wid, String(argv.schedule_id));
          out.emitSuccess(data, g, (d: any) => {
            const s = d?.report_schedule ?? d;
            out.status("Name", String(s?.name ?? "-"));
            out.status("Frequency", String(s?.frequency ?? "-"));
            out.status("Active", s?.active ? "yes" : "no");
            out.status("Last run", String(s?.last_run_at ?? "never"));
            out.status("Next run", String(s?.next_run_at ?? "-"));
          });
        }),
      )
      .command(
        "report-schedules:create",
        "Create a recurring report schedule.",
        (y) =>
          y
            .option("name", { type: "string", demandOption: true })
            .option("platform-type", { type: "string", demandOption: true })
            .option("frequency", {
              type: "string",
              demandOption: true,
              choices: ["daily", "weekly", "monthly"],
            })
            .option("accounts", { type: "string", describe: "Comma-separated ids." })
            .option("emails", {
              type: "string",
              describe: "Comma-separated recipients.",
            })
            .option("day-of-week", { type: "number" })
            .option("day-of-month", { type: "number" })
            .option("time", { type: "string", describe: "HH:MM." })
            .option("timezone", { type: "string" })
            .option("callback-url", { type: "string" })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const body: Record<string, unknown> = {
            name: String(argv.name),
            platform_type: String(argv["platform-type"] ?? argv.platformType),
            frequency: String(argv.frequency),
            accounts: csv(argv.accounts),
            email_list: csv(argv.emails),
            day_of_week: argv["day-of-week"] ?? argv.dayOfWeek,
            day_of_month: argv["day-of-month"] ?? argv.dayOfMonth,
            time: argv.time,
            timezone: argv.timezone,
            callback_url: argv["callback-url"] ?? argv.callbackUrl,
          };
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `POST /workspaces/${wid}/analytics/report-schedules`,
              body,
              "create report schedule",
            );
          }
          // A schedule provisioned with a bad report type fails silently every month until someone
          // notices the report never arrived, so it is worth one call to catch here.
          await assertReportType(client, wid, String(body.platform_type));
          const data = await createReportSchedule(client, wid, body);
          out.emitSuccess(data, g, (d: any) => {
            const s = d?.report_schedule ?? d;
            out.success("Schedule created.");
            out.status("ID", String(s?.id ?? "-"));
            out.status("Next run", String(s?.next_run_at ?? "-"));
          });
        }),
      )
      .command(
        "report-schedules:update <schedule_id>",
        "Update a report schedule. Send the full configuration.",
        (y) =>
          y
            .positional("schedule_id", { type: "string", demandOption: true })
            .option("name", { type: "string" })
            .option("platform-type", { type: "string" })
            .option("frequency", {
              type: "string",
              choices: ["daily", "weekly", "monthly"],
            })
            .option("accounts", { type: "string" })
            .option("emails", { type: "string" })
            .option("time", { type: "string" })
            .option("timezone", { type: "string" })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const sid = String(argv.schedule_id);
          const body: Record<string, unknown> = {
            name: argv.name,
            platform_type: argv["platform-type"] ?? argv.platformType,
            frequency: argv.frequency,
            accounts: csv(argv.accounts),
            email_list: csv(argv.emails),
            time: argv.time,
            timezone: argv.timezone,
          };
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `PUT /workspaces/${wid}/analytics/report-schedules/${sid}`,
              body,
              "update report schedule",
            );
          }
          if (body.platform_type) {
            await assertReportType(client, wid, String(body.platform_type));
          }
          const data = await updateReportSchedule(client, wid, sid, body);
          out.emitSuccess(data, g, () => out.success("Schedule updated."));
        }),
      )
      .command(
        "report-schedules:pause <schedule_id>",
        "Pause a schedule without deleting it.",
        (y) =>
          y
            .positional("schedule_id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const sid = String(argv.schedule_id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `PUT /workspaces/${wid}/analytics/report-schedules/${sid}/state`,
              { active: false },
              "pause schedule",
            );
          }
          const data = await setReportScheduleState(client, wid, sid, false);
          out.emitSuccess(data, g, () => out.success("Schedule paused."));
        }),
      )
      .command(
        "report-schedules:resume <schedule_id>",
        "Resume a paused schedule.",
        (y) =>
          y
            .positional("schedule_id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const sid = String(argv.schedule_id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `PUT /workspaces/${wid}/analytics/report-schedules/${sid}/state`,
              { active: true },
              "resume schedule",
            );
          }
          const data = await setReportScheduleState(client, wid, sid, true);
          out.emitSuccess(data, g, () => out.success("Schedule resumed."));
        }),
      )
      .command(
        "report-schedules:run <schedule_id>",
        "Send one run now, without waiting for the next slot.",
        (y) =>
          y
            .positional("schedule_id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const sid = String(argv.schedule_id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `POST /workspaces/${wid}/analytics/report-schedules/${sid}/run`,
              undefined,
              "run schedule now",
            );
          }
          const data = await runReportScheduleNow(client, wid, sid);
          out.emitSuccess(data, g, (d: any) => {
            out.success("Run requested.");
            // The API acknowledges the request without returning a report id, so
            // confirm the run actually landed rather than trusting the 200.
            const s = d?.report_schedule ?? d;
            out.status("Last run", String(s?.last_run_at ?? "not recorded yet"));
            out.info("Verify with report-schedules:get before relying on delivery.");
          });
        }),
      )
      .command(
        "report-schedules:delete <schedule_id>",
        "Delete a report schedule.",
        (y) =>
          y
            .positional("schedule_id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const sid = String(argv.schedule_id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `DELETE /workspaces/${wid}/analytics/report-schedules/${sid}`,
              undefined,
              "delete schedule",
            );
          }
          const data = await deleteReportSchedule(client, wid, sid);
          out.emitSuccess(data, g, () => out.success("Schedule deleted."));
        }),
      )

      // ── share links ────────────────────────────────────────────
      .command(
        "share-links:list",
        "List shareable analytics links.",
        (y) => y,
        run(async (_argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await listShareLinks(client, wid);
          const items = (data as any)?.share_links ?? out.listish(data);
          out.emitSuccess(items, g, () =>
            out.table(
              ["ID", "Title", "Platform", "Password", "Expires", "Viewable"],
              (items as any[]).map((l) => [
                String(l.id ?? "-"),
                String(l.title ?? "-"),
                String(l.platform ?? "-"),
                l.is_password_protected ? "yes" : "no",
                l.expires_at ? String(l.expires_at) : "never",
                // One column for the question a client-facing integration actually asks: does
                // this link still open? Disabled and expired are different reasons, same answer.
                l.is_viewable === false ? "no" : "yes",
              ]),
            ),
          );
        }),
      )
      .command(
        "share-links:get <id>",
        "Read one shareable link.",
        (y) => y.positional("id", { type: "string", demandOption: true }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await getShareLink(client, wid, String(argv.id));
          out.emitSuccess(data, g, (d: any) => {
            const l = d?.share_link ?? d;
            out.status("Title", String(l?.title ?? "-"));
            out.status("URL", String(l?.share_url ?? "-"));
            out.status("Password", l?.is_password_protected ? "yes" : "no");
            out.status("Disabled", l?.is_disabled ? "yes" : "no");
            out.status("Expires", l?.expires_at ? String(l.expires_at) : "never");
            if (l?.is_viewable === false) {
              out.warning(
                l?.is_expired
                  ? "This link has expired — a client opening it is told so."
                  : "This link is disabled — a client cannot open it.",
              );
            }
          });
        }),
      )
      .command(
        "share-links:create",
        "Create a link a client can open without a ContentStudio account.",
        (y) =>
          y
            .option("title", { type: "string", demandOption: true })
            .option("platform", { type: "string", demandOption: true })
            .option("account-id", { type: "string" })
            .option("date-range", {
              type: "string",
              describe: 'Pin the period, as "YYYY-MM-DD - YYYY-MM-DD".',
            })
            .option("account-switching", { type: "boolean", default: false })
            .option("password", {
              type: "string",
              describe: "Protect the link. Stored hashed, never returned.",
            })
            .option("expires-at", {
              type: "string",
              describe:
                "Optional deadline (e.g. 2026-12-31). After it the link stops opening. Omit for a link that lives until disabled.",
            })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const range = argv["date-range"] ?? argv.dateRange;
          const password = argv.password ? String(argv.password) : undefined;
          const body: Record<string, unknown> = {
            title: String(argv.title),
            platform: String(argv.platform),
            account_id: argv["account-id"] ?? argv.accountId,
            is_date_range_fixed: !!range,
            date_range: range,
            is_account_switching_enabled:
              argv["account-switching"] ?? argv.accountSwitching ?? false,
            is_password_protected: !!password,
            password,
            expires_at: argv["expires-at"] ?? argv.expiresAt,
          };
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `POST /workspaces/${wid}/analytics/share-links`,
              { ...body, password: password ? "***" : undefined },
              "create share link",
            );
          }
          const data = await createShareLink(client, wid, body);
          out.emitSuccess(data, g, (d: any) => {
            const l = d?.share_link ?? d;
            out.success("Share link created.");
            out.status("URL", String(l?.share_url ?? "-"));
          });
        }),
      )
      .command(
        "share-links:update <id>",
        "Update a link. PUT replaces it, so --title and --platform are required.",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("title", { type: "string", demandOption: true })
            .option("platform", { type: "string", demandOption: true })
            .option("account-id", { type: "string" })
            .option("date-range", { type: "string" })
            .option("account-switching", { type: "boolean" })
            .option("password", { type: "string" })
            .option("expires-at", {
              type: "string",
              describe: "Deadline. Omitting it CLEARS any existing expiry, as PUT replaces the link.",
            })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const id = String(argv.id);
          const range = argv["date-range"] ?? argv.dateRange;
          const password = argv.password ? String(argv.password) : undefined;
          const body: Record<string, unknown> = {
            title: String(argv.title),
            platform: String(argv.platform),
            account_id: argv["account-id"] ?? argv.accountId,
            is_date_range_fixed: !!range,
            date_range: range,
            is_account_switching_enabled:
              argv["account-switching"] ?? argv.accountSwitching,
            is_password_protected: !!password,
            password,
            expires_at: argv["expires-at"] ?? argv.expiresAt,
          };
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `PUT /workspaces/${wid}/analytics/share-links/${id}`,
              { ...body, password: password ? "***" : undefined },
              "update share link",
            );
          }
          const data = await updateShareLink(client, wid, id, body);
          out.emitSuccess(data, g, () => out.success("Share link updated."));
        }),
      )
      .command(
        "share-links:disable <id>",
        "Revoke a link's access without deleting it.",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const id = String(argv.id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `PUT /workspaces/${wid}/analytics/share-links/${id}/state`,
              { is_disabled: true },
              "disable share link",
            );
          }
          const data = await setShareLinkDisabled(client, wid, id, true);
          out.emitSuccess(data, g, () => out.success("Share link disabled."));
        }),
      )
      .command(
        "share-links:enable <id>",
        "Re-enable a disabled link.",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const id = String(argv.id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `PUT /workspaces/${wid}/analytics/share-links/${id}/state`,
              { is_disabled: false },
              "enable share link",
            );
          }
          const data = await setShareLinkDisabled(client, wid, id, false);
          out.emitSuccess(data, g, () => out.success("Share link enabled."));
        }),
      )
      .command(
        "share-links:delete <id>",
        "Delete a shareable link permanently.",
        (y) =>
          y
            .positional("id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const id = String(argv.id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `DELETE /workspaces/${wid}/analytics/share-links/${id}`,
              undefined,
              "delete share link",
            );
          }
          const data = await deleteShareLink(client, wid, id);
          out.emitSuccess(data, g, () => out.success("Share link deleted."));
        }),
      )

      // ── competitors ────────────────────────────────────────────
      .command(
        "competitors:search <query>",
        "Find a page to track as a competitor.",
        (y) =>
          y
            .positional("query", { type: "string", demandOption: true })
            .option("platform-type", {
              type: "string",
              demandOption: true,
              choices: ["facebook", "instagram"],
            }),
        run(async (argv: any, g) => {
          // The platform lookup retries upstream with its own long timeouts, so the default
          // 30s client budget aborts a search that would have succeeded. Give it room.
          const { cfg, client } = buildClient(g, { timeoutMs: COMPETITOR_SEARCH_TIMEOUT_MS });
          const wid = resolveWorkspace(cfg, g);
          const data = await searchCompetitors(client, wid, {
            platform_type: String(argv["platform-type"] ?? argv.platformType),
            search: String(argv.query),
          });
          out.emitSuccess(data, g, (d: any) => {
            const results = d?.results ?? [];
            if (results.length === 0) {
              // not_trackable is a successful read, not a failure — say why.
              out.warning(
                d?.reason
                  ? `No trackable page: ${d.reason}`
                  : "No trackable page matched that query.",
              );
              return;
            }
            out.table(
              ["Competitor ID", "Name"],
              results.map((r: any) => [
                String(r.competitor_id ?? r.id ?? "-"),
                String(r.name ?? "-"),
              ]),
            );
          });
        }),
      )
      .command(
        "competitor-reports:list",
        "List saved competitor sets.",
        (y) =>
          y.option("platforms", {
            type: "string",
            describe: "Filter, e.g. facebook or instagram.",
          }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await listCompetitorReports(client, wid, {
            platforms: argv.platforms,
          });
          const items = (data as any)?.competitor_reports ?? out.listish(data);
          out.emitSuccess(items, g, () =>
            out.table(
              ["ID", "Name", "Platform", "Competitors"],
              (items as any[]).map((r) => [
                String(r.id ?? "-"),
                String(r.name ?? "-"),
                String(r.platform_type ?? "-"),
                String((r.competitors ?? []).length),
              ]),
            ),
          );
        }),
      )
      .command(
        "competitor-reports:get <report_id>",
        "Read one competitor set.",
        (y) => y.positional("report_id", { type: "string", demandOption: true }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await getCompetitorReport(client, wid, String(argv.report_id));
          out.emitSuccess(data, g, (d: any) => {
            const r = d?.competitor_report ?? d;
            out.status("Name", String(r?.name ?? "-"));
            out.status("Platform", String(r?.platform_type ?? "-"));
            const comps = r?.competitors ?? [];
            if (comps.length === 0) {
              out.warning("No competitors attached to this report.");
              return;
            }
            out.table(
              ["Competitor ID", "Name", "State"],
              comps.map((c: any) => [
                String(c.competitor_id ?? "-"),
                String(c.name ?? "-"),
                String(c.state ?? "-"),
              ]),
            );
          });
        }),
      )
      .command(
        "competitor-reports:create",
        "Create a competitor set to benchmark against.",
        (y) =>
          y
            .option("name", { type: "string", demandOption: true })
            .option("platform-type", {
              type: "string",
              demandOption: true,
              choices: ["facebook", "instagram"],
            })
            .option("competitors", {
              type: "string",
              demandOption: true,
              describe:
                "'id:Name,id:Name', or a JSON array of {competitor_id,name}. Ids come from competitors:search.",
            })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const body = {
            name: String(argv.name),
            platform_type: String(argv["platform-type"] ?? argv.platformType),
            competitors: parseCompetitors(argv.competitors, "--competitors"),
          };
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `POST /workspaces/${wid}/analytics/competitor-reports`,
              body,
              "create competitor report",
            );
          }
          const data = await createCompetitorReport(client, wid, body);
          out.emitSuccess(data, g, (d: any) => {
            const r = d?.competitor_report ?? d;
            out.success("Competitor report created.");
            out.status("ID", String(r?.id ?? "-"));
          });
        }),
      )
      .command(
        "competitor-reports:update <report_id>",
        "Replace a competitor set — send every competitor to keep.",
        (y) =>
          y
            .positional("report_id", { type: "string", demandOption: true })
            .option("name", { type: "string", demandOption: true })
            .option("platform-type", {
              type: "string",
              demandOption: true,
              choices: ["facebook", "instagram"],
            })
            .option("competitors", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const rid = String(argv.report_id);
          const body = {
            name: String(argv.name),
            platform_type: String(argv["platform-type"] ?? argv.platformType),
            competitors: parseCompetitors(argv.competitors, "--competitors"),
          };
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `PUT /workspaces/${wid}/analytics/competitor-reports/${rid}`,
              body,
              "update competitor report",
            );
          }
          const data = await updateCompetitorReport(client, wid, rid, body);
          out.emitSuccess(data, g, () => out.success("Competitor report updated."));
        }),
      )
      .command(
        "competitor-reports:delete <report_id>",
        "Delete a competitor set.",
        (y) =>
          y
            .positional("report_id", { type: "string", demandOption: true })
            .option("dry-run", { type: "boolean", default: false }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const rid = String(argv.report_id);
          if (isDryRun(argv)) {
            return emitDryRun(
              g,
              `DELETE /workspaces/${wid}/analytics/competitor-reports/${rid}`,
              undefined,
              "delete competitor report",
            );
          }
          const data = await deleteCompetitorReport(client, wid, rid);
          out.emitSuccess(data, g, () => out.success("Competitor report deleted."));
        }),
      )
      .command(
        "competitors:compare <report_id>",
        "Read the competitor comparison for a date range.",
        (y) =>
          y
            .positional("report_id", { type: "string", demandOption: true })
            .option("platform", {
              type: "string",
              demandOption: true,
              choices: ["facebook", "instagram"],
            })
            .option("start-date", { type: "string", demandOption: true })
            .option("end-date", { type: "string", demandOption: true })
            .option("metric", {
              type: "string",
              default: "data-table-metrics",
              describe:
                "data-table-metrics, post-engagement-by-competitor, followers-growth-comparison, posting-activity-graph-by-types, top-and-least-performing-posts, top-hashtags, biography-data.",
            })
            .option("timezone", { type: "string" }),
        run(async (argv: any, g) => {
          const { cfg, client } = buildClient(g);
          const wid = resolveWorkspace(cfg, g);
          const data = await getCompetitorComparison(
            client,
            wid,
            argv.platform,
            argv.metric,
            {
              competitor_report_id: String(argv.report_id),
              start_date: String(argv["start-date"] ?? argv.startDate),
              end_date: String(argv["end-date"] ?? argv.endDate),
              timezone: argv.timezone,
            },
          );
          const requestedMetric = String(argv.metric ?? "data-table-metrics");
          out.emitSuccess(data, g, (d: any) => {
            // Read the key belonging to the metric that was ASKED for. `data_prev` is never it:
            // that is the PREVIOUS period, and printing it under the caller's own date flags
            // answered a different question than the one asked.
            const { rows, key } = selectCompetitorRows(d, requestedMetric);
            if (rows.length === 0) {
              out.warning("No comparison rows for that period.");
              return;
            }
            // Only the default metric has a curated shape. The other six return rows with entirely
            // different fields, so their columns are read off the row instead of assumed.
            if (key !== "data_table_metrics") {
              const cols = genericCompetitorColumns(rows[0]);
              out.table(
                cols,
                rows.map((r: any) => cols.map((c) => formatCompetitorCell(r?.[c]))),
              );
              const notProcessed = rows.filter((r: any) => r.state && r.state !== "Processed");
              if (notProcessed.length > 0) {
                out.warning(
                  `${notProcessed.length} of ${rows.length} rows are not Processed: ` +
                    "NotFound has no data for the period, Failed may be stale or partial. " +
                    "Do not read either as a measurement.",
                );
              }
              return;
            }
            // Only `Processed` is a complete measurement. `NotFound` means the competitor has no
            // data yet, so its metrics are ABSENT — printing the zeros the API sends would read as
            // "this competitor got no engagement", which is a different claim. `Failed` means the
            // last crawl errored: the numbers may be stale or partial, but they are numbers.
            const metric = (r: any, value: unknown) =>
              r.state === "NotFound" ? "—" : String(value ?? "-");
            out.table(
              ["Competitor", "Followers", "Avg engagement", "State"],
              rows.map((r: any) => [
                String(r.name ?? "-"),
                metric(r, r.followersCount ?? r.fanCount),
                metric(r, r.averageEngagement),
                String(r.state ?? "-"),
              ]),
            );
            const unmeasured = rows.filter((r: any) => r.state && r.state !== "Processed");
            if (unmeasured.length > 0) {
              out.warning(
                `${unmeasured.length} of ${rows.length} competitors are not Processed: ` +
                  "NotFound has no data for the period (shown as —), Failed may be stale or partial. " +
                  "Do not read either as a measurement.",
              );
            }
          });
        }),
      )
  );
}

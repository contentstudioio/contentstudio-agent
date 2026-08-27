/**
 * Scheduling commands (added v1.2.0).
 *
 *   scheduling:best-times  — "best time to post": ranked posting slots derived
 *                            from the historical performance of the workspace's
 *                            connected accounts.
 *
 * A **slot** is one recommended posting time: a weekday and an hour, expressed
 * in the workspace timezone (echoed as `meta.timezone`). That is the same clock
 * `posts:create --scheduled-at` writes against, so a slot can be scheduled
 * as-is — no timezone conversion.
 *
 * Read-only, so there is no `--dry-run` (matching `inbox:list`, the CLI's other
 * POST-with-a-body read).
 */

import type { Argv } from "yargs";

import {
  MAX_OPTIMAL_SLOTS,
  MIN_OPTIMAL_SLOTS,
  OPTIMAL_TIME_PLATFORMS,
  type OptimalTimesEntity,
  schedulingOptimalTimes,
} from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

/**
 * Parse a `--account <platform>:<account_id>` value. The endpoint needs both
 * halves — the platform is the entity `type` — and `accounts:list` returns
 * them side by side, so they are supplied together rather than as two
 * positionally-paired flags.
 */
function parseAccountRef(raw: string): OptimalTimesEntity {
  const sep = raw.indexOf(":");
  const platform = sep === -1 ? "" : raw.slice(0, sep).trim().toLowerCase();
  const id = sep === -1 ? "" : raw.slice(sep + 1).trim();
  if (!platform || !id) {
    throw new ConfigError(
      `--account expects <platform>:<account_id> (got "${raw}"). ` +
        `Both halves come from one accounts:list row: its \`platform\` and \`_id\`.`,
    );
  }
  if (!(OPTIMAL_TIME_PLATFORMS as readonly string[]).includes(platform)) {
    throw new ConfigError(
      `--account: unsupported platform "${platform}". ` +
        `Supported: ${OPTIMAL_TIME_PLATFORMS.join(", ")}.`,
    );
  }
  return { id, type: platform };
}

/** Normalise a repeatable string option into a clean array. */
function strList(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  const arr = (Array.isArray(v) ? v : [v]).map(String).filter((s) => s.length);
  return arr.length ? arr : undefined;
}

/** `--entities` is a JSON array, so it needs its own parse (cliCtx's helper rejects arrays). */
function parseEntities(raw: unknown): OptimalTimesEntity[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch (e) {
    throw new ConfigError(`--entities: invalid JSON — ${(e as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new ConfigError(
      '--entities: JSON must be an array, e.g. \'[{"id":"<id>","type":"facebook","slots":3}]\'.',
    );
  }
  return parsed.map((e, i) => {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      throw new ConfigError(`--entities[${i}]: each item must be an object.`);
    }
    const { id, type } = e as Record<string, unknown>;
    if (!id || !type) {
      throw new ConfigError(`--entities[${i}]: both "id" and "type" are required.`);
    }
    return e as OptimalTimesEntity;
  });
}

/** The API returns the hour as a bare string ("14"); render it as a clock time. */
function slotTime(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^\d{1,2}$/.test(s) ? `${s.padStart(2, "0")}:00` : s || "-";
}

/** `{facebook: 60, instagram: 40}` → `facebook 60, instagram 40`. */
function breakdown(v: unknown): string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "-";
  const parts = Object.entries(v as Record<string, unknown>).map(
    ([k, n]) => `${k} ${n}`,
  );
  return parts.length ? parts.join(", ") : "-";
}

function recommendationRows(recs: unknown): string[][] {
  const items = Array.isArray(recs) ? recs : [];
  return items.map((r: any, i: number) => [
    String(r?.rank ?? i + 1),
    String(r?.day ?? "-"),
    String(r?.date ?? "-"),
    slotTime(r?.time),
    String(r?.score ?? "-"),
    breakdown(r?.platform_breakdown),
  ]);
}

const REC_HEADERS = ["Rank", "Day", "Date", "Time", "Score", "Platforms"];

export function registerScheduling<T>(yargs: Argv<T>): Argv<T> {
  return yargs.command(
    "scheduling:best-times",
    "Best times to post — ranked posting slots from the connected accounts' history.",
    (y) =>
      y
        // Deliberately no `-i` alias: unlike posts:create's `-i`, this takes
        // `<platform>:<account_id>`, and a shared shorthand would imply the
        // two are interchangeable.
        .option("account", {
          type: "string",
          array: true,
          describe:
            "Account to analyse, as <platform>:<account_id> (both from an accounts:list row). Repeatable. Default: every connected account.",
        })
        .option("entities", {
          type: "string",
          describe:
            'Full entity array as JSON, for per-account slot counts: \'[{"id":"<id>","type":"facebook","slots":3}]\'. Mutually exclusive with --account.',
        })
        .option("global-slots", {
          type: "number",
          describe: `How many pooled recommendations to return, best-first (${MIN_OPTIMAL_SLOTS}-${MAX_OPTIMAL_SLOTS}; API default 5).`,
        })
        .option("per-account-slots", {
          type: "number",
          describe: `How many recommendations to return per account (${MIN_OPTIMAL_SLOTS}-${MAX_OPTIMAL_SLOTS}; API default 3).`,
        }),
    run(async (argv: any, g) => {
      const { cfg, client } = buildClient(g);
      const wid = resolveWorkspace(cfg, g);

      const accounts = strList(argv.account);
      if (accounts && argv.entities !== undefined) {
        throw new ConfigError(
          "Pass either --account or --entities, not both. Use --entities when you need per-account slot counts.",
        );
      }

      const body: Record<string, unknown> = {};
      if (argv.entities !== undefined) {
        body.entities = parseEntities(argv.entities);
      } else if (accounts) {
        body.entities = accounts.map(parseAccountRef);
      }
      const globalSlots = argv["global-slots"] ?? argv.globalSlots;
      const perAccountSlots = argv["per-account-slots"] ?? argv.perAccountSlots;
      if (globalSlots !== undefined) body.global_slots = globalSlots;
      if (perAccountSlots !== undefined) body.per_account_slots = perAccountSlots;

      const data = await schedulingOptimalTimes(client, wid, body);

      out.emitSuccess(data, g, (d) => {
        const meta = d.meta ?? {};
        out.section("Best times to post");
        if (meta.timezone) out.status("Timezone", String(meta.timezone));
        if (meta.generated_at) out.status("Generated at", String(meta.generated_at));

        for (const w of meta.warnings ?? []) out.warning(String(w));
        if (meta.missing_entities?.length) {
          out.warning(
            `No usable history for: ${meta.missing_entities.join(", ")} — these accounts were skipped.`,
          );
        }
        if (meta.ai_fallback_entities?.length) {
          out.info(
            `Estimated (not measured) for: ${meta.ai_fallback_entities.join(", ")}.`,
          );
        }

        if (d.global?.top_recommendations?.length) {
          out.section("Across all accounts");
          out.table(REC_HEADERS, recommendationRows(d.global.top_recommendations));
        } else {
          out.warning(
            "No pooled recommendations — none of the analysed accounts had enough history.",
          );
        }

        for (const [accountId, acc] of Object.entries(d.individual)) {
          const a = acc as any;
          const source = a?.source ? ` · ${a.source}` : "";
          out.section(`${a?.platform ?? "account"} ${accountId}${source}`);
          out.table(REC_HEADERS, recommendationRows(a?.top_recommendations));
        }

        if (meta.timezone) {
          out.info(
            `Times are ${meta.timezone} wall-clock — pass one straight to \`posts:create --scheduled-at\`.`,
          );
        }
      });
    }),
  );
}

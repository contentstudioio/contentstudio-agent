/**
 * Lightweight self-update notifier.
 *
 * On startup, checks the npm registry once per 24h for a newer version of
 * `contentstudio-cli`. If found, prints a single-line banner to stderr.
 *
 * Properties:
 *  - Never blocks the CLI: the registry fetch is fire-and-forget.
 *  - Never corrupts machine-readable output: skips when stdout/stderr isn't
 *    a TTY OR when --json/--version/--help is in argv.
 *  - Opt-out: set CONTENTSTUDIO_NO_UPDATE_CHECK=1 to silence entirely.
 *  - Cache: results stored at ~/.config/contentstudio/.update-check.json.
 *  - Best-effort: any error (network, parse, fs) is swallowed silently.
 */

import * as fs from "fs";
import * as path from "path";
import fetch from "node-fetch";

import { configDir } from "./config";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_FILE = ".update-check.json";
const FETCH_TIMEOUT_MS = 2000;
const REGISTRY_URL = "https://registry.npmjs.org/contentstudio-cli/latest";

interface Cache {
  checkedAt: number;
  latestVersion: string;
}

export function cachePath(): string {
  return path.join(configDir(), CACHE_FILE);
}

export function readCache(): Cache | null {
  try {
    const raw = fs.readFileSync(cachePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.checkedAt === "number" &&
      typeof parsed.latestVersion === "string"
    ) {
      return parsed as Cache;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeCache(c: Cache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true, mode: 0o700 });
    fs.writeFileSync(cachePath(), JSON.stringify(c), { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

/**
 * Returns true iff `latest` is strictly newer than `current` by semver
 * comparison (major.minor.patch only — pre-release tags are ignored).
 */
export function isNewer(latest: string, current: string): boolean {
  const a = parseSemver(latest);
  const b = parseSemver(current);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function parseSemver(v: string): [number, number, number] {
  const parts = v
    .replace(/^v/, "")
    .split(/[-+]/, 1)[0] // drop pre-release / build metadata
    .split(".")
    .slice(0, 3)
    .map((n) => parseInt(n, 10) || 0);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/**
 * Decide whether the update banner should be shown for this invocation.
 * Centralized so tests can verify the gating logic.
 */
export function shouldCheckUpdate(
  argv: string[],
  env: NodeJS.ProcessEnv,
  isStderrTTY: boolean,
): boolean {
  if (env.CONTENTSTUDIO_NO_UPDATE_CHECK === "1") return false;
  if (!isStderrTTY) return false;
  if (argv.includes("--json")) return false;
  // Don't bother on metadata-only commands.
  if (argv.includes("--version") || argv.includes("-V")) return false;
  if (argv.includes("--help") || argv.includes("-h")) return false;
  return true;
}

function banner(latest: string, current: string): string {
  // ANSI dim + yellow accents; plain text fallback if colors aren't supported
  // is fine since most terminals interpret these.
  const yellow = "\x1b[33m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  return [
    "",
    `${yellow}⚠${reset} contentstudio-cli ${yellow}${latest}${reset} is available (you have ${current})`,
    `  ${dim}Run:${reset} npm install -g contentstudio-cli@latest`,
    `  ${dim}Refresh skill:${reset} npx skills add contentstudioio/contentstudio-agent`,
    `  ${dim}(silence with CONTENTSTUDIO_NO_UPDATE_CHECK=1)${reset}`,
    "",
    "",
  ].join("\n");
}

async function refreshCache(): Promise<void> {
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const resp = await fetch(REGISTRY_URL, {
      signal: ac.signal as any,
    } as any);
    clearTimeout(timer);
    if (!resp.ok) return;
    const body = (await resp.json()) as { version?: unknown };
    if (body && typeof body.version === "string") {
      writeCache({ checkedAt: Date.now(), latestVersion: body.version });
    }
  } catch {
    /* silent — update check is best-effort */
  }
}

/**
 * Print the banner (from cached value) and refresh the cache in the
 * background if it's stale. Synchronous for the print path; the fetch
 * is fire-and-forget so the CLI starts immediately.
 */
export function maybeNotifyUpdate(
  currentVersion: string,
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  isStderrTTY: boolean = !!process.stderr.isTTY,
): void {
  if (!shouldCheckUpdate(argv, env, isStderrTTY)) return;

  const cache = readCache();
  const now = Date.now();
  const isFresh = !!cache && now - cache.checkedAt < CACHE_TTL_MS;

  if (cache && isNewer(cache.latestVersion, currentVersion)) {
    process.stderr.write(banner(cache.latestVersion, currentVersion));
  }

  if (!isFresh) {
    // Don't await — we don't want to block the user's command.
    refreshCache().catch(() => {
      /* silent */
    });
  }
}

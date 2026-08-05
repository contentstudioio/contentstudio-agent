/**
 * Shared per-invocation context: parsed global flags + helpers to acquire
 * the configured Client / workspace ID. Imported by every command module.
 */

import { Config, loadConfig } from "./config";
import { Client } from "./api";
import { ConfigError } from "./errors";
import * as out from "./output";
import { CliContext, emitError, emitSuccess } from "./output";

export interface GlobalArgs extends CliContext {
  workspace?: string | null;
  baseUrl?: string | null;
}

export function ctxFromArgv(argv: any): GlobalArgs {
  return {
    useJson: !!argv.json,
    workspace: argv.workspace ?? null,
    baseUrl: argv.baseUrl ?? argv["base-url"] ?? null,
  };
}

/**
 * Load config (applying any `--base-url` override) and return a Client.
 * Throws ConfigError if API key isn't configured (caught by run()).
 */
export function buildClient(g: GlobalArgs): { cfg: Config; client: Client } {
  const cfg = loadConfig();
  if (g.baseUrl) cfg.baseUrl = g.baseUrl;
  cfg.requireApiKey();
  return { cfg, client: new Client(cfg) };
}

/**
 * Resolve the workspace ID for a workspace-scoped call.
 *  - explicit `--workspace` flag wins
 *  - else CONTENTSTUDIO_WORKSPACE_ID env
 *  - else config.json `active_workspace_id`
 */
export function resolveWorkspace(cfg: Config, g: GlobalArgs): string {
  return cfg.requireWorkspaceId(g.workspace ?? undefined);
}

/**
 * Wrap an async command handler with consistent error → JSON envelope behavior.
 */
export function run<A = any>(
  fn: (argv: A, g: GlobalArgs) => Promise<unknown> | unknown,
): (argv: A) => Promise<void> {
  return async (argv) => {
    const g = ctxFromArgv(argv);
    try {
      await fn(argv, g);
    } catch (e) {
      const code = emitError(e, g);
      process.exit(code);
    }
  };
}

/**
 * Standard `--dry-run` output: print the endpoint and body that *would* be
 * sent, and touch no API. Shared by every mutating command.
 */
export function emitDryRun(
  g: GlobalArgs,
  endpoint: string,
  body: Record<string, unknown> | undefined,
  label: string,
): void {
  out.emitSuccess({ dry_run: true, endpoint, body: body ?? {} }, g, () => {
    out.info(`DRY RUN — would ${label}`);
    console.log(JSON.stringify(body ?? {}, null, 2));
  });
}

/** Parse a `--flag '<json object>'` option, with a readable error. */
export function parseJsonOption(
  raw: unknown,
  flag: string,
): Record<string, unknown> {
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

/** True when the invocation asked for a dry run (handles both yargs spellings). */
export function isDryRun(argv: any): boolean {
  return !!(argv["dry-run"] ?? argv.dryRun);
}

export { emitSuccess };

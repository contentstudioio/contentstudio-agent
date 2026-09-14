import type { Argv } from "yargs";

import { Client, getMe } from "../api";
import {
  clearConfig,
  configPath,
  loadConfig,
  saveConfig,
} from "../config";
import { ConfigError } from "../errors";
import * as out from "../output";
import { run } from "../cliCtx";

export function registerAuth<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "auth:login",
      "Store your API key and verify it against /me.",
      (y) =>
        y
          .option("api-key", {
            type: "string",
            describe: "API key (cs_...). Falls back to $CONTENTSTUDIO_API_KEY.",
          })
          .option("base-url", {
            type: "string",
            describe: "Override the API base URL.",
          })
          .option("skip-verify", {
            type: "boolean",
            default: false,
            describe: "Skip the /me verification round-trip.",
          }),
      run(async (argv: any, g) => {
        const cfg = loadConfig();
        let apiKey: string | null =
          argv["api-key"] ?? argv.apiKey ?? process.env.CONTENTSTUDIO_API_KEY ?? null;
        if (!apiKey) {
          throw new ConfigError("No API key provided.", {
            hint: "Pass --api-key cs_... or set CONTENTSTUDIO_API_KEY.",
          });
        }
        cfg.apiKey = apiKey;
        const baseUrl = argv["base-url"] ?? argv.baseUrl;
        if (baseUrl) cfg.baseUrl = String(baseUrl).replace(/\/+$/, "");

        if (!argv["skip-verify"] && !argv.skipVerify) {
          const client = new Client(cfg);
          const me: any = await getMe(client);
          cfg.user = {
            id: me?.id ?? me?._id ?? null,
            email: me?.email ?? null,
            full_name: me?.full_name ?? null,
          };
        }

        const path = saveConfig(cfg);
        const data = { config_path: path, base_url: cfg.baseUrl, user: cfg.user };
        out.emitSuccess(data, g, (d) => {
          out.success(
            `Logged in as ${d.user.full_name || d.user.email || "(unknown)"}`,
          );
          out.status("Config", d.config_path);
          out.status("Base URL", d.base_url);
        });
      }),
    )
    .command(
      "auth:logout",
      "Forget the stored API key and active workspace.",
      (y) => y,
      run(async (_argv, g) => {
        const path = clearConfig();
        const data = { cleared: !!path, path };
        out.emitSuccess(data, g, (d) => {
          if (d.cleared) out.success("Logged out — config cleared.");
          else out.info("No config file to clear.");
        });
      }),
    )
    .command(
      "auth:whoami",
      "Return the authenticated user (hits /me).",
      (y) => y,
      run(async (_argv, g) => {
        const cfg = loadConfig();
        cfg.requireApiKey();
        const client = new Client(cfg);
        const me: any = await getMe(client);
        out.emitSuccess(me, g, (m) => {
          out.section("Authenticated user");
          out.status("ID", m.id || m._id || "-");
          out.status("Name", m.full_name || "-");
          out.status("Email", m.email || "-");
          out.status("State", m.state || "-");
        });
      }),
    )
    .command(
      "auth:status",
      "Show local config (API key redacted).",
      (y) => y,
      run(async (_argv, g) => {
        const cfg = loadConfig();
        const data: Record<string, unknown> = {
          ...cfg.toRedactedDict(),
          config_path: configPath(),
          has_api_key: !!cfg.effectiveApiKey(),
        };
        out.emitSuccess(data, g, (d: any) => {
          out.section("Local config");
          out.status("Path", String(d.config_path));
          out.status("API key", String(d.api_key ?? "(not set)"));
          out.status("Base URL", String(d.base_url));
          out.status("Active workspace", String(d.active_workspace_id ?? "(none)"));
          out.status("Workspace name", String(d.active_workspace_name ?? "-"));
        });
      }),
    );
}

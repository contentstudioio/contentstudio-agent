/**
 * Account-connection commands (added v1.0.3).
 *
 *   platforms:list                    — list platforms available to connect
 *   accounts:connect <platform>       — start OAuth (or reconnect) flow
 *   accounts:add-bluesky              — credential-based Bluesky connect
 *   accounts:add-facebook-group       — manual FB Group add
 */

import type { Argv } from "yargs";

import {
  addBlueskyAccount,
  addFacebookGroup,
  connectAccount,
  listPlatforms,
} from "../api";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

const PLATFORM_CHOICES = [
  "facebook",
  "facebook-profile",
  "instagram",
  "instagram-via-facebook",
  "twitter",
  "linkedin",
  "pinterest",
  "tiktok",
  "youtube",
  "threads",
  "gmb",
  "tumblr",
];

export function registerConnect<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "platforms:list",
      "List social platforms available for account connection.",
      (y) => y,
      run(async (_argv, g) => {
        const { client } = buildClient(g);
        const data: any = await listPlatforms(client);
        const items = (Array.isArray(data) ? data : []) as any[];
        out.emitSuccess(data, g, () =>
          out.table(
            ["Platform", "Display Name", "Method", "Endpoint"],
            items.map((p) => [
              p.platform ?? "-",
              p.display_name ?? "-",
              p.connection_method ?? "-",
              p.endpoint ?? "-",
            ]),
          ),
        );
      }),
    )
    .command(
      "accounts:connect <platform>",
      "Initiate an OAuth account-connection (or reconnection) flow for a platform. Returns a one-time authorization URL.",
      (y) =>
        y
          .positional("platform", {
            type: "string",
            demandOption: true,
            choices: PLATFORM_CHOICES,
            describe: "OAuth platform to connect.",
          })
          .option("reconnect", {
            type: "boolean",
            default: false,
            describe:
              "Reconnect an existing account (requires --account-id) instead of connecting a new one.",
          })
          .option("account-id", {
            type: "string",
            describe:
              "Existing account ID to reconnect (required when --reconnect).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const reconnect = !!(argv.reconnect ?? false);
        const accountId = argv["account-id"] ?? argv.accountId;
        const process: "connect" | "reconnect" = reconnect
          ? "reconnect"
          : "connect";
        const params: Record<string, unknown> = { process };
        if (accountId) params.account_id = accountId;

        if (argv["dry-run"] ?? argv.dryRun) {
          out.emitSuccess(
            {
              dry_run: true,
              endpoint: `POST /workspaces/${wid}/connect/${argv.platform}`,
              query: params,
            },
            g,
            () => {
              out.info(
                `DRY RUN — would request OAuth URL for ${argv.platform} (${process})`,
              );
              console.log(JSON.stringify(params, null, 2));
            },
          );
          return;
        }

        if (reconnect && !accountId) {
          // Match the API's expectation; surface a clear error before the round-trip.
          const e = new (await import("../errors")).ConfigError(
            "--reconnect requires --account-id <existing_account_id>.",
          );
          throw e;
        }

        const data: any = await connectAccount(
          client,
          wid,
          String(argv.platform),
          { process, accountId },
        );
        out.emitSuccess(data, g, (d: any) => {
          out.success("OAuth URL generated.");
          if (d?.authorization_url) out.status("Authorization URL", d.authorization_url);
          else if (d?.url) out.status("URL", d.url);
          if (d?.expires_at) out.status("Expires", d.expires_at);
        });
      }),
    )
    .command(
      "accounts:add-bluesky",
      "Connect a Bluesky account using handle + app password (no browser).",
      (y) =>
        y
          .option("handle", {
            type: "string",
            demandOption: true,
            describe: "Bluesky handle (e.g. yourname.bsky.social).",
          })
          .option("app-password", {
            type: "string",
            demandOption: true,
            describe:
              "Bluesky app password (NOT your main account password — generate one at bsky.app/settings/app-passwords).",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const handle = String(argv.handle);
        const appPassword = String(argv["app-password"] ?? argv.appPassword);
        if (argv["dry-run"] ?? argv.dryRun) {
          out.emitSuccess(
            {
              dry_run: true,
              endpoint: `POST /workspaces/${wid}/add/bluesky`,
              body: { handle, app_password: "<redacted>" },
            },
            g,
            () => {
              out.info(`DRY RUN — would connect Bluesky handle ${handle}`);
              console.log(
                JSON.stringify(
                  { handle, app_password: "<redacted>" },
                  null,
                  2,
                ),
              );
            },
          );
          return;
        }
        const data: any = await addBlueskyAccount(
          client,
          wid,
          handle,
          appPassword,
        );
        out.emitSuccess(data, g, (d: any) => {
          out.success(`Bluesky account connected: ${handle}`);
          const acctId = d?.id ?? d?._id;
          if (acctId) out.status("Account ID", String(acctId));
        });
      }),
    )
    .command(
      "accounts:add-facebook-group",
      "Manually add a Facebook Group connection by name (and optional image URL).",
      (y) =>
        y
          .option("name", {
            type: "string",
            demandOption: true,
            describe: "Display name of the Facebook Group.",
          })
          .option("image", {
            type: "string",
            describe: "Optional image URL for the group.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const name = String(argv.name);
        const image = argv.image ? String(argv.image) : undefined;
        const body: Record<string, unknown> = { name };
        if (image) body.image = image;
        if (argv["dry-run"] ?? argv.dryRun) {
          out.emitSuccess(
            {
              dry_run: true,
              endpoint: `POST /workspaces/${wid}/add/facebook-group`,
              body,
            },
            g,
            () => {
              out.info(`DRY RUN — would add Facebook Group "${name}"`);
              console.log(JSON.stringify(body, null, 2));
            },
          );
          return;
        }
        const data: any = await addFacebookGroup(client, wid, name, image);
        out.emitSuccess(data, g, (d: any) => {
          out.success(`Facebook Group added: ${name}`);
          const acctId = d?.id ?? d?._id;
          if (acctId) out.status("Account ID", String(acctId));
        });
      }),
    );
}

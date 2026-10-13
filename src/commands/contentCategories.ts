/**
 * Content categories — the evergreen buckets a `content_category` post is
 * dealt into, plus the weekly posting slots that decide when those posts fire.
 *
 * `categories:list` (read-only) lives in `lookups.ts` with the other lookup
 * tables; everything else is here.
 *
 * Slots are their own `category-slots:*` group because every one of them is
 * scoped to a category AND a slot, so folding them into `categories:*` would
 * have produced two positionals on half the commands.
 */

import type { Argv } from "yargs";

import {
  createContentCategory,
  createContentCategorySlot,
  deleteContentCategory,
  deleteContentCategorySlot,
  getContentCategory,
  listContentCategorySlots,
  nextContentCategorySlot,
  shuffleContentCategory,
  updateContentCategory,
  updateContentCategorySlot,
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

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const PERIODS = ["AM", "PM"] as const;

export function registerContentCategories<T>(yargs: Argv<T>): Argv<T> {
  return registerSlots(registerCategories(yargs));
}

function registerCategories<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "categories:get <category_id>",
      "Read one content category. The response inlines the category's slots[], so there is no need to follow up with category-slots:list.",
      (y) => y.positional("category_id", { type: "string", demandOption: true }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await getContentCategory(
          client,
          wid,
          String(argv.category_id),
        );
        out.emitSuccess(data, g, (d: any) => {
          out.success(`Category ${d?.name ?? argv.category_id}`);
          out.status("ID", String(d?.id ?? d?._id ?? "-"));
          out.status("Color", String(d?.color ?? "-"));
          out.status("Posts", String(d?.posts_count ?? 0));
          out.table(
            ["Slot ID", "Day", "Hour", "Minute", "Period"],
            ((d?.slots as any[]) ?? []).map((s) => [
              String(s.id ?? s._id ?? "-"),
              s.day ?? "-",
              String(s.hour ?? "-"),
              String(s.minute ?? "-"),
              s.period ?? "-",
            ]),
          );
        });
      }),
    )
    .command(
      "categories:create",
      "Create a content category.",
      (y) =>
        y
          .option("name", { type: "string", describe: "Category name (≤100 chars)." })
          .option("color", {
            type: "string",
            describe: "Category color: color_1 … color_20.",
          })
          .option("account", {
            type: "string",
            array: true,
            describe:
              "Social account ID the category posts to. Repeatable. One FLAT list mixed across platforms → accounts[].",
          })
          .option("allowed-member", {
            type: "string",
            array: true,
            describe:
              "Team member user ID allowed to use the category. Repeatable → allowed_member_ids[]. Every id must be on the workspace team.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        if (!argv.name || !argv.color) {
          throw new ConfigError("--name and --color are required.");
        }
        const body: Record<string, unknown> = {
          name: String(argv.name),
          color: String(argv.color),
        };
        const accounts = argv.account as string[] | undefined;
        const members = (argv["allowed-member"] ?? argv.allowedMember) as
          | string[]
          | undefined;
        if (accounts?.length) body.accounts = accounts;
        if (members?.length) body.allowed_member_ids = members;

        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/content-categories`,
            body,
            "create content category",
          );
        }
        const data = await createContentCategory(client, wid, body as any);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Content category created.");
          out.status("ID", String(d?.id ?? d?._id ?? "-"));
        });
      }),
    )
    .command(
      "categories:update <category_id>",
      "Update a content category (partial — send only what changes).",
      (y) =>
        y
          .positional("category_id", { type: "string", demandOption: true })
          .option("name", { type: "string" })
          .option("color", { type: "string", describe: "color_1 … color_20." })
          .option("account", {
            type: "string",
            array: true,
            describe: "Replaces accounts[] wholesale. Repeatable.",
          })
          .option("allowed-member", {
            type: "string",
            array: true,
            describe: "Replaces allowed_member_ids[] wholesale. Repeatable.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.category_id);
        const body: Record<string, unknown> = {};
        if (argv.name !== undefined) body.name = argv.name;
        if (argv.color !== undefined) body.color = argv.color;
        const accounts = argv.account as string[] | undefined;
        const members = (argv["allowed-member"] ?? argv.allowedMember) as
          | string[]
          | undefined;
        if (accounts !== undefined) body.accounts = accounts;
        if (members !== undefined) body.allowed_member_ids = members;
        if (!Object.keys(body).length) {
          throw new ConfigError(
            "Pass at least one of --name / --color / --account / --allowed-member.",
          );
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/content-categories/${cid}`,
            body,
            `update content category ${cid}`,
          );
        }
        const data = await updateContentCategory(client, wid, cid, body as any);
        out.emitSuccess(data, g, () =>
          out.success(`Updated content category ${cid}.`),
        );
      }),
    )
    .command(
      "categories:delete <category_id>",
      "Delete a content category. Global (workspace-wide) categories are refused with CONTENT_CATEGORY_IS_GLOBAL.",
      (y) =>
        y
          .positional("category_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.category_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/content-categories/${cid}`,
            {},
            `delete content category ${cid}`,
          );
        }
        const data = await deleteContentCategory(client, wid, cid);
        out.emitSuccess(data, g, () =>
          out.success(`Deleted content category ${cid}.`),
        );
      }),
    )
    .command(
      "categories:shuffle <category_id>",
      "Re-deal the category's upcoming posts across its slots. Zero upcoming posts is a success, not an error.",
      (y) =>
        y
          .positional("category_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.category_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/content-categories/${cid}/shuffle`,
            {},
            `shuffle content category ${cid}`,
          );
        }
        const data: any = await shuffleContentCategory(client, wid, cid);
        out.emitSuccess(data, g, (d: any) =>
          out.success(`Shuffled ${d?.shuffled_posts_count ?? 0} post(s).`),
        );
      }),
    );
}

function registerSlots<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "category-slots:list <category_id>",
      "List a content category's weekly posting slots.",
      (y) => y.positional("category_id", { type: "string", demandOption: true }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await listContentCategorySlots(
          client,
          wid,
          String(argv.category_id),
        );
        const items = (data as any[]) ?? [];
        out.emitSuccess(data, g, () =>
          out.table(
            ["ID", "Day", "Sort", "Hour", "Minute", "Period"],
            items.map((s) => [
              String(s.id ?? s._id ?? "-"),
              s.day ?? "-",
              String(s.weekday_sorting ?? "-"),
              String(s.hour ?? "-"),
              String(s.minute ?? "-"),
              s.period ?? "-",
            ]),
          ),
        );
      }),
    )
    .command(
      "category-slots:next <category_id>",
      "Resolve the category's next free posting slot. next_slot: null on a 200 means there is no upcoming slot — that is an answer, not a failure.",
      (y) =>
        y
          .positional("category_id", { type: "string", demandOption: true })
          .option("post-id", {
            type: "string",
            describe:
              "Ask for the slot this specific post would take. When the post already has a time, `scheduled` comes back true and next_slot is that time.",
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const postId = argv["post-id"] ?? argv.postId;
        const data: any = await nextContentCategorySlot(
          client,
          wid,
          String(argv.category_id),
          postId ? { post_id: String(postId) } : {},
        );
        out.emitSuccess(data, g, (d: any) => {
          if (!d?.next_slot) {
            out.info("No upcoming slot for this category.");
          } else {
            out.success(`Next slot: ${d.next_slot}`);
          }
          out.status("Timezone", String(d?.timezone ?? "-"));
          out.status("Already scheduled", d?.scheduled ? "yes" : "no");
        });
      }),
    )
    .command(
      "category-slots:create <category_id>",
      "Add one weekly posting slot to a content category.",
      (y) =>
        y
          .positional("category_id", { type: "string", demandOption: true })
          .option("day", {
            type: "string",
            choices: [...DAYS],
            describe: "Weekday, lowercase.",
          })
          .option("hour", {
            type: "number",
            describe: "12-hour clock, 0–12. 12 normalises to 0. Sent as an integer.",
          })
          .option("minute", { type: "number", describe: "0–59." })
          .option("period", { type: "string", choices: [...PERIODS] })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.category_id);
        const body = slotBody(argv, true);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/content-categories/${cid}/slots`,
            body,
            `add a slot to content category ${cid}`,
          );
        }
        const data = await createContentCategorySlot(
          client,
          wid,
          cid,
          body as any,
        );
        out.emitSuccess(data, g, (d: any) => {
          out.success("Slot created.");
          out.status("ID", String(d?.id ?? d?._id ?? "-"));
        });
      }),
    )
    .command(
      "category-slots:update <category_id> <slot_id>",
      "Update one posting slot (partial — send only what changes).",
      (y) =>
        y
          .positional("category_id", { type: "string", demandOption: true })
          .positional("slot_id", { type: "string", demandOption: true })
          .option("day", { type: "string", choices: [...DAYS] })
          .option("hour", { type: "number", describe: "0–12; 12 normalises to 0." })
          .option("minute", { type: "number", describe: "0–59." })
          .option("period", { type: "string", choices: [...PERIODS] })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.category_id);
        const sid = String(argv.slot_id);
        const body = slotBody(argv, false);
        if (!Object.keys(body).length) {
          throw new ConfigError(
            "Pass at least one of --day / --hour / --minute / --period.",
          );
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PUT /workspaces/${wid}/content-categories/${cid}/slots/${sid}`,
            body,
            `update slot ${sid}`,
          );
        }
        const data = await updateContentCategorySlot(
          client,
          wid,
          cid,
          sid,
          body as any,
        );
        out.emitSuccess(data, g, () => out.success(`Updated slot ${sid}.`));
      }),
    )
    .command(
      "category-slots:delete <category_id> <slot_id>",
      "Delete one posting slot.",
      (y) =>
        y
          .positional("category_id", { type: "string", demandOption: true })
          .positional("slot_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const cid = String(argv.category_id);
        const sid = String(argv.slot_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/content-categories/${cid}/slots/${sid}`,
            {},
            `delete slot ${sid}`,
          );
        }
        const data = await deleteContentCategorySlot(client, wid, cid, sid);
        out.emitSuccess(data, g, () => out.success(`Deleted slot ${sid}.`));
      }),
    );
}

/**
 * Build a slot body from argv.
 *
 * `hour` and `minute` are coerced to Number deliberately: the backend
 * normalises noon with a strict `hour === 12` comparison, so a string "12"
 * slips past it and persists an hour the scheduler cannot match.
 */
function slotBody(argv: any, requireAll: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (argv.day !== undefined) body.day = String(argv.day);
  if (argv.hour !== undefined) body.hour = Number(argv.hour);
  if (argv.minute !== undefined) body.minute = Number(argv.minute);
  if (argv.period !== undefined) body.period = String(argv.period);

  if (requireAll) {
    const missing = ["day", "hour", "minute", "period"].filter(
      (k) => body[k] === undefined,
    );
    if (missing.length) {
      throw new ConfigError(
        `--${missing.join(", --")} ${missing.length > 1 ? "are" : "is"} required.`,
      );
    }
  }

  if (body.hour !== undefined && Number.isNaN(body.hour as number)) {
    throw new ConfigError("--hour must be an integer between 0 and 12.");
  }
  if (body.minute !== undefined && Number.isNaN(body.minute as number)) {
    throw new ConfigError("--minute must be an integer between 0 and 59.");
  }

  return body;
}

import * as fs from "fs";
import type { Argv } from "yargs";

import {
  createPost,
  deletePost,
  listPosts,
  postApproval,
  updatePost,
} from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

const WORKFLOW_ACTIONS = [
  "restart",
  "resume",
  "renotify_current",
  "keep",
  "remove",
] as const;

export function registerPosts<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "posts:list",
      "List posts in the active workspace.",
      (y) =>
        y
          .option("status", {
            type: "string",
            array: true,
            describe: "Filter by status (repeatable).",
          })
          .option("date-from", { type: "string", describe: "YYYY-MM-DD" })
          .option("date-to", { type: "string", describe: "YYYY-MM-DD" })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listPosts(client, wid, {
          status: argv.status as string[] | undefined,
          date_from: argv["date-from"] ?? argv.dateFrom,
          date_to: argv["date-to"] ?? argv.dateTo,
          page: argv.page,
          per_page: argv["per-page"] ?? argv.perPage,
        });
        const items = (resp.data as any[]) ?? [];
        out.emitSuccess(
          resp.data,
          g,
          () =>
            out.table(
              ["ID", "Status", "Scheduled", "Text"],
              items.map((p) => [
                String(p._id ?? p.id ?? "-"),
                p.status ?? "-",
                p.scheduled_at ?? p.publish_time ?? "-",
                shortText(p),
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "posts:create",
      "Create a post. Either --body <file.json> or shortcut flags --content/--account/--publish-type (plus --facebook-carousel / --threads / --twitter / --linkedin-options JSON blobs).",
      (y) => applyPostBodyOptions(y),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const body = buildPostBodyFromArgv(argv);

        if (argv["dry-run"] ?? argv.dryRun) {
          out.emitSuccess(
            {
              dry_run: true,
              endpoint: `POST /workspaces/${wid}/posts`,
              body,
            },
            g,
            () => {
              out.info(`DRY RUN — would POST /workspaces/${wid}/posts`);
              console.log(JSON.stringify(body, null, 2));
            },
          );
          return;
        }

        const data: any = await createPost(client, wid, body);
        out.emitSuccess(data, g, renderPostWrite("created"));
      }),
    )
    .command(
      "posts:update <post_id>",
      "Update an existing post (same body/flags as posts:create). The backend rejects the update (422) when the post is already published or processing.",
      (y) =>
        applyPostBodyOptions(
          y.positional("post_id", { type: "string", demandOption: true }),
        ),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const pid = String(argv.post_id);
        const body = buildPostBodyFromArgv(argv);

        if (argv["dry-run"] ?? argv.dryRun) {
          out.emitSuccess(
            {
              dry_run: true,
              endpoint: `PUT /workspaces/${wid}/posts/${pid}`,
              body,
            },
            g,
            () => {
              out.info(`DRY RUN — would PUT /workspaces/${wid}/posts/${pid}`);
              console.log(JSON.stringify(body, null, 2));
            },
          );
          return;
        }

        const data: any = await updatePost(client, wid, pid, body);
        out.emitSuccess(data, g, renderPostWrite("updated"));
      }),
    )
    .command(
      "posts:delete <post_id>",
      "Delete a post.",
      (y) =>
        y
          .positional("post_id", { type: "string", demandOption: true })
          .option("delete-from-social", {
            type: "boolean",
            default: false,
            describe: "Also try to delete from social platforms.",
          })
          .option("account", {
            type: "string",
            array: true,
            describe: "Limit deletion to these account IDs.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const dfs = !!(argv["delete-from-social"] ?? argv.deleteFromSocial);
        const accounts = argv.account as string[] | undefined;
        const body: Record<string, unknown> = {};
        if (dfs) body.delete_from_social = true;
        if (accounts && accounts.length) body.account_ids = accounts;
        if (argv["dry-run"] ?? argv.dryRun) {
          out.emitSuccess(
            {
              dry_run: true,
              endpoint: `DELETE /workspaces/${wid}/posts/${argv.post_id}`,
              body,
            },
            g,
            () => {
              out.info(`DRY RUN — would DELETE post ${argv.post_id}`);
              console.log(JSON.stringify(body, null, 2));
            },
          );
          return;
        }
        const data = await deletePost(client, wid, String(argv.post_id), {
          deleteFromSocial: dfs,
          accountIds: accounts,
        });
        out.emitSuccess(data, g, () =>
          out.success(`Deleted post ${argv.post_id}`),
        );
      }),
    )
    .command(
      "posts:approve <post_id>",
      "Approve a post awaiting review.",
      (y) =>
        y
          .positional("post_id", { type: "string", demandOption: true })
          .option("comment", { type: "string" })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => approvalHandler(argv, g, "approve")),
    )
    .command(
      "posts:reject <post_id>",
      "Reject a post awaiting review.",
      (y) =>
        y
          .positional("post_id", { type: "string", demandOption: true })
          .option("comment", { type: "string" })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => approvalHandler(argv, g, "reject")),
    );
}

/**
 * Shared option set for posts:create and posts:update — both accept the same
 * request body. `--body <file.json>` provides the full payload; the shortcut
 * flags build a simple body for the common cases.
 */
function applyPostBodyOptions<T>(y: Argv<T>): Argv<T> {
  return y
    .option("body", {
      type: "string",
      describe: "Path to a JSON file with the full post body.",
    })
    .option("content", {
      alias: "c",
      type: "string",
      describe: "Shortcut: post text.",
    })
    .option("account", {
      alias: "i",
      type: "string",
      array: true,
      describe:
        "Shortcut: account ID(s) to post to. Repeatable. Required unless --content-category-id is given.",
    })
    .option("content-category-id", {
      type: "string",
      describe:
        "Top-level content_category_id (required by the backend when --publish-type content_category). Accounts are derived from the category, so --account is not required when this is set.",
    })
    .option("publish-type", {
      alias: "t",
      type: "string",
      choices: ["scheduled", "draft", "queued", "content_category"],
      describe: "Shortcut: scheduling.publish_type.",
    })
    .option("scheduled-at", {
      alias: "s",
      type: "string",
      describe:
        "Shortcut: scheduling.scheduled_at (YYYY-MM-DD HH:MM:SS). The API reads it as workspace-local wall-clock time, so `scheduling:best-times` slots can be passed straight through.",
    })
    .option("image-url", {
      alias: "m",
      type: "string",
      array: true,
      describe: "Shortcut: external image URL. Repeatable.",
    })
    .option("video-url", { type: "string" })
    .option("media-id", {
      type: "string",
      array: true,
      describe: "Shortcut: media-library ID. Repeatable.",
    })
    .option("post-type", {
      type: "string",
      describe:
        "Post type, e.g. feed, reel, carousel, story, poll. carousel is auto-derived (post_type=carousel + 2+ images); poll requires --post-type poll + a text-only --linkedin-options poll.",
    })
    .option("label", {
      type: "string",
      array: true,
      describe: "Label ID to assign. Repeatable (max 20).",
    })
    .option("campaign-id", {
      type: "string",
      describe: "Campaign ID to assign the post to.",
    })
    .option("approver", {
      type: "string",
      array: true,
      describe:
        "User ID of an approver. Repeatable. Builds the legacy `approval` block. Mutually exclusive with --approval-workflow-id / --approval-workflow-action.",
    })
    .option("approve-option", {
      type: "string",
      choices: ["anyone", "everyone"],
      describe:
        "Approval mode when approvers are set (default anyone). anyone = any single approver; everyone = all must approve.",
    })
    .option("approval-notes", {
      type: "string",
      describe: "Optional note for the approvers.",
    })
    .option("approval-workflow-id", {
      type: "string",
      describe:
        "Attach an approval workflow by ID (the _id from approval-workflows:list) → approval_workflow.workflow_id. Mutually exclusive with --approver and --approval-workflow-action.",
    })
    .option("approval-workflow-action", {
      type: "string",
      choices: [...WORKFLOW_ACTIONS],
      describe:
        "Update-only: change the post's attached workflow — restart|resume|renotify_current|keep|remove → approval_workflow.workflow_action. Mutually exclusive with --approval-workflow-id.",
    })
    .option("approval-workflow-notes", {
      type: "string",
      describe: "Optional note for the approval workflow.",
    })
    .option("linkedin-options", {
      type: "string",
      describe:
        'LinkedIn options as a JSON object: {"title"?:<string>,"poll"?:{"question":<≤140>,"options":<string[2..4], each ≤30>,"duration":"ONE_DAY|THREE_DAYS|SEVEN_DAYS|FOURTEEN_DAYS"}}. A poll requires --post-type poll and text-only content. → linkedin_options',
    })
    .option("facebook-background-id", {
      type: "string",
      describe:
        "Facebook colored-background preset ID (plain-text Facebook posts only).",
    })
    .option("facebook-carousel", {
      type: "string",
      describe:
        'Facebook carousel as a JSON object: {"cards":[{"image","link","title?","description?"}],"call_to_action?","end_card?","end_card_url?","accounts?"}. 2–10 cards. Facebook accounts only.',
    })
    .option("facebook-collaborator", {
      type: "string",
      array: true,
      describe:
        "Facebook collaborator user ID (repeatable, max 10) → facebook_options.collaborators.",
    })
    .option("instagram-collaborator", {
      type: "string",
      array: true,
      describe:
        "Instagram collaborator user ID (repeatable, max 3) → instagram_options.collaborators.",
    })
    .option("threads", {
      type: "string",
      describe:
        'Threads multi-thread as a JSON array: [{"message","media?","media_ids?"}]. Max 10 items, each needs message or media. Threads accounts only.',
    })
    .option("twitter", {
      type: "string",
      describe:
        'Twitter/X threaded tweets as a JSON array: [{"message","media?","media_ids?"}]. Max 10 items, each needs message or media. Twitter accounts only — NO mixed media in one tweet (no images+video together) and max 1 video per tweet.',
    })
    .option("first-comment", {
      type: "string",
      describe:
        "First comment message (≤2000 chars). Requires --first-comment-account (≥1, a subset of --account); the backend 422s if accounts are missing.",
    })
    .option("first-comment-account", {
      type: "string",
      array: true,
      describe:
        "Account ID for the first comment. Repeatable. Must be a subset of the post's --account IDs. Required by the backend when --first-comment is set.",
    })
    .option("dry-run", {
      type: "boolean",
      default: false,
      describe: "Print the body that would be sent without calling the API.",
    });
}

/**
 * Build the post request body from parsed argv — either a full `--body` file
 * or the shortcut flags. Shared by posts:create and posts:update (same body).
 */
function buildPostBodyFromArgv(argv: any): Record<string, unknown> {
  if (argv.body) {
    return readJsonFile(argv.body, "--body");
  }

  const contentCategoryId =
    argv["content-category-id"] ?? argv.contentCategoryId;
  const accounts = (argv.account as string[] | undefined) ?? [];
  const approvers =
    (argv.approver as string[] | undefined)?.filter(Boolean) ?? [];

  const facebookCarouselRaw =
    argv["facebook-carousel"] ?? argv.facebookCarousel;
  const facebookCarousel = facebookCarouselRaw
    ? (parseJsonFlag(
        String(facebookCarouselRaw),
        "--facebook-carousel",
        "object",
      ) as Record<string, unknown>)
    : undefined;

  const linkedinOptionsRaw = argv["linkedin-options"] ?? argv.linkedinOptions;
  const linkedinOptions = linkedinOptionsRaw
    ? (parseJsonFlag(
        String(linkedinOptionsRaw),
        "--linkedin-options",
        "object",
      ) as Record<string, unknown>)
    : undefined;

  const threadsRaw = argv.threads;
  const multiThreads = threadsRaw
    ? (parseJsonFlag(String(threadsRaw), "--threads", "array") as unknown[])
    : undefined;

  const twitterRaw = argv.twitter;
  const threadedTweets = twitterRaw
    ? (parseJsonFlag(String(twitterRaw), "--twitter", "array") as unknown[])
    : undefined;

  const firstComment = argv["first-comment"] ?? argv.firstComment;
  const firstCommentAccounts = (argv["first-comment-account"] ??
    argv.firstCommentAccount) as string[] | undefined;

  const approvalWorkflowId =
    argv["approval-workflow-id"] ?? argv.approvalWorkflowId;
  const approvalWorkflowAction =
    argv["approval-workflow-action"] ?? argv.approvalWorkflowAction;
  const approvalWorkflowNotes =
    argv["approval-workflow-notes"] ?? argv.approvalWorkflowNotes;

  if (!argv.content || !argv["publish-type"]) {
    throw new ConfigError(
      "For shortcut mode, --content and --publish-type are required.",
      { hint: "Or pass --body <file.json> with the full post payload." },
    );
  }

  // Accounts are required unless a content category supplies them.
  if (!contentCategoryId && !accounts.length) {
    throw new ConfigError(
      "For shortcut mode, --account (one or more) is required unless --content-category-id is provided.",
      {
        hint: "Content-category posts use --content-category-id instead of --account (accounts come from the category).",
      },
    );
  }

  // `approval` (legacy approvers) and `approval_workflow` are mutually exclusive.
  if (approvers.length && (approvalWorkflowId || approvalWorkflowAction)) {
    throw new ConfigError(
      "--approver (legacy approval) and --approval-workflow-* are mutually exclusive — pass only one.",
    );
  }

  // Exactly one of workflow_id / workflow_action.
  if (approvalWorkflowId && approvalWorkflowAction) {
    throw new ConfigError(
      "Pass exactly one of --approval-workflow-id or --approval-workflow-action.",
    );
  }

  return buildSimplePostBody({
    text: String(argv.content),
    accounts,
    contentCategoryId: contentCategoryId ? String(contentCategoryId) : undefined,
    publishType: String(argv["publish-type"]),
    scheduledAt: argv["scheduled-at"] ?? argv.scheduledAt,
    imageUrls: (argv["image-url"] ?? argv.imageUrl) as string[] | undefined,
    videoUrl: argv["video-url"] ?? argv.videoUrl,
    mediaIds: (argv["media-id"] ?? argv.mediaId) as string[] | undefined,
    postType: argv["post-type"] ?? argv.postType,
    labels: (argv.label as string[] | undefined)?.filter(Boolean),
    campaignId: argv["campaign-id"] ?? argv.campaignId,
    approvers,
    approveOption: argv["approve-option"] ?? argv.approveOption,
    approvalNotes: argv["approval-notes"] ?? argv.approvalNotes,
    approvalWorkflowId: approvalWorkflowId ? String(approvalWorkflowId) : undefined,
    approvalWorkflowAction: approvalWorkflowAction
      ? String(approvalWorkflowAction)
      : undefined,
    approvalWorkflowNotes: approvalWorkflowNotes
      ? String(approvalWorkflowNotes)
      : undefined,
    linkedinOptions,
    facebookBackgroundId:
      argv["facebook-background-id"] ?? argv.facebookBackgroundId,
    facebookCarousel,
    facebookCollaborators: (argv["facebook-collaborator"] ??
      argv.facebookCollaborator) as string[] | undefined,
    instagramCollaborators: (argv["instagram-collaborator"] ??
      argv.instagramCollaborator) as string[] | undefined,
    multiThreads,
    threadedTweets,
    firstComment: firstComment ? String(firstComment) : undefined,
    firstCommentAccounts,
  });
}

/** Human-output renderer for the create/update success payload. */
function renderPostWrite(verb: string) {
  return (d: any) => {
    out.success(`Post ${verb}.`);
    out.status("ID", String(d?.id ?? d?._id ?? d?.post_id ?? "-"));
    if (d?.post_url) out.status("URL", d.post_url);
    if (d?.warning) out.info(`Warning: ${d.warning}`);
  };
}

async function approvalHandler(
  argv: any,
  g: any,
  action: "approve" | "reject",
): Promise<void> {
  const { cfg, client } = buildClient(g);
  const wid = resolveWorkspace(cfg, g);
  const body: Record<string, unknown> = { action };
  if (argv.comment) body.comment = argv.comment;
  if (argv["dry-run"] ?? argv.dryRun) {
    out.emitSuccess(
      {
        dry_run: true,
        endpoint: `POST /workspaces/${wid}/posts/${argv.post_id}/approval`,
        body,
      },
      g,
      () => {
        out.info(`DRY RUN — would ${action} post ${argv.post_id}`);
        console.log(JSON.stringify(body, null, 2));
      },
    );
    return;
  }
  const data = await postApproval(
    client,
    wid,
    String(argv.post_id),
    action,
    argv.comment,
  );
  out.emitSuccess(data, g, () =>
    out.success(`${action[0].toUpperCase() + action.slice(1)}d post ${argv.post_id}`),
  );
}

function shortText(p: any, limit = 60): string {
  const text =
    p?.content?.text ?? p?.common?.content?.text ?? p?.text ?? p?.message ?? "";
  const flat = String(text).replace(/\n/g, " ").trim();
  return flat.length > limit ? flat.slice(0, limit - 1) + "…" : flat;
}

function readJsonFile(p: string, flagName: string): Record<string, unknown> {
  if (!fs.existsSync(p)) {
    throw new ConfigError(`${flagName}: file not found — ${p}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (e) {
    throw new ConfigError(`${flagName}: invalid JSON — ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigError(
      `${flagName}: JSON must be an object — got ${typeof parsed}`,
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Parse an inline JSON-blob flag value into an object or array. Throws a
 * helpful ConfigError on invalid JSON or a shape mismatch; the backend still
 * validates the contents (card counts, CTA values, item limits).
 */
function parseJsonFlag(
  raw: string,
  flagName: string,
  expect: "object" | "array",
): Record<string, unknown> | unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigError(
      `${flagName}: invalid JSON — ${(e as Error).message}`,
      {
        hint:
          expect === "array"
            ? `${flagName} expects a JSON array, e.g. '[{"message":"part 1"}]'`
            : `${flagName} expects a JSON object, e.g. '{"cards":[{"image":"...","link":"..."}]}'`,
      },
    );
  }
  if (expect === "array" && !Array.isArray(parsed)) {
    throw new ConfigError(
      `${flagName}: JSON must be an array — got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }
  if (
    expect === "object" &&
    (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
  ) {
    throw new ConfigError(
      `${flagName}: JSON must be an object — got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
    );
  }
  return parsed as Record<string, unknown> | unknown[];
}

/**
 * Normalize a date string to the backend's `Y-m-d H:i:s` format.
 * Already-correct input is returned as-is; unparseable input is passed
 * through so the backend can validate. Ported from the MCP create_post tool.
 *
 * Note the two paths differ: a canonical `Y-m-d H:i:s` string is forwarded
 * verbatim, while anything else is rendered from its UTC fields. The backend
 * then interprets whatever it receives as *workspace-local* wall-clock time,
 * so passing an instant-bearing value (e.g. an ISO string ending in `Z`)
 * schedules at that clock reading in the workspace timezone, not at that
 * instant. `scheduling:best-times` already returns workspace-local slots.
 */
function formatToYmdHis(input?: string): string | undefined {
  if (!input) return undefined;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    return input;
  }
  const d = new Date(input);
  if (isNaN(d.getTime())) return input;
  const pad = (n: number) => n.toString().padStart(2, "0");
  const YYYY = d.getUTCFullYear();
  const MM = pad(d.getUTCMonth() + 1);
  const DD = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mm = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
}

function buildSimplePostBody(opts: {
  text: string;
  accounts: string[];
  contentCategoryId?: string;
  publishType: string;
  scheduledAt?: string;
  imageUrls?: string[];
  videoUrl?: string;
  mediaIds?: string[];
  postType?: string;
  labels?: string[];
  campaignId?: string;
  approvers?: string[];
  approveOption?: string;
  approvalNotes?: string;
  approvalWorkflowId?: string;
  approvalWorkflowAction?: string;
  approvalWorkflowNotes?: string;
  linkedinOptions?: Record<string, unknown>;
  facebookBackgroundId?: string;
  facebookCarousel?: Record<string, unknown>;
  facebookCollaborators?: string[];
  instagramCollaborators?: string[];
  multiThreads?: unknown[];
  threadedTweets?: unknown[];
  firstComment?: string;
  firstCommentAccounts?: string[];
}): Record<string, unknown> {
  const content: Record<string, unknown> = { text: opts.text };
  const media: Record<string, unknown> = {};
  if (opts.imageUrls?.length) media.images = opts.imageUrls;
  if (opts.videoUrl) media.video = opts.videoUrl;
  if (opts.mediaIds?.length) media.media_ids = opts.mediaIds;
  if (Object.keys(media).length) content.media = media;

  const scheduling: Record<string, unknown> = { publish_type: opts.publishType };
  const scheduledAt = formatToYmdHis(opts.scheduledAt);
  if (scheduledAt) scheduling.scheduled_at = scheduledAt;

  const body: Record<string, unknown> = {
    content,
    accounts: opts.accounts,
    scheduling,
  };

  if (opts.contentCategoryId) {
    body.content_category_id = opts.contentCategoryId;
  }
  if (opts.postType) body.post_type = opts.postType;
  if (opts.labels?.length) body.labels = opts.labels;
  if (opts.campaignId) body.campaign_id = opts.campaignId;
  if (opts.approvers?.length) {
    body.approval = {
      approvers: opts.approvers,
      approve_option: opts.approveOption || "anyone",
      notes: opts.approvalNotes || "",
    };
  }

  // approval_workflow — mutually exclusive with `approval` (guarded upstream).
  // workflow_id attaches a workflow (create + update); workflow_action mutates
  // an already-attached workflow (update only).
  if (opts.approvalWorkflowId || opts.approvalWorkflowAction) {
    const approvalWorkflow: Record<string, unknown> = {};
    if (opts.approvalWorkflowId) {
      approvalWorkflow.workflow_id = opts.approvalWorkflowId;
    }
    if (opts.approvalWorkflowAction) {
      approvalWorkflow.workflow_action = opts.approvalWorkflowAction;
    }
    if (opts.approvalWorkflowNotes) {
      approvalWorkflow.notes = opts.approvalWorkflowNotes;
    }
    body.approval_workflow = approvalWorkflow;
  }

  if (opts.linkedinOptions) {
    body.linkedin_options = opts.linkedinOptions;
  }

  // Facebook options can carry a background preset, a carousel, and/or
  // collaborators. Merge them into the same object so none clobbers the others.
  const facebookOptions: Record<string, unknown> = {};
  if (opts.facebookBackgroundId) {
    facebookOptions.facebook_background_id = opts.facebookBackgroundId;
  }
  if (opts.facebookCarousel) {
    facebookOptions.carousel = {
      is_carousel_post: true,
      ...opts.facebookCarousel,
    };
  }
  if (opts.facebookCollaborators?.length) {
    facebookOptions.collaborators = opts.facebookCollaborators;
  }
  if (Object.keys(facebookOptions).length) {
    body.facebook_options = facebookOptions;
  }

  if (opts.instagramCollaborators?.length) {
    body.instagram_options = { collaborators: opts.instagramCollaborators };
  }

  if (opts.multiThreads) {
    body.threads_options = {
      has_multi_threads: true,
      multi_threads: opts.multiThreads,
    };
  }

  if (opts.threadedTweets) {
    body.twitter_options = {
      has_threaded_tweets: true,
      threaded_tweets: opts.threadedTweets,
    };
  }

  if (opts.firstComment) {
    body.first_comment = {
      message: opts.firstComment,
      ...(opts.firstCommentAccounts?.length
        ? { accounts: opts.firstCommentAccounts }
        : {}),
    };
  }
  return body;
}

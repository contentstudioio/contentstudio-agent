---
name: contentstudio
description: ContentStudio is a tool to schedule social-media posts, manage the social inbox, and pull performance analytics across Facebook, LinkedIn, Twitter/X, Instagram, YouTube, TikTok, Pinterest, Threads, Tumblr, Bluesky, and Google Business Profile. Use when the user wants to list/create/delete/approve posts, find the best time to post, read and reply to DMs, comments and reviews, manage media, audit workspaces, accounts, campaigns, labels, categories, or team-members, or pull analytics reports (top posts, engagement, impressions, follower growth, AI insights, etc.) on their ContentStudio account.
version: 1.2.0
homepage: https://api.contentstudio.io/guide
metadata: {"openclaw":{"emoji":"📅","requires":{"bins":["contentstudio"],"env":["CONTENTSTUDIO_API_KEY"]}}}
---

## Install ContentStudio CLI if it doesn't exist

```bash
npm install -g contentstudio-cli
# or
pnpm install -g contentstudio-cli
```

npm release: https://www.npmjs.com/package/contentstudio-cli
contentstudio-agent github: https://github.com/contentstudioio/contentstudio-agent
contentstudio API docs: https://api.contentstudio.io/api-docs
official website: https://contentstudio.io

---

| Property | Value |
|----------|-------|
| **name** | contentstudio |
| **description** | Social-media automation CLI for scheduling posts and managing media/accounts via the ContentStudio public API |
| **allowed-tools** | Bash(contentstudio:*) |

---

## ⚠️ Authentication Required

**You MUST authenticate before running any contentstudio CLI command.** All commands will fail without a valid API key.

Before doing anything else, check auth status:

```bash
contentstudio auth:status
```

If `has_api_key` is `false`, authenticate one of two ways. The user can generate a key from **ContentStudio Dashboard → Settings → API Keys**.

1. **API key (interactive)** — stores the key in the CLI config file:

```bash
contentstudio auth:login --api-key cs_...
```

2. **Environment variable (headless / agent runtimes)** — the CLI reads `CONTENTSTUDIO_API_KEY` from the environment and it takes precedence over the config file:

```bash
export CONTENTSTUDIO_API_KEY=cs_...
```

> **Headless deployment note (OpenClaw, CI, daemons):** a shell `export` does **not** persist to a service process. Set `CONTENTSTUDIO_API_KEY` in the agent's actual environment — e.g. systemd `Environment=` (`systemctl edit`), an `EnvironmentFile=`, or Docker `-e` / compose `environment:` — then restart the service. Runtimes that gate on declared requirements (e.g. OpenClaw's `requires.env`) will stay blocked until this variable is present in the process environment.

Then verify a workspace is selected:

```bash
contentstudio --json workspaces:current
```

If `active_workspace_id` is `null`, list workspaces and ask the user to pick one:

```bash
contentstudio --json workspaces:list
contentstudio workspaces:use <workspace_id>
```

---

## Invocation rules for agents

- **Always pass `--json` before the subcommand** for stable, parseable output.
- **Envelope shape**:
  - Success: `{"ok": true, "data": <payload>, "pagination"?: {...}}`
  - Error:   `{"ok": false, "error": {"type": "<ErrorType>", "message": "...", "http_status": <int>, "hint": "..."}}`
- **Exit codes** are non-zero on error. Check both `returncode` and `ok`.
- **Parse stdout only** — human messages go to stderr.
- **Before any mutating action (posts/comments/media), run it with `--dry-run`** first to verify the payload is correct. `--dry-run` never touches the API.

### Confirm the target workspace before mutating actions

The CLI silently defaults to the active workspace (whatever was set by `workspaces:use`). That default is fine for **read-only** calls (`workspaces:list`, `accounts:list`, `posts:list`, `media:list`, etc.) — just use the active workspace.

But for any **mutating** action — `accounts:connect`, `accounts:add-bluesky`, `accounts:add-facebook-group`, `accounts:remove`, `posts:create`, `posts:update`, `posts:delete`, `posts:approve`, `posts:reject`, `comments:add`, `media:upload`, `workspaces:update`, `workspaces:delete`, `labels:create`, `labels:update`, `labels:delete`, `campaigns:create`, `campaigns:update`, `campaigns:delete`, `team:add`, `team:update`, `team:remove`, and every `inbox:*` write (`inbox:send`, `inbox:comment-add`, `inbox:comment-delete`, `inbox:review-reply`, `inbox:update`, `inbox:tag-*`, …) — you MUST confirm the workspace with the user first, even if a workspace is already active. Don't assume the active workspace is the one they want to mutate.

> **Inbox writes are customer-facing.** `inbox:send`, `inbox:comment-add`, and `inbox:review-reply` publish text to a real person on a real social platform, and there is no undo on the provider side. Always `--dry-run` first, show the exact message text to the user, and get explicit approval before sending. Never compose-and-send a reply to a customer in one step.

(`workspaces:create` is the one write that is **not** workspace-scoped — it creates a brand-new workspace and ignores the active one.)

Pattern:

1. Run `contentstudio --json workspaces:current` to see what's active.
2. Tell the user: "Your active workspace is **`<name>`** (`<id>`). Do you want to connect/post/delete in this workspace, or a different one?"
3. If they say a different one, run `workspaces:list`, let them pick, then either:
   - Run `workspaces:use <id>` to switch the default, or
   - Pass `--workspace <id>` on the single mutating call (preferred when it's a one-off — does not change the active workspace).
4. Only then run the mutating command.

This is mandatory even when the user's request seems to imply the active workspace ("connect a Facebook page", "create a draft post") — they may have just switched contexts in their head and forgotten which workspace is active in the CLI.

## Pagination — be proactive, don't silently truncate

**All list commands return a `pagination` block** in JSON mode when more results exist than fit on one page:

```json
{
  "ok": true,
  "data": [ /* current page of items */ ],
  "pagination": {
    "current_page": 1,
    "per_page": 10,
    "total": 48,
    "last_page": 5,
    "from": 1,
    "to": 10,
    "has_more": true
  }
}
```

**Mandatory rule**: Whenever `pagination.has_more === true`, the user has more data than what was returned. **You MUST NOT silently treat the current page as "all results"**. Pick one of these three strategies:

1. **Ask the user** (default for ambiguous requests):
   > "I retrieved 10 of your 48 workspaces. Do you want me to fetch the rest, or is the first 10 enough for what you're doing?"

2. **Auto-paginate** — if the user's request implies they want everything (e.g. "list ALL my accounts", "show every draft post", "delete all queued posts"):
   - Call again with `--per-page <total>` to get everything in one round-trip:
     ```bash
     contentstudio --json workspaces:list --per-page 48
     ```
   - Or iterate `--page 2`, `--page 3`, … `--page <last_page>` if `total` is large (>200) and you want bounded pages.

3. **Filter, don't paginate** — if the user asked for something specific (e.g. "Facebook accounts only"), use the relevant filter flag (`--platform facebook`, `--search "..."`, `--status draft`) instead of paginating. Smaller result set = no pagination needed.

### Quick decision tree for the agent

```
Did the user say "all" / "every" / "complete list" / "every single"?
  → YES: auto-paginate using --per-page <pagination.total>
  → NO:
      Did the user give a specific count? ("show me top 5", "first 20 posts")
        → YES: respect that count; use --per-page accordingly
        → NO:
            pagination.has_more === true?
              → YES: ASK the user before assuming you have everything
              → NO: you have all the data; proceed
```

### Examples

**User**: "list my workspaces"
**Agent should**:
1. Run `contentstudio --json workspaces:list --per-page 50` (high default to often avoid pagination)
2. If `pagination.has_more` is still true, say: "I see 50 of N workspaces. Want me to fetch all N?"

**User**: "delete all my draft posts"
**Agent should**:
1. Run `contentstudio --json posts:list --status draft --per-page 1` to peek at `total`
2. Run `contentstudio --json posts:list --status draft --per-page <total>` to get them all
3. Iterate over `data[]` and delete each
4. Never delete just the first page and report "done"

**User**: "show me my Facebook accounts"
**Agent should**:
1. Use `--platform facebook` filter — usually returns 0 or a handful, no pagination concern
2. If `has_more` still true (>20 FB accounts), ask before auto-fetching

### Endpoints that paginate

All `*:list` commands paginate:
`workspaces:list`, `accounts:list`, `posts:list`, `comments:list`, `media:list`, `campaigns:list`, `categories:list`, `labels:list`, `team:list`, `approval-workflows:list`.

Non-list commands (`auth:whoami`, `posts:create`, `posts:delete`, `media:upload`, etc.) never include `pagination` in their envelope.

---

## Command Reference

All commands are invoked as `contentstudio <group>:<command>`.

### Authentication

| Command | Purpose |
|---------|---------|
| `auth:login --api-key cs_...` | Store and verify API key |
| `auth:logout` | Forget stored credentials |
| `auth:whoami` | Hit `/me` and return user info |
| `auth:status` | Show local config (key redacted) |

### Workspaces

| Command | Purpose |
|---------|---------|
| `workspaces:list` | List user's workspaces |
| `workspaces:use <id>` | Set active workspace |
| `workspaces:current` | Show active workspace |
| `workspaces:create --name <n> --logo <url> --timezone <tz> [--super-admin-id <id>] [--note <t>] [--instagram-posting-method api\|mobile] [--first-day-day <Day> --first-day-key <0-6>]` | Create a new workspace (NOT workspace-scoped) |
| `workspaces:update [<id>] [--name] [--logo] [--timezone] [--note] [--instagram-posting-method] [--first-day-day --first-day-key]` | Update a workspace (defaults to active; ≥1 field required) |
| `workspaces:delete <id>` | Delete a workspace |

`workspaces:create` / `workspaces:update`:
- `--name` ≤35 chars, letters/spaces/digits/period only.
- `--logo` must be a URL; `--timezone` is an IANA string (e.g. `Asia/Karachi`).
- `--super-admin-id` (create only) — account owner to create under; required when you manage multiple super admins.
- First day of week is expressed as two paired flags: `--first-day-day <Sunday..Saturday>` + `--first-day-key <index>` where the key is the day's index (`Sunday=0 … Saturday=6`). Both build `first_day: {day, key}`.
- `workspaces:update` defaults to the active workspace if `<id>` is omitted and requires at least one field.
- Errors: `WORKSPACE_DELETE_FAILED` (422) on delete failure; 404 when the workspace doesn't exist.

### Social accounts (read + connect)

| Command | Purpose |
|---------|---------|
| `accounts:list [--platform <p>] [--search <q>]` | List connected social accounts |
| `platforms:list` | List platforms supported for new account connections |
| `accounts:connect <platform>` | Generate a one-time OAuth URL to connect a new account |
| `accounts:connect <platform> --reconnect --account-id <id>` | Refresh an expired/invalid account |
| `accounts:add-bluesky --handle <h> --app-password <p>` | Connect a Bluesky account (no browser — uses app password) |
| `accounts:add-facebook-group --name <n> [--image <url>]` | Manually add a Facebook Group connection |
| `accounts:remove <account_id>` | Remove (disconnect) a social account. `account_id` is the account's `id` from `accounts:list`. Requires the `save_social` permission (403 otherwise). |

`--platform` values for `accounts:list` filter: `facebook`, `linkedin`, `twitter`, `instagram`, `youtube`, `tiktok`, `pinterest`, `gmb`.

`<platform>` values for `accounts:connect`: `facebook`, `facebook-profile`, `instagram`, `instagram-via-facebook`, `twitter`, `linkedin`, `pinterest`, `tiktok`, `youtube`, `threads`, `gmb`, `tumblr`.

**Account-connection flow for AI agents:**
1. Run `platforms:list` to see what's supported and which method each uses (`oauth` / `credentials` / `manual`).
2. For OAuth platforms (most), call `accounts:connect <platform>` and surface the returned URL to the user — they open it in their browser to authorize. The CLI itself never handles credentials.
3. For Bluesky, ask the user for their handle + app-password (link them to <https://bsky.app/settings/app-passwords>) and call `accounts:add-bluesky`.
4. For Facebook Groups, just call `accounts:add-facebook-group --name "..."`.

### Posts

| Command | Purpose |
|---------|---------|
| `posts:list [--status draft\|scheduled\|...] [--date-from] [--date-to]` | List posts |
| `posts:create -c "text" -i <account> -t <publish_type> [-s "YYYY-MM-DD HH:MM:SS"] [-m <image_url>]` | Create a post (shortcut mode) |
| `posts:create -c "text" -t content_category --content-category-id <cat_id>` | Create a content-category post (accounts come from the category) |
| `posts:create -c "text" -i <fb_account> -t draft --facebook-carousel '<json>'` | Create a Facebook carousel post (2–10 cards) |
| `posts:create -c "text" -i <threads_account> -t draft --threads '<json>'` | Create a Threads multi-thread (chained) post (max 10 items) |
| `posts:create -c "text" -i <twitter_account> -t draft --twitter '<json>'` | Create a Twitter/X threaded-tweet post (max 10 tweets) |
| `posts:create -c "text" -i <account> -t draft --first-comment "..." --first-comment-account <id>` | Create a post with a first comment |
| `posts:create -c "text" -i <linkedin_account> -t draft --post-type poll --linkedin-options '<json>'` | Create a LinkedIn poll post (text-only) |
| `posts:create -c "text" -i <ig_account> -t draft --post-type reel --video-url <url> --instagram-trial-reel` | Create an Instagram trial reel (shown to non-followers first) |
| `posts:create -c "common text" -i <fb_account> -i <tiktok_account> -t draft -m <img_url> --platform-overrides '<json>'` | Same post to multiple platforms with a per-platform content override |
| `posts:create --body /path/to/body.json` | Create a post with full JSON body |
| `posts:update <post_id> [same flags as posts:create]` | Update an existing post (same body). Rejected (422) once the post is published/processing |
| `posts:delete <post_id> [--delete-from-social]` | Delete a post |
| `posts:approve <post_id> [--comment "..."]` | Approve a pending post |
| `posts:reject <post_id> [--comment "..."]` | Reject a pending post |

`-t / --publish-type` values: `scheduled`, `draft`, `queued`, `content_category`.

`posts:update <post_id>` takes the **exact same flags and body** as `posts:create` (both `--body` and shortcut mode) — it PUTs to `/workspaces/{w}/posts/{post_id}`. The backend allows the update only while the post's status is **not** `published` or `processing` (otherwise it returns 422). Use `--approval-workflow-action` (below) on update to change an already-attached workflow.

**`posts:create` / `posts:update` shortcut-mode flags:**
- `-c / --content` (required) — post text.
- `-i / --account <id>` (repeatable) — account ID(s) to post to. **Required UNLESS `--content-category-id` is given.**
- `--content-category-id <id>` — sets top-level `content_category_id`. **Required by the backend when `--publish-type content_category`.** When set, accounts are derived from the category, so `--account` is not required (and may be omitted). Use this instead of `--account` for content-category posts.
- `-s / --scheduled-at "YYYY-MM-DD HH:MM:SS"` — scheduling time. The CLI normalizes any parseable date to `YYYY-MM-DD HH:MM:SS` (the backend's required `date_format`) and sends it as a plain wall-clock string. **The API reads it in the workspace's timezone, not UTC** — so pass the local time the user wants the post to fire at, and get the zone from `workspaces:current` if you're unsure. `scheduling:best-times` already returns slots in that zone, so they can be passed straight through.
- `-m / --image-url <url>` (repeatable), `--video-url <url>`, `--media-id <id>` (repeatable) — media.
- `--post-type <type>` — e.g. `feed`, `reel`, `carousel`, `story`, `poll`. A **carousel** is auto-derived by the backend when `post_type=carousel` and 2+ images are attached. A **poll** requires `--post-type poll` **and** a text-only `--linkedin-options` poll block (no media).
- `--label <id>` (repeatable, max 20) → `labels`.
- `--campaign-id <id>` → `campaign_id`.
- `--linkedin-options '<json>'` → `linkedin_options` (**LinkedIn accounts**). Pass a JSON **object**; the CLI parses it locally (invalid JSON → `ConfigError`) and sends it verbatim.
  - Shape: `{ "title"?: <string>, "poll"?: { "question": <≤140>, "options": <string[2..4], each ≤30>, "duration": "ONE_DAY" | "THREE_DAYS" | "SEVEN_DAYS" | "FOURTEEN_DAYS" } }`
  - A **poll** must be paired with `--post-type poll` and text-only content (no images/video). Backend validates and 422s on violations.
- `--facebook-collaborator <user_id>` (repeatable, **max 10**) → `facebook_options.collaborators` (Facebook accounts). Merges with `--facebook-carousel` / `--facebook-background-id`.
- `--instagram-collaborator <user_id>` (repeatable, **max 3**) → `instagram_options.collaborators` (Instagram accounts). Rejected (422) together with `--instagram-trial-reel`.
- `--instagram-trial-reel` (boolean, default `false`) → `instagram_options.trial_reel.enabled`. Publishes an Instagram **trial reel** — shown to non-followers first, so it does not appear on the profile grid or in follower feeds.
  - `--instagram-trial-reel-graduation SS_PERFORMANCE|MANUAL` (default `SS_PERFORMANCE`) → `instagram_options.trial_reel.graduation_strategy`. `SS_PERFORMANCE` lets Instagram auto-graduate it to followers if it performs well; `MANUAL` requires graduating it by hand in the Instagram app (Instagram has no API for that).
  - Requires `--post-type reel` **exactly** (not `feed+reel`) and a video — feed/carousel/story are rejected. The CLI does not pre-validate this; the backend returns 422.
  - **Rejected (422) together with `--instagram-collaborator`.** Share-to-story is silently dropped (not rejected) when combined with a trial reel.
  - Not available when the workspace posts to Instagram via the mobile app (`instagram_posting_option=mobile`).
- `--platform-overrides '<json>'` → `platform_overrides` (top-level, works across any platform in the post). Pass a JSON **object** keyed by platform (`facebook`, `instagram`, `twitter`, `linkedin`, `pinterest`, `youtube`, `tiktok`, `gmb`, `tumblr`, `threads`, `bluesky`, `telegram`); the CLI parses it locally (invalid JSON → `ConfigError`) and sends it verbatim.
  - Shape per platform: `{ "content": { "text"?: <string>, "post_type"?: <string>, "media"?: { "images"?: <url[] ≤10>, "video"?: <url> } } }`.
  - `text` and `post_type` each merge **independently** with the common top-level `content` — an override with only `media` still inherits the common `text`/`post_type`.
  - `media` is **atomic**: if an override's `content` includes a `media` key at all, that platform's media is defined ENTIRELY by the override (no per-field fallback to the common media for whichever of `images`/`video` it omits). Omitting `media` entirely inherits the common `content.media` wholesale. This exists because some platforms (e.g. TikTok) can never support mixed images+video.
  - Omitting `--platform-overrides` entirely publishes the same top-level `content` to every targeted platform.
  - Override images are URLs only (no `media_ids`) and follow the same validation as the top-level media (max 10 images, no mixing images+video in one override).
- **Approval — two mutually-exclusive systems (pass only one):**
  - **Legacy** `--approver <user_id>` (repeatable) + `--approve-option anyone|everyone` (default `anyone`) + `--approval-notes "..."` → builds `approval: {approvers, approve_option, notes}` only when at least one approver is given. The post creator cannot be an approver. `anyone` = any single approver; `everyone` = all must approve.
  - **Workflow** `--approval-workflow-id <id>` + `--approval-workflow-notes "..."` → `approval_workflow: {workflow_id, notes?}` — ATTACH a workflow (works on both create and update). Get the id from `approval-workflows:list` (its `id`).
  - **Workflow (update only)** `--approval-workflow-action restart|resume|renotify_current|keep|remove` + `--approval-workflow-notes "..."` → `approval_workflow: {workflow_action, notes?}` — mutate the already-attached workflow. Only valid on `posts:update`.
  - **Exactly one** of `--approval-workflow-id` / `--approval-workflow-action`, and `--approver` cannot be combined with either `--approval-workflow-*` flag. The CLI errors locally (`ConfigError`) if these rules are broken.
- `--facebook-background-id <id>` → `facebook_options.facebook_background_id` (plain-text Facebook posts only; rejected if media is attached). Get a valid id from `facebook:text-backgrounds`.
- `--facebook-carousel '<json>'` → `facebook_options.carousel` (**Facebook accounts only**). Pass a JSON **object**; the CLI parses it locally (invalid JSON → `ConfigError`) and adds `is_carousel_post: true`. It **merges** with `--facebook-background-id` (neither clobbers the other). The backend validates card counts/CTA/limits and returns a 422 if they're wrong.
  - Shape: `{ "cards": [ { "image": <url, required>, "link": <url, required>, "title"?: <≤255>, "description"?: <≤1000> } ], "call_to_action"?, "end_card"?: <bool>, "end_card_url"?: <url>, "accounts"?: <string[]> }`
  - **MIN 2, MAX 10 cards.** The Facebook account ID(s) still go in the top-level `-i / --account` (or in `carousel.accounts`).
  - `call_to_action` is one of 33 values: `NO_BUTTON`, `ADD_TO_CART`, `APPLY_NOW`, `BET_NOW`, `BOOK_TRAVEL`, `BUY_NOW`, `BUY_TICKETS`, `CALL_NOW`, `CONTACT_US`, `DOWNLOAD`, `GET_DIRECTIONS`, `GET_OFFER`, `GET_QUOTE`, `GO_LIVE`, `INSTALL_MOBILE_APP`, `LEARN_MORE`, `LIKE_PAGE`, `LISTEN_MUSIC`, `OPEN_LINK`, `ORDER_NOW`, `PLAY_GAME`, `REGISTER_NOW`, `REQUEST_TIME`, `SAVE`, `MESSAGE_PAGE`, `WHATSAPP_MESSAGE`, `SHOP_NOW`, `SIGN_UP`, `SUBSCRIBE`, `USE_APP`, `WATCH_MORE`, `WATCH_VIDEO`.
- `--threads '<json>'` → `threads_options` (**Threads accounts only**). Pass a JSON **array** of thread items; the CLI parses it locally (invalid JSON → `ConfigError`), sets `has_multi_threads: true` and `multi_threads: <array>`. The Threads account ID goes in the top-level `-i / --account`.
  - Shape: `[ { "message": <string>, "media"?: <url[] ≤10>, "media_ids"?: <string[] ≤10> } ]`
  - **MAX 10 items.** Each item needs `message` OR `media`. Threads allows mixed media. Backend validates limits and returns a 422 if exceeded.
- `--twitter '<json>'` → `twitter_options` (**Twitter/X accounts only**). Pass a JSON **array** of tweet items; the CLI parses it locally (invalid JSON → `ConfigError`), sets `has_threaded_tweets: true` and `threaded_tweets: <array>`. The Twitter account ID goes in the top-level `-i / --account`. This mirrors `--threads` but for Twitter threaded tweets.
  - Shape: `[ { "message": <string>, "media"?: <url[] ≤10>, "media_ids"?: <string[] ≤10> } ]`
  - **MAX 10 tweets.** Each item needs `message` OR `media`. **Twitter does NOT allow mixed media in one tweet** (no images + video together) and **max 1 video per tweet**. The CLI does not validate tweet contents — the backend enforces these limits and returns a 422 if violated.
- `--first-comment "<message>"` → `first_comment` (≤2000 chars). The CLI builds `first_comment: { message, accounts? }`. The accounts are supplied with `--first-comment-account <id>` (repeatable).
  - `--first-comment-account <id>` (repeatable) → `first_comment.accounts`. **The backend REQUIRES at least one account when a `--first-comment` message is given, and the accounts must be a subset of the post's main `--account` IDs.** The CLI does not hard-block client-side — if you omit `--first-comment-account`, the backend returns a 422.

(`--facebook-carousel`, `--facebook-collaborator`, `--instagram-collaborator`, `--instagram-trial-reel`, `--instagram-trial-reel-graduation`, `--linkedin-options`, `--platform-overrides`, `--threads`, and `--twitter` only apply in shortcut mode. The `--body` JSON mode already supports `facebook_options` (carousel + collaborators), `instagram_options` (`collaborators` + `trial_reel`), `linkedin_options`, `threads_options`, `twitter_options`, `first_comment`, `approval`, `approval_workflow`, and top-level `platform_overrides` natively — use it for posts that mix multiple platform option blocks.)

The `posts:list` payload now includes `linkedin_options` and `approval_workflow` per post (in addition to the existing fields) — they surface automatically in the `--json` output.

### Scheduling — best time to post

| Command | Purpose |
|---------|---------|
| `scheduling:best-times` | Ranked posting slots for the workspace, derived from the connected accounts' history |
| `scheduling:best-times --account <platform>:<account_id>` | Restrict the analysis to specific accounts (repeatable) |
| `scheduling:best-times --global-slots <n> --per-account-slots <n>` | How many recommendations to return (1–24 each) |
| `scheduling:best-times --entities '<json>'` | Full entity array, for per-account slot counts |

A **slot** is one recommended posting time: a weekday and an hour. Slots come back ranked best-first, so `--global-slots 3` means *the three best hours to post*.

- **Times are always in the workspace timezone**, echoed as `meta.timezone`. There is no timezone parameter. That is the same clock `posts:create --scheduled-at` writes against, so a slot can be scheduled as-is — do **not** convert it to UTC first.
- **Omit `--account` to analyse every connected account.** Otherwise pass `<platform>:<account_id>` where both halves come from one `accounts:list` row (its `platform` and `_id`), e.g. `--account facebook:<account_id>`. Supported platforms: `facebook`, `instagram`, `linkedin`, `twitter`, `tiktok`, `youtube`, `pinterest`, `threads`, `gmb`, `tumblr`, `bluesky`, `telegram`.
- `--entities '[{"id":"<account_id>","type":"facebook","slots":3}]'` is the escape hatch for a **different slot count per account**; it cannot be combined with `--account`.
- `--global-slots` (API default 5) sizes the pooled `global` view; `--per-account-slots` (API default 3) sizes each account's list. Both are 1–24 and are validated by the CLI before the call. Neither changes the underlying analysis or the `heatmap_matrix`, which always carries every hour that had signal.

**Response shape** (`data` in the JSON envelope):

- `meta` — `{generated_at, timezone, warnings[], missing_entities[], ai_fallback_entities[]}`.
- `global` — pooled across analysed accounts: `top_recommendations[]` (each `{rank, day, date, time, score, platform_breakdown}`, where `time` is the hour as a bare string, e.g. `"14"` = 14:00), plus `heatmap_matrix.data` (sparse `[hour, day_index, score]` triples, `day_index` 0 = Monday) and `dates_key`. **`null` when no account had usable data.**
- `individual` — the same breakdown keyed by account id, each with `platform` and `source` (`data_driven` or an AI fallback).

**A thin workspace still returns HTTP 200.** Accounts with too little history come back in `meta.missing_entities` and `global` may be `null` — that is a successful read, not an error. Tell the user which accounts were skipped rather than reporting a failure. Accounts listed in `meta.ai_fallback_entities` are estimates, not measurements — say so when you present them.

Errors: 422 for unknown accounts or a workspace with no connected accounts; 502 (`BackendError`) when the optimizer is temporarily unavailable — retry rather than reporting no data.

**Reading is safe.** `scheduling:best-times` only reads, so it needs no `--dry-run` and no workspace confirmation. Scheduling a post from a slot is a mutation, so the usual `--dry-run` + workspace-confirmation rules apply to that step.

### Comments / Internal notes

| Command | Purpose |
|---------|---------|
| `comments:list <post_id>` | List comments on a post |
| `comments:add <post_id> "message" [--note] [--mention <user_id>]` | Add public comment or internal note |

### Media library

| Command | Purpose |
|---------|---------|
| `media:list [--type images\|videos] [--sort recent\|...]` | List media assets |
| `media:upload --file <local_path>` | Upload a local file |
| `media:upload --url <external_url>` | Import from external URL |

### Lookup tables (read)

| Command | Purpose |
|---------|---------|
| `campaigns:list` | List campaigns (folders) |
| `categories:list` | List content categories |
| `labels:list` | List labels |
| `team:list` | List workspace team members |
| `approval-workflows:list` | List approval workflows (use an item's `id` as `--approval-workflow-id`) |

Each `approval-workflows:list` item is `{ id, name, is_default, levels: [{ level_number, title, rule, members: [{ user_id }] }] }`. Use `id` as `posts:create` / `posts:update`'s `--approval-workflow-id`.

### Labels (write)

| Command | Purpose |
|---------|---------|
| `labels:create --name <n> --color <color_N>` | Create a label |
| `labels:update <label_id> [--name] [--color]` | Update a label |
| `labels:delete <label_id>` | Delete a label |

### Campaigns (write)

| Command | Purpose |
|---------|---------|
| `campaigns:create --name <n> --color <color_N>` | Create a campaign |
| `campaigns:update <campaign_id> [--name] [--color]` | Update a campaign |
| `campaigns:delete <campaign_id>` | Delete a campaign |

For labels and campaigns: `--name` ≤100 chars; `--color` is one of the enum values `color_1` … `color_20`. On update, pass `--name` and/or `--color` (each is required-if-present).

### Team members (write)

| Command | Purpose |
|---------|---------|
| `team:add --email <e> --role <r> [--membership team\|client] [--permissions '<json>']` | Invite a member |
| `team:update <member_id> --role <r> --permissions '<json>' [--membership]` | Update a member's role/permissions |
| `team:remove <member_id> [--confirmed]` | Remove a member |

- `member_id` is the **membership id** — the `member_id` field from `team:list` (not the user's `id`, a distinct field).
- `--role` (required): `admin`, `approver`, or `collaborator`.
- `--email` (required for `team:add`): a single email address.
- `--membership` (optional): `team` (internal) or `client` (external; hidden from internal notes). Default `team`.
- `--permissions` (optional for `team:add`, **required for `team:update`**): a **role-aware** JSON object passed as a string (e.g. `--permissions '{"addSocial":true}'`). Invalid JSON → local `ConfigError`; invalid role/key combinations → backend 422. `team:update` is a partial merge — only the keys you send change; a role change drops boolean keys not valid for the new role.
  - **Shared booleans** (any role): `accessSharedFolder`, `allow_workflow_management`.
  - **admin**: full access — only the `hasBillingAccess` boolean applies.
  - **collaborator** booleans: `addBlog`, `addSocial`, `addSource`, `addTopic`, `viewTeam`, `rescheduleQueue`, `postsReview`, `changeFBGroupPublishAs`, `hasListeningAccess`.
  - **approver** booleans: `approverCanEditPost`, `approverCanAddNotes`, `approverCanCreatePost` (approvers can only approve/reject otherwise).
  - **Account-access arrays** (any role; must be real connected account IDs in the workspace, else 422): `facebook`, `instagram`, `threads`, `twitter`, `linkedin`, `pinterest`, `telegram`, `youtube`, `tiktok`, `tumblr`, `tumblr_blogs`, `tumblr_profiles`, `bluesky`, `gmb`.
  - **Blog arrays** (any role; not existence-validated): `wordpress`, `medium`, `shopify`, `webflow`.
  - **content_categories** (any role; must be real category IDs in the workspace, else 422): array of content-category IDs.
- `team:remove`: if the member is in approval workflows / in-flight posts, the backend returns error_code `REQUIRES_REMOVAL_CONFIRMATION` (422) — re-run with `--confirmed` (sends `?confirmed=true`) to proceed. 404 = `TEAM_MEMBER_NOT_FOUND`.

### Social accounts (write)

| Command | Purpose |
|---------|---------|
| `accounts:remove <account_id> [--dry-run]` | Remove (disconnect) a social account (`DELETE /workspaces/{w}/accounts/{account_id}`) |

- `account_id` is the account's `id` from `accounts:list`.
- Requires the `save_social` permission — callers without it get 403.
- Errors: 401 (bad/missing API key), 403 (missing `save_social`), 404 (account not found in the workspace), 422 (removal failed). Success is 200 with an empty `data` array.
- Mutating command — preview with `--dry-run` and confirm the workspace first.

### Facebook helpers

| Command | Purpose |
|---------|---------|
| `facebook:text-backgrounds` | List Facebook colored-background presets (use `id` as `facebook_options.facebook_background_id` on plain-text posts) |

### Social Inbox

The inbox unifies three kinds of item into **elements**: `conversation` (DMs),
`post` (a post with comments), and `review`. `inbox:list` is the entry point —
everything else takes an id it returned.

### Which id to pass

Inbox commands take their id from the `element_details` object on each
`inbox:list` row. Use **`element_details.element_id`** — it is accepted by
every element-scoped command.

| Command | Id to pass |
|---------|------------|
| `inbox:update` (`--element`) | `element_details.element_id` |
| `inbox:tag-attach` / `inbox:tag-detach` | `element_details.element_id` |
| `inbox:mark-read` | `element_details.element_id` |
| `inbox:contact` / `inbox:contact-update` | `element_details.element_id` |
| `inbox:messages` / `send` / `notes` / `note-add` / `bookmarks` | `element_details.element_id` (`t_…` form) |
| `inbox:comments` / `inbox:comment-add` | `element_details.post_id` |

Values look like:

- `element_details.element_id` — `t_10000000000000001` (conversation) or
  `100000000000000001_200000000000000002` (post)
- `element_details.post_id` — `900000000000001_100000000000000001`

The row's top-level `element_ref` is an internal reference, not a command
argument — always take the id from `element_details`.

If a command returns an empty list or reports the item as not found, confirm
the id against this table before describing the result to the user.

Also needed for most writes:

- **`platform_id`** — the connected social account the item belongs to. The
  backend replies through that account's token. It is on every `inbox:list`
  row as `platform_id`, or from `accounts:list`.
- The platform field on a list row is **`platform`** (not `platform_type`),
  but the write commands take `--platform-type`.

**Reading**

| Command | Purpose |
|---------|---------|
| `inbox:list` | Search the inbox. `--type conversation\|post\|review` (repeatable), `--action all\|marked_done\|archived\|assigned`, `--search`, `--tag`, `--channels '{"facebook":["<acct>"]}'`, `--page`, `--limit` |
| `inbox:summary` | Counts per bucket — cheap way to answer "anything unread?" |
| `inbox:messages <conversation_id>` | Messages in a DM thread. Id = `element_details.element_id`. `--sort-order asc\|desc` |
| `inbox:comments <post_id>` | A post's comments (threaded). Id = `element_details.post_id` |
| `inbox:notes <conversation_id>` | Internal notes (team-only). Id = `element_details.element_id`. Paginated |
| `inbox:bookmarks <conversation_id>` | Starred messages. Id = `element_details.element_id`. Paginated |
| `inbox:contact <element_ref>` | Contact profile behind an element |
| `inbox:tags` | The workspace's inbox tag catalogue |

**Replying — customer-facing, confirm before sending**

| Command | Purpose |
|---------|---------|
| `inbox:send <conversation_id>` | Send a DM (id = `element_details.element_id`). Needs `--platform-type facebook\|instagram`, `--platform-id`, and `--message` and/or `--file`. `--idempotency-key` de-dupes a retry |
| `inbox:comment-add <post_id>` | Comment on a post. `--comment-id` makes it a threaded reply; `--private-reply` sends a Facebook DM instead; `--attachment <path>` attaches a file |
| `inbox:review-reply <review_id>` | Add or replace a review reply (upsert). `--platform-id`, `--reply` |
| `inbox:note-add <conversation_id>` | Add an internal note. `--mention <user_id>` (repeatable). Not customer-visible |

**Triage and moderation**

| Command | Purpose |
|---------|---------|
| `inbox:mark-read <element_ref>` | Mark read (idempotent) |
| `inbox:update` | Bulk state change. `--element` (repeatable, **max 100**) plus **exactly one** of `--status done\|pending`, `--archived`, `--assigned` (pair with `--assigned-to '{"id":"<user>"}'`) |
| `inbox:comment-hide` / `inbox:comment-unhide <comment_id>` | Hide/unhide. Unhide needs `--platform-type` + `--platform-id` |
| `inbox:comment-like` / `inbox:comment-unlike <comment_id>` | Facebook only |
| `inbox:comment-delete <comment_id>` | Delete. Needs `--platform-type` + `--platform-id`; LinkedIn also needs `--comment-urn` |
| `inbox:star` / `inbox:unstar <message_id>` | Star a message |
| `inbox:message-delete <message_id>` | Soft-delete a message. `--platform-id` |
| `inbox:review-reply-delete <review_id>` | Remove a review reply. `--platform-id` |
| `inbox:contact-update <element_ref>` | `--platform-id` plus any of `--name`, `--email`, `--phone`, `--company` |

**Tags**

| Command | Purpose |
|---------|---------|
| `inbox:tag-create` | `--name` (≤50), `--color` — a **hex** value like `#33aa55`. (Older tags may display `color_1`, but the API now rejects that format.) |
| `inbox:tag-update <tag_id>` | `--name` and/or `--color` |
| `inbox:tag-delete` | `--tag <id>` (repeatable, bulk) |
| `inbox:tag-merge` | Fold tags into a new one: `--name`, `--color`, `--tag` (repeatable) |
| `inbox:tag-attach <element_ref>` | `--tag` (repeatable), `--platform-id`, `--inbox-type` |
| `inbox:tag-detach <element_ref> <tag_id>` | `--platform-id`, `--inbox-type` |

**Inbox pagination note.** Inbox list commands use `--limit` rather than
`--per-page` (`--per-page` is accepted as an alias). The pagination rules in
the section above apply unchanged: if `pagination.has_more` is true, do not
report the first page as the whole inbox.

> **Inbox page size is 200.** For inboxes larger than that, page through with
> `--page 1`, `--page 2`, … up to `pagination.last_page` rather than raising
> `--limit` past 200.

**Inbox limits.** The CLI validates these locally, so they surface as a
`ConfigError` before any request is sent:

| Limit | Where |
|-------|-------|
| `--limit` ≤ 200 | `inbox:list`, `inbox:messages`, `inbox:comments` |
| ≤ 100 `--element` refs per call | `inbox:update` |
| Exactly **one** operation per call | `inbox:update` — `--status`, `--archived`, and `--assigned` are mutually exclusive; run separate commands |
| Tag name ≤ 50 chars | `inbox:tag-create` |

**Partial success on bulk updates.** `inbox:update` returns HTTP `207` when
some elements were updated and others were not, listing the remainder in
`missing_ids`. The CLI reports this as a warning. When `missing_ids` is
non-empty, tell the user which elements did not change rather than reporting
the batch as fully applied.

**`inbox:contact-update` updates the whole contact.** A contact is a person,
not a per-element attribute, so the change applies to every element for that
contact on that account in the workspace. The response's `updated_count` says
how many were updated. Mention this scope to the user before running it.

**`inbox:contact` returns personal data.** Email and phone of an end customer.
Return only the fields the user actually asked for; don't dump the whole record
into a summary or paste it somewhere persistent without being asked.

**`inbox:messages` includes activity events.** A thread contains both messages
and a record of team activity. Activity entries have `message: null` and an
`action` block (`MARKED_AS_DONE`, `PENDING`, `ARCHIVED`, …) naming the teammate
who performed it, and they count toward `total_messages` and pagination. Filter
on `action == null` when you mean customer messages — don't count activity
entries as messages, quote them as customer text, or treat one as the latest
reply. The CLI renders them as `— marked as done —` rows in human mode.

**Replies are nested, not paginated.** In `inbox:comments`, replies live under
each thread's `children` — they are not separate top-level rows. Paging counts
threads (`total_threads`), not individual comments, so "12 comments" from the
pagination block means 12 *threads* and there may be many more replies inside.

**Handling a `409` on a send.** For `inbox:send` and `inbox:comment-add`, a
`409` means the delivery outcome is undetermined — the message may or may not
have reached the customer. The CLI surfaces it as `ConflictError`. Do not retry
automatically: read the conversation back with `inbox:messages` to check
whether it landed, and tell the user what you found before sending again.

**Confirming a send.** `inbox:send` returns `sent_message.id_status`. When it
is `unavailable`, the platform accepted the message without returning an id, so
there is no id to reconcile against later — report it as sent, with delivery
unconfirmed.

**Inbox-specific responses.** A `502` from an `inbox:*` command indicates the
inbox service is temporarily unreachable rather than a missing item — retry
after a short backoff. An empty `inbox:list` result is a successful empty
read: report it as "no matching conversations", not "not found".

### Analytics

Read-only performance reports across Facebook, Instagram, YouTube, Pinterest,
LinkedIn, Google Business Profile, TikTok, Twitter/X, **Meta Ads** and
**Google Ads**, plus cross-network Campaigns & Labels reports (133 commands
total, one per backend endpoint — no generic passthrough).

Most commands need `--platform-id` (the connected account, from
`accounts:list`) plus either a date range or a native post id. The ads and
campaign/label families are the exceptions — see below:

- **Date-range reports** — `--start-date` / `--end-date` (`YYYY-MM-DD`,
  both required). Optional on most: `--timezone` (IANA name, default UTC),
  `--date` (alternative `'YYYY-MM-DD - YYYY-MM-DD'` form that overrides the
  range), `--limit` / `--offset`, `--order-by` (choices vary per command —
  check `--help`), and array filters like `--media-type`, `--hashtags`,
  `--entity-type` (repeat the flag for multiple values).
- **Single-item lookups** (`*-single-post`, `*-single-pin`, `*-single-tweet`,
  `*-single-video`) — `--platform-id` + `--post-id` (the platform-native id,
  not a ContentStudio internal id). No date range.
- **AI insights** commands (`*-ai-insights`) additionally take `--type`
  (`aiInsightsSummary` for the compact card, `aiInsightsDetailed` for the full
  report) and `--language` (ISO 639-1, default `en`). Both ads platforms have
  one too.
- **Ads reports** (`analytics:meta-ads-*`, `analytics:google-ads-*`) take
  `--account-id` — an *ad* account (`act_…` on Meta, a customer id on Google,
  from `analytics:meta-ads-accounts` / `analytics:google-ads-accounts`) — not
  `--platform-id`. Table commands add `--limit`/`--offset`, `--search`,
  `--order-by`/`--order-dir` and id filters (`--campaign-id`, `--ad-set-id`,
  `--ad-group-id`); chart commands add `--metric` and `--level`.
  `analytics:*-ads-accounts` needs no account at all — it is how you find one.
- **Campaigns & Labels** (`analytics:campaigns-labels-*`) are the only POST
  reports: the filters are lists, so repeat the flag —
  `--campaigns <id> --campaigns <id>`, `--labels <id>`, and one account list
  per network (`--facebook-accounts`, `--instagram-accounts`, …). Only
  `--start-date`/`--end-date` are required.

Run `contentstudio analytics:<command> --help` to see the exact options for
any one command — required vs. optional and enum choices differ per endpoint.

Every analytics command is read-only — the campaign/label ones are POSTs only
because their filters are arrays — so none of them take `--dry-run` (that flag
only exists on mutating commands elsewhere in this CLI).

**If a command returns `ANALYTICS_UPSTREAM_ERROR`** (HTTP 200 with
`status: false`, often `upstream_status: 401`), that is the ContentStudio
backend's own analytics pipeline failing upstream — not a bad request. Report
it as "the analytics service is temporarily unavailable," don't retry the
exact same call in a loop, and don't treat it as evidence the account/workspace
is wrong.

**Facebook (15)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:facebook-active-users` | Facebook active users by hour and day of week | --platform-id, --start-date, --end-date |
| `analytics:facebook-ai-insights` | Facebook AI-generated insights | --platform-id, --start-date, --end-date |
| `analytics:facebook-audience-growth` | Facebook fan / follower growth over time | --platform-id, --start-date, --end-date |
| `analytics:facebook-audience-location` | Facebook audience location (country/city breakdown) | --platform-id, --start-date, --end-date |
| `analytics:facebook-demographics` | Facebook audience age / gender / country / city demographics | --platform-id, --start-date, --end-date |
| `analytics:facebook-demographics-overview` | Facebook demographics overview widget | --platform-id, --start-date, --end-date |
| `analytics:facebook-engagement` | Facebook page engagements over time | --platform-id, --start-date, --end-date |
| `analytics:facebook-get-top-posts` | Facebook top posts with media_type filter | --platform-id, --start-date, --end-date |
| `analytics:facebook-impressions` | Facebook page impressions over time | --platform-id, --start-date, --end-date |
| `analytics:facebook-overview-top-posts` | Facebook top posts (overview widget) | --platform-id, --start-date, --end-date |
| `analytics:facebook-publishing-behaviour` | Facebook engagement by impression type over time | --platform-id, --start-date, --end-date |
| `analytics:facebook-reels` | Facebook Reels performance over time | --platform-id, --start-date, --end-date |
| `analytics:facebook-single-post` | Get a single Facebook post by ID | --platform-id, --post-id |
| `analytics:facebook-summary` | Facebook summary KPIs — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:facebook-video-insights` | Facebook video view time and plays over time | --platform-id, --start-date, --end-date |

**Instagram (15)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:instagram-active-users` | Instagram active users by hour and day of week | --platform-id, --start-date, --end-date |
| `analytics:instagram-ai-insights` | Instagram AI-generated insights | --platform-id, --start-date, --end-date |
| `analytics:instagram-audience-growth` | Instagram follower growth over time | --platform-id, --start-date, --end-date |
| `analytics:instagram-country-city` | Instagram audience country / city breakdown | --platform-id, --start-date, --end-date |
| `analytics:instagram-demographics-age` | Instagram audience age / gender breakdown | --platform-id, --start-date, --end-date |
| `analytics:instagram-engagement` | Instagram post engagement over time | --platform-id, --start-date, --end-date |
| `analytics:instagram-get-top-posts` | Instagram top posts with hashtag filter | --platform-id, --start-date, --end-date |
| `analytics:instagram-hashtags` | Instagram top hashtags by engagement | --platform-id, --start-date, --end-date |
| `analytics:instagram-impressions` | Instagram post impressions over time | --platform-id, --start-date, --end-date |
| `analytics:instagram-publishing-behaviour` | Instagram post engagement by media type over time | --platform-id, --start-date, --end-date |
| `analytics:instagram-reels-performance` | Instagram Reels engagement and watch time over time | --platform-id, --start-date, --end-date |
| `analytics:instagram-single-post` | Get a single Instagram post by ID | --platform-id, --post-id |
| `analytics:instagram-stories-performance` | Instagram stories impressions, reach, and interactions over time | --platform-id, --start-date, --end-date |
| `analytics:instagram-summary` | Instagram summary KPIs — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:instagram-top-posts` | Instagram top-performing posts | --platform-id, --start-date, --end-date |

**YouTube (20)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:youtube-ai-insights` | YouTube AI-generated insights | --platform-id, --start-date, --end-date |
| `analytics:youtube-demographics` | YouTube audience demographics — age & gender, device type, subscriber change | --platform-id, --start-date, --end-date |
| `analytics:youtube-engagement-trend` | YouTube cumulative engagement trend over time | --platform-id, --start-date, --end-date |
| `analytics:youtube-engagement-trend-daily` | YouTube daily-delta engagement trend | --platform-id, --start-date, --end-date |
| `analytics:youtube-find-video` | YouTube traffic source breakdown (how viewers found videos) | --platform-id, --start-date, --end-date |
| `analytics:youtube-least-posts` | YouTube least-performing videos ordered by views and engagement | --platform-id, --start-date, --end-date |
| `analytics:youtube-performance-schedule` | YouTube video performance metrics grouped by publish date | --platform-id, --start-date, --end-date |
| `analytics:youtube-publishing-behaviour` | YouTube posts published over time and content-type breakdown | --platform-id, --start-date, --end-date |
| `analytics:youtube-single-video` | Get a single YouTube video by ID | --platform-id, --post-id |
| `analytics:youtube-sorted-top-posts` | YouTube videos sorted by a configurable metric | --platform-id, --start-date, --end-date |
| `analytics:youtube-subscriber-trend` | YouTube cumulative subscriber trend over time | --platform-id, --start-date, --end-date |
| `analytics:youtube-subscriber-trend-daily` | YouTube daily-delta subscriber trend | --platform-id, --start-date, --end-date |
| `analytics:youtube-summary` | YouTube summary KPIs — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:youtube-top-geographies` | YouTube top geographies — countries pre-sorted by views, watch time, view duration and view percentage | --platform-id, --start-date, --end-date |
| `analytics:youtube-top-posts` | YouTube top videos ordered by views and engagement | --platform-id, --start-date, --end-date |
| `analytics:youtube-video-sharing` | YouTube sharing platform breakdown | --platform-id, --start-date, --end-date |
| `analytics:youtube-views-trend` | YouTube cumulative views split by subscriber / non-subscriber | --platform-id, --start-date, --end-date |
| `analytics:youtube-views-trend-daily` | YouTube daily-delta views trend | --platform-id, --start-date, --end-date |
| `analytics:youtube-watch-time-trend` | YouTube cumulative watch time split by subscriber / non-subscriber | --platform-id, --start-date, --end-date |
| `analytics:youtube-watch-time-trend-daily` | YouTube daily-delta watch time trend | --platform-id, --start-date, --end-date |

**Pinterest (14)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:pinterest-ai-insights` | Pinterest AI-generated insights | --platform-id, --start-date, --end-date |
| `analytics:pinterest-engagement-trend` | Pinterest cumulative engagement trend over time | --platform-id, --start-date, --end-date |
| `analytics:pinterest-engagement-trend-daily` | Pinterest daily-delta engagement trend | --platform-id, --start-date, --end-date |
| `analytics:pinterest-follower-trend` | Pinterest cumulative follower trend over time | --platform-id, --start-date, --end-date |
| `analytics:pinterest-follower-trend-daily` | Pinterest daily-delta follower trend | --platform-id, --start-date, --end-date |
| `analytics:pinterest-impressions-trend` | Pinterest cumulative impressions trend over time | --platform-id, --start-date, --end-date |
| `analytics:pinterest-impressions-trend-daily` | Pinterest daily-delta impressions trend | --platform-id, --start-date, --end-date |
| `analytics:pinterest-pin-performance` | Pinterest pin performance metrics over time | --platform-id, --start-date, --end-date |
| `analytics:pinterest-pin-posting` | Pinterest cumulative pin posting activity over time | --platform-id, --start-date, --end-date |
| `analytics:pinterest-pin-posting-daily` | Pinterest daily-delta pin posting activity | --platform-id, --start-date, --end-date |
| `analytics:pinterest-pin-rollup` | Pinterest pin performance rollup — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:pinterest-single-pin` | Get a single Pinterest pin by ID | --platform-id, --post-id |
| `analytics:pinterest-summary` | Pinterest summary KPIs — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:pinterest-top-pins` | Pinterest top-performing and least-performing pins | --platform-id, --start-date, --end-date |

**LinkedIn (11)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:linkedin-ai-insights` | LinkedIn AI-generated insights | --platform-id, --start-date, --end-date |
| `analytics:linkedin-audience-growth` | LinkedIn follower growth over time | --platform-id, --start-date, --end-date |
| `analytics:linkedin-followers-demographics` | LinkedIn follower demographics by industry, country, and other dimensions | --platform-id, --start-date, --end-date |
| `analytics:linkedin-get-top-posts` | LinkedIn top posts with hashtag and media type filter | --platform-id, --start-date, --end-date |
| `analytics:linkedin-hashtags` | LinkedIn top hashtags by engagement | --platform-id, --start-date, --end-date |
| `analytics:linkedin-page-views` | LinkedIn page views over time (desktop vs mobile) | --platform-id, --start-date, --end-date |
| `analytics:linkedin-posts-per-days` | LinkedIn post count distribution by day of week | --platform-id, --start-date, --end-date |
| `analytics:linkedin-publishing-behaviour` | LinkedIn post engagement by media type over time | --platform-id, --start-date, --end-date |
| `analytics:linkedin-single-post` | Get a single LinkedIn post by ID | --platform-id, --post-id |
| `analytics:linkedin-summary` | LinkedIn summary KPIs — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:linkedin-top-posts` | LinkedIn top-performing posts | --platform-id, --start-date, --end-date |

**Google Business Profile (GMB) (10)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:gmb-actions` | GMB customer actions (clicks, calls, directions) over time | --platform-id, --start-date, --end-date |
| `analytics:gmb-ai-insights` | GMB AI-generated insights | --platform-id, --start-date, --end-date |
| `analytics:gmb-impressions` | GMB impressions breakdown by channel and device over time | --platform-id, --start-date, --end-date |
| `analytics:gmb-media-activity` | GMB media (photo/video) activity over time | --platform-id, --start-date, --end-date |
| `analytics:gmb-publishing-behavior` | GMB posts published over time and topic-type breakdown | --platform-id, --start-date, --end-date |
| `analytics:gmb-reviews` | GMB reviews — ratings, distribution, and daily activity | --platform-id, --start-date, --end-date |
| `analytics:gmb-search-keywords` | GMB top search keywords that surfaced the listing | --platform-id, --start-date, --end-date |
| `analytics:gmb-single-post` | Get a single GMB post by ID | --platform-id, --post-id |
| `analytics:gmb-summary` | GMB summary KPIs — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:gmb-top-posts` | GMB top-performing posts | --platform-id, --start-date, --end-date |

**TikTok (8)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:tiktok-ai-insights` | TikTok AI-generated insights | --platform-id, --start-date, --end-date |
| `analytics:tiktok-engagement-trend` | TikTok daily engagement trend over time | --platform-id, --start-date, --end-date |
| `analytics:tiktok-follower-trend` | TikTok follower and views trend over time | --platform-id, --start-date, --end-date |
| `analytics:tiktok-publishing-behaviour` | TikTok daily post volume and engagement breakdown over time | --platform-id, --start-date, --end-date |
| `analytics:tiktok-single-post` | Get a single TikTok post by ID | --platform-id, --post-id |
| `analytics:tiktok-sorted-top-posts` | TikTok posts sorted by a configurable metric | --platform-id, --start-date, --end-date |
| `analytics:tiktok-summary` | TikTok summary KPIs — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:tiktok-top-posts` | TikTok top and least performing posts | --platform-id, --start-date, --end-date |

**Twitter/X (7)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:twitter-credits-used` | Twitter API credits usage for the workspace | --platform-id, --start-date, --end-date |
| `analytics:twitter-engagement-impression` | Twitter engagement and impression trend over time | --platform-id, --start-date, --end-date |
| `analytics:twitter-followers-trend` | Twitter follower trend over time | --platform-id, --start-date, --end-date |
| `analytics:twitter-least-tweets` | Twitter least-performing tweets | --platform-id, --start-date, --end-date |
| `analytics:twitter-single-tweet` | Get a single Twitter/X tweet by ID | --platform-id, --post-id |
| `analytics:twitter-summary` | Twitter summary KPIs — current vs previous period | --platform-id, --start-date, --end-date |
| `analytics:twitter-top-tweets` | Twitter top-performing tweets | --platform-id, --start-date, --end-date |

**Meta Ads (11)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:meta-ads-accounts` | List connected Meta ad accounts | — |
| `analytics:meta-ads-ad-sets` | Ad sets with per-ad-set metrics | --account-id, --start-date, --end-date |
| `analytics:meta-ads-ads` | Ads with per-ad metrics and creative details | --account-id, --start-date, --end-date |
| `analytics:meta-ads-ai-insights` | AI-generated insights for an ad account | --account-id, --start-date, --end-date, --type |
| `analytics:meta-ads-campaigns` | Campaigns with per-campaign metrics | --account-id, --start-date, --end-date |
| `analytics:meta-ads-demographics` | Audience breakdown by age and gender, region or country | --account-id, --start-date, --end-date |
| `analytics:meta-ads-performance-by-level` | One metric broken down by campaign, ad set or ad | --account-id, --start-date, --end-date |
| `analytics:meta-ads-performance-by-placement` | One metric broken down by publisher platform and placement | --account-id, --start-date, --end-date |
| `analytics:meta-ads-performance-over-time` | Daily time series for one or more metrics | --account-id, --start-date, --end-date |
| `analytics:meta-ads-results-by-objective` | Results and spend grouped by campaign objective | --account-id, --start-date, --end-date |
| `analytics:meta-ads-summary` | Meta Ads headline KPIs — current vs previous period | --account-id, --start-date, --end-date |

**Google Ads (17)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:google-ads-accounts` | List connected Google Ads accounts | — |
| `analytics:google-ads-ad-groups` | Ad groups with per-ad-group metrics | --account-id, --start-date, --end-date |
| `analytics:google-ads-ads` | Ads with per-ad metrics | --account-id, --start-date, --end-date |
| `analytics:google-ads-ai-insights` | AI-generated insights for an ad account | --account-id, --start-date, --end-date, --type |
| `analytics:google-ads-campaigns` | Campaigns with per-campaign metrics | --account-id, --start-date, --end-date |
| `analytics:google-ads-conversion-actions` | Conversion actions configured on the account | --account-id, --start-date, --end-date |
| `analytics:google-ads-conversion-funnel` | Conversion funnel — impressions through to conversions | --account-id, --start-date, --end-date |
| `analytics:google-ads-conversions-by-action` | Conversions grouped by conversion action | --account-id, --start-date, --end-date |
| `analytics:google-ads-conversions-over-time` | Conversions over time | --account-id, --start-date, --end-date |
| `analytics:google-ads-demographics` | Audience breakdown by age, gender and location | --account-id, --start-date, --end-date |
| `analytics:google-ads-keywords` | Keywords with per-keyword metrics | --account-id, --start-date, --end-date |
| `analytics:google-ads-performance-by-level` | One metric broken down by campaign, ad group or ad | --account-id, --start-date, --end-date |
| `analytics:google-ads-performance-by-type` | One metric broken down by campaign type | --account-id, --start-date, --end-date |
| `analytics:google-ads-performance-over-time` | Daily time series for one or more metrics | --account-id, --start-date, --end-date |
| `analytics:google-ads-search-terms` | Search terms with per-term metrics | --account-id, --start-date, --end-date |
| `analytics:google-ads-shopping` | Shopping campaign product performance | --account-id, --start-date, --end-date |
| `analytics:google-ads-summary` | Google Ads headline KPIs — current vs previous period | --account-id, --start-date, --end-date |

**Campaigns & Labels (5)**

| Command | Purpose | Required |
|---------|---------|----------|
| `analytics:campaigns-labels-breakdown` | Per-campaign and per-label totals, current vs previous period | --start-date, --end-date |
| `analytics:campaigns-labels-insights-breakdown` | Daily time series per campaign and per label | --start-date, --end-date |
| `analytics:campaigns-labels-posts` | Per-post table for the selected campaigns & labels | --start-date, --end-date |
| `analytics:campaigns-labels-summary` | Campaign & label summary KPIs — current vs previous period | --start-date, --end-date |
| `analytics:campaigns-labels-top-posts` | Top 5 posts per network for the selected campaigns & labels | --start-date, --end-date |

### Analytics: reports, schedules, share links

Reporting is asynchronous. `reports:generate` returns an id straight away and
the work happens elsewhere, so never treat the create response as a finished
report — poll `reports:get <id> --wait`, or pass `--callback-url` to be told
instead of asking. A report is done when `status` is `completed` and
`export_url` is populated; `failed` is terminal too, and `reports:retry` re-runs
it from the stored definition without rebuilding the request.

Start from `reports:options` rather than guessing: it returns the report types
this workspace can build and the sections each one accepts, and it is the same
catalogue the product's own section selector reads.

**Share links are how a client sees a report without an account.** Create one
with `share-links:create`; `--password` protects it, `--date-range` pins the
period so the numbers stop moving, and omitting the range leaves it rolling.
There is no expiry — a link lives until you disable or delete it, so prefer
`share-links:disable` (reversible) over `share-links:delete` when a client
engagement pauses. A share link is independent of any generated report: it shows
the live dashboard, not a PDF.

`report-schedules:run` asks for an immediate send, but the API acknowledges the
request without returning a report id. Confirm with `report-schedules:get` and
check `last_run_at` moved before telling the user the report went out.

### Analytics: competitors

Two different things share the word "report". A **competitor report** is a saved
*set* of competitors to benchmark against — it has no status and produces no
file. The comparison numbers are read separately, with `competitors:compare`.

Provisioning order matters: `competitors:search` first, because a competitor is
an object (`competitor_id` plus `name`), not a bare id. `competitor-reports:create`
accepts the shorthand `--competitors 'id:Name,id:Name'` or a JSON array, and
expands it for you.

A page that cannot be tracked comes back as an empty result with a `reason` —
that is a successful read, not an error. Tell the user which page could not be
tracked and why, rather than reporting a failure.

`competitor-reports:update` **replaces** the set, so send every competitor you
want to keep, not just the new one.

When reading comparisons, respect each row's `state`. Only `Processed` means a
complete measurement for the period — a competitor in any other state has zeros
that mean *not measured*, not *zero engagement*. Never present those as a result.

---

## Examples

### Verify the stored key is valid

```bash
contentstudio --json auth:whoami
# → {"ok": true, "data": {"id": "...", "email": "...", "full_name": "..."}}
```

### Find a Facebook account to post to

```bash
contentstudio --json accounts:list --platform facebook --per-page 10
# Pick an _id, e.g. <account_id>
```

### Post-creation examples

Always preview a mutating post with `--dry-run` first — it returns `{"ok": true, "data": {"dry_run": true, "endpoint": "...", "body": {...}}}` and never touches the API. Drop `--dry-run` to actually create.

**1. Plain text draft**

```bash
contentstudio --json posts:create \
  -c "Our new blog is live!" \
  -i <account_id> \
  -t draft
```

**2. Text + single image, scheduled with a date**

```bash
contentstudio --json posts:create \
  -c "Our new blog is live! https://example.com/post" \
  -i <account_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  -m https://example.com/hero.jpg
```

**3. Text + multiple images** (repeat `-m`)

```bash
contentstudio --json posts:create \
  -c "Gallery drop 📸" \
  -i <account_id> \
  -t scheduled \
  -s "2026-05-02 09:00:00" \
  -m https://example.com/1.jpg \
  -m https://example.com/2.jpg \
  -m https://example.com/3.jpg
```

**4. Text + video**

```bash
contentstudio --json posts:create \
  -c "Watch our launch reel 🎬" \
  -i <account_id> \
  -t scheduled \
  -s "2026-05-03 12:00:00" \
  --video-url https://example.com/launch.mp4
```

**5. Queued post** (goes into the publishing queue; no explicit time)

```bash
contentstudio --json posts:create \
  -c "Filler post for the queue" \
  -i <account_id> \
  -t queued
```

**6. Content-category post** (accounts come from the category — NO `--account`)

```bash
# Find a category id first:
contentstudio --json categories:list
# --content-category-id is required for -t content_category:
contentstudio --json posts:create \
  -c "Evergreen tip of the day" \
  -t content_category \
  --content-category-id <category_id>
```

**7. Post with an approval workflow** (two approvers, all must approve)

```bash
contentstudio --json posts:create \
  -c "Quarterly results announcement" \
  -i <account_id> \
  -t scheduled \
  -s "2026-05-05 08:00:00" \
  --approver <user_id_1> \
  --approver <user_id_2> \
  --approve-option everyone \
  --approval-notes "Legal + comms must both sign off"
```

**8. Post with labels and a campaign** (repeat `--label`)

```bash
contentstudio --json posts:create \
  -c "Spring sale kickoff" \
  -i <account_id> \
  -t scheduled \
  -s "2026-05-06 10:00:00" \
  --label <label_id_1> \
  --label <label_id_2> \
  --campaign-id <campaign_id>
```

**9. Facebook colored-background text post** (plain text, no media)

```bash
# Get a valid background id first:
contentstudio --json facebook:text-backgrounds
contentstudio --json posts:create \
  -c "Big news coming soon!" \
  -i <facebook_account_id> \
  -t draft \
  --facebook-background-id <background_id>
```

**10. Facebook CAROUSEL** (Facebook only; 2–10 cards) — preview then create

```bash
# Preview:
contentstudio --json posts:create --dry-run \
  -c "Shop the new collection" \
  -i <facebook_account_id> \
  -t scheduled \
  -s "2026-07-01 10:00:00" \
  --facebook-carousel '{"cards":[{"image":"https://e.com/1.jpg","link":"https://e.com/p1","title":"Tee","description":"100% cotton"},{"image":"https://e.com/2.jpg","link":"https://e.com/p2","title":"Hoodie"},{"image":"https://e.com/3.jpg","link":"https://e.com/p3","title":"Cap"}],"call_to_action":"SHOP_NOW","end_card":true,"end_card_url":"https://e.com/shop"}'
# Drop --dry-run to create. The CLI adds "is_carousel_post": true.
```

A carousel and a colored-background text post (`--facebook-background-id`, example 9) are two different Facebook formats — use one or the other, not both in the same post. The FB account ID goes in `-i / --account`.

**11. Threads multi-thread** (Threads only; max 10 chained items) — preview then create

```bash
contentstudio --json posts:create --dry-run \
  -c "🧵 A thread on shipping CLIs" \
  -i <threads_account_id> \
  -t draft \
  --threads '[{"message":"1/ Start small."},{"message":"2/ Ship a demo.","media":["https://e.com/demo.mp4"]},{"message":"3/ Iterate in public."}]'
# Drop --dry-run to create. The CLI adds "has_multi_threads": true.
```

The top-level `-c / --content` is the lead post; each `--threads` item is a chained reply, in order. Don't repeat the lead text in the items (number them `1/`, `2/`, … as the continuation). Each item needs `message` or `media`.

**12. Post with a first comment** (auto-posted comment after publish; e.g. "link in bio") — preview then create

```bash
contentstudio --json posts:create --dry-run \
  -c "New drop is live 🎉" \
  -i <account_id> \
  -t draft \
  --first-comment "🔗 link in bio" \
  --first-comment-account <account_id>
# Drop --dry-run to create. --first-comment-account is REQUIRED by the backend
# and must be a subset of the -i / --account IDs, else the API returns a 422.
```

**13. Twitter/X threaded tweets** (Twitter only; max 10 tweets) — preview then create

```bash
contentstudio --json posts:create --dry-run \
  -c "Why we built a CLI 🧵" \
  -i <twitter_account_id> \
  -t draft \
  --twitter '[{"message":"1/ Start with the contract."},{"message":"2/ Show, don'\''t tell.","media":["https://e.com/x.jpg"]},{"message":"3/ Ship it."}]'
# Drop --dry-run to create. The CLI adds "has_threaded_tweets": true.
# Twitter rule: no mixed media in one tweet (no images+video together), max 1 video per tweet.
```

The top-level `-c / --content` is the lead tweet; each `--twitter` item is a follow-up tweet in the chain, in order. Don't repeat the lead text in the items (number the items `1/`, `2/`, … as the continuation). Each item needs `message` or `media`. The Twitter account ID goes in `-i / --account`.

**14. Full-control body via `--body <file.json>`** (any field the shortcut flags don't cover)

Use `--body` when you need fields beyond the shortcut flags (per-platform `platform_overrides`, `twitter_options`/`threads_options`, `timezone`, `hide_client`, etc.). The JSON is sent verbatim, so build it for the platform(s) your `accounts` belong to — a Facebook-carousel body, a Threads body, and a Twitter body are separate posts, not one combined payload.

```jsonc
// /tmp/post.json — a Facebook carousel via the full body schema
{
  "content": { "text": "Shop the collection" },
  "accounts": ["<facebook_account_id>"],
  "scheduling": { "publish_type": "scheduled", "scheduled_at": "2026-07-01 10:00:00" },
  "facebook_options": {
    "carousel": {
      "is_carousel_post": true,
      "cards": [
        { "image": "https://e.com/1.jpg", "link": "https://e.com/p1", "title": "Tee" },
        { "image": "https://e.com/2.jpg", "link": "https://e.com/p2", "title": "Hoodie" }
      ],
      "call_to_action": "SHOP_NOW",
      "end_card": true,
      "end_card_url": "https://e.com/shop"
    }
  },
  "labels": ["<label_id>"],
  "campaign_id": "<campaign_id>",
  "approval": { "approvers": ["<user_id>"], "approve_option": "anyone", "notes": "please review" }
}
```

```bash
contentstudio --json posts:create --body /tmp/post.json
```

For a Threads or Twitter/X thread, use a body with that account and the matching block instead — e.g. `{ "content": {...}, "accounts": ["<threads_account_id>"], "scheduling": {...}, "threads_options": { "has_multi_threads": true, "multi_threads": [...] } }` (or `twitter_options.threaded_tweets` for Twitter/X).

### Schedule a post at the best time

```bash
# 1. Ask for the best slots. Omit --account for every connected account.
contentstudio --json scheduling:best-times --global-slots 3
# → data.meta.timezone            e.g. "Asia/Karachi"
#   data.global.top_recommendations[0]  {rank: 1, day: "Wednesday",
#                                        date: "2026-08-19", time: "14", score: 100}
#   data.meta.missing_entities     accounts with too little history (skipped)

# 2. Narrow it to the account you're actually posting to.
#    <platform>:<account_id> — both from one accounts:list row.
contentstudio --json scheduling:best-times \
  --account facebook:<account_id> --per-account-slots 3

# 3. Show the user the ranked slots and let them pick. Then schedule at that
#    slot's date + hour AS-IS — the times are already workspace-local, so
#    converting to UTC would move the post.
contentstudio --json posts:create \
  -c "Launch day is here." \
  -i <account_id> \
  -t scheduled \
  -s "2026-08-19 14:00:00" \
  --dry-run

# 4. Drop --dry-run once the user approves the time and the text.
```

If `data.global` is `null`, the workspace has too little history — don't report an
error. Say which accounts were skipped (`meta.missing_entities`) and offer to
schedule at a time the user chooses instead.

### List recent draft posts

```bash
contentstudio --json posts:list --status draft --per-page 5
```

### Delete a post (and from social)

```bash
contentstudio --json posts:delete <post_id> --delete-from-social
```

### Add an internal note on a post (private)

```bash
contentstudio --json comments:add <post_id> "Double-check the link" --note
```

### Override workspace for a single call

```bash
contentstudio --json --workspace <other_ws_id> posts:list --per-page 3
```

### Triage the inbox: find unanswered DMs and reply to one

```bash
# 1. Cheap check first — is there anything to do?
contentstudio --json inbox:summary

# 2. List open conversations
contentstudio --json inbox:list --type conversation --action all --limit 20
# → per row: element_ref, platform, platform_id,
#            element_details.element_id  ← THIS is the conversation id

# 3. Read the thread. Use element_details.element_id (looks like t_1234...),
#    NOT element_ref — element_ref here returns an empty list.
contentstudio --json inbox:messages t_10000000000000001 --sort-order desc --limit 10

# 4. Find the account that owns the thread (gives you --platform-id)
contentstudio --json accounts:list --platform facebook

# 5. Preview the reply — ALWAYS do this, and show the text to the user
contentstudio --json inbox:send <conversation_id> \
  --platform-type facebook \
  --platform-id <account_id> \
  --message "Hi! Your order shipped this morning — tracking is on the way." \
  --dry-run

# 6. Only after the user approves, drop --dry-run
```

### Reply to a comment, then hide a spam one

```bash
# Threaded reply. <post_id> is element_details.post_id, not element_ref.
contentstudio --json inbox:comment-add <post_id> \
  --platform-type facebook --platform-id <account_id> \
  --comment-id <comment_id> \
  --message "Thanks for the kind words!" --dry-run

# Hide spam rather than deleting it (reversible)
contentstudio --json inbox:comment-hide <comment_id> --dry-run
```

### Clear a batch of conversations

```bash
contentstudio --json inbox:update \
  --element <element_ref_1> --element <element_ref_2> \
  --status done --dry-run
```

### Tag a conversation for follow-up

```bash
contentstudio --json inbox:tags                       # find or create a tag id
contentstudio --json inbox:tag-attach <element_ref> \
  --tag <tag_id> --platform-id <account_id> --inbox-type conversation --dry-run
```

---

## Error handling

| `error.type` | `http_status` | Typical hint |
|--------------|---------------|--------------|
| `AuthError` | 401, 403 | Run `auth:login` with a valid key. |
| `NotFoundError` | 404 | The resource doesn't exist or isn't in this workspace. |
| `ValidationError` | 422 | Flattened Laravel-style field errors from the API. |
| `ConflictError` | 409 | Resource already exists, or a send's delivery outcome is undetermined. Verify before retrying a send. |
| `RateLimitError` | 429 | Wait a moment and retry. |
| `BackendError` | 5xx or network | Retry after a short backoff. |
| `ConfigError` | — (local) | Missing API key / workspace; run `auth:login` or pass flags. |

---

## When NOT to use this skill

- The user is asking about running their own ContentStudio backend (Laravel source); this CLI only talks to the deployed API.
- Tasks not exposed by the v1 API (e.g., billing changes, first-time social account connection — those happen in the ContentStudio web UI).

---

The authoritative version for this skill is the `version:` field in the
frontmatter at the top of this file.

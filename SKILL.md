---
name: contentstudio
description: ContentStudio is a tool to schedule social-media posts across Facebook, LinkedIn, Twitter/X, Instagram, YouTube, TikTok, Pinterest, and Google Business Profile. Use when the user wants to list/create/delete/approve posts, manage media, or audit workspaces, accounts, campaigns, labels, categories, or team-members on their ContentStudio account.
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

If `has_api_key` is `false`, ask the user for their ContentStudio API key. They can generate one from **ContentStudio Dashboard → Settings → API Keys**. Then:

```bash
contentstudio auth:login --api-key cs_...
```

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

But for any **mutating** action — `accounts:connect`, `accounts:add-bluesky`, `accounts:add-facebook-group`, `posts:create`, `posts:delete`, `posts:approve`, `posts:reject`, `comments:add`, `media:upload`, `workspaces:update`, `workspaces:delete`, `labels:create`, `labels:update`, `labels:delete`, `campaigns:create`, `campaigns:update`, `campaigns:delete`, `team:add`, `team:update`, `team:remove` — you MUST confirm the workspace with the user first, even if a workspace is already active. Don't assume the active workspace is the one they want to mutate.

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
`workspaces:list`, `accounts:list`, `posts:list`, `comments:list`, `media:list`, `campaigns:list`, `categories:list`, `labels:list`, `team:list`.

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
| `posts:create --body /path/to/body.json` | Create a post with full JSON body |
| `posts:delete <post_id> [--delete-from-social]` | Delete a post |
| `posts:approve <post_id> [--comment "..."]` | Approve a pending post |
| `posts:reject <post_id> [--comment "..."]` | Reject a pending post |

`-t / --publish-type` values: `scheduled`, `draft`, `queued`, `content_category`.

**`posts:create` shortcut-mode flags:**
- `-c / --content` (required) — post text.
- `-i / --account <id>` (repeatable) — account ID(s) to post to. **Required UNLESS `--content-category-id` is given.**
- `--content-category-id <id>` — sets top-level `content_category_id`. **Required by the backend when `--publish-type content_category`.** When set, accounts are derived from the category, so `--account` is not required (and may be omitted). Use this instead of `--account` for content-category posts.
- `-s / --scheduled-at "YYYY-MM-DD HH:MM:SS"` — scheduling time (UTC). The CLI normalizes any parseable date to `YYYY-MM-DD HH:MM:SS` (the backend's required `date_format`).
- `-m / --image-url <url>` (repeatable), `--video-url <url>`, `--media-id <id>` (repeatable) — media.
- `--post-type <type>` — e.g. `feed`, `reel`, `carousel`, `story`, …
- `--label <id>` (repeatable, max 20) → `labels`.
- `--campaign-id <id>` → `campaign_id`.
- `--approver <user_id>` (repeatable) + `--approve-option anyone|everyone` (default `anyone`) + `--approval-notes "..."` → builds `approval: {approvers, approve_option, notes}` only when at least one approver is given. The post creator cannot be an approver. `anyone` = any single approver; `everyone` = all must approve.
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

(`--facebook-carousel`, `--threads`, and `--twitter` only apply in shortcut mode. The `--body` JSON mode already supports `facebook_options.carousel`, `threads_options`, `twitter_options`, and `first_comment` natively — use it for posts that mix multiple platform option blocks.)

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

- `member_id` is the **membership id** — the `_id` / `member_id` field from `team:list` (not the user_id).
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

### Facebook helpers

| Command | Purpose |
|---------|---------|
| `facebook:text-backgrounds` | List Facebook colored-background presets (use `id` as `facebook_options.facebook_background_id` on plain-text posts) |

---

## Examples

### Verify the stored key is valid

```bash
contentstudio --json auth:whoami
# → {"ok": true, "data": {"_id": "...", "email": "...", "full_name": "..."}}
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

Use `--body` when you need fields beyond the shortcut flags (per-platform `overrides`, `twitter_options`/`threads_options`, `timezone`, `hide_client`, etc.). The JSON is sent verbatim, so build it for the platform(s) your `accounts` belong to — a Facebook-carousel body, a Threads body, and a Twitter body are separate posts, not one combined payload.

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

---

## Error handling

| `error.type` | `http_status` | Typical hint |
|--------------|---------------|--------------|
| `AuthError` | 401, 403 | Run `auth:login` with a valid key. |
| `NotFoundError` | 404 | The resource doesn't exist or isn't in this workspace. |
| `ValidationError` | 422 | Flattened Laravel-style field errors from the API. |
| `RateLimitError` | 429 | Wait a moment and retry. |
| `BackendError` | 5xx or network | Retry after a short backoff. |
| `ConfigError` | — (local) | Missing API key / workspace; run `auth:login` or pass flags. |

---

## When NOT to use this skill

- The user is asking about running their own ContentStudio backend (Laravel source); this CLI only talks to the deployed API.
- Tasks not exposed by the v1 API (e.g., billing changes, first-time social account connection — those happen in the ContentStudio web UI).

---

## Version

1.0.0

---
name: contentstudio
description: ContentStudio is a tool to schedule social-media posts across Facebook, LinkedIn, Twitter/X, Instagram, YouTube, TikTok, Pinterest, and Google Business Profile. Use when the user wants to list/create/delete/approve posts, manage media, or audit workspaces, accounts, campaigns, labels, categories, or team-members on their ContentStudio account.
version: 1.0.8
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

But for any **mutating** action — `accounts:connect`, `accounts:add-bluesky`, `accounts:add-facebook-group`, `posts:create`, `posts:delete`, `posts:approve`, `posts:reject`, `comments:add`, `media:upload` — you MUST confirm the workspace with the user first, even if a workspace is already active. Don't assume the active workspace is the one they want to mutate.

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
| `posts:create --body /path/to/body.json` | Create a post with full JSON body |
| `posts:delete <post_id> [--delete-from-social]` | Delete a post |
| `posts:approve <post_id> [--comment "..."]` | Approve a pending post |
| `posts:reject <post_id> [--comment "..."]` | Reject a pending post |

`-t / --publish-type` values: `draft`, `scheduled`, `queued`, `content_category`.

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

### Lookup tables

| Command | Purpose |
|---------|---------|
| `campaigns:list` | List campaigns (folders) |
| `categories:list` | List content categories |
| `labels:list` | List labels |
| `team:list` | List workspace team members |

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

### Safely preview a post before creating it

```bash
contentstudio --json posts:create --dry-run \
  -c "Our new blog is live! https://example.com/post" \
  -i <account_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  -m https://example.com/hero.jpg
# Returns: {"ok": true, "data": {"dry_run": true, "endpoint": "...", "body": {...}}}
```

### Actually create the post (drop --dry-run)

```bash
contentstudio --json posts:create \
  -c "Our new blog is live!" \
  -i <account_id> \
  -t draft
```

### Create a post with a complex body (platform options, approval workflow)

Write a JSON body and pass via `--body`:

```jsonc
{
  "content": {
    "text": "Hello world",
    "media": {"images": ["https://example.com/img.jpg"]}
  },
  "accounts": ["<account_id>"],
  "scheduling": {
    "publish_type": "scheduled",
    "scheduled_at": "2026-05-01 10:00:00"
  },
  "first_comment": {"message": "🔗 link in bio", "accounts": ["<account_id>"]},
  "labels": ["<label_id>"],
  "campaign_id": "<campaign_id>",
  "approval": {
    "approvers": ["<user_id>"],
    "approve_option": "anyone",
    "notes": "please review"
  }
}
```

```bash
contentstudio --json posts:create --body /tmp/post.json
```

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

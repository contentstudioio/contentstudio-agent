# contentstudio-cli

[![npm version](https://img.shields.io/npm/v/contentstudio-cli.svg)](https://www.npmjs.com/package/contentstudio-cli)
[![license](https://img.shields.io/npm/l/contentstudio-cli.svg)](./LICENSE)

**Install as a skill:**
```bash
npx skills add contentstudioio/contentstudio-agent
```

ContentStudio CLI — schedule social-media posts, manage media, accounts, comments, and approvals across **Facebook, LinkedIn, Twitter/X, Instagram, YouTube, TikTok, Pinterest, and Google Business Profile** through the [ContentStudio](https://contentstudio.io) public API.

The `contentstudio` CLI provides a command-line interface for developers and AI agents to drive a ContentStudio workspace from the terminal — scheduling posts, uploading media, managing approvals, and auditing accounts/campaigns/labels — using the same API your dashboard does.

## Why use this CLI

- **Drive ContentStudio from anywhere** — bash scripts, CI/CD pipelines, AI agents (Claude Code, Cursor, OpenCode, Codex), n8n workflows, custom automations.
- **JSON output for agents** — every command supports `--json` returning a stable `{"ok": true, "data": ...}` envelope.
- **Dry-run safety** — preview every mutating call before sending it, so AI agents (and humans) never publish by accident.
- **No SaaS lock-in to your CLI tooling** — talks directly to the production ContentStudio API over HTTPS; no proxy, no extra service.

## Installation

### From npm (recommended)

```bash
npm install -g contentstudio-cli
# or
pnpm install -g contentstudio-cli
```

Verify:
```bash
contentstudio --version
contentstudio --help
```

### Install the skill (for AI agents)

If you use an AI assistant (Claude Code, Cursor, OpenCode, Codex, Augment, IBM Bob, etc.), install the SKILL.md so the agent can drive this CLI on your behalf:

```bash
npx skills add contentstudioio/contentstudio-agent
```

Pick which agents to install into in the interactive prompt. The SKILL.md is dropped into each agent's skill directory (e.g. `~/.claude/skills/contentstudio/SKILL.md`).

## Authentication

Authentication uses an **API key** issued from your ContentStudio dashboard.

### Option 1: `auth:login` (persists to local config)

```bash
contentstudio auth:login --api-key cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

This stores your key at `~/.config/contentstudio/config.json` (file mode `0600`, dir `0700`) and verifies it via a `/me` round-trip.

```bash
# Check current auth status (key redacted)
contentstudio auth:status

# Verify the stored key is still valid
contentstudio --json auth:whoami

# Remove stored credentials
contentstudio auth:logout
```

### Option 2: Environment variables

For CI/CD or one-off invocations, set the key in your environment instead of persisting:

```bash
export CONTENTSTUDIO_API_KEY=cs_...
export CONTENTSTUDIO_WORKSPACE_ID=601b773d2149273f48039ec2     # optional
export CONTENTSTUDIO_BASE_URL=https://api.contentstudio.io/api/v1   # optional
```

Env vars **take priority** over the persisted config when both are present.

### Where to get an API key

ContentStudio Dashboard → **Settings → API Keys → Generate new key**.

## Quick Start

```bash
# 1. Auth (once)
contentstudio auth:login --api-key cs_...

# 2. Pick a workspace
contentstudio workspaces:list
contentstudio workspaces:use <workspace_id>

# 3. List the social accounts connected to that workspace
contentstudio accounts:list --platform facebook

# 4. Create a draft post (safe — won't publish to social)
contentstudio posts:create \
  --content "Hello from contentstudio CLI" \
  --account <account_id> \
  --publish-type draft

# 5. Schedule a real post for 2 minutes from now
contentstudio posts:create \
  -c "Hello from automation 👋" \
  -i <account_id> \
  -t scheduled \
  -s "$(date -d '+2 minutes' '+%F %T')" \
  -m https://picsum.photos/400
```

## Discovery & Lookup

### List your workspaces
```bash
contentstudio --json workspaces:list
contentstudio --json workspaces:list --per-page 50
```
Returns workspace IDs, names, slugs, timezones.

### Show / change the active workspace
```bash
contentstudio workspaces:current
contentstudio workspaces:use <workspace_id>
```

### List connected social accounts
```bash
contentstudio --json accounts:list                              # all accounts
contentstudio --json accounts:list --platform facebook          # filter
contentstudio --json accounts:list --search "barcelona"         # search by name
```

`--platform` values: `facebook`, `linkedin`, `twitter`, `instagram`, `youtube`, `tiktok`, `pinterest`, `gmb`.

### Look up campaigns, labels, categories, team members
```bash
contentstudio --json campaigns:list
contentstudio --json categories:list
contentstudio --json labels:list
contentstudio --json team:list
```

All support `--page`, `--per-page`, and `--search` filters.

## Connecting Social Accounts

Three ways to add new accounts to a workspace, depending on the platform.

### List which platforms are connectable

```bash
contentstudio --json platforms:list
```

Returns all 12+ supported platforms with their `connection_method` (`oauth`, `credentials`, or `manual`) and the endpoint to call.

### OAuth platforms (Facebook, LinkedIn, Twitter, Instagram, YouTube, TikTok, Pinterest, GMB, Threads, Tumblr)

```bash
contentstudio --json accounts:connect facebook
# Returns a one-time authorization_url — open it in your browser to authorize.
```

To **reconnect** an existing account that's expired or invalid:
```bash
contentstudio --json accounts:connect facebook --reconnect --account-id <existing_account_id>
```

Available `<platform>` values: `facebook`, `facebook-profile`, `instagram`, `instagram-via-facebook`, `twitter`, `linkedin`, `pinterest`, `tiktok`, `youtube`, `threads`, `gmb`, `tumblr`.

### Bluesky (credential-based, no browser)

Generate an app password at <https://bsky.app/settings/app-passwords> first, then:

```bash
contentstudio --json accounts:add-bluesky \
  --handle yourname.bsky.social \
  --app-password xxxx-xxxx-xxxx-xxxx
```

⚠️ Use the Bluesky **app password**, NOT your main account password. The CLI redacts it from `--dry-run` output but it's still sent to ContentStudio's API over HTTPS.

### Facebook Groups (manual)

```bash
contentstudio --json accounts:add-facebook-group \
  --name "My Community Group" \
  --image https://example.com/group-cover.jpg
```

The image URL is optional.

All three connect commands support `--dry-run` to preview the payload without calling the API.

## Creating Posts

There are two ways to create a post: **shortcut flags** for simple cases, or **`--body <file.json>`** for the full schema.

### Shortcut flags (simple posts)

```bash
# Scheduled post to a Facebook page with one image
contentstudio posts:create \
  -c "Our latest blog post is live!" \
  -i <account_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  -m https://example.com/hero.jpg
```

Options:

| Flag | Purpose |
|------|---------|
| `-c`, `--content` | Post text |
| `-i`, `--account` | Social account ID. Repeatable for multi-account posts. |
| `-t`, `--publish-type` | `scheduled` \| `draft` \| `queued` \| `content_category` |
| `-s`, `--scheduled-at` | Schedule date `"YYYY-MM-DD HH:MM:SS"` |
| `-m`, `--image-url` | External image URL. Repeatable. |
| `--video-url` | External video URL |
| `--media-id` | ID of media in your library (from `media:list`). Repeatable. |
| `--post-type` | `feed` \| `reel` \| `story` \| `feed+reel` \| `feed+story` \| `feed+reel+story` \| `carousel` \| `carousel+story` \| `video` \| `shorts` |
| `--facebook-carousel '<json>'` | Facebook carousel (Facebook accounts only): JSON object `{cards:[{image,link,title?,description?}], call_to_action?, end_card?, end_card_url?, accounts?}`. 2–10 cards. CLI adds `is_carousel_post:true`. |
| `--threads '<json>'` | Threads multi-thread (Threads accounts only): JSON array `[{message, media?, media_ids?}]`. Max 10 items. CLI adds `has_multi_threads:true`. |
| `--twitter '<json>'` | Twitter/X threaded tweets (Twitter accounts only): JSON array `[{message, media?, media_ids?}]`. Max 10 tweets. CLI adds `has_threaded_tweets:true`. No mixed media per tweet (no images+video together), max 1 video per tweet. |
| `--first-comment "<message>"` | First comment (≤2000 chars). Build `first_comment:{message, accounts?}`. Requires `--first-comment-account`. |
| `--first-comment-account <id>` | Account for the first comment. Repeatable. Must be a subset of `--account`; backend 422s if omitted when `--first-comment` is set. |
| `--dry-run` | Print the body that would be POSTed and exit (no API call) |

### Multi-account post

Repeat `-i` for each account:
```bash
contentstudio posts:create \
  -c "Cross-platform announcement 🚀" \
  -i <facebook_id> \
  -i <linkedin_id> \
  -i <twitter_id> \
  -t scheduled \
  -s "2026-05-01 09:00:00"
```

### Use existing media library assets

```bash
# Find a media ID
contentstudio --json media:list --type images

# Reference it by ID instead of URL
contentstudio posts:create \
  -c "Post with library asset" \
  -i <account_id> \
  -t draft \
  --media-id <media_library_id>
```

### Queued post (added to the publishing queue; no explicit time)

```bash
contentstudio posts:create \
  -c "Filler post for the queue" \
  -i <account_id> \
  -t queued
```

`scheduled_at` is optional for `queued` — the backend slots it into the workspace queue automatically.

### Content-category post (accounts come from the category — no `-i`)

```bash
# Find a category id first:
contentstudio --json categories:list

# --content-category-id is required for -t content_category; accounts are derived from the category:
contentstudio posts:create \
  -c "Evergreen tip of the day" \
  -t content_category \
  --content-category-id <category_id>
```

### Facebook carousel (2–10 cards, Facebook accounts only)

```bash
contentstudio --json posts:create --dry-run \
  -c "Shop the new collection" \
  -i <facebook_account_id> \
  -t scheduled \
  -s "2026-07-01 10:00:00" \
  --facebook-carousel '{"cards":[{"image":"https://e.com/1.jpg","link":"https://e.com/p1","title":"Tee"},{"image":"https://e.com/2.jpg","link":"https://e.com/p2","title":"Hoodie"}],"call_to_action":"SHOP_NOW","end_card":true,"end_card_url":"https://e.com/shop"}'
```

The CLI parses the JSON locally and adds `is_carousel_post: true`. A carousel and a colored-background text post (`--facebook-background-id`) are different Facebook formats — use one or the other, not both in the same post. CTA values (33 total) include `SHOP_NOW`, `LEARN_MORE`, `BUY_NOW`, `SIGN_UP`, … (see `SKILL.md` for the full list). The backend validates card counts and CTA values.

### Threads multi-thread (chained, max 10 items, Threads accounts only)

```bash
contentstudio --json posts:create --dry-run \
  -c "🧵 A thread on shipping CLIs" \
  -i <threads_account_id> \
  -t draft \
  --threads '[{"message":"1/ Start small."},{"message":"2/ Ship a demo.","media":["https://e.com/demo.mp4"]},{"message":"3/ Iterate in public."}]'
```

The top-level `-c / --content` is the lead post; each `--threads` item is a chained reply, in order (don't repeat the lead text in the items). The CLI parses the JSON array locally and sets `has_multi_threads: true`. Each item needs `message` or `media`; Threads allows mixed media.

### Twitter/X threaded tweets (chained, max 10 tweets, Twitter accounts only)

```bash
contentstudio --json posts:create --dry-run \
  -c "Why we built a CLI 🧵" \
  -i <twitter_account_id> \
  -t draft \
  --twitter '[{"message":"1/ Start with the contract."},{"message":"2/ Show, don'\''t tell.","media":["https://e.com/x.jpg"]},{"message":"3/ Ship it."}]'
```

The top-level `-c / --content` is the lead tweet; each `--twitter` item is a follow-up tweet in the chain, in order (don't repeat the lead text in the items). The CLI parses the JSON array locally and sets `has_threaded_tweets: true`. Each item needs `message` or `media`. Unlike Threads, Twitter does **not** allow mixed media in one tweet (no images + video together) and allows **max 1 video per tweet** — the backend enforces this and returns a 422 if violated.

### Post with a first comment

```bash
contentstudio --json posts:create --dry-run \
  -c "New drop is live 🎉" \
  -i <account_id> \
  -t draft \
  --first-comment "🔗 link in bio" \
  --first-comment-account <account_id>
```

The CLI builds `first_comment: { message, accounts }`. `--first-comment-account` is **required** by the backend when `--first-comment` is set and must be a subset of the `-i / --account` IDs; otherwise the API returns a 422.

### Full body via `--body <file.json>`

For platform-specific options (TikTok privacy, YouTube category, GMB topic, approval workflow, first-comment, labels, campaigns, etc.), write a JSON body and pass it via `--body`:

```bash
contentstudio --json posts:create --body /tmp/post.json
```

Body schema:
```jsonc
{
  "content": {
    "text": "Hello world",
    "media": {
      "images": ["https://example.com/img.jpg"],
      "video": "https://example.com/clip.mp4",
      "media_ids": ["<media_library_id>"]
    }
  },
  "accounts": ["<account_id>"],
  "post_type": "reel+story",
  "post_video_title": "My Video Title",
  "scheduling": {
    "publish_type": "scheduled",
    "scheduled_at": "2026-05-01 10:00:00"
  },
  "first_comment": {
    "message": "🔗 link in bio",
    "accounts": ["<account_id>"]
  },
  "labels": ["<label_id>"],
  "campaign_id": "<campaign_id>",
  "approval": {
    "approvers": ["<user_id>"],
    "approve_option": "anyone",
    "notes": "please review"
  },
  // facebook_options: use EITHER carousel OR facebook_background_id (different FB formats, not both):
  "facebook_options":  { "carousel": { "is_carousel_post": true, "cards": [ {"image":"https://...","link":"https://...","title":"...","description":"..."} ], "call_to_action": "SHOP_NOW", "end_card": true, "end_card_url": "https://..." } },
  // colored-background text post instead: "facebook_options": { "facebook_background_id": "<id>" },
  "threads_options":   { "has_multi_threads": true, "multi_threads": [ {"message":"1/ ..."}, {"message":"2/ ...","media":["https://...mp4"]} ] },
  "youtube_options":   { "title": "...", "privacy_status": "public", "category": "EDUCATION", "tags": ["tag1"], "license": "youtube", "made_for_kids": false },
  "tiktok_options":    { "privacy_level": "PUBLIC_TO_EVERYONE", "disable_comment": false, "disable_duet": false, "disable_stitch": false, "auto_add_music": false },
  "pinterest_options": { "title": "...", "link": "https://..." },
  "gmb_options":       { "topic_type": "EVENT", "start_date": "2026-05-01", "end_date": "2026-05-02", "title": "...", "action_type": "BOOK", "cta_link": "https://..." }
}
```

### Always preview with `--dry-run` first

For agents (and cautious humans), every mutating command supports `--dry-run` — it prints the request body and exits **without** calling the API:

```bash
contentstudio --json posts:create --dry-run \
  -c "Test" -i <account_id> -t scheduled -s "2026-05-01 10:00"
# → {"ok": true, "data": {"dry_run": true, "endpoint": "...", "body": {...}}}
```

## Managing Posts

### List posts (with filters)

```bash
contentstudio --json posts:list                                          # all recent
contentstudio --json posts:list --status draft --per-page 5
contentstudio --json posts:list --status scheduled --status published
contentstudio --json posts:list --date-from 2026-04-01 --date-to 2026-04-30
```

### Delete a post

```bash
# Just delete from ContentStudio
contentstudio --json posts:delete <post_id>

# Also delete from the connected social platforms
contentstudio --json posts:delete <post_id> --delete-from-social

# Limit the cross-platform delete to specific accounts
contentstudio --json posts:delete <post_id> --account <account_id> --delete-from-social

# Preview without deleting
contentstudio --json posts:delete <post_id> --dry-run
```

### Approve / reject a post in an approval workflow

```bash
contentstudio --json posts:approve <post_id> --comment "LGTM, ship it"
contentstudio --json posts:reject  <post_id> --comment "fix the link first"

# Preview without acting
contentstudio --json posts:approve <post_id> --dry-run
```

## Comments & Internal Notes

```bash
# List all comments / notes on a post
contentstudio --json comments:list <post_id>

# Add a public comment
contentstudio --json comments:add <post_id> "Great work team!"

# Add an internal note (not visible to the public)
contentstudio --json comments:add <post_id> "Double-check the link before publishing" --note

# Mention team members
contentstudio --json comments:add <post_id> "Heads up" --mention <user_id> --mention <user_id>

# Preview
contentstudio --json comments:add <post_id> "test" --note --dry-run
```

## Media Library

### List media assets

```bash
contentstudio --json media:list                                          # all
contentstudio --json media:list --type images --sort recent --per-page 20
contentstudio --json media:list --type videos
contentstudio --json media:list --search "campaign-2026"
```

`--sort` values: `recent`, `oldest`, `size`, `a2z`, `z2a`.

### Upload media

Upload a local file:
```bash
contentstudio --json media:upload --file ./hero.jpg
```

Or import from an external URL:
```bash
contentstudio --json media:upload --url https://example.com/asset.mp4
```

Optionally place into a folder:
```bash
contentstudio --json media:upload --file ./hero.jpg --folder-id <folder_id>
```

Preview (no upload):
```bash
contentstudio --json media:upload --url https://example.com/img.jpg --dry-run
```

The response includes an `_id` you can pass as `--media-id` when creating posts.

## Platform-Specific Examples

The full body schema accepts platform-specific options. These examples show the most common configurations.

### Facebook Page

```bash
contentstudio --json posts:create \
  -c "Big news for our community 🎉" \
  -i <facebook_page_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  -m https://example.com/announcement.jpg
```

For Facebook **Reels** or **Stories**, set `--post-type`:
```bash
contentstudio posts:create \
  -c "Behind-the-scenes" \
  -i <facebook_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  --video-url https://example.com/clip.mp4 \
  --post-type reel+story
```

### LinkedIn (personal or company page)

```bash
contentstudio --json posts:create \
  -c "Excited to share our Q2 roadmap" \
  -i <linkedin_id> \
  -t scheduled \
  -s "2026-05-01 09:00:00" \
  -m https://example.com/roadmap.png
```

### Twitter / X

```bash
# Single tweet with image
contentstudio --json posts:create \
  -c "New release shipped 🚀" \
  -i <twitter_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  -m https://example.com/preview.png
```

### Instagram (feed / reel / story)

For Instagram, control the post format with `--post-type`:

```bash
# Feed post
contentstudio posts:create \
  -c "Caption with #hashtags" \
  -i <instagram_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  -m https://example.com/photo.jpg \
  --post-type feed

# Reel
contentstudio posts:create \
  -c "" \
  -i <instagram_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  --video-url https://example.com/reel.mp4 \
  --post-type reel

# Story
contentstudio posts:create \
  -c "" \
  -i <instagram_id> \
  -t scheduled \
  -s "2026-05-01 10:00:00" \
  -m https://example.com/story.jpg \
  --post-type story
```

### YouTube (Shorts and Videos)

YouTube needs `youtube_options` — use a `--body` file:

```bash
cat > /tmp/yt-post.json <<'JSON'
{
  "content": {
    "text": "Description shown under the video",
    "media": {"video": "https://example.com/clip.mp4"}
  },
  "accounts": ["<youtube_id>"],
  "post_type": "shorts",
  "post_video_title": "How we built ContentStudio CLI",
  "scheduling": {"publish_type": "scheduled", "scheduled_at": "2026-05-01 10:00:00"},
  "youtube_options": {
    "title": "How we built ContentStudio CLI",
    "privacy_status": "public",
    "category": "EDUCATION",
    "tags": ["cli", "automation", "social-media"],
    "license": "youtube",
    "made_for_kids": false
  }
}
JSON
contentstudio --json posts:create --body /tmp/yt-post.json
```

### TikTok

```bash
cat > /tmp/tt-post.json <<'JSON'
{
  "content": {
    "text": "Quick demo #fyp #tutorial",
    "media": {"video": "https://example.com/tiktok.mp4"}
  },
  "accounts": ["<tiktok_id>"],
  "scheduling": {"publish_type": "scheduled", "scheduled_at": "2026-05-01 10:00:00"},
  "tiktok_options": {
    "privacy_level": "PUBLIC_TO_EVERYONE",
    "disable_comment": false,
    "disable_duet": false,
    "disable_stitch": false,
    "auto_add_music": false,
    "brand_content_toggle": false,
    "disclose_commercial_content": false,
    "is_aigc": false
  }
}
JSON
contentstudio --json posts:create --body /tmp/tt-post.json
```

### Pinterest

```bash
cat > /tmp/pin-post.json <<'JSON'
{
  "content": {
    "text": "Check out our spring guide",
    "media": {"images": ["https://example.com/pin.jpg"]}
  },
  "accounts": ["<pinterest_id>"],
  "scheduling": {"publish_type": "scheduled", "scheduled_at": "2026-05-01 10:00:00"},
  "pinterest_options": {
    "title": "Spring 2026 Style Guide",
    "link": "https://example.com/spring-guide"
  }
}
JSON
contentstudio --json posts:create --body /tmp/pin-post.json
```

### Google Business Profile

```bash
cat > /tmp/gmb-post.json <<'JSON'
{
  "content": {
    "text": "Join our grand opening event",
    "media": {"images": ["https://example.com/event.jpg"]}
  },
  "accounts": ["<gmb_account_id>"],
  "scheduling": {"publish_type": "scheduled", "scheduled_at": "2026-05-01 10:00:00"},
  "gmb_options": {
    "topic_type": "EVENT",
    "start_date": "2026-05-15",
    "end_date": "2026-05-16",
    "title": "Grand Opening",
    "action_type": "BOOK",
    "cta_link": "https://example.com/rsvp"
  }
}
JSON
contentstudio --json posts:create --body /tmp/gmb-post.json
```

## Features for AI Agents

This CLI is designed to be driven by AI assistants. Three properties make it agent-friendly:

### 1. Stable JSON envelope

Every command supports `--json` returning a predictable shape:

```jsonc
// Success
{ "ok": true, "data": <payload> }

// Error
{
  "ok": false,
  "error": {
    "type": "AuthError",
    "message": "Invalid or revoked API key",
    "http_status": 401,
    "hint": "Run `contentstudio auth:login --api-key cs_...` to set a valid API key."
  }
}
```

Agents check both `ok` and the process exit code (non-zero on error).

### 2. Dry-run by default for safety

Every mutating command (`posts:create`, `posts:delete`, `posts:approve`, `posts:reject`, `comments:add`, `media:upload`) supports `--dry-run` — the agent can validate a payload before committing.

### 3. Discoverable via `npx skills add`

The repo ships a `SKILL.md` agents can install with one command:
```bash
npx skills add contentstudioio/contentstudio-agent
```
After this, the agent automatically knows when to use the `contentstudio` CLI without prompting.

## Common Workflows

### 1. Schedule a daily post for the next 7 days

```bash
#!/bin/bash
# Daily content batch for a Facebook page
ACCOUNT="<facebook_page_id>"
CONTENT=(
  "Monday motivation 💪"
  "Tuesday tips: keep it simple"
  "Wednesday wisdom from the team"
  "Throwback Thursday"
  "Friday vibes 🎉"
  "Weekend prep — try this"
  "Sunday reflections"
)

for i in "${!CONTENT[@]}"; do
  DATE=$(date -d "+$((i+1)) day 09:00" '+%F %T')
  contentstudio --json posts:create \
    -c "${CONTENT[$i]}" \
    -i "$ACCOUNT" \
    -t scheduled \
    -s "$DATE"
done
```

### 2. Cross-platform campaign

```bash
#!/bin/bash
# Same content to FB + LinkedIn + Twitter at the same time
TIME="2026-05-01 10:00:00"

# List accounts and pick one per platform
FB=$(contentstudio --json accounts:list --platform facebook | jq -r '.data[0]._id')
LI=$(contentstudio --json accounts:list --platform linkedin | jq -r '.data[0]._id')
TW=$(contentstudio --json accounts:list --platform twitter  | jq -r '.data[0]._id')

contentstudio --json posts:create \
  -c "Big launch today 🚀" \
  -i "$FB" -i "$LI" -i "$TW" \
  -t scheduled \
  -s "$TIME" \
  -m https://example.com/launch.jpg
```

### 3. Bulk-delete drafts older than 30 days

```bash
#!/bin/bash
CUTOFF=$(date -d '-30 days' '+%Y-%m-%d')

contentstudio --json posts:list --status draft --date-to "$CUTOFF" --per-page 100 \
  | jq -r '.data[]._id' \
  | while read id; do
      contentstudio --json posts:delete "$id"
    done
```

### 4. Upload a folder of images and create one post per image

```bash
#!/bin/bash
ACCOUNT="<instagram_id>"

for img in ./photos/*.jpg; do
  # Upload first to get a media library ID
  RESP=$(contentstudio --json media:upload --file "$img")
  MEDIA_ID=$(echo "$RESP" | jq -r '.data._id')

  # Schedule a post with the uploaded media
  TIME=$(date -d "+1 hour" '+%F %T')
  contentstudio --json posts:create \
    -c "$(basename "$img" .jpg)" \
    -i "$ACCOUNT" \
    -t scheduled \
    -s "$TIME" \
    --media-id "$MEDIA_ID" \
    --post-type feed
done
```

### 5. Approval pipeline — auto-approve posts from a trusted creator

```bash
#!/bin/bash
TRUSTED_USER_ID="<user_id>"

contentstudio --json posts:list --status pending_approval --per-page 50 \
  | jq -r --arg u "$TRUSTED_USER_ID" '.data[] | select(.created_by == $u) | ._id' \
  | while read id; do
      contentstudio --json posts:approve "$id" --comment "auto-approved (trusted creator)"
    done
```

## API Endpoints

The CLI wraps these 20 endpoints from the ContentStudio v1 public API. Base URL: `https://api.contentstudio.io/api/v1`.

| Method | Endpoint | CLI command |
|--------|----------|-------------|
| GET    | `/me` | `auth:whoami` |
| GET    | `/platforms` | `platforms:list` |
| GET    | `/facebook/text-backgrounds` | `facebook:text-backgrounds` |
| GET    | `/workspaces` | `workspaces:list` |
| GET    | `/workspaces/{w}/accounts` | `accounts:list` |
| POST   | `/workspaces/{w}/connect/{platform}` | `accounts:connect <platform>` |
| POST   | `/workspaces/{w}/add/bluesky` | `accounts:add-bluesky` |
| POST   | `/workspaces/{w}/add/facebook-group` | `accounts:add-facebook-group` |
| GET    | `/workspaces/{w}/campaigns` | `campaigns:list` |
| GET    | `/workspaces/{w}/content-categories` | `categories:list` |
| GET    | `/workspaces/{w}/labels` | `labels:list` |
| GET    | `/workspaces/{w}/team-members` | `team:list` |
| GET    | `/workspaces/{w}/media` | `media:list` |
| POST   | `/workspaces/{w}/media` | `media:upload` |
| GET    | `/workspaces/{w}/posts` | `posts:list` |
| POST   | `/workspaces/{w}/posts` | `posts:create` |
| DELETE | `/workspaces/{w}/posts/{p}` | `posts:delete` |
| POST   | `/workspaces/{w}/posts/{p}/approval` | `posts:approve`, `posts:reject` |
| GET    | `/workspaces/{w}/posts/{p}/comments` | `comments:list` |
| POST   | `/workspaces/{w}/posts/{p}/comments` | `comments:add` |

Full OpenAPI 3.0 spec: <https://api.contentstudio.io/api-docs.json>
Human-readable docs: <https://api.contentstudio.io/guide>

## Configuration

Stored at:
```
$XDG_CONFIG_HOME/contentstudio/config.json
# falls back to ~/.config/contentstudio/config.json
```

File mode `0600`, parent dir `0700` — never world-readable.

Format:
```jsonc
{
  "api_key": "cs_...",
  "base_url": "https://api.contentstudio.io/api/v1",
  "active_workspace_id": "<workspace_id>",
  "active_workspace_name": "...",
  "user": { "id": "...", "email": "...", "full_name": "..." }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTENTSTUDIO_API_KEY` | No\* | — | API key (overrides stored config) |
| `CONTENTSTUDIO_WORKSPACE_ID` | No\* | — | Active workspace (overrides stored config) |
| `CONTENTSTUDIO_BASE_URL` | No | `https://api.contentstudio.io/api/v1` | API base URL (override for staging) |
| `CONTENTSTUDIO_CONFIG_PATH` | No | `~/.config/contentstudio/config.json` | Custom config file path |

\*Either run `contentstudio auth:login` once, or set `CONTENTSTUDIO_API_KEY`. Either run `workspaces:use <id>` once, set `CONTENTSTUDIO_WORKSPACE_ID`, or pass `--workspace <id>` per call.

## Error Handling

The CLI provides typed errors with non-zero exit codes:

| Exit code | `error.type` | HTTP status | Typical cause / hint |
|-----------|--------------|-------------|----------------------|
| 1 | `ContentStudioError` | varies | Generic — check `message` |
| 2 | `AuthError` | 401, 403 | Invalid/revoked key — run `auth:login` again |
| 3 | `NotFoundError` | 404 | Resource doesn't exist or wrong workspace |
| 4 | `ValidationError` | 422 | Malformed request — check `message` for field errors |
| 5 | `RateLimitError` | 429 | Too many calls — back off and retry |
| 6 | `BackendError` | 5xx / network | Upstream issue — retry with backoff |
| 1 | `ConfigError` | — | Local config issue (no key/workspace set) — see `hint` |

The CLI auto-retries on `429` and `5xx` (up to 2 attempts with exponential backoff). Connection timeouts also retry.

## Quick Reference

```bash
# Authentication
contentstudio auth:login --api-key cs_...                                           # Persist key + verify
contentstudio auth:status                                                           # Show local config
contentstudio --json auth:whoami                                                    # Validate key against API
contentstudio auth:logout                                                           # Forget key

# Workspaces
contentstudio --json workspaces:list                                                # List workspaces
contentstudio workspaces:use <workspace_id>                                         # Set active workspace
contentstudio workspaces:current                                                    # Show active

# Discovery (workspace-scoped)
contentstudio --json accounts:list [--platform facebook] [--search "query"]        # Connected accounts
contentstudio --json campaigns:list                                                 # Folders
contentstudio --json categories:list                                                # Content categories
contentstudio --json labels:list                                                    # Labels
contentstudio --json team:list                                                      # Team members

# Posts
contentstudio --json posts:list [--status draft] [--date-from] [--date-to]         # List posts
contentstudio --json posts:create -c "text" -i <account_id> -t draft               # Create (shortcut)
contentstudio --json posts:create --body /path/to/post.json                        # Create (full body)
contentstudio --json posts:create [...] --dry-run                                  # Preview, no API call
contentstudio --json posts:delete <post_id> [--delete-from-social]                 # Delete
contentstudio --json posts:approve <post_id> [--comment "..."]                     # Approve
contentstudio --json posts:reject  <post_id> [--comment "..."]                     # Reject

# Comments / Notes
contentstudio --json comments:list <post_id>                                        # List
contentstudio --json comments:add  <post_id> "message" [--note] [--mention <id>]   # Public comment / internal note

# Media
contentstudio --json media:list [--type images|videos] [--sort recent]             # List
contentstudio --json media:upload --file <path>                                    # Upload local file
contentstudio --json media:upload --url <url>                                      # Import from URL

# Globals
contentstudio --version                                                             # Print version
contentstudio --help                                                                # Top-level help
contentstudio <group>:<verb> --help                                                 # Per-command help
contentstudio --json ...                                                            # JSON envelope output
contentstudio --workspace <id> ...                                                  # Per-call workspace override
contentstudio --base-url <url> ...                                                  # Per-call API base override
```

## Development

This package is built with TypeScript and bundled with [tsup](https://tsup.egoist.dev/).

### Project structure

```
contentstudio-agent/
├── src/
│   ├── index.ts              # CLI entry — yargs setup
│   ├── api.ts                # HTTP client + endpoint wrappers
│   ├── config.ts             # Persistent config (read/write/lock)
│   ├── errors.ts             # Typed error hierarchy
│   ├── output.ts             # JSON envelope + human renderer
│   ├── cliCtx.ts             # Shared command glue (run, buildClient)
│   └── commands/
│       ├── auth.ts           # auth:login, auth:logout, auth:whoami, auth:status
│       ├── workspaces.ts     # workspaces:list, workspaces:use, workspaces:current
│       ├── lookups.ts        # accounts/campaigns/categories/labels/team list commands
│       ├── posts.ts          # posts:list, posts:create, posts:delete, posts:approve, posts:reject
│       ├── comments.ts       # comments:list, comments:add
│       └── media.ts          # media:list, media:upload
├── tests/                    # vitest + nock unit + real-API E2E
├── skills/contentstudio/SKILL.md  # symlink → ../../SKILL.md
├── .claude-plugin/           # Claude Code plugin manifest
├── SKILL.md                  # AI-agent skill content
├── README.md                 # This file
├── CHANGELOG.md
├── LICENSE                   # MIT
├── package.json
├── tsconfig.json
└── tsup.config.ts
```

### Scripts

```bash
npm run dev          # tsup --watch (rebuild on save)
npm run build        # tsup → dist/index.js
npm run start        # node dist/index.js
npm test             # vitest run (unit + CLI subprocess; E2E auto-skipped)
npm run test:watch   # vitest in watch mode
```

### Tests

- **Unit + CLI subprocess** — runs by default with `npm test`. Uses `nock` to mock HTTPS. **No network required.**
- **Real-API E2E** — gated on env vars. Hits `api.contentstudio.io` for real:
  ```bash
  CONTENTSTUDIO_API_KEY=cs_... \
  CONTENTSTUDIO_WORKSPACE_ID=... \
  npm test
  ```
  E2E covers create-draft → delete cycles via both the API client and the installed CLI binary.

### Build output

`tsup` produces a single CommonJS bundle at `dist/index.js` (~43 KB) with `#!/usr/bin/env node` shebang. The npm package ships only `dist/`, `README.md`, `SKILL.md`, `CHANGELOG.md`, and `LICENSE`.

## Security

- API keys live in `~/.config/contentstudio/config.json` with mode `0600`.
- Keys are never echoed in CLI output (only a redacted prefix via `auth:status`).
- The `--json` error envelope never includes the key.
- All API traffic is HTTPS; the client validates TLS certificates.
- 0 production dependency vulnerabilities (`npm audit --omit=dev`).

## Contributing

1. Fork the repo at <https://github.com/contentstudioio/contentstudio-agent>
2. Branch off `main`
3. Make your changes; add/update tests
4. `npm test` — must stay green
5. Open a pull request

## Links

- **npm**: <https://www.npmjs.com/package/contentstudio-cli>
- **GitHub**: <https://github.com/contentstudioio/contentstudio-agent>
- **API guide**: <https://api.contentstudio.io/guide>
- **OpenAPI spec**: <https://api.contentstudio.io/api-docs>
- **ContentStudio**: <https://contentstudio.io>

## License

[MIT](./LICENSE)

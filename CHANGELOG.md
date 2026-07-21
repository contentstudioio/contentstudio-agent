# Changelog

## Unreleased — posts:update, approval workflows, LinkedIn polls & collaborators

- New `accounts:remove <account_id>` command — `DELETE /workspaces/{w}/accounts/{account_id}` disconnects a social account (`account_id` is the account's `_id` from `accounts:list`). Requires the `save_social` permission (403 otherwise); 404 when the account isn't found, 422 when removal fails. Carries `--dry-run` like the other mutating commands.
- New `posts:update <post_id>` command — PUTs `/workspaces/{w}/posts/{post_id}` with the **same body/flags** as `posts:create` (shared option set + body builder). The backend rejects the update (422) once the post is `published` or `processing`.
- New `approval-workflows:list` command (GET `/workspaces/{w}/approval-workflows`) — lists `{ _id, name, is_default, levels[] }`; use `_id` as `--approval-workflow-id`.
- `posts:create` / `posts:update` new shortcut flags:
  - `--linkedin-options '<json>'` → `linkedin_options` (title + poll; poll needs `--post-type poll` and text-only content).
  - `--facebook-collaborator` (repeatable, max 10) → `facebook_options.collaborators`; `--instagram-collaborator` (repeatable, max 3) → `instagram_options.collaborators`.
  - `--approval-workflow-id` + `--approval-workflow-notes` → attach a workflow (`approval_workflow.workflow_id`); `--approval-workflow-action restart|resume|renotify_current|keep|remove` → mutate an attached workflow (update only). Mutually exclusive with `--approver`, and exactly one of id/action.
  - `--post-type` now documents `poll` (carousel is auto-derived by the backend from `post_type=carousel` + 2+ images).
- `posts:list` now surfaces `linkedin_options` and `approval_workflow` per post in the `--json` output.

## 1.0.10 — propagate platform-name metadata to the npm package

- Release-only bump. The `package.json`/`plugin.json` description + keywords were updated to include Threads, Tumblr, and Bluesky *after* `1.0.9` had already been published to npm, so npm's `1.0.9` carried the old description and the follow-up deploy failed (`403`, can't republish an existing version). This bump ships the corrected package metadata to npm.
- No CLI source or SKILL.md content changes beyond the version bump.

## 1.0.9 — add Threads, Tumblr, and Bluesky to the skill description

- SKILL.md: the `description` now lists Threads, Tumblr, and Bluesky alongside the existing platforms. The CLI already supports connecting these (`accounts:connect threads`, `accounts:connect tumblr`, `accounts:add-bluesky`), but the one-line summary had drifted and only advertised the original headline set.
- No CLI source changes — platform support is unchanged; this only corrects the skill's discoverability/summary text.

## 1.0.8 — document env-var authentication for headless/agent runtimes

- SKILL.md: the Authentication section now documents **two** auth paths — `auth:login --api-key` (interactive, config file) and `export CONTENTSTUDIO_API_KEY` (headless / agent runtimes, env var). The env var takes precedence over the config file.
- Added a headless-deployment note: a shell `export` does not persist to a service process; set `CONTENTSTUDIO_API_KEY` via systemd `Environment=`/`EnvironmentFile=`, Docker `-e`, etc., then restart. Runtimes that gate on `requires.env` (e.g. OpenClaw) stay blocked until the variable is present in the process environment.
- Resolves a docs/metadata mismatch: the frontmatter already declared `requires.env: CONTENTSTUDIO_API_KEY`, but the body only documented `auth:login`, so OpenClaw operators were left blocked with no instruction on how to satisfy the gate.
- No CLI source-code changes — the CLI already reads `CONTENTSTUDIO_API_KEY` from the environment (`src/config.ts`).

## Unreleased — write commands for workspaces/labels/campaigns/team + posts:create fixes

- Fixed `posts:create`: now emits top-level `content_category_id` and no longer forces `--account` when `--content-category-id` is supplied (content-category posts derive accounts from the category — previously 422'd). Added `--content-category-id`.
- `posts:create` now normalizes `--scheduled-at` to the backend's `YYYY-MM-DD HH:MM:SS` (UTC) format, and gained parity flags `--label` (repeatable, max 20), `--campaign-id`, `--approver` (repeatable) + `--approve-option` + `--approval-notes`, and `--facebook-background-id`. `--publish-type` now also accepts `now`.
- New workspace write commands: `workspaces:create`, `workspaces:update`, `workspaces:delete`.
- New label write commands: `labels:create`, `labels:update`, `labels:delete`.
- New campaign write commands: `campaigns:create`, `campaigns:update`, `campaigns:delete`.
- New team-member write commands: `team:add`, `team:update`, `team:remove` (with `--confirmed` for guarded removals).
- All new mutating commands support `--dry-run` and are added to the SKILL.md workspace-confirmation list. Added a `put` method to the API client and nock tests for every new wrapper.

## 1.0.5 — workspace confirmation before mutations

- SKILL.md: agents must now confirm the target workspace with the user before any mutating command (`accounts:connect`, `accounts:add-bluesky`, `accounts:add-facebook-group`, `posts:create`, `posts:delete`, `posts:approve`, `posts:reject`, `comments:add`, `media:upload`) instead of silently using whatever workspace is active in the CLI.
- Read-only listings (`*:list`, `workspaces:current`, etc.) continue to use the active workspace silently — the rule only applies to mutations.
- Documents the recommended pattern: run `workspaces:current`, surface the active workspace to the user, ask whether to proceed there or pick another, then either `workspaces:use <id>` or pass `--workspace <id>` for a one-off override.
- No CLI source-code changes — the CLI's default-to-active-workspace behavior is unchanged.

## 1.0.4 — update-check banner + version inlining

- New: when a newer `contentstudio-cli` is published to npm, the CLI now prints a single-line "update available" banner to stderr on startup, with install + skill-refresh hints.
- Banner is **suppressed** when:
  - `--json`, `--version`, or `--help` is in argv (avoids corrupting machine-readable / metadata output)
  - stderr isn't a TTY (avoids polluting log files / pipes)
  - `CONTENTSTUDIO_NO_UPDATE_CHECK=1` is set
- Update check is **fire-and-forget** (never blocks the command), result cached at `~/.config/contentstudio/.update-check.json` for 24h.
- Fixed: `VERSION` constant now reads from `package.json` at build time via tsup `define` — older builds had `User-Agent` header reporting `1.0.0` regardless of actual version.
- 22 new unit tests for the update checker (76/76 passing).

## 1.0.3 — account connection commands

Added 5 new commands for managing social-account connections:

- **`platforms:list`** — list all 12+ platforms available for connection, with their `connection_method` (`oauth` / `credentials` / `manual`).
- **`accounts:connect <platform>`** — generate a one-time OAuth URL for connecting a new account; `--reconnect --account-id <id>` to refresh expired accounts.
- **`accounts:add-bluesky --handle <h> --app-password <p>`** — credential-based Bluesky add (no browser). Password is redacted in `--dry-run` output.
- **`accounts:add-facebook-group --name <n> [--image <url>]`** — manual Facebook Group connection.
- **`facebook:text-backgrounds`** — list Facebook colored-background presets used in `facebook_options.facebook_background_id` on plain-text posts.

All new commands support `--json` (mutations also support `--dry-run`).

## 1.0.2 — pagination metadata for AI agents

- All `*:list` commands now surface Laravel pagination metadata (`current_page`, `per_page`, `total`, `last_page`, `from`, `to`, `has_more`) in the JSON envelope as a sibling of `data`.
- Human-mode list commands now print a "Showing X–Y of TOTAL (page N/M)" footer with a hint to fetch more pages.
- SKILL.md updated with mandatory pagination rules for AI agents — when `pagination.has_more` is true, the agent must either ask the user, auto-paginate, or filter; never silently truncate.
- 4 new pagination unit tests; total now 47 unit + 9 E2E.

## 1.0.1 — expanded README

- Full README rewrite with platform-specific examples (FB / LinkedIn / Twitter / Instagram / YouTube / TikTok / Pinterest / GMB), common workflow scripts, API endpoints table, error handling table, quick reference, and development guide.
- No code changes — docs only.

## 1.0.0 — initial release

- All 15 endpoints of the ContentStudio v1 public API exposed as `<group>:<verb>` commands.
- Human + JSON output modes (`--json`).
- `--dry-run` on every mutating command (posts:create, posts:delete, posts:approve/reject, comments:add, media:upload).
- Persistent config at `~/.config/contentstudio/config.json` (0600 perms).
- Env-var overrides: `CONTENTSTUDIO_API_KEY`, `CONTENTSTUDIO_BASE_URL`, `CONTENTSTUDIO_WORKSPACE_ID`, `CONTENTSTUDIO_CONFIG_PATH`.
- Typed errors: `AuthError`, `NotFoundError`, `ValidationError`, `RateLimitError`, `BackendError`, `ConfigError`.
- Retry on `429` and `5xx` with exponential backoff.
- 52 tests passing — unit (errors, config, API, CLI) + real-API E2E.
- SKILL.md + `.claude-plugin/` manifests for `npx skills add` and Claude Code marketplace.

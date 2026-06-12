# Changelog

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

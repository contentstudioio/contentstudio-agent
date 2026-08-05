/**
 * HTTP client + endpoint wrappers for the ContentStudio v1 API.
 *
 * - X-API-Key authentication
 * - Response envelope unwrapping ({status, message, data})
 * - Typed error mapping (see ./errors)
 * - Retry on 429 / 5xx (opt-in via opts.retries)
 * - Safe debug logging (never prints the API key)
 */

import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";
import fetch, { RequestInit, Response } from "node-fetch";

import { Config } from "./config";
import {
  BackendError,
  ConfigError,
  ContentStudioError,
  fromHttpStatus,
} from "./errors";

// Replaced at build time by tsup's `define` (see tsup.config.ts).
declare const __VERSION__: string;

export const VERSION: string =
  typeof __VERSION__ !== "undefined" ? __VERSION__ : "0.0.0-dev";
export const USER_AGENT = `contentstudio-cli/${VERSION} (+https://github.com/contentstudioio/contentstudio-agent)`;
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface ClientOpts {
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
}

export class Client {
  readonly config: Config;
  readonly timeoutMs: number;
  readonly retries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: Config, opts: ClientOpts = {}) {
    this.config = config;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = opts.retries ?? 2;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ── low-level ───────────────────────────────────────────────────

  private buildUrl(p: string, params?: Record<string, unknown>): string {
    let url: string;
    if (p.startsWith("http://") || p.startsWith("https://")) {
      url = p;
    } else {
      const base = this.config.effectiveBaseUrl();
      const rel = p.startsWith("/") ? p : `/${p}`;
      url = `${base}${rel}`;
    }
    if (!params) return url;
    const qs = flattenQuery(params);
    if (qs.length === 0) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}${qs}`;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      "X-API-Key": this.config.requireApiKey(),
    };
    if (extra) Object.assign(h, extra);
    return h;
  }

  async request<T = unknown>(
    method: string,
    p: string,
    opts: {
      params?: Record<string, unknown>;
      json?: unknown;
      form?: FormData;
      extraHeaders?: Record<string, string>;
      unwrap?: boolean;
    } = {},
  ): Promise<T> {
    const { params, json, form, extraHeaders, unwrap = true } = opts;
    const url = this.buildUrl(p, params);

    const init: RequestInit = {
      method,
      headers: this.headers(extraHeaders),
    };

    if (form) {
      // Let form-data set Content-Type with boundary.
      Object.assign(init.headers as Record<string, string>, form.getHeaders());
      init.body = form;
    } else if (json !== undefined) {
      (init.headers as Record<string, string>)["Content-Type"] = "application/json";
      init.body = JSON.stringify(json);
    }

    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      init.signal = ac.signal as RequestInit["signal"];
      let resp: Response;
      try {
        resp = await this.fetchImpl(url, init);
      } catch (e) {
        clearTimeout(timer);
        lastErr = e as Error;
        if (attempt < this.retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw new BackendError(
          `Network error talking to ${url}: ${(e as Error).message}`,
          { hint: "Check your internet connection and CONTENTSTUDIO_BASE_URL." },
        );
      }
      clearTimeout(timer);

      // Retry 429 / 5xx
      if (resp.status === 429 || resp.status >= 500) {
        if (attempt < this.retries) {
          const ra = parseFloat(resp.headers.get("retry-after") || "");
          const delay = !isNaN(ra) && ra > 0 ? ra * 1000 : 500 * 2 ** attempt;
          await sleep(Math.min(delay, 5_000));
          continue;
        }
      }

      return await handleResponse<T>(resp, unwrap);
    }
    // Shouldn't reach here, but be explicit.
    throw new BackendError(
      `Unreachable after ${this.retries + 1} attempts: ${lastErr?.message ?? "unknown"}`,
    );
  }

  get<T = unknown>(p: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>("GET", p, { params });
  }

  /**
   * GET a paginated list endpoint and preserve Laravel-style pagination
   * metadata (current_page / per_page / total / last_page / from / to)
   * alongside the unwrapped `data` array.
   *
   * Returns `{ data, pagination? }`. `pagination` is undefined for endpoints
   * that don't paginate (the API simply doesn't include the metadata fields).
   */
  async getPaginated<T = unknown>(
    p: string,
    params?: Record<string, unknown>,
  ): Promise<PaginatedResponse<T>> {
    const body = await this.request<any>("GET", p, { params, unwrap: false });
    if (!body || typeof body !== "object" || !("data" in body)) {
      return { data: body as T };
    }
    const pagination = extractPagination(body);
    return { data: body.data as T, pagination };
  }

  post<T = unknown>(
    p: string,
    body?: { json?: unknown; form?: FormData },
  ): Promise<T> {
    return this.request<T>("POST", p, { json: body?.json, form: body?.form });
  }

  put<T = unknown>(p: string, body?: { json?: unknown }): Promise<T> {
    return this.request<T>("PUT", p, { json: body?.json });
  }

  patch<T = unknown>(p: string, body?: { json?: unknown }): Promise<T> {
    return this.request<T>("PATCH", p, { json: body?.json });
  }

  delete<T = unknown>(p: string, body?: unknown): Promise<T> {
    return this.request<T>("DELETE", p, { json: body });
  }
}

/** Pagination metadata from the API (Laravel paginator style). */
export interface Pagination {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
  from: number | null;
  to: number | null;
  has_more: boolean;
}

export interface PaginatedResponse<T> {
  data: T;
  pagination?: Pagination;
}

function extractPagination(body: any): Pagination | undefined {
  if (
    body &&
    typeof body === "object" &&
    typeof body.current_page === "number" &&
    typeof body.last_page === "number" &&
    typeof body.total === "number" &&
    typeof body.per_page === "number"
  ) {
    return {
      current_page: body.current_page,
      per_page: body.per_page,
      total: body.total,
      last_page: body.last_page,
      from: body.from ?? null,
      to: body.to ?? null,
      has_more: body.current_page < body.last_page,
    };
  }
  return undefined;
}

async function handleResponse<T>(resp: Response, unwrap: boolean): Promise<T> {
  let body: any;
  const text = await resp.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text || `HTTP ${resp.status}` };
  }

  if (resp.ok) {
    if (!unwrap) return body as T;
    if (body && typeof body === "object" && "data" in body) {
      return body.data as T;
    }
    return body as T;
  }

  const message = extractMessage(body) || `HTTP ${resp.status}`;
  throw fromHttpStatus(resp.status, message, body);
}

function extractMessage(body: any): string | null {
  if (!body || typeof body !== "object") return null;
  if (typeof body.message === "string") return body.message;
  if (body.errors && typeof body.errors === "object") {
    // Flatten Laravel-style validation errors.
    const parts: string[] = [];
    for (const [field, msgs] of Object.entries(body.errors)) {
      if (Array.isArray(msgs)) {
        for (const m of msgs) parts.push(`${field}: ${m}`);
      } else {
        parts.push(`${field}: ${msgs}`);
      }
    }
    if (parts.length) return parts.join("; ");
  }
  if (typeof body.error === "string") return body.error;
  return null;
}

function flattenQuery(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item === null || item === undefined) continue;
        pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(item))}`);
      }
    } else {
      pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return pairs.join("&");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────
// Endpoint wrappers — one function per ContentStudio v1 endpoint.
// ─────────────────────────────────────────────────────────────────

export function getMe(c: Client) {
  return c.get<any>("/me");
}

export function listWorkspaces(
  c: Client,
  params: { page?: number; per_page?: number } = {},
) {
  return c.getPaginated<any>("/workspaces", params);
}

export function listAccounts(
  c: Client,
  workspaceId: string,
  params: {
    platform?: string;
    search?: string;
    page?: number;
    per_page?: number;
  } = {},
) {
  return c.getPaginated<any>(`/workspaces/${workspaceId}/accounts`, params);
}

export function listContentCategories(
  c: Client,
  workspaceId: string,
  params: { search?: string; page?: number; per_page?: number } = {},
) {
  return c.getPaginated<any>(`/workspaces/${workspaceId}/content-categories`, params);
}

export function listLabels(
  c: Client,
  workspaceId: string,
  params: { search?: string; page?: number; per_page?: number } = {},
) {
  return c.getPaginated<any>(`/workspaces/${workspaceId}/labels`, params);
}

export function listCampaigns(
  c: Client,
  workspaceId: string,
  params: { search?: string; page?: number; per_page?: number } = {},
) {
  return c.getPaginated<any>(`/workspaces/${workspaceId}/campaigns`, params);
}

export function listTeamMembers(
  c: Client,
  workspaceId: string,
  params: { search?: string; page?: number; per_page?: number } = {},
) {
  return c.getPaginated<any>(`/workspaces/${workspaceId}/team-members`, params);
}

export function listMedia(
  c: Client,
  workspaceId: string,
  params: {
    type?: string;
    sort?: string;
    search?: string;
    page?: number;
    per_page?: number;
  } = {},
) {
  return c.getPaginated<any>(`/workspaces/${workspaceId}/media`, params);
}

export function uploadMedia(
  c: Client,
  workspaceId: string,
  opts: { filePath?: string; url?: string; folderId?: string },
) {
  if (!!opts.filePath === !!opts.url) {
    throw new ConfigError(
      "Exactly one of `filePath` or `url` must be provided for media upload.",
    );
  }
  if (opts.filePath && !fs.existsSync(opts.filePath)) {
    throw new ConfigError(`Media file not found: ${opts.filePath}`);
  }

  const form = new FormData();
  if (opts.folderId) form.append("folder_id", opts.folderId);
  if (opts.filePath) {
    form.append("file", fs.createReadStream(opts.filePath), {
      filename: path.basename(opts.filePath),
    });
  } else if (opts.url) {
    form.append("url", opts.url);
  }

  return c.post<any>(`/workspaces/${workspaceId}/media`, { form });
}

export function listPosts(
  c: Client,
  workspaceId: string,
  params: {
    status?: string[];
    date_from?: string;
    date_to?: string;
    page?: number;
    per_page?: number;
    approval_assigned_to?: string[];
    approval_requested_by?: string[];
  } = {},
) {
  // Map array params to status[] / approval_*[]
  const q: Record<string, unknown> = {
    "status[]": params.status,
    date_from: params.date_from,
    date_to: params.date_to,
    page: params.page,
    per_page: params.per_page,
    "approval_assigned_to[]": params.approval_assigned_to,
    "approval_requested_by[]": params.approval_requested_by,
  };
  return c.getPaginated<any>(`/workspaces/${workspaceId}/posts`, q);
}

export function createPost(c: Client, workspaceId: string, body: unknown) {
  return c.post<any>(`/workspaces/${workspaceId}/posts`, { json: body });
}

/**
 * PUT /workspaces/{w}/posts/{post_id} — update an existing post. Takes the
 * same body schema as createPost. The backend rejects updates (422) when the
 * post status is `published` or `processing`.
 */
export function updatePost(
  c: Client,
  workspaceId: string,
  postId: string,
  body: unknown,
) {
  return c.put<any>(`/workspaces/${workspaceId}/posts/${postId}`, { json: body });
}

/**
 * GET /workspaces/{w}/approval-workflows — list the workspace's approval
 * workflows. Each item exposes `_id` (use as `approval_workflow.workflow_id`),
 * `name`, `is_default`, and `levels[]`.
 */
export function listApprovalWorkflows(
  c: Client,
  workspaceId: string,
  params: { page?: number; per_page?: number } = {},
) {
  return c.getPaginated<any>(
    `/workspaces/${workspaceId}/approval-workflows`,
    params,
  );
}

export function deletePost(
  c: Client,
  workspaceId: string,
  postId: string,
  opts: { deleteFromSocial?: boolean; accountIds?: string[] } = {},
) {
  const body: Record<string, unknown> = {};
  if (opts.deleteFromSocial) body.delete_from_social = true;
  if (opts.accountIds && opts.accountIds.length) body.account_ids = opts.accountIds;
  return c.delete<any>(
    `/workspaces/${workspaceId}/posts/${postId}`,
    Object.keys(body).length ? body : undefined,
  );
}

export function postApproval(
  c: Client,
  workspaceId: string,
  postId: string,
  action: "approve" | "reject",
  comment?: string,
) {
  const body: Record<string, unknown> = { action };
  if (comment) body.comment = comment;
  return c.post<any>(`/workspaces/${workspaceId}/posts/${postId}/approval`, {
    json: body,
  });
}

export function listComments(
  c: Client,
  workspaceId: string,
  postId: string,
  params: { page?: number; per_page?: number } = {},
) {
  return c.getPaginated<any>(`/workspaces/${workspaceId}/posts/${postId}/comments`, params);
}

export function addComment(
  c: Client,
  workspaceId: string,
  postId: string,
  comment: string,
  opts: { isNote?: boolean; mentionedUsers?: string[] } = {},
) {
  const body: Record<string, unknown> = { comment };
  if (opts.isNote) body.is_note = true;
  if (opts.mentionedUsers && opts.mentionedUsers.length) {
    body.mentioned_users = opts.mentionedUsers;
  }
  return c.post<any>(`/workspaces/${workspaceId}/posts/${postId}/comments`, {
    json: body,
  });
}

// ─────────────────────────────────────────────────────────────────
// Account Connection — list platforms, OAuth init, manual add
// (added in v1.0.3)
// ─────────────────────────────────────────────────────────────────

/**
 * GET /platforms — list every social platform available for connection,
 * with the connection method (oauth/credentials/manual), required fields,
 * and the endpoint to call.
 */
export function listPlatforms(c: Client) {
  return c.get<any>("/platforms");
}

/**
 * POST /workspaces/{w}/connect/{platform}
 *
 * Generates a one-time OAuth authorization URL for the chosen platform.
 * Use process="connect" for new accounts, process="reconnect" (with
 * accountId) to refresh an expired/invalid account.
 */
export function connectAccount(
  c: Client,
  workspaceId: string,
  platform: string,
  opts: { process: "connect" | "reconnect"; accountId?: string },
) {
  const params: Record<string, unknown> = { process: opts.process };
  if (opts.accountId) params.account_id = opts.accountId;
  return c.request<any>(
    "POST",
    `/workspaces/${workspaceId}/connect/${platform}`,
    { params },
  );
}

/**
 * POST /workspaces/{w}/add/bluesky — connect a Bluesky profile via handle +
 * app password. No browser step.
 */
export function addBlueskyAccount(
  c: Client,
  workspaceId: string,
  handle: string,
  appPassword: string,
) {
  return c.post<any>(`/workspaces/${workspaceId}/add/bluesky`, {
    json: { handle, app_password: appPassword },
  });
}

/**
 * POST /workspaces/{w}/add/facebook-group — manually add a Facebook Group
 * by name (and optional image URL). No browser step.
 */
export function addFacebookGroup(
  c: Client,
  workspaceId: string,
  name: string,
  image?: string,
) {
  const body: Record<string, unknown> = { name };
  if (image) body.image = image;
  return c.post<any>(`/workspaces/${workspaceId}/add/facebook-group`, {
    json: body,
  });
}

/**
 * GET /facebook/text-backgrounds — list Facebook colored-background presets
 * accepted by `facebook_options.facebook_background_id` on POST /posts.
 */
export function listFacebookTextBackgrounds(c: Client) {
  return c.get<any>("/facebook/text-backgrounds");
}

// ─────────────────────────────────────────────────────────────────
// Workspaces — create / update / delete (write operations).
// `createWorkspace` is NOT workspace-scoped (POST /workspaces).
// ─────────────────────────────────────────────────────────────────

/**
 * POST /workspaces — create a new workspace. Not workspace-scoped.
 * `name`, `logo`, `timezone` are required; the rest are optional.
 */
export function createWorkspace(c: Client, body: unknown) {
  return c.post<any>("/workspaces", { json: body });
}

/** PUT /workspaces/{id} — update an existing workspace (partial). */
export function updateWorkspace(c: Client, workspaceId: string, body: unknown) {
  return c.put<any>(`/workspaces/${workspaceId}`, { json: body });
}

/** DELETE /workspaces/{id} — delete a workspace. */
export function deleteWorkspace(c: Client, workspaceId: string) {
  return c.delete<any>(`/workspaces/${workspaceId}`);
}

// ─────────────────────────────────────────────────────────────────
// Labels — create / update / delete (workspace-scoped).
// ─────────────────────────────────────────────────────────────────

export function createLabel(c: Client, workspaceId: string, body: unknown) {
  return c.post<any>(`/workspaces/${workspaceId}/labels`, { json: body });
}

export function updateLabel(
  c: Client,
  workspaceId: string,
  labelId: string,
  body: unknown,
) {
  return c.put<any>(`/workspaces/${workspaceId}/labels/${labelId}`, {
    json: body,
  });
}

export function deleteLabel(c: Client, workspaceId: string, labelId: string) {
  return c.delete<any>(`/workspaces/${workspaceId}/labels/${labelId}`);
}

// ─────────────────────────────────────────────────────────────────
// Campaigns — create / update / delete (workspace-scoped).
// ─────────────────────────────────────────────────────────────────

export function createCampaign(c: Client, workspaceId: string, body: unknown) {
  return c.post<any>(`/workspaces/${workspaceId}/campaigns`, { json: body });
}

export function updateCampaign(
  c: Client,
  workspaceId: string,
  campaignId: string,
  body: unknown,
) {
  return c.put<any>(`/workspaces/${workspaceId}/campaigns/${campaignId}`, {
    json: body,
  });
}

export function deleteCampaign(
  c: Client,
  workspaceId: string,
  campaignId: string,
) {
  return c.delete<any>(`/workspaces/${workspaceId}/campaigns/${campaignId}`);
}

// ─────────────────────────────────────────────────────────────────
// Team members — add / update / remove (workspace-scoped).
// `member_id` is the membership id (the member_id field from team:list).
// ─────────────────────────────────────────────────────────────────

export function addTeamMember(c: Client, workspaceId: string, body: unknown) {
  return c.post<any>(`/workspaces/${workspaceId}/team-members`, { json: body });
}

export function updateTeamMember(
  c: Client,
  workspaceId: string,
  memberId: string,
  body: unknown,
) {
  return c.put<any>(`/workspaces/${workspaceId}/team-members/${memberId}`, {
    json: body,
  });
}

/**
 * DELETE /workspaces/{w}/team-members/{member_id}
 *
 * When the member is in approval workflows / in-flight posts the backend
 * returns error_code REQUIRES_REMOVAL_CONFIRMATION (422); resend with
 * `confirmed=true` (sent as a `?confirmed=true` query param) to proceed.
 */
export function removeTeamMember(
  c: Client,
  workspaceId: string,
  memberId: string,
  opts: { confirmed?: boolean } = {},
) {
  const params: Record<string, unknown> = {};
  if (opts.confirmed) params.confirmed = "true";
  return c.request<any>(
    "DELETE",
    `/workspaces/${workspaceId}/team-members/${memberId}`,
    { params },
  );
}

// ─────────────────────────────────────────────────────────────────
// Social accounts — remove (disconnect) a connected account.
// `accountId` is the account's `_id` from accounts:list.
// ─────────────────────────────────────────────────────────────────

/**
 * DELETE /workspaces/{w}/accounts/{account_id} — remove (disconnect) a social
 * account. Requires the `save_social` permission (403 otherwise). Returns 404
 * when the account isn't found, and 422 when removal fails. Success is 200
 * with an empty `data` array.
 */
export function removeAccount(
  c: Client,
  workspaceId: string,
  accountId: string,
) {
  return c.delete<any>(`/workspaces/${workspaceId}/accounts/${accountId}`);
}

// ─────────────────────────────────────────────────────────────────
// Social Inbox — conversations (DMs), post comments, reviews, tags.
// (added in v1.1.0)
//
// Inbox "elements" are the unified unit: a conversation, a commented post,
// or a review. They are addressed by `element_ref` — a canonical ref that
// may contain reserved characters, so it is always percent-encoded here.
//
// Note: the inbox list/summary endpoints are POST-with-a-body (not GET with
// query params) because the filter payload is structured.
// ─────────────────────────────────────────────────────────────────

/** Percent-encode a path segment that may contain reserved characters. */
function seg(v: string): string {
  return encodeURIComponent(v);
}

const inboxBase = (workspaceId: string) => `/workspaces/${workspaceId}/inbox`;

/**
 * The inbox service does NOT use the `{status, message, data}` envelope the
 * rest of the v1 API uses. It returns the collection under its own key
 * (`elements`, `messages`, `comments`, `tags`, …) with paginator fields whose
 * names differ per endpoint. These helpers normalise both so inbox commands
 * emit the same `{ok, data, pagination}` envelope as every other command.
 */
function inboxCollection(body: any, ...keys: string[]): any[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const k of [...keys, "data"]) {
      if (Array.isArray(body[k])) return body[k];
    }
  }
  return [];
}

/** Pull a single object out of an inbox response by key, tolerating absence. */
function inboxObject(body: any, key: string): any {
  if (body && typeof body === "object" && key in body) return body[key];
  return body;
}

function buildPagination(o: {
  page?: number;
  perPage?: number;
  total?: number;
  lastPage?: number;
  count: number;
}): Pagination | undefined {
  const { total, count } = o;
  if (typeof total !== "number") return undefined;
  const page = typeof o.page === "number" && o.page > 0 ? o.page : 1;
  const perPage =
    typeof o.perPage === "number" && o.perPage > 0 ? o.perPage : count || total;
  const lastPage =
    typeof o.lastPage === "number" && o.lastPage > 0
      ? o.lastPage
      : perPage > 0
        ? Math.max(1, Math.ceil(total / perPage))
        : 1;
  const from = total === 0 ? null : (page - 1) * perPage + 1;
  const to = total === 0 ? null : Math.min((page - 1) * perPage + count, total);
  return {
    current_page: page,
    per_page: perPage,
    total,
    last_page: lastPage,
    from,
    to,
    has_more: page < lastPage,
  };
}

/** The inbox caps page size at 200 items on every list endpoint. */
export const MAX_INBOX_LIMIT = 200;
/** A single bulk element update may address at most 100 elements. */
export const MAX_INBOX_BULK_REFS = 100;
/** Tag names are capped at 50 characters by POST /inbox/tags. */
export const MAX_INBOX_TAG_NAME = 50;

function assertLimit(limit: number | undefined, flag = "--limit"): void {
  if (limit !== undefined && limit > MAX_INBOX_LIMIT) {
    throw new ConfigError(
      `${flag} may not exceed ${MAX_INBOX_LIMIT} for inbox endpoints (got ${limit}). ` +
        `Page through with --page instead.`,
    );
  }
}

export interface InboxSearchBody {
  inbox_types?: string[];
  action?: string;
  page?: number;
  limit?: number;
  search_term?: string;
  tags?: string[];
  all_channels?: Record<string, unknown>;
  targeted_element?: string;
}

/**
 * POST /workspaces/{w}/inbox/elements/search — the primary inbox read.
 * An empty result set is a successful empty read, not a 404.
 */
export async function searchInboxElements(
  c: Client,
  workspaceId: string,
  body: InboxSearchBody = {},
): Promise<PaginatedResponse<any[]>> {
  assertLimit(body.limit);
  // Response: {status, elements[], total_count, current_page, last_page, limit}
  const raw = await c.request<any>(
    "POST",
    `${inboxBase(workspaceId)}/elements/search`,
    { json: body, unwrap: false },
  );
  const data = inboxCollection(raw, "elements");
  return {
    data,
    pagination: buildPagination({
      page: raw?.current_page ?? body.page,
      perPage: raw?.limit ?? body.limit,
      total: raw?.total_count,
      lastPage: raw?.last_page,
      count: data.length,
    }),
  };
}

/** POST /workspaces/{w}/inbox/elements/summary — unread/pending counts per bucket. */
export async function inboxSummary(
  c: Client,
  workspaceId: string,
  body: { inbox_types?: string[]; all_channels?: Record<string, unknown> } = {},
) {
  // Response: {status, element_counts}
  const raw = await c.request<any>(
    "POST",
    `${inboxBase(workspaceId)}/elements/summary`,
    { json: body, unwrap: false },
  );
  return inboxObject(raw, "element_counts");
}

/**
 * PATCH /workspaces/{w}/inbox/elements — bulk state change across elements
 * (mark done/pending, archive, assign).
 */
export function bulkUpdateInboxElements(
  c: Client,
  workspaceId: string,
  body: {
    element_refs: string[];
    status?: "done" | "pending";
    archived?: boolean;
    assigned?: boolean;
    assigned_to?: Record<string, unknown>;
  },
) {
  if (body.element_refs.length > MAX_INBOX_BULK_REFS) {
    throw new ConfigError(
      `A bulk update may address at most ${MAX_INBOX_BULK_REFS} elements ` +
        `(got ${body.element_refs.length}). Split it into batches.`,
    );
  }
  // The API rejects anything but exactly one operation per call with a 422
  // ("not exactly one operation supplied"). `assigned_to` is part of the
  // assign operation, not an operation of its own.
  const ops = ["status", "archived", "assigned"].filter(
    (k) => (body as Record<string, unknown>)[k] !== undefined,
  );
  if (ops.length !== 1) {
    throw new ConfigError(
      ops.length === 0
        ? "Supply exactly one operation: --status, --archived, or --assigned."
        : `Supply exactly one operation per call — got ${ops.length} (${ops.join(", ")}). ` +
          `Run separate commands.`,
    );
  }
  return c.patch<any>(`${inboxBase(workspaceId)}/elements`, { json: body });
}

/** PUT /workspaces/{w}/inbox/elements/{ref}/read — idempotent. */
export function markInboxElementRead(
  c: Client,
  workspaceId: string,
  elementRef: string,
) {
  return c.put<any>(`${inboxBase(workspaceId)}/elements/${seg(elementRef)}/read`);
}

/** GET /workspaces/{w}/inbox/elements/{ref}/contact — contact profile. */
export async function getInboxContact(
  c: Client,
  workspaceId: string,
  elementRef: string,
  params: { platform_id?: string } = {},
) {
  // Response: {status, contact}
  const raw = await c.request<any>(
    "GET",
    `${inboxBase(workspaceId)}/elements/${seg(elementRef)}/contact`,
    { params, unwrap: false },
  );
  return inboxObject(raw, "contact");
}

/** PATCH /workspaces/{w}/inbox/elements/{ref}/contact — update contact profile. */
export function updateInboxContact(
  c: Client,
  workspaceId: string,
  elementRef: string,
  body: unknown,
) {
  return c.patch<any>(
    `${inboxBase(workspaceId)}/elements/${seg(elementRef)}/contact`,
    { json: body },
  );
}

// ── Conversations (DMs) ──────────────────────────────────────────

export async function listInboxMessages(
  c: Client,
  workspaceId: string,
  conversationId: string,
  params: { page?: number; limit?: number; sort_order?: "asc" | "desc" } = {},
): Promise<PaginatedResponse<any[]>> {
  assertLimit(params.limit);
  // Response: {status, messages[], total_messages, page, page_count}
  const raw = await c.request<any>(
    "GET",
    `${inboxBase(workspaceId)}/conversations/${seg(conversationId)}/messages`,
    { params, unwrap: false },
  );
  const data = inboxCollection(raw, "messages");
  return {
    data,
    pagination: buildPagination({
      page: raw?.page ?? params.page,
      perPage: params.limit,
      total: raw?.total_messages,
      lastPage: raw?.page_count,
      count: data.length,
    }),
  };
}

/**
 * POST /workspaces/{w}/inbox/conversations/{c}/messages — send a DM.
 * multipart/form-data: text-only when no file, media when `filePath` is set.
 *
 * `idempotencyKey` de-duplicates a sequential retry. Per the API docs it does
 * NOT protect against concurrent duplicate sends.
 */
export function sendInboxMessage(
  c: Client,
  workspaceId: string,
  conversationId: string,
  opts: {
    platformType: string;
    platformId: string;
    message?: string;
    filePath?: string;
    fileType?: string;
    idempotencyKey?: string;
  },
) {
  if (!opts.message && !opts.filePath) {
    throw new ConfigError(
      "Provide --message and/or --file — a DM needs text, an attachment, or both.",
    );
  }
  if (opts.filePath && !fs.existsSync(opts.filePath)) {
    throw new ConfigError(`Attachment file not found: ${opts.filePath}`);
  }

  const form = new FormData();
  form.append("platform_type", opts.platformType);
  form.append("platform_id", opts.platformId);
  if (opts.message) form.append("message", opts.message);
  if (opts.fileType) form.append("file_type", opts.fileType);
  if (opts.filePath) {
    form.append("file", fs.createReadStream(opts.filePath), {
      filename: path.basename(opts.filePath),
    });
  }

  return c.request<any>(
    "POST",
    `${inboxBase(workspaceId)}/conversations/${seg(conversationId)}/messages`,
    {
      form,
      extraHeaders: opts.idempotencyKey
        ? { "Idempotency-Key": opts.idempotencyKey }
        : undefined,
    },
  );
}

/** GET /workspaces/{w}/inbox/conversations/{c}/bookmarks — starred messages. */
export async function listInboxBookmarks(
  c: Client,
  workspaceId: string,
  conversationId: string,
  params: { page?: number; limit?: number } = {},
): Promise<PaginatedResponse<any[]>> {
  assertLimit(params.limit);
  // Verified against the live API: {status, bookmarks[], total,
  // total_bookmarks, page, limit} — paginated, though the spec says neither.
  const raw = await c.request<any>(
    "GET",
    `${inboxBase(workspaceId)}/conversations/${seg(conversationId)}/bookmarks`,
    { params, unwrap: false },
  );
  const data = inboxCollection(raw, "bookmarks", "messages");
  return {
    data,
    pagination: buildPagination({
      page: raw?.page ?? params.page,
      perPage: raw?.limit ?? params.limit,
      total: raw?.total_bookmarks ?? raw?.total,
      count: data.length,
    }),
  };
}

/** PUT|DELETE /workspaces/{w}/inbox/messages/{id}/bookmark — star / unstar. */
export function setInboxMessageBookmark(
  c: Client,
  workspaceId: string,
  messageId: string,
  starred: boolean,
) {
  const p = `${inboxBase(workspaceId)}/messages/${seg(messageId)}/bookmark`;
  return starred ? c.put<any>(p) : c.delete<any>(p);
}

/** DELETE /workspaces/{w}/inbox/messages/{id} — soft delete. */
export function deleteInboxMessage(
  c: Client,
  workspaceId: string,
  messageId: string,
  params: { platform_id: string },
) {
  return c.request<any>(
    "DELETE",
    `${inboxBase(workspaceId)}/messages/${seg(messageId)}`,
    { params },
  );
}

// ── Internal notes on a conversation ─────────────────────────────

export async function listInboxNotes(
  c: Client,
  workspaceId: string,
  conversationId: string,
  params: { page?: number; limit?: number } = {},
): Promise<PaginatedResponse<any[]>> {
  assertLimit(params.limit);
  // Verified against the live API: {status, notes[], total, total_notes,
  // page, limit}. The published spec documents no schema here and does not
  // mention that this endpoint paginates.
  const raw = await c.request<any>(
    "GET",
    `${inboxBase(workspaceId)}/conversations/${seg(conversationId)}/notes`,
    { params, unwrap: false },
  );
  const data = inboxCollection(raw, "notes");
  return {
    data,
    pagination: buildPagination({
      page: raw?.page ?? params.page,
      perPage: raw?.limit ?? params.limit,
      total: raw?.total_notes ?? raw?.total,
      count: data.length,
    }),
  };
}

export function addInboxNote(
  c: Client,
  workspaceId: string,
  conversationId: string,
  body: {
    message: string;
    platform_type: string;
    platform_id: string;
    mentioned_users?: string[];
  },
  opts: { idempotencyKey?: string } = {},
) {
  return c.request<any>(
    "POST",
    `${inboxBase(workspaceId)}/conversations/${seg(conversationId)}/notes`,
    {
      json: body,
      extraHeaders: opts.idempotencyKey
        ? { "Idempotency-Key": opts.idempotencyKey }
        : undefined,
    },
  );
}

// ── Post comments ────────────────────────────────────────────────

export async function listInboxPostComments(
  c: Client,
  workspaceId: string,
  postId: string,
  params: { page?: number; limit?: number } = {},
): Promise<PaginatedResponse<any[]>> {
  assertLimit(params.limit);
  // Response: {status, comments[], total_comment_count, total_threads}.
  // `total_threads` is the pagination universe (top-level threads);
  // `total_comment_count` counts replies too, so it must NOT drive paging.
  const raw = await c.request<any>(
    "GET",
    `${inboxBase(workspaceId)}/posts/${seg(postId)}/comments`,
    { params, unwrap: false },
  );
  const data = inboxCollection(raw, "comments");
  return {
    data,
    pagination: buildPagination({
      page: params.page,
      perPage: params.limit,
      total: raw?.total_threads,
      count: data.length,
    }),
  };
}

/**
 * POST /workspaces/{w}/inbox/posts/{p}/comments — comment, threaded reply
 * (pass `commentId`), or Facebook private reply (`isPrivateReply`).
 */
export function addInboxPostComment(
  c: Client,
  workspaceId: string,
  postId: string,
  opts: {
    platformType: string;
    platformId: string;
    message?: string;
    commentId?: string;
    isPrivateReply?: boolean;
    attachmentPath?: string;
    idempotencyKey?: string;
  },
) {
  if (!opts.message && !opts.attachmentPath) {
    throw new ConfigError(
      "Provide --message and/or --attachment — a comment needs text, an attachment, or both.",
    );
  }
  if (opts.attachmentPath && !fs.existsSync(opts.attachmentPath)) {
    throw new ConfigError(`Attachment file not found: ${opts.attachmentPath}`);
  }

  const form = new FormData();
  form.append("platform_type", opts.platformType);
  form.append("platform_id", opts.platformId);
  if (opts.message) form.append("message", opts.message);
  if (opts.commentId) form.append("comment_id", opts.commentId);
  if (opts.isPrivateReply) form.append("is_private_reply", "1");
  if (opts.attachmentPath) {
    form.append("attachment_file", fs.createReadStream(opts.attachmentPath), {
      filename: path.basename(opts.attachmentPath),
    });
  }

  return c.request<any>(
    "POST",
    `${inboxBase(workspaceId)}/posts/${seg(postId)}/comments`,
    {
      form,
      extraHeaders: opts.idempotencyKey
        ? { "Idempotency-Key": opts.idempotencyKey }
        : undefined,
    },
  );
}

/** DELETE /workspaces/{w}/inbox/comments/{id} — `comment_urn` is LinkedIn-only. */
export function deleteInboxComment(
  c: Client,
  workspaceId: string,
  commentId: string,
  params: { platform_type: string; platform_id: string; comment_urn?: string },
) {
  return c.request<any>(
    "DELETE",
    `${inboxBase(workspaceId)}/comments/${seg(commentId)}`,
    { params },
  );
}

/**
 * PUT|DELETE /workspaces/{w}/inbox/comments/{id}/hidden — hide / unhide.
 * Idempotent. Unhide requires platform_type + platform_id; hide does not.
 */
export function setInboxCommentHidden(
  c: Client,
  workspaceId: string,
  commentId: string,
  hidden: boolean,
  params: { platform_type?: string; platform_id?: string } = {},
) {
  const p = `${inboxBase(workspaceId)}/comments/${seg(commentId)}/hidden`;
  return hidden
    ? c.put<any>(p)
    : c.request<any>("DELETE", p, { params });
}

/** PUT|DELETE /workspaces/{w}/inbox/comments/{id}/like — Facebook only, idempotent. */
export function setInboxCommentLike(
  c: Client,
  workspaceId: string,
  commentId: string,
  liked: boolean,
) {
  const p = `${inboxBase(workspaceId)}/comments/${seg(commentId)}/like`;
  return liked ? c.put<any>(p) : c.delete<any>(p);
}

// ── Reviews ──────────────────────────────────────────────────────

/** PUT /workspaces/{w}/inbox/reviews/{id}/reply — upsert (add or replace). */
export function upsertInboxReviewReply(
  c: Client,
  workspaceId: string,
  reviewId: string,
  body: { platform_id: string; review_reply: string },
) {
  return c.put<any>(`${inboxBase(workspaceId)}/reviews/${seg(reviewId)}/reply`, {
    json: body,
  });
}

export function deleteInboxReviewReply(
  c: Client,
  workspaceId: string,
  reviewId: string,
  params: { platform_id: string },
) {
  return c.request<any>(
    "DELETE",
    `${inboxBase(workspaceId)}/reviews/${seg(reviewId)}/reply`,
    { params },
  );
}

// ── Tags ─────────────────────────────────────────────────────────

export async function listInboxTags(c: Client, workspaceId: string) {
  // Response: {status, tags[], total}
  const raw = await c.request<any>("GET", `${inboxBase(workspaceId)}/tags`, {
    unwrap: false,
  });
  return inboxCollection(raw, "tags");
}

export function createInboxTag(
  c: Client,
  workspaceId: string,
  body: { tag_name: string; tag_color: string },
) {
  if (body.tag_name.length > MAX_INBOX_TAG_NAME) {
    throw new ConfigError(
      `Tag name may not exceed ${MAX_INBOX_TAG_NAME} characters ` +
        `(got ${body.tag_name.length}).`,
    );
  }
  return c.post<any>(`${inboxBase(workspaceId)}/tags`, { json: body });
}

export function updateInboxTag(
  c: Client,
  workspaceId: string,
  tagId: string,
  body: { tag_name?: string; tag_color?: string },
) {
  return c.patch<any>(`${inboxBase(workspaceId)}/tags/${seg(tagId)}`, {
    json: body,
  });
}

/** DELETE /workspaces/{w}/inbox/tags — bulk delete by id. */
export function deleteInboxTags(
  c: Client,
  workspaceId: string,
  tagIds: string[],
) {
  return c.delete<any>(`${inboxBase(workspaceId)}/tags`, { tag_ids: tagIds });
}

/** POST /workspaces/{w}/inbox/tags/merge — fold several tags into a new one. */
export function mergeInboxTags(
  c: Client,
  workspaceId: string,
  body: { tag_name: string; tag_color: string; tag_ids: string[] },
) {
  return c.post<any>(`${inboxBase(workspaceId)}/tags/merge`, { json: body });
}

/** POST /workspaces/{w}/inbox/elements/{ref}/tags — attach tags to an element. */
export function attachInboxTags(
  c: Client,
  workspaceId: string,
  elementRef: string,
  body: {
    tags: string[];
    platform_id: string;
    inbox_type: "conversation" | "post" | "review";
  },
) {
  return c.post<any>(
    `${inboxBase(workspaceId)}/elements/${seg(elementRef)}/tags`,
    { json: body },
  );
}

export function detachInboxTag(
  c: Client,
  workspaceId: string,
  elementRef: string,
  tagId: string,
  params: { platform_id: string; inbox_type: string },
) {
  return c.request<any>(
    "DELETE",
    `${inboxBase(workspaceId)}/elements/${seg(elementRef)}/tags/${seg(tagId)}`,
    { params },
  );
}

// Re-export ContentStudioError for convenience in commands.
export { ContentStudioError };

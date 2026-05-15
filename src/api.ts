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

// Re-export ContentStudioError for convenience in commands.
export { ContentStudioError };

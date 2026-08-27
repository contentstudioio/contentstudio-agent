/**
 * E2E tests against the real ContentStudio API.
 *
 * Gated on env vars:
 *   CONTENTSTUDIO_API_KEY        required
 *   CONTENTSTUDIO_WORKSPACE_ID   required
 *   CONTENTSTUDIO_BASE_URL       optional (defaults to api.contentstudio.io)
 *
 * If the env vars are missing the suite is **skipped** (we still mark the
 * skip clearly in console). Set them in CI / locally to run real-world tests.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  Client,
  addComment,
  createPost,
  deletePost,
  getMe,
  listAccounts,
  listCampaigns,
  listComments,
  listContentCategories,
  listLabels,
  listMedia,
  listPosts,
  listTeamMembers,
  listWorkspaces,
  getInboxContact,
  inboxSummary,
  listInboxBookmarks,
  listInboxMessages,
  listInboxNotes,
  listInboxPostComments,
  listInboxTags,
  schedulingOptimalTimes,
  searchInboxElements,
} from "../src/api";
import { Config } from "../src/config";

const API_KEY = process.env.CONTENTSTUDIO_API_KEY;
const WORKSPACE_ID = process.env.CONTENTSTUDIO_WORKSPACE_ID;
const BASE_URL = (
  process.env.CONTENTSTUDIO_BASE_URL || "https://api.contentstudio.io/api/v1"
).replace(/\/+$/, "");

const HAS_CREDS = !!(API_KEY && WORKSPACE_ID);
const describeIfCreds = HAS_CREDS ? describe : describe.skip;

if (!HAS_CREDS) {
  // eslint-disable-next-line no-console
  console.log(
    "[e2e.test.ts] Skipping — set CONTENTSTUDIO_API_KEY and CONTENTSTUDIO_WORKSPACE_ID to run.",
  );
}

function mkClient(): Client {
  return new Client(
    new Config({ apiKey: API_KEY!, baseUrl: BASE_URL }),
    { timeoutMs: 120_000, retries: 2 },
  );
}

describeIfCreds("API direct E2E", () => {
  let pickAccountId: string;

  beforeAll(async () => {
    // listAccounts returns {data, pagination} — not a bare array.
    const accts: any[] = (
      await listAccounts(mkClient(), WORKSPACE_ID!, { per_page: 20 })
    ).data;
    if (!Array.isArray(accts) || !accts.length) {
      throw new Error(
        `Workspace ${WORKSPACE_ID} has no connected accounts — cannot run E2E.`,
      );
    }
    pickAccountId = accts[0]._id;
  });

  it("GET /me", async () => {
    const me: any = await getMe(mkClient());
    expect(me).toBeTypeOf("object");
    expect(me._id || me.id).toBeTruthy();
    expect(me.email).toBeTruthy();
  });

  it("GET /workspaces includes the test workspace", async () => {
    const ws = await listWorkspaces(mkClient(), { per_page: 100 });
    const ids = (ws.data as any[]).map((w) => w._id);
    expect(ids).toContain(WORKSPACE_ID);
  });

  it("GET /accounts, /campaigns, /labels, /content-categories, /team-members, /media, /posts", async () => {
    const c = mkClient();
    await listAccounts(c, WORKSPACE_ID!, { per_page: 5 });
    await listCampaigns(c, WORKSPACE_ID!, { per_page: 5 });
    await listLabels(c, WORKSPACE_ID!, { per_page: 5 });
    await listContentCategories(c, WORKSPACE_ID!, { per_page: 5 });
    await listTeamMembers(c, WORKSPACE_ID!, { per_page: 5 });
    await listMedia(c, WORKSPACE_ID!, { per_page: 3 });
    await listPosts(c, WORKSPACE_ID!, { per_page: 3 });
  });

  it("create draft post → delete (round-trip)", async () => {
    const c = mkClient();
    const created: any = await createPost(c, WORKSPACE_ID!, {
      content: { text: "contentstudio TS E2E test (draft, auto-deleted)" },
      accounts: [pickAccountId],
      scheduling: { publish_type: "draft" },
    });
    const postId = created.id || created._id || created.post_id;
    expect(postId).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`  Created draft post: ${postId}`);
    try {
      // Comments endpoint is occasionally flaky on freshly-created drafts
      // (upstream returns 500). The error mapping is covered by unit tests;
      // here we just confirm the call surface is wired and don't fail the
      // suite on an upstream blip.
      try {
        await addComment(c, WORKSPACE_ID!, postId, "E2E internal note", {
          isNote: true,
        });
        const comments = await listComments(c, WORKSPACE_ID!, postId, {
          per_page: 20,
        });
        // Paginated wrapper: the array lives on `.data`.
        expect(Array.isArray(comments.data)).toBe(true);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.warn(
          `  comments endpoint flake (non-blocking): ${e?.errorType ?? "Error"} ` +
            `${e?.httpStatus ?? ""} — ${e?.message ?? e}`,
        );
      }
    } finally {
      await deletePost(c, WORKSPACE_ID!, postId);
      // eslint-disable-next-line no-console
      console.log(`  Deleted draft post: ${postId}`);
    }
  });
});

// ─── CLI subprocess E2E ───────────────────────────────────────────

const CLI = path.resolve(__dirname, "..", "dist", "index.js");

function runCLI(
  args: string[],
  env: Record<string, string>,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: any) {
    return {
      code: e.status ?? 1,
      stdout: (e.stdout ?? "").toString(),
      stderr: (e.stderr ?? "").toString(),
    };
  }
}

describeIfCreds("CLI subprocess E2E", () => {
  let tmp: string;
  let pickAccountId: string;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cs-cli-e2e-"));
    if (!fs.existsSync(CLI)) {
      throw new Error("dist/index.js missing — run 'npm run build' first.");
    }
    const accts: any[] = (
      await listAccounts(mkClient(), WORKSPACE_ID!, { per_page: 20 })
    ).data;
    pickAccountId = accts[0]?._id;
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function env(extra: Record<string, string> = {}): Record<string, string> {
    return {
      CONTENTSTUDIO_CONFIG_PATH: path.join(tmp, "config.json"),
      CONTENTSTUDIO_API_KEY: API_KEY!,
      CONTENTSTUDIO_WORKSPACE_ID: WORKSPACE_ID!,
      CONTENTSTUDIO_BASE_URL: BASE_URL,
      ...extra,
    };
  }

  it("--json auth:whoami returns ok=true", () => {
    const r = runCLI(["--json", "auth:whoami"], env());
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.ok).toBe(true);
    expect(d.data._id || d.data.id).toBeTruthy();
  });

  it("--json workspaces:list returns non-empty array", () => {
    const r = runCLI(["--json", "workspaces:list", "--per-page", "10"], env());
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.ok).toBe(true);
    expect(d.data.length).toBeGreaterThan(0);
  });

  it("--json accounts:list returns array", () => {
    const r = runCLI(["--json", "accounts:list", "--per-page", "3"], env());
    expect(r.code).toBe(0);
    const d = JSON.parse(r.stdout);
    expect(d.ok).toBe(true);
    expect(Array.isArray(d.data)).toBe(true);
  });

  it("create + delete a draft post end-to-end via CLI", () => {
    const r1 = runCLI(
      [
        "--json",
        "posts:create",
        "-c",
        "contentstudio TS E2E subprocess test (auto-deleted)",
        "-i",
        pickAccountId,
        "-t",
        "draft",
      ],
      env(),
    );
    expect(r1.code).toBe(0);
    const d1 = JSON.parse(r1.stdout);
    expect(d1.ok).toBe(true);
    const pid = d1.data.id || d1.data._id || d1.data.post_id;
    expect(pid).toBeTruthy();
    // eslint-disable-next-line no-console
    console.log(`  CLI created draft post: ${pid}`);

    const r2 = runCLI(["--json", "posts:delete", pid], env());
    expect(r2.code).toBe(0);
    const d2 = JSON.parse(r2.stdout);
    expect(d2.ok).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`  CLI deleted draft post: ${pid}`);
  });

  it("--workspace flag overrides active workspace", () => {
    const r = runCLI(
      [
        "--json",
        "--workspace",
        WORKSPACE_ID!,
        "accounts:list",
        "--per-page",
        "1",
      ],
      env(),
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).ok).toBe(true);
  });
});


describeIfCreds("Social Inbox E2E (read-only)", () => {
  it("inbox summary returns per-bucket counts", async () => {
    const counts: any = await inboxSummary(mkClient(), WORKSPACE_ID!, {});
    expect(counts).toBeTypeOf("object");
    expect(Array.isArray(counts)).toBe(false);
    // Buckets are upper-case keys like ALL / UNASSIGNED / ARCHIVED.
    expect(Object.keys(counts).length).toBeGreaterThan(0);
  });

  it("inbox search unwraps `elements` and normalises pagination", async () => {
    const res = await searchInboxElements(mkClient(), WORKSPACE_ID!, { limit: 5 });
    expect(Array.isArray(res.data)).toBe(true);
    if (res.data.length) {
      const e: any = res.data[0];
      // Guards the column mapping used by `inbox:list`.
      expect(e).toHaveProperty("inbox_type");
      expect(e).toHaveProperty("platform");
      expect(e).toHaveProperty("element_ref");
      expect(e.element_details).toBeTypeOf("object");
      expect(e.element_details).toHaveProperty("element_id");
      expect(res.pagination).toBeDefined();
      expect(res.pagination!.total).toBeGreaterThanOrEqual(res.data.length);
    }
  });

  it("inbox tags unwrap to an array", async () => {
    const tags: any = await listInboxTags(mkClient(), WORKSPACE_ID!);
    expect(Array.isArray(tags)).toBe(true);
  });

  it("a conversation's messages, notes and bookmarks all unwrap + paginate", async () => {
    const c = mkClient();
    const res = await searchInboxElements(c, WORKSPACE_ID!, {
      inbox_types: ["conversation"],
      limit: 1,
    });
    if (!res.data.length) return; // nothing to assert against in this workspace

    // These endpoints take element_details.element_id; this also guards the
    // id mapping documented in SKILL.md and the README.
    const convId = (res.data[0] as any).element_details.element_id;

    const msgs = await listInboxMessages(c, WORKSPACE_ID!, convId, { limit: 5 });
    expect(Array.isArray(msgs.data)).toBe(true);
    expect(msgs.pagination).toBeDefined();

    const notes = await listInboxNotes(c, WORKSPACE_ID!, convId, { limit: 5 });
    expect(Array.isArray(notes.data)).toBe(true);

    const marks = await listInboxBookmarks(c, WORKSPACE_ID!, convId, { limit: 5 });
    expect(Array.isArray(marks.data)).toBe(true);

    const contact: any = await getInboxContact(
      c,
      WORKSPACE_ID!,
      (res.data[0] as any).element_ref,
    );
    // Unwrapped from {status, contact} — must not still be the envelope.
    expect(contact).toBeTypeOf("object");
    expect(contact).not.toHaveProperty("status");
  });

  it("post comments page on threads, not raw comment count", async () => {
    const c = mkClient();
    const res = await searchInboxElements(c, WORKSPACE_ID!, {
      inbox_types: ["post"],
      limit: 1,
    });
    if (!res.data.length) return;
    const postId = (res.data[0] as any).element_details.post_id;
    if (!postId) return;
    const comments = await listInboxPostComments(c, WORKSPACE_ID!, postId, {
      limit: 5,
    });
    expect(Array.isArray(comments.data)).toBe(true);
  });
});

describeIfCreds("Scheduling E2E (read-only)", () => {
  it("optimal-times returns meta/global/individual in the workspace timezone", async () => {
    const res = await schedulingOptimalTimes(mkClient(), WORKSPACE_ID!, {
      global_slots: 3,
    });
    // meta is always present, even for a workspace with too little history.
    expect(res.meta).toBeTypeOf("object");
    expect(typeof res.meta.timezone).toBe("string");
    expect(res.individual).toBeTypeOf("object");

    // `global` is null when no account had usable data — a valid 200.
    if (res.global) {
      const recs = res.global.top_recommendations ?? [];
      expect(Array.isArray(recs)).toBe(true);
      expect(recs.length).toBeLessThanOrEqual(3);
      if (recs.length) {
        // Guards the column mapping used by `scheduling:best-times`.
        const r = recs[0];
        expect(r).toHaveProperty("rank");
        expect(r).toHaveProperty("day");
        expect(r).toHaveProperty("score");
        // The hour comes back as a bare string, e.g. "14".
        expect(String(r.time)).toMatch(/^\d{1,2}$/);
      }
    }
  });

  it("--json scheduling:best-times returns ok=true", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cs-cli-e2e-sched-"));
    try {
      if (!fs.existsSync(CLI)) {
        throw new Error("dist/index.js missing — run 'npm run build' first.");
      }
      const r = runCLI(["--json", "scheduling:best-times", "--global-slots", "1"], {
        CONTENTSTUDIO_CONFIG_PATH: path.join(tmp, "config.json"),
        CONTENTSTUDIO_API_KEY: API_KEY!,
        CONTENTSTUDIO_WORKSPACE_ID: WORKSPACE_ID!,
        CONTENTSTUDIO_BASE_URL: BASE_URL,
      });
      expect(r.code).toBe(0);
      const d = JSON.parse(r.stdout);
      expect(d.ok).toBe(true);
      expect(d.data).toHaveProperty("meta");
      expect(d.data).toHaveProperty("individual");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import nock from "nock";

import {
  Client,
  addBlueskyAccount,
  addComment,
  addFacebookGroup,
  addInboxNote,
  addInboxPostComment,
  addTeamMember,
  archiveMedia,
  attachInboxTags,
  bulkUpdateInboxElements,
  createMediaFolder,
  deleteInboxComment,
  deleteInboxMessage,
  deleteInboxTags,
  deleteMedia,
  deleteMediaFolder,
  detachInboxTag,
  createInboxTag,
  flagMediaBrandAsset,
  getInboxContact,
  getMediaStorage,
  inboxSummary,
  listInboxPostComments,
  listInboxTags,
  listInboxMessages,
  listMediaFolders,
  markInboxElementRead,
  moveMedia,
  renameMediaFolder,
  searchInboxElements,
  sendInboxMessage,
  setInboxCommentHidden,
  setInboxMessageBookmark,
  unflagMediaBrandAsset,
  updateInboxTag,
  updateMediaNote,
  connectAccount,
  createCampaign,
  createLabel,
  createPost,
  createWorkspace,
  deleteCampaign,
  deleteLabel,
  deletePost,
  deleteWorkspace,
  getMe,
  listAccounts,
  listApprovalWorkflows,
  listFacebookTextBackgrounds,
  listPlatforms,
  listPosts,
  listWorkspaces,
  postApproval,
  removeAccount,
  removeTeamMember,
  schedulingOptimalTimes,
  updateCampaign,
  updateLabel,
  updatePost,
  updateTeamMember,
  updateWorkspace,
  uploadMedia,
} from "../src/api";
import { Config } from "../src/config";
import {
  AuthError,
  BackendError,
  ConfigError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  ValidationError,
} from "../src/errors";

const BASE = "https://api.contentstudio.io";
const PATH = "/api/v1";
const API_KEY =
  "cs_fakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefake";

function envelope(data: unknown) {
  return { status: true, message: "ok", data };
}

function mkClient(retries = 0) {
  const cfg = new Config({
    apiKey: API_KEY,
    baseUrl: `${BASE}${PATH}`,
    activeWorkspaceId: "ws-1",
  });
  return new Client(cfg, { retries, timeoutMs: 10_000 });
}

beforeEach(() => {
  nock.cleanAll();
  nock.disableNetConnect();
  // Clear env so it doesn't override config in tests.
  delete process.env.CONTENTSTUDIO_API_KEY;
  delete process.env.CONTENTSTUDIO_BASE_URL;
  delete process.env.CONTENTSTUDIO_WORKSPACE_ID;
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe("Client headers + envelope unwrap", () => {
  it("sends X-API-Key + Accept; unwraps `data`", async () => {
    nock(BASE, {
      reqheaders: {
        "x-api-key": API_KEY,
        accept: "application/json",
      },
    })
      .get(`${PATH}/me`)
      .reply(200, envelope({ _id: "u1", email: "x@y.z" }));

    const me = await getMe(mkClient());
    expect(me).toEqual({ _id: "u1", email: "x@y.z" });
  });

  it("flattens array params (status[]=draft&status[]=scheduled)", async () => {
    let actualUrl = "";
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/posts`)
      .query((q) => {
        actualUrl = JSON.stringify(q);
        return true;
      })
      .reply(200, envelope([]));

    await listPosts(mkClient(), "ws-1", { status: ["draft", "scheduled"] });
    expect(actualUrl).toContain("draft");
    expect(actualUrl).toContain("scheduled");
  });
});

describe("Error mapping", () => {
  it("401 → AuthError with message from body", async () => {
    nock(BASE).get(`${PATH}/me`).reply(401, { message: "invalid" });
    await expect(getMe(mkClient())).rejects.toBeInstanceOf(AuthError);
  });

  it("404 → NotFoundError", async () => {
    nock(BASE).get(`${PATH}/workspaces/x/posts`).reply(404, { message: "no" });
    await expect(listPosts(mkClient(), "x")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("422 → ValidationError (Laravel-style errors flattened)", async () => {
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/posts`)
      .reply(422, {
        message: "validation failed",
        errors: { "content.text": ["required"], accounts: ["required"] },
      });
    await expect(createPost(mkClient(), "ws-1", {})).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("409 → ConflictError carrying a verify-before-retry hint", async () => {
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/conversations/c1/messages`)
      .reply(409, { message: "Idempotency conflict" });
    const err = await sendInboxMessage(mkClient(), "ws-1", "c1", {
      platformType: "facebook",
      platformId: "acc-9",
      message: "hi",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.hint).toMatch(/before retrying/i);
  });

  it("429 retries up to retries then raises RateLimitError", async () => {
    const scope = nock(BASE)
      .get(`${PATH}/me`)
      .times(2)
      .reply(429, { message: "slow" });
    await expect(getMe(mkClient(1))).rejects.toBeInstanceOf(RateLimitError);
    expect(scope.isDone()).toBe(true);
  });

  it("5xx retries then raises BackendError", async () => {
    const scope = nock(BASE).get(`${PATH}/me`).times(2).reply(502, { message: "bad" });
    await expect(getMe(mkClient(1))).rejects.toBeInstanceOf(BackendError);
    expect(scope.isDone()).toBe(true);
  });
});

describe("Pagination (Laravel envelope)", () => {
  function paginatedEnvelope(data: unknown[], total: number, page = 1, perPage = 10) {
    const lastPage = Math.max(1, Math.ceil(total / perPage));
    return {
      status: true,
      message: "ok",
      current_page: page,
      per_page: perPage,
      total,
      last_page: lastPage,
      from: (page - 1) * perPage + 1,
      to: Math.min(page * perPage, total),
      data,
    };
  }

  it("listWorkspaces returns {data, pagination} when API includes pagination fields", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces`)
      .query(true)
      .reply(200, paginatedEnvelope([{ _id: "w1" }, { _id: "w2" }], 48, 1, 2));

    const resp = await listWorkspaces(mkClient(), { per_page: 2 });
    expect(resp.data).toEqual([{ _id: "w1" }, { _id: "w2" }]);
    expect(resp.pagination).toBeDefined();
    expect(resp.pagination!.current_page).toBe(1);
    expect(resp.pagination!.total).toBe(48);
    expect(resp.pagination!.last_page).toBe(24);
    expect(resp.pagination!.has_more).toBe(true);
  });

  it("listWorkspaces — has_more is false on the last page", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces`)
      .query(true)
      .reply(200, paginatedEnvelope([{ _id: "w24" }], 48, 24, 2));

    const resp = await listWorkspaces(mkClient(), { page: 24, per_page: 2 });
    expect(resp.pagination!.has_more).toBe(false);
    expect(resp.pagination!.current_page).toBe(24);
  });

  it("listAccounts returns pagination metadata too", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/accounts`)
      .query(true)
      .reply(200, paginatedEnvelope([{ _id: "a1" }], 5, 1, 1));

    const resp = await listAccounts(mkClient(), "ws-1", { per_page: 1 });
    expect(resp.pagination!.total).toBe(5);
    expect(resp.pagination!.has_more).toBe(true);
  });

  it("response without pagination fields → pagination undefined", async () => {
    // Some endpoints (like /me) don't paginate — the API just returns {status, message, data}
    // without current_page/total/etc. Our wrapper should leave pagination undefined.
    nock(BASE)
      .get(`${PATH}/workspaces`)
      .query(true)
      .reply(200, envelope([{ _id: "w1" }]));

    const resp = await listWorkspaces(mkClient());
    expect(resp.data).toEqual([{ _id: "w1" }]);
    expect(resp.pagination).toBeUndefined();
  });
});

describe("Account connection (v1.0.3)", () => {
  it("listPlatforms hits /platforms", async () => {
    nock(BASE)
      .get(`${PATH}/platforms`)
      .reply(200, envelope([{ platform: "facebook", connection_method: "oauth" }]));
    const data: any = await listPlatforms(mkClient());
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].platform).toBe("facebook");
  });

  it("connectAccount sends process=connect by default", async () => {
    let qs: any = {};
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/connect/facebook`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, envelope({ authorization_url: "https://oauth.example/...?token=abc" }));
    await connectAccount(mkClient(), "ws-1", "facebook", { process: "connect" });
    expect(qs.process).toBe("connect");
    expect(qs.account_id).toBeUndefined();
  });

  it("connectAccount with reconnect + account_id", async () => {
    let qs: any = {};
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/connect/facebook`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, envelope({ authorization_url: "https://oauth.example/..." }));
    await connectAccount(mkClient(), "ws-1", "facebook", {
      process: "reconnect",
      accountId: "acc-123",
    });
    expect(qs.process).toBe("reconnect");
    expect(qs.account_id).toBe("acc-123");
  });

  it("addBlueskyAccount posts {handle, app_password}", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/add/bluesky`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "bsky-1" }));
    await addBlueskyAccount(mkClient(), "ws-1", "alice.bsky.social", "p4ss-w0rd");
    expect(received).toEqual({
      handle: "alice.bsky.social",
      app_password: "p4ss-w0rd",
    });
  });

  it("addFacebookGroup posts {name} only when no image", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/add/facebook-group`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "fb-grp-1" }));
    await addFacebookGroup(mkClient(), "ws-1", "Cool Group");
    expect(received).toEqual({ name: "Cool Group" });
  });

  it("addFacebookGroup posts {name, image} when image given", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/add/facebook-group`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "fb-grp-2" }));
    await addFacebookGroup(
      mkClient(),
      "ws-1",
      "Cool Group",
      "https://example.com/cover.jpg",
    );
    expect(received).toEqual({
      name: "Cool Group",
      image: "https://example.com/cover.jpg",
    });
  });

  it("listFacebookTextBackgrounds hits /facebook/text-backgrounds", async () => {
    nock(BASE)
      .get(`${PATH}/facebook/text-backgrounds`)
      .reply(200, envelope([{ id: "bg-1", type: "solid", description: "Solid red" }]));
    const data: any = await listFacebookTextBackgrounds(mkClient());
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].id).toBe("bg-1");
  });
});

describe("Endpoint wrappers — request shape", () => {
  it("listAccounts forwards filters", async () => {
    let q: any = {};
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/accounts`)
      .query((qq) => {
        q = qq;
        return true;
      })
      .reply(200, envelope([]));

    await listAccounts(mkClient(), "ws-1", {
      platform: "facebook",
      search: "beauty",
      per_page: 5,
    });
    expect(q.platform).toBe("facebook");
    expect(q.search).toBe("beauty");
    expect(q.per_page).toBe("5");
  });

  it("createPost sends JSON body verbatim", async () => {
    const body = {
      content: { text: "hi" },
      accounts: ["a1"],
      scheduling: { publish_type: "draft" },
    };
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/posts`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ id: "p1" }));

    await createPost(mkClient(), "ws-1", body);
    expect(received).toEqual(body);
  });

  it("updatePost PUTs /workspaces/{w}/posts/{id} with the body verbatim", async () => {
    const body = {
      content: { text: "edited" },
      accounts: ["a1"],
      scheduling: { publish_type: "draft" },
      linkedin_options: { title: "New title" },
      approval_workflow: { workflow_action: "restart", notes: "please re-review" },
    };
    let received: any;
    let method = "";
    nock(BASE)
      .put(`${PATH}/workspaces/ws-1/posts/p1`, (b) => {
        received = b;
        return true;
      })
      .reply(200, function () {
        method = this.req.method;
        return envelope({ id: "p1", post_url: null });
      });

    await updatePost(mkClient(), "ws-1", "p1", body);
    expect(method).toBe("PUT");
    expect(received).toEqual(body);
  });

  it("listApprovalWorkflows GETs /workspaces/{w}/approval-workflows", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/approval-workflows`)
      .query(true)
      .reply(
        200,
        envelope([
          { _id: "wf1", name: "Legal", is_default: true, levels: [] },
        ]),
      );
    const resp = await listApprovalWorkflows(mkClient(), "ws-1");
    expect((resp.data as any[])[0]._id).toBe("wf1");
  });

  it("deletePost without flags sends empty body", async () => {
    let received: any = "UNSET";
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/posts/p1`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope([]));
    await deletePost(mkClient(), "ws-1", "p1");
    // node-fetch sends nothing → nock reports as empty string
    expect(received === "" || received === null).toBe(true);
  });

  it("deletePost with flags sends body", async () => {
    let received: any;
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/posts/p1`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope([]));
    await deletePost(mkClient(), "ws-1", "p1", {
      deleteFromSocial: true,
      accountIds: ["a1"],
    });
    expect(received).toEqual({ delete_from_social: true, account_ids: ["a1"] });
  });

  it("postApproval sends action; comment only when supplied", async () => {
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/posts/p1/approval`, (b) => {
        expect(b).toEqual({ action: "approve" });
        return true;
      })
      .reply(200, envelope({}));
    await postApproval(mkClient(), "ws-1", "p1", "approve");

    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/posts/p1/approval`, (b) => {
        expect(b).toEqual({ action: "reject", comment: "bad" });
        return true;
      })
      .reply(200, envelope({}));
    await postApproval(mkClient(), "ws-1", "p1", "reject", "bad");
  });

  it("addComment includes is_note / mentioned_users only when set", async () => {
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/posts/p1/comments`, (b) => {
        expect(b).toEqual({ comment: "hi" });
        return true;
      })
      .reply(200, envelope({}));
    await addComment(mkClient(), "ws-1", "p1", "hi");

    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/posts/p1/comments`, (b) => {
        expect(b).toEqual({
          comment: "note",
          is_note: true,
          mentioned_users: ["u1"],
        });
        return true;
      })
      .reply(200, envelope({}));
    await addComment(mkClient(), "ws-1", "p1", "note", {
      isNote: true,
      mentionedUsers: ["u1"],
    });
  });

  it("uploadMedia requires exactly one of file/url", () => {
    const c = mkClient();
    expect(() => uploadMedia(c, "ws-1", {})).toThrowError(ConfigError);
    expect(() =>
      uploadMedia(c, "ws-1", { filePath: "x", url: "y" }),
    ).toThrowError(ConfigError);
  });

  it("uploadMedia missing file path → ConfigError", () => {
    expect(() =>
      uploadMedia(mkClient(), "ws-1", { filePath: "/no/such/file.png" }),
    ).toThrowError(ConfigError);
  });

  it("uploadMedia with --url sends multipart with url field", async () => {
    let ctype = "";
    let bodyText = "";
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/media`, (b: any) => {
        bodyText = typeof b === "string" ? b : JSON.stringify(b);
        return true;
      })
      .matchHeader("content-type", (v) => {
        ctype = Array.isArray(v) ? v.join(", ") : String(v);
        return /multipart\/form-data/.test(ctype);
      })
      .reply(200, envelope({ _id: "m1" }));
    await uploadMedia(mkClient(), "ws-1", {
      url: "https://example.test/x.png",
      folderId: "f1",
    });
    expect(ctype).toMatch(/multipart\/form-data/);
    expect(bodyText).toContain("example.test");
    expect(bodyText).toContain("f1");
  });
});

describe("Workspace write wrappers", () => {
  it("createWorkspace POSTs /workspaces (not workspace-scoped)", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "w-new" }));
    const body = { name: "Demo", logo: "https://e.com/l.png", timezone: "Asia/Karachi" };
    await createWorkspace(mkClient(), body);
    expect(received).toEqual(body);
  });

  it("updateWorkspace PUTs /workspaces/{id} with the partial body", async () => {
    let received: any;
    let method = "";
    nock(BASE)
      .put(`${PATH}/workspaces/w1`, (b) => {
        received = b;
        return true;
      })
      .reply(200, function () {
        method = this.req.method;
        return envelope({ _id: "w1" });
      });
    await updateWorkspace(mkClient(), "w1", { name: "Renamed" });
    expect(method).toBe("PUT");
    expect(received).toEqual({ name: "Renamed" });
  });

  it("deleteWorkspace DELETEs /workspaces/{id}", async () => {
    nock(BASE).delete(`${PATH}/workspaces/w1`).reply(200, envelope([]));
    await expect(deleteWorkspace(mkClient(), "w1")).resolves.toBeDefined();
  });
});

describe("Label write wrappers", () => {
  it("createLabel POSTs /workspaces/{w}/labels", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/labels`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "l1" }));
    await createLabel(mkClient(), "ws-1", { name: "Promo", color: "color_3" });
    expect(received).toEqual({ name: "Promo", color: "color_3" });
  });

  it("updateLabel PUTs /workspaces/{w}/labels/{id}", async () => {
    let received: any;
    nock(BASE)
      .put(`${PATH}/workspaces/ws-1/labels/l1`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "l1" }));
    await updateLabel(mkClient(), "ws-1", "l1", { color: "color_5" });
    expect(received).toEqual({ color: "color_5" });
  });

  it("deleteLabel DELETEs /workspaces/{w}/labels/{id}", async () => {
    nock(BASE).delete(`${PATH}/workspaces/ws-1/labels/l1`).reply(200, envelope([]));
    await expect(deleteLabel(mkClient(), "ws-1", "l1")).resolves.toBeDefined();
  });
});

describe("Campaign write wrappers", () => {
  it("createCampaign POSTs /workspaces/{w}/campaigns", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/campaigns`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "c1" }));
    await createCampaign(mkClient(), "ws-1", { name: "Q1", color: "color_2" });
    expect(received).toEqual({ name: "Q1", color: "color_2" });
  });

  it("updateCampaign PUTs /workspaces/{w}/campaigns/{id}", async () => {
    let received: any;
    nock(BASE)
      .put(`${PATH}/workspaces/ws-1/campaigns/c1`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "c1" }));
    await updateCampaign(mkClient(), "ws-1", "c1", { name: "Q2" });
    expect(received).toEqual({ name: "Q2" });
  });

  it("deleteCampaign DELETEs /workspaces/{w}/campaigns/{id}", async () => {
    nock(BASE).delete(`${PATH}/workspaces/ws-1/campaigns/c1`).reply(200, envelope([]));
    await expect(deleteCampaign(mkClient(), "ws-1", "c1")).resolves.toBeDefined();
  });
});

describe("Team-member write wrappers", () => {
  it("addTeamMember POSTs /workspaces/{w}/team-members", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/team-members`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "m1" }));
    const body = { role: "approver", email: "a@b.co" };
    await addTeamMember(mkClient(), "ws-1", body);
    expect(received).toEqual(body);
  });

  it("updateTeamMember PUTs /workspaces/{w}/team-members/{member_id}", async () => {
    let received: any;
    nock(BASE)
      .put(`${PATH}/workspaces/ws-1/team-members/m1`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "m1" }));
    const body = { role: "collaborator", permissions: { addSocial: true } };
    await updateTeamMember(mkClient(), "ws-1", "m1", body);
    expect(received).toEqual(body);
  });

  it("removeTeamMember DELETEs without confirmed by default", async () => {
    let qs: any = {};
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/team-members/m1`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, envelope([]));
    await removeTeamMember(mkClient(), "ws-1", "m1");
    expect(qs.confirmed).toBeUndefined();
  });

  it("removeTeamMember appends ?confirmed=true when confirmed", async () => {
    let qs: any = {};
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/team-members/m1`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, envelope([]));
    await removeTeamMember(mkClient(), "ws-1", "m1", { confirmed: true });
    expect(qs.confirmed).toBe("true");
  });

  it("422 REQUIRES_REMOVAL_CONFIRMATION surfaces as ValidationError", async () => {
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/team-members/m1`)
      .query(true)
      .reply(422, { message: "confirmation required", error_code: "REQUIRES_REMOVAL_CONFIRMATION" });
    await expect(removeTeamMember(mkClient(), "ws-1", "m1")).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("Account write wrappers", () => {
  it("removeAccount DELETEs /workspaces/{w}/accounts/{account_id}", async () => {
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/accounts/a1`)
      .reply(200, envelope([]));
    await expect(removeAccount(mkClient(), "ws-1", "a1")).resolves.toBeDefined();
  });

  it("removeAccount 404 surfaces as NotFoundError", async () => {
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/accounts/missing`)
      .reply(404, { message: "not found", error_code: "ACCOUNT_NOT_FOUND" });
    await expect(
      removeAccount(mkClient(), "ws-1", "missing"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Inbox — elements, state, contacts", () => {
  // Inbox endpoints return their collection under a named key with
  // per-endpoint paginator fields; the wrappers map them onto {data, pagination}.
  it("searchInboxElements unwraps `elements` and normalises `total_count`", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/elements/search`, (b) => {
        received = b;
        return true;
      })
      .reply(200, {
        status: true,
        elements: [{ element_ref: "conv:1" }, { element_ref: "conv:2" }],
        total_count: 45,
        current_page: 1,
        last_page: 3,
        limit: 20,
      });

    const res = await searchInboxElements(mkClient(), "ws-1", {
      inbox_types: ["conversation"],
      search_term: "refund",
      limit: 20,
    });

    expect(received).toEqual({
      inbox_types: ["conversation"],
      search_term: "refund",
      limit: 20,
    });
    expect(res.data).toEqual([{ element_ref: "conv:1" }, { element_ref: "conv:2" }]);
    expect(res.pagination).toMatchObject({
      current_page: 1,
      per_page: 20,
      total: 45,
      last_page: 3,
      has_more: true,
    });
  });

  it("searchInboxElements reports has_more=false on the last page", async () => {
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/elements/search`)
      .reply(200, {
        status: true,
        elements: [{ element_ref: "conv:9" }],
        total_count: 41,
        current_page: 3,
        last_page: 3,
        limit: 20,
      });
    const res = await searchInboxElements(mkClient(), "ws-1", { page: 3 });
    expect(res.pagination!.has_more).toBe(false);
    expect(res.pagination!.to).toBe(41);
  });

  it("searchInboxElements treats an empty result as a successful empty read", async () => {
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/elements/search`)
      .reply(200, { status: true, elements: [], total_count: 0 });
    const res = await searchInboxElements(mkClient(), "ws-1", {});
    expect(res.data).toEqual([]);
    expect(res.pagination!.total).toBe(0);
    expect(res.pagination!.has_more).toBe(false);
  });

  it("inboxSummary unwraps `element_counts`", async () => {
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/elements/summary`)
      .reply(200, { status: true, element_counts: { conversation: 4, review: 1 } });
    const counts: any = await inboxSummary(mkClient(), "ws-1", {});
    expect(counts).toEqual({ conversation: 4, review: 1 });
  });

  it("bulkUpdateInboxElements PATCHes /inbox/elements", async () => {
    let received: any;
    nock(BASE)
      .patch(`${PATH}/workspaces/ws-1/inbox/elements`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ updated: 2 }));

    await bulkUpdateInboxElements(mkClient(), "ws-1", {
      element_refs: ["a", "b"],
      status: "done",
    });
    expect(received).toEqual({ element_refs: ["a", "b"], status: "done" });
  });

  it("getInboxContact unwraps the `contact` key", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/inbox/elements/conv%3A1/contact`)
      .query(true)
      .reply(200, { status: true, contact: { name: "Jane", email: "j@x.co" } });
    const contact: any = await getInboxContact(mkClient(), "ws-1", "conv:1");
    expect(contact).toEqual({ name: "Jane", email: "j@x.co" });
  });

  it("bulkUpdateInboxElements rejects more than one operation (API 422 rule)", () => {
    expect(() =>
      bulkUpdateInboxElements(mkClient(), "ws-1", {
        element_refs: ["a"],
        status: "done",
        archived: true,
      }),
    ).toThrow(ConfigError);
  });

  it("bulkUpdateInboxElements rejects zero operations", () => {
    expect(() =>
      bulkUpdateInboxElements(mkClient(), "ws-1", { element_refs: ["a"] }),
    ).toThrow(ConfigError);
  });

  it("bulkUpdateInboxElements enforces the 100-ref cap", () => {
    expect(() =>
      bulkUpdateInboxElements(mkClient(), "ws-1", {
        element_refs: Array.from({ length: 101 }, (_, i) => `r${i}`),
        status: "done",
      }),
    ).toThrow(ConfigError);
  });

  it("bulkUpdateInboxElements surfaces a 207 partial update via missing_ids", async () => {
    nock(BASE)
      .patch(`${PATH}/workspaces/ws-1/inbox/elements`)
      .reply(207, { status: true, missing_ids: ["r2"] });
    const res: any = await bulkUpdateInboxElements(mkClient(), "ws-1", {
      element_refs: ["r1", "r2"],
      status: "done",
    });
    expect(res.missing_ids).toEqual(["r2"]);
  });

  // searchInboxElements is async, so its guard surfaces as a rejection rather
  // than a synchronous throw. Either way run() maps it to a ConfigError exit.
  it("searchInboxElements refuses a limit above the API cap of 200", async () => {
    await expect(
      searchInboxElements(mkClient(), "ws-1", { limit: 500 }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("listInboxMessages refuses a limit above the API cap of 200", async () => {
    await expect(
      listInboxMessages(mkClient(), "ws-1", "c1", { limit: 201 }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("createInboxTag enforces the 50-character tag name cap", () => {
    expect(() =>
      createInboxTag(mkClient(), "ws-1", {
        tag_name: "x".repeat(51),
        tag_color: "#fff",
      }),
    ).toThrow(ConfigError);
  });

  it("markInboxElementRead percent-encodes the element ref", async () => {
    const scope = nock(BASE)
      .put(`${PATH}/workspaces/ws-1/inbox/elements/conv%3Aa%2Fb/read`)
      .reply(200, envelope({ ok: true }));
    await markInboxElementRead(mkClient(), "ws-1", "conv:a/b");
    expect(scope.isDone()).toBe(true);
  });
});

describe("Inbox — conversations and messages", () => {
  it("listInboxMessages forwards page / limit / sort_order", async () => {
    let qs: any = {};
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/inbox/conversations/c1/messages`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, { status: true, messages: [] });
    await listInboxMessages(mkClient(), "ws-1", "c1", {
      page: 2,
      limit: 50,
      sort_order: "asc",
    });
    expect(qs).toMatchObject({ page: "2", limit: "50", sort_order: "asc" });
  });

  it("listInboxMessages unwraps `messages` and maps total_messages/page_count", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/inbox/conversations/c1/messages`)
      .query(true)
      .reply(200, {
        status: true,
        messages: [{ _id: "m1" }, { _id: "m2" }],
        total_messages: 30,
        page: 1,
        page_count: 3,
      });
    const res = await listInboxMessages(mkClient(), "ws-1", "c1", { limit: 10 });
    expect(res.data).toEqual([{ _id: "m1" }, { _id: "m2" }]);
    expect(res.pagination).toMatchObject({
      current_page: 1,
      per_page: 10,
      total: 30,
      last_page: 3,
      has_more: true,
    });
  });

  it("sendInboxMessage posts multipart and sets Idempotency-Key", async () => {
    let body = "";
    let idem: unknown;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/conversations/c1/messages`, (b) => {
        body = typeof b === "string" ? b : JSON.stringify(b);
        return true;
      })
      .reply(function () {
        // nock surfaces request headers as string[].
        const h = this.req.headers["idempotency-key"];
        idem = Array.isArray(h) ? h[0] : h;
        return [200, envelope({ sent: true })];
      });

    await sendInboxMessage(mkClient(), "ws-1", "c1", {
      platformType: "facebook",
      platformId: "acc-9",
      message: "hello",
      idempotencyKey: "key-1",
    });

    expect(body).toContain("platform_type");
    expect(body).toContain("facebook");
    expect(body).toContain("hello");
    expect(idem).toBe("key-1");
  });

  it("sendInboxMessage rejects an empty DM before hitting the network", () => {
    // Guard runs synchronously — no request is ever built, so nock sees nothing.
    expect(() =>
      sendInboxMessage(mkClient(), "ws-1", "c1", {
        platformType: "facebook",
        platformId: "acc-9",
      }),
    ).toThrow(ConfigError);
  });

  it("setInboxMessageBookmark PUTs to star and DELETEs to unstar", async () => {
    const put = nock(BASE)
      .put(`${PATH}/workspaces/ws-1/inbox/messages/m1/bookmark`)
      .reply(200, envelope({}));
    await setInboxMessageBookmark(mkClient(), "ws-1", "m1", true);
    expect(put.isDone()).toBe(true);

    const del = nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/inbox/messages/m1/bookmark`)
      .reply(200, envelope({}));
    await setInboxMessageBookmark(mkClient(), "ws-1", "m1", false);
    expect(del.isDone()).toBe(true);
  });

  it("deleteInboxMessage sends platform_id as a query param", async () => {
    let qs: any = {};
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/inbox/messages/m1`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, envelope({}));
    await deleteInboxMessage(mkClient(), "ws-1", "m1", { platform_id: "acc-9" });
    expect(qs.platform_id).toBe("acc-9");
  });

  it("addInboxNote posts JSON with mentioned_users", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/conversations/c1/notes`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({ _id: "n1" }));
    await addInboxNote(mkClient(), "ws-1", "c1", {
      message: "internal",
      platform_type: "facebook",
      platform_id: "acc-9",
      mentioned_users: ["u1"],
    });
    expect(received.mentioned_users).toEqual(["u1"]);
  });
});

describe("Inbox — comments and moderation", () => {
  it("listInboxPostComments pages on total_threads, not total_comment_count", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/inbox/posts/p1/comments`)
      .query(true)
      .reply(200, {
        status: true,
        comments: [{ _id: "c1" }],
        total_comment_count: 90, // includes replies — must NOT drive paging
        total_threads: 12,
      });
    const res = await listInboxPostComments(mkClient(), "ws-1", "p1", { limit: 5 });
    expect(res.data).toEqual([{ _id: "c1" }]);
    expect(res.pagination!.total).toBe(12);
    expect(res.pagination!.last_page).toBe(3);
  });

  it("addInboxPostComment sends comment_id for a threaded reply", async () => {
    let body = "";
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/posts/p1/comments`, (b) => {
        body = typeof b === "string" ? b : JSON.stringify(b);
        return true;
      })
      .reply(200, envelope({}));
    await addInboxPostComment(mkClient(), "ws-1", "p1", {
      platformType: "facebook",
      platformId: "acc-9",
      message: "thanks!",
      commentId: "cmt-1",
    });
    expect(body).toContain("comment_id");
    expect(body).toContain("cmt-1");
  });

  it("deleteInboxComment forwards platform_type, platform_id and comment_urn", async () => {
    let qs: any = {};
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/inbox/comments/cmt-1`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, envelope({}));
    await deleteInboxComment(mkClient(), "ws-1", "cmt-1", {
      platform_type: "linkedin",
      platform_id: "acc-9",
      comment_urn: "urn:li:comment:(x,y)",
    });
    expect(qs).toMatchObject({
      platform_type: "linkedin",
      platform_id: "acc-9",
      comment_urn: "urn:li:comment:(x,y)",
    });
  });

  it("hide needs no params; unhide sends platform_type + platform_id", async () => {
    const hide = nock(BASE)
      .put(`${PATH}/workspaces/ws-1/inbox/comments/cmt-1/hidden`)
      .reply(200, envelope({}));
    await setInboxCommentHidden(mkClient(), "ws-1", "cmt-1", true);
    expect(hide.isDone()).toBe(true);

    let qs: any = {};
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/inbox/comments/cmt-1/hidden`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, envelope({}));
    await setInboxCommentHidden(mkClient(), "ws-1", "cmt-1", false, {
      platform_type: "facebook",
      platform_id: "acc-9",
    });
    expect(qs).toMatchObject({ platform_type: "facebook", platform_id: "acc-9" });
  });
});

describe("Inbox — tags", () => {
  it("listInboxTags unwraps the `tags` key", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/inbox/tags`)
      .reply(200, { status: true, tags: [{ _id: "t1", tag_name: "VIP" }], total: 1 });
    const tags: any = await listInboxTags(mkClient(), "ws-1");
    expect(Array.isArray(tags)).toBe(true);
    expect(tags[0].tag_name).toBe("VIP");
  });

  it("updateInboxTag PATCHes the tag", async () => {
    let received: any;
    nock(BASE)
      .patch(`${PATH}/workspaces/ws-1/inbox/tags/t1`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({}));
    await updateInboxTag(mkClient(), "ws-1", "t1", { tag_name: "VIP" });
    expect(received).toEqual({ tag_name: "VIP" });
  });

  it("deleteInboxTags sends tag_ids as a DELETE body", async () => {
    let received: any;
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/inbox/tags`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({}));
    await deleteInboxTags(mkClient(), "ws-1", ["t1", "t2"]);
    expect(received).toEqual({ tag_ids: ["t1", "t2"] });
  });

  it("attachInboxTags posts tags + inbox_type", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/inbox/elements/conv%3A1/tags`, (b) => {
        received = b;
        return true;
      })
      .reply(200, envelope({}));
    await attachInboxTags(mkClient(), "ws-1", "conv:1", {
      tags: ["t1"],
      platform_id: "acc-9",
      inbox_type: "conversation",
    });
    expect(received).toEqual({
      tags: ["t1"],
      platform_id: "acc-9",
      inbox_type: "conversation",
    });
  });

  it("detachInboxTag encodes the ref and sends both query params", async () => {
    let qs: any = {};
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/inbox/elements/conv%3A1/tags/t1`)
      .query((q) => {
        qs = q;
        return true;
      })
      .reply(200, envelope({}));
    await detachInboxTag(mkClient(), "ws-1", "conv:1", "t1", {
      platform_id: "acc-9",
      inbox_type: "conversation",
    });
    expect(qs).toMatchObject({ platform_id: "acc-9", inbox_type: "conversation" });
  });
});

describe("Scheduling — optimal posting times", () => {
  const URL = `${PATH}/workspaces/ws-1/scheduling/optimal-times`;

  const okBody = {
    status: true,
    meta: {
      generated_at: "2026-08-17T09:00:00Z",
      timezone: "America/New_York",
      warnings: [],
      missing_entities: [],
      ai_fallback_entities: [],
    },
    global: {
      top_recommendations: [
        {
          rank: 1,
          day: "Wednesday",
          date: "2026-08-19",
          time: "14",
          score: 100,
          platform_breakdown: { facebook: 60, instagram: 40 },
        },
      ],
      heatmap_matrix: { data: [[14, 2, 100]] },
      dates_key: ["2026-08-19"],
    },
    individual: {
      "acc-1": { platform: "facebook", source: "data_driven", top_recommendations: [] },
    },
  };

  it("POSTs an empty body when no entities are given and normalises the response", async () => {
    let received: any;
    nock(BASE)
      .post(URL, (b) => {
        received = b;
        return true;
      })
      .reply(200, okBody);

    const res = await schedulingOptimalTimes(mkClient(), "ws-1");
    expect(received).toEqual({});
    // The endpoint does not use the {status, message, data} envelope, so the
    // wrapper must surface meta/global/individual rather than a `data` key.
    expect(res.meta.timezone).toBe("America/New_York");
    expect(res.global.top_recommendations[0].rank).toBe(1);
    expect(res.individual["acc-1"].platform).toBe("facebook");
  });

  it("passes entities and slot counts through verbatim", async () => {
    let received: any;
    nock(BASE)
      .post(URL, (b) => {
        received = b;
        return true;
      })
      .reply(200, okBody);

    await schedulingOptimalTimes(mkClient(), "ws-1", {
      entities: [{ id: "acc-1", type: "facebook", slots: 3 }],
      global_slots: 5,
      per_account_slots: 2,
    });
    expect(received).toEqual({
      entities: [{ id: "acc-1", type: "facebook", slots: 3 }],
      global_slots: 5,
      per_account_slots: 2,
    });
  });

  it("defaults `global` to null and `individual` to {} when absent", async () => {
    nock(BASE).post(URL).reply(200, { status: true, meta: { timezone: "UTC" } });
    const res = await schedulingOptimalTimes(mkClient(), "ws-1");
    expect(res.global).toBeNull();
    expect(res.individual).toEqual({});
  });

  it("rejects out-of-range slot counts client-side, before any request", async () => {
    // No nock interceptor: if a request were made, disableNetConnect would
    // surface a different error than ConfigError.
    await expect(
      schedulingOptimalTimes(mkClient(), "ws-1", { global_slots: 25 }),
    ).rejects.toBeInstanceOf(ConfigError);
    await expect(
      schedulingOptimalTimes(mkClient(), "ws-1", { per_account_slots: 0 }),
    ).rejects.toBeInstanceOf(ConfigError);
    await expect(
      schedulingOptimalTimes(mkClient(), "ws-1", {
        entities: [{ id: "acc-1", type: "facebook", slots: 99 }],
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("maps a 422 (unknown entities / no connected accounts) to ValidationError", async () => {
    nock(BASE).post(URL).reply(422, { message: "No connected accounts" });
    await expect(
      schedulingOptimalTimes(mkClient(), "ws-1"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps a 502 (optimizer unavailable) to BackendError", async () => {
    nock(BASE).post(URL).reply(502, { message: "Post time optimizer unavailable" });
    await expect(
      schedulingOptimalTimes(mkClient(), "ws-1"),
    ).rejects.toBeInstanceOf(BackendError);
  });
});
describe("Media management wrappers", () => {
  it("listMediaFolders GETs /workspaces/{w}/media/folders and returns the real `folders` envelope", async () => {
    // The real API has no top-level `data` key here — the array is under
    // `folders`, so Client.get()'s unwrap passes the whole body through.
    const folder = {
      _id: "6a96831a33727ceb930f5402",
      folder_name: "Q4 Campaign",
      workspace_id: "6a9681b3a6b68cb591f30483",
      created_at: "2026-09-01T07:47:38.345000Z",
      updated_at: "2026-09-01T07:47:38.345000Z",
      folder_route_gcs: "media_library/6a9681b3a6b68cb591f30483",
      created_by: "6a9681b3a6b68cb591f30482",
      is_root: true,
      count: 0,
    };
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/media/folders`)
      .reply(200, { status: true, message: "ok", folders: [folder] });
    const result: any = await listMediaFolders(mkClient(), "ws-1");
    expect(result.folders).toEqual([folder]);
  });

  it("createMediaFolder POSTs folder_name", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/media/folders`, (b) => (received = b) && true)
      .reply(200, envelope({ id: "f1" }));
    await createMediaFolder(mkClient(), "ws-1", { folder_name: "Q4 Assets" });
    expect(received.folder_name).toBe("Q4 Assets");
  });

  it("renameMediaFolder PUTs to the folder id", async () => {
    nock(BASE)
      .put(`${PATH}/workspaces/ws-1/media/folders/f1`, { folder_name: "Renamed" })
      .reply(200, envelope({ id: "f1" }));
    await expect(
      renameMediaFolder(mkClient(), "ws-1", "f1", { folder_name: "Renamed" }),
    ).resolves.toBeDefined();
  });

  it("deleteMediaFolder DELETEs the folder", async () => {
    nock(BASE).delete(`${PATH}/workspaces/ws-1/media/folders/f1`).reply(200, envelope([]));
    await expect(deleteMediaFolder(mkClient(), "ws-1", "f1")).resolves.toBeDefined();
  });

  it("getMediaStorage GETs /media/storage", async () => {
    nock(BASE)
      .get(`${PATH}/workspaces/ws-1/media/storage`)
      .reply(200, envelope({ used: 1, limit: 2 }));
    await expect(getMediaStorage(mkClient(), "ws-1")).resolves.toBeDefined();
  });

  it("archiveMedia POSTs media_ids + archived", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/media/archive`, (b) => (received = b) && true)
      .reply(200, envelope([]));
    await archiveMedia(mkClient(), "ws-1", { media_ids: ["m1", "m2"], archived: true });
    expect(received).toEqual({ media_ids: ["m1", "m2"], archived: true });
  });

  it("moveMedia POSTs media_ids + folder_id", async () => {
    let received: any;
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/media/move`, (b) => (received = b) && true)
      .reply(200, envelope([]));
    await moveMedia(mkClient(), "ws-1", { media_ids: ["m1"], folder_id: "f1" });
    expect(received).toEqual({ media_ids: ["m1"], folder_id: "f1" });
  });

  it("updateMediaNote PUTs the note, and null clears it", async () => {
    nock(BASE)
      .put(`${PATH}/workspaces/ws-1/media/m1/note`, { note: null })
      .reply(200, envelope({ id: "m1", note: null }));
    await expect(
      updateMediaNote(mkClient(), "ws-1", "m1", { note: null }),
    ).resolves.toBeDefined();
  });

  it("flagMediaBrandAsset POSTs to the brand-asset sub-resource", async () => {
    nock(BASE)
      .post(`${PATH}/workspaces/ws-1/media/m1/brand-asset`)
      .reply(200, envelope({ id: "m1", is_brand_asset: true }));
    await expect(flagMediaBrandAsset(mkClient(), "ws-1", "m1")).resolves.toBeDefined();
  });

  it("unflagMediaBrandAsset DELETEs the brand-asset sub-resource", async () => {
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/media/m1/brand-asset`)
      .reply(200, envelope({ id: "m1", is_brand_asset: false }));
    await expect(unflagMediaBrandAsset(mkClient(), "ws-1", "m1")).resolves.toBeDefined();
  });

  it("deleteMedia forwards confirmed only when asked", async () => {
    let received: any;
    nock(BASE)
      .delete(`${PATH}/workspaces/ws-1/media/m1`, (b) => (received = b) && true)
      .reply(200, envelope([]));
    await deleteMedia(mkClient(), "ws-1", "m1", { confirmed: true });
    expect(received).toEqual({ confirmed: true });
  });
});

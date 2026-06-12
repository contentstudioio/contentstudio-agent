import { afterEach, beforeEach, describe, expect, it } from "vitest";
import nock from "nock";

import {
  Client,
  addBlueskyAccount,
  addComment,
  addFacebookGroup,
  addTeamMember,
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
  listFacebookTextBackgrounds,
  listPlatforms,
  listPosts,
  listWorkspaces,
  postApproval,
  removeTeamMember,
  updateCampaign,
  updateLabel,
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

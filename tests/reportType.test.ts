/**
 * --platform-type validation for the report commands.
 *
 * The valid set is read from reports:options at call time rather than hardcoded, so a new report
 * family (threads was the most recent) works without a CLI release. These tests pin the three
 * behaviours that matter: a bad type is refused with the real list, a type the API advertises is
 * accepted, and an options call that FAILS does not block the command.
 */

import nock from "nock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Client } from "../src/api";
import { assertReportType } from "../src/commands/analyticsReports";
import { Config } from "../src/config";
import { ValidationError } from "../src/errors";

const BASE = "https://api.contentstudio.io";
const PATH = "/api/v1";
const WS = "ws-1";
const OPTIONS_PATH = `${PATH}/workspaces/${WS}/analytics/reports/options`;

const TYPES = [
  "overview",
  "campaign_label",
  "facebook",
  "instagram",
  "linkedin",
  "tiktok",
  "youtube",
  "pinterest",
  "twitter",
  "bluesky",
  "gmb",
  "threads",
  "meta_ads",
  "google_ads",
];

function mkClient() {
  return new Client(
    new Config({
      apiKey: "cs_fakefakefakefakefakefakefakefakefakefakefakefakefakefakefakefake",
      baseUrl: `${BASE}${PATH}`,
      activeWorkspaceId: WS,
    }),
    { retries: 0, timeoutMs: 10_000 },
  );
}

beforeEach(() => {
  nock.cleanAll();
  nock.disableNetConnect();
  delete process.env.CONTENTSTUDIO_API_KEY;
  delete process.env.CONTENTSTUDIO_BASE_URL;
  delete process.env.CONTENTSTUDIO_WORKSPACE_ID;
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe("assertReportType", () => {
  it("accepts a type the API advertises, including threads", async () => {
    nock(BASE).get(OPTIONS_PATH).reply(200, { status: true, report_types: TYPES });

    await expect(assertReportType(mkClient(), WS, "threads")).resolves.toBeUndefined();
  });

  it("refuses an unknown type and names the valid ones", async () => {
    nock(BASE).get(OPTIONS_PATH).reply(200, { status: true, report_types: TYPES });

    // "thread", not "threads" — the typo this check exists to catch.
    const err = await assertReportType(mkClient(), WS, "thread").catch((e) => e);

    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toContain('unknown report type "thread"');
    // The list comes from the response, so the hint cannot go stale.
    expect(err.hint).toContain("threads");
    expect(err.hint).toContain("facebook");
    expect(err.exitCode).toBe(4);
  });

  it("reads report_types out of a {data:…} envelope too", async () => {
    nock(BASE)
      .get(OPTIONS_PATH)
      .reply(200, { status: true, data: { report_types: ["facebook", "threads"] } });

    await expect(assertReportType(mkClient(), WS, "threads")).resolves.toBeUndefined();
  });

  it("FAILS OPEN when the options call errors, so a pre-flight check cannot break a working command", async () => {
    nock(BASE).get(OPTIONS_PATH).reply(500, { message: "boom" });

    await expect(assertReportType(mkClient(), WS, "anything")).resolves.toBeUndefined();
  });

  it("fails open when the API advertises no types at all", async () => {
    nock(BASE).get(OPTIONS_PATH).reply(200, { status: true, report_types: [] });

    await expect(assertReportType(mkClient(), WS, "anything")).resolves.toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { normalizePostBody } from "../src/commands/posts";
import { ConfigError } from "../src/errors";

/**
 * A `--body` file is written against what labels:list and campaigns:list return,
 * so it arrives holding whole objects. Sent verbatim the API returned a 500 on
 * the label objects, ignored the campaign, and never saw the schedule time.
 */
describe("normalizePostBody", () => {
  it("reduces label objects to their ids", () => {
    const body = normalizePostBody({
      labels: [{ id: "68de50f71c1768f19305c384", name: "Podcast", color: "color_1" }],
    });

    expect(body.labels).toEqual(["68de50f71c1768f19305c384"]);
  });

  it("turns a campaign object into campaign_id", () => {
    const body = normalizePostBody({
      campaign: { id: "68de519b0ca24b167005bfc0", name: "Podcast" },
    });

    expect(body.campaign_id).toBe("68de519b0ca24b167005bfc0");
    expect(body).not.toHaveProperty("campaign");
  });

  it("renames scheduling.execute_time to scheduled_at", () => {
    const body = normalizePostBody({
      scheduling: { publish_type: "scheduled", execute_time: "2026-09-18 14:49:03" },
    });

    expect(body.scheduling).toEqual({
      publish_type: "scheduled",
      scheduled_at: "2026-09-18 14:49:03",
    });
  });

  it("normalizes the whole reported payload", () => {
    const body = normalizePostBody({
      accounts: ["171639455029", "1635598"],
      content: { text: "hello" },
      scheduling: { publish_type: "scheduled", execute_time: "2026-09-18 14:49:03" },
      labels: [{ id: "68de50f71c1768f19305c384", name: "Podcast", color: "color_1" }],
      campaign: { id: "68de519b0ca24b167005bfc0", name: "Podcast", color: "color_1" },
    });

    expect(body).toMatchObject({
      labels: ["68de50f71c1768f19305c384"],
      campaign_id: "68de519b0ca24b167005bfc0",
      scheduling: { publish_type: "scheduled", scheduled_at: "2026-09-18 14:49:03" },
    });
  });

  it("leaves an already-correct payload untouched", () => {
    const input = {
      labels: ["68de50f71c1768f19305c384"],
      campaign_id: "68de519b0ca24b167005bfc0",
      scheduling: { publish_type: "scheduled", scheduled_at: "2026-09-18 14:49:03" },
    };

    expect(normalizePostBody(input)).toEqual(input);
  });

  it("accepts _id as well as id", () => {
    expect(normalizePostBody({ labels: [{ _id: "abc" }] }).labels).toEqual(["abc"]);
  });

  it("wraps a single label into an array", () => {
    expect(normalizePostBody({ labels: "abc" }).labels).toEqual(["abc"]);
  });

  it("refuses a label with no id rather than dropping it", () => {
    expect(() => normalizePostBody({ labels: [{ name: "Podcast" }] })).toThrow(
      ConfigError,
    );
  });

  it("refuses a campaign with no id rather than dropping it", () => {
    expect(() => normalizePostBody({ campaign: { name: "Podcast" } })).toThrow(
      ConfigError,
    );
  });

  it("keeps an explicit scheduled_at when execute_time is also present", () => {
    const body = normalizePostBody({
      scheduling: {
        publish_type: "scheduled",
        scheduled_at: "2026-09-18 10:00:00",
        execute_time: "2026-09-18 14:49:03",
      },
    });

    expect(body.scheduling).toEqual({
      publish_type: "scheduled",
      scheduled_at: "2026-09-18 10:00:00",
    });
  });
});

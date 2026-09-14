/**
 * competitors:compare row selection and rendering.
 *
 * Each --metric hits a different endpoint and names its array after itself, so reading one
 * hardcoded key printed "No comparison rows for that period." for six of the seven metrics even
 * when the API had returned data. The fixtures below are the real response shapes, taken from the
 * live API for every metric.
 */

import { describe, expect, it } from "vitest";

import {
  formatCompetitorCell,
  genericCompetitorColumns,
  selectCompetitorRows,
} from "../src/commands/analyticsReports";

describe("selectCompetitorRows", () => {
  it("reads the key belonging to the requested metric", () => {
    const cases: Array<[string, string]> = [
      ["data-table-metrics", "data_table_metrics"],
      ["post-engagement-by-competitor", "post_engagement_by_competitor"],
      ["followers-growth-comparison", "followers_growth_comparison"],
      ["posting-activity-graph-by-types", "posting_activity_graph_by_types"],
      ["top-hashtags", "top_hashtags"],
      ["biography-data", "biography_data"],
    ];
    for (const [metric, key] of cases) {
      const payload = { status: true, [key]: [{ name: "x" }] };
      expect(selectCompetitorRows(payload, metric)).toEqual({
        rows: [{ name: "x" }],
        key,
      });
    }
  });

  it("handles top-and-least-performing-posts, which answers under top_posts", () => {
    // The one metric whose response key is NOT its own name — the reason this is a lookup table
    // rather than a string transform.
    const payload = { status: true, top_posts: [{ name: "x", least_5_posts: [] }] };
    const { rows, key } = selectCompetitorRows(payload, "top-and-least-performing-posts");
    expect(key).toBe("top_posts");
    expect(rows).toHaveLength(1);
  });

  it("never picks data_prev — that is the PREVIOUS period, not the one asked for", () => {
    const payload = {
      status: true,
      data_prev: [{ name: "old", followersCount: 1 }],
      data_table_metrics: [{ name: "current", followersCount: 2 }],
    };
    expect(selectCompetitorRows(payload, "data-table-metrics").rows[0].name).toBe("current");

    // Even with no usable key for the metric, data_prev must not be the fallback.
    const onlyPrev = { status: true, data_prev: [{ name: "old" }] };
    expect(selectCompetitorRows(onlyPrev, "top-hashtags")).toEqual({ rows: [], key: null });
  });

  it("falls back to the first row array, so a metric added later still renders", () => {
    const payload = { status: true, some_future_metric: [{ name: "x" }] };
    const { rows, key } = selectCompetitorRows(payload, "some-future-metric");
    expect(key).toBe("some_future_metric");
    expect(rows).toHaveLength(1);
  });

  it("unwraps a {data:…} envelope and survives junk", () => {
    expect(selectCompetitorRows({ data: { top_hashtags: [{ tag: "x" }] } }, "top-hashtags").rows)
      .toHaveLength(1);
    expect(selectCompetitorRows(null, "top-hashtags")).toEqual({ rows: [], key: null });
    expect(selectCompetitorRows({ status: true }, "top-hashtags")).toEqual({ rows: [], key: null });
  });
});

describe("genericCompetitorColumns", () => {
  it("puts the identity column first and drops ids and image urls", () => {
    const row = {
      facebook_id: "237675153102724",
      followers: [],
      image: "https://graph.facebook.com/…",
      name: "Oscar Piastri",
      slug: "Oscar Piastri",
      state: "Failed",
    };
    expect(genericCompetitorColumns(row)).toEqual(["name", "followers", "state"]);
  });

  it("keeps state last even when the row is wide", () => {
    const row = {
      companies_name: "x",
      count: 1,
      engagement_per_post: 2,
      engagement_per_follower: 3,
      total_engagement: 4,
      tag: "PurpleForce",
      state: "Processed",
    };
    const cols = genericCompetitorColumns(row);
    expect(cols[cols.length - 1]).toBe("state");
    expect(cols[0]).toBe("companies_name");
  });

  it("drops nested objects, which have no single-cell rendering", () => {
    expect(genericCompetitorColumns({ name: "x", nested: { a: 1 }, count: 2 })).toEqual([
      "name",
      "count",
    ]);
  });

  it("survives a non-object row", () => {
    expect(genericCompetitorColumns(null)).toEqual([]);
    expect(genericCompetitorColumns("nope")).toEqual([]);
  });
});

describe("formatCompetitorCell", () => {
  it("renders a series as its point count", () => {
    // followers-growth returns a time series per competitor; dropping the column read as "no
    // data", and printing the raw array would be unreadable. 0 pts vs 75 pts is the useful signal.
    expect(formatCompetitorCell([])).toBe("0 pts");
    expect(formatCompetitorCell([1, 2, 3])).toBe("3 pts");
  });

  it("renders absence as a dash, never as zero", () => {
    expect(formatCompetitorCell(null)).toBe("-");
    expect(formatCompetitorCell(undefined)).toBe("-");
    expect(formatCompetitorCell("")).toBe("-");
    expect(formatCompetitorCell(0)).toBe("0");
  });
});

/**
 * Analytics report commands — one command per ContentStudio v1 analytics
 * endpoint across Facebook, Instagram, YouTube, Pinterest, LinkedIn, GMB,
 * TikTok, Twitter/X, Meta Ads and Google Ads, plus the cross-network
 * Campaigns & Labels reports (133 endpoints total).
 *
 * Every analytics endpoint is read-only and returns a report payload rather
 * than a row-based list — so unlike `lookups.ts`/`inbox.ts` there is no
 * per-command table renderer; output is JSON in both --json and human mode
 * (via `out.emitSuccess(data, g)` with no human callback).
 *
 * Three request shapes, which is why `params` is declared per command rather
 * than shared: the social endpoints key on `platform_id` + a date range or
 * `post_id`; the ads endpoints key on `account_id` (an ad account) with
 * table/chart filters; and the five Campaigns & Labels reports are POSTs
 * because their campaign/label/account filters are lists.
 *
 * ANALYTICS_OPS is a data table (name, backing api.ts function, required vs.
 * optional query params) rather than 133 hand-copied `.command()` blocks —
 * every entry still becomes its own named, individually documented yargs
 * command (`analytics:instagram-top-posts --help` works exactly like any
 * other command), there is no generic "run any operation" command exposed.
 */

import type { Argv } from "yargs";

import * as api from "../api";
import type { AnalyticsParams } from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import { buildClient, resolveWorkspace, run } from "../cliCtx";

interface AnalyticsParamSpec {
  name: string;
  type: "string" | "integer" | "array";
  required: boolean;
  enum?: string[];
  default?: string | number;
  description?: string;
}

interface AnalyticsOpSpec {
  cmd: string;
  fn: keyof typeof api;
  desc: string;
  params: AnalyticsParamSpec[];
}

const ANALYTICS_OPS: AnalyticsOpSpec[] = [
  {
    "cmd": "analytics:facebook-active-users",
    "fn": "facebookAnalyticsActiveUsers",
    "desc": "Facebook active users by hour and day of week",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-ai-insights",
    "fn": "facebookAnalyticsAiInsights",
    "desc": "Facebook AI-generated insights",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "AI insights type key"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 5
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "default": "en",
        "description": "Response language (ISO 639-1)"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-audience-growth",
    "fn": "facebookAnalyticsAudienceGrowth",
    "desc": "Facebook fan / follower growth over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-audience-location",
    "fn": "facebookAnalyticsAudienceLocation",
    "desc": "Facebook audience location (country/city breakdown)",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-demographics",
    "fn": "facebookAnalyticsDemographics",
    "desc": "Facebook audience age / gender / country / city demographics",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-demographics-overview",
    "fn": "facebookAnalyticsDemographicsOverview",
    "desc": "Facebook demographics overview widget",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-engagement",
    "fn": "facebookAnalyticsEngagement",
    "desc": "Facebook page engagements over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-get-top-posts",
    "fn": "facebookAnalyticsGetTopPosts",
    "desc": "Facebook top posts with media_type filter",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "enum": [
          "post_engagement",
          "created_time",
          "comments",
          "shares",
          "post_clicks",
          "post_impressions",
          "post_impressions_unique",
          "post_video_views",
          "total"
        ]
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:facebook-impressions",
    "fn": "facebookAnalyticsImpressions",
    "desc": "Facebook page impressions over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-overview-top-posts",
    "fn": "facebookAnalyticsOverviewTopPosts",
    "desc": "Facebook top posts (overview widget)",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "enum": [
          "post_engagement",
          "created_time",
          "comments",
          "shares",
          "post_clicks",
          "post_impressions",
          "post_impressions_unique",
          "post_video_views",
          "total"
        ]
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:facebook-publishing-behaviour",
    "fn": "facebookAnalyticsPublishingBehaviour",
    "desc": "Facebook engagement by impression type over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:facebook-reels",
    "fn": "facebookAnalyticsReels",
    "desc": "Facebook Reels performance over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-single-post",
    "fn": "facebookAnalyticsSinglePost",
    "desc": "Get a single Facebook post by ID",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "post_id",
        "type": "string",
        "required": true,
        "description": "Platform-native identifier of the post."
      }
    ]
  },
  {
    "cmd": "analytics:facebook-summary",
    "fn": "facebookAnalyticsSummary",
    "desc": "Facebook summary KPIs — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:facebook-video-insights",
    "fn": "facebookAnalyticsVideoInsights",
    "desc": "Facebook video view time and plays over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:gmb-actions",
    "fn": "gmbAnalyticsActions",
    "desc": "GMB customer actions (clicks, calls, directions) over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:gmb-ai-insights",
    "fn": "gmbAnalyticsAiInsights",
    "desc": "GMB AI-generated insights",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "AI insights type key"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 5
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "default": "en",
        "description": "Response language (ISO 639-1)"
      }
    ]
  },
  {
    "cmd": "analytics:gmb-impressions",
    "fn": "gmbAnalyticsImpressions",
    "desc": "GMB impressions breakdown by channel and device over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:gmb-media-activity",
    "fn": "gmbAnalyticsMediaActivity",
    "desc": "GMB media (photo/video) activity over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:gmb-publishing-behavior",
    "fn": "gmbAnalyticsPublishingBehavior",
    "desc": "GMB posts published over time and topic-type breakdown",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:gmb-reviews",
    "fn": "gmbAnalyticsReviews",
    "desc": "GMB reviews — ratings, distribution, and daily activity",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:gmb-search-keywords",
    "fn": "gmbAnalyticsSearchKeywords",
    "desc": "GMB top search keywords that surfaced the listing",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      }
    ]
  },
  {
    "cmd": "analytics:gmb-single-post",
    "fn": "gmbAnalyticsSinglePost",
    "desc": "Get a single GMB post by ID",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "post_id",
        "type": "string",
        "required": true,
        "description": "Platform-native identifier of the post."
      }
    ]
  },
  {
    "cmd": "analytics:gmb-summary",
    "fn": "gmbAnalyticsSummary",
    "desc": "GMB summary KPIs — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:gmb-top-posts",
    "fn": "gmbAnalyticsTopPosts",
    "desc": "GMB top-performing posts",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "topic_type",
        "type": "array",
        "required": false,
        "description": "Comma-separated list of topic types to filter by (e.g. STANDARD,OFFER,EVENT)."
      }
    ]
  },
  {
    "cmd": "analytics:instagram-active-users",
    "fn": "instagramAnalyticsActiveUsers",
    "desc": "Instagram active users by hour and day of week",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-ai-insights",
    "fn": "instagramAnalyticsAiInsights",
    "desc": "Instagram AI-generated insights",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "AI insights type key"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 5
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "default": "en",
        "description": "Response language (ISO 639-1)"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-audience-growth",
    "fn": "instagramAnalyticsAudienceGrowth",
    "desc": "Instagram follower growth over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-country-city",
    "fn": "instagramAnalyticsCountryCity",
    "desc": "Instagram audience country / city breakdown",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-demographics-age",
    "fn": "instagramAnalyticsDemographicsAge",
    "desc": "Instagram audience age / gender breakdown",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-engagement",
    "fn": "instagramAnalyticsEngagement",
    "desc": "Instagram post engagement over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-get-top-posts",
    "fn": "instagramAnalyticsGetTopPosts",
    "desc": "Instagram top posts with hashtag filter",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "enum": [
          "post_engagement",
          "like_count",
          "comments_count",
          "saved",
          "reach",
          "impressions",
          "views",
          "shares",
          "post_created_at"
        ]
      },
      {
        "name": "hashtags",
        "type": "array",
        "required": false
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      },
      {
        "name": "entity_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:instagram-hashtags",
    "fn": "instagramAnalyticsHashtags",
    "desc": "Instagram top hashtags by engagement",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-impressions",
    "fn": "instagramAnalyticsImpressions",
    "desc": "Instagram post impressions over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-publishing-behaviour",
    "fn": "instagramAnalyticsPublishingBehaviour",
    "desc": "Instagram post engagement by media type over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:instagram-reels-performance",
    "fn": "instagramAnalyticsReelsPerformance",
    "desc": "Instagram Reels engagement and watch time over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-single-post",
    "fn": "instagramAnalyticsSinglePost",
    "desc": "Get a single Instagram post by ID",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "post_id",
        "type": "string",
        "required": true,
        "description": "Platform-native identifier of the post."
      }
    ]
  },
  {
    "cmd": "analytics:instagram-stories-performance",
    "fn": "instagramAnalyticsStoriesPerformance",
    "desc": "Instagram stories impressions, reach, and interactions over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-summary",
    "fn": "instagramAnalyticsSummary",
    "desc": "Instagram summary KPIs — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:instagram-top-posts",
    "fn": "instagramAnalyticsTopPosts",
    "desc": "Instagram top-performing posts",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "enum": [
          "post_engagement",
          "like_count",
          "comments_count",
          "saved",
          "reach",
          "impressions",
          "views",
          "shares",
          "post_created_at"
        ]
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      },
      {
        "name": "entity_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-ai-insights",
    "fn": "linkedinAnalyticsAiInsights",
    "desc": "LinkedIn AI-generated insights",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "AI insights type key"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 5
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "default": "en",
        "description": "Response language (ISO 639-1)"
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-audience-growth",
    "fn": "linkedinAnalyticsAudienceGrowth",
    "desc": "LinkedIn follower growth over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-followers-demographics",
    "fn": "linkedinAnalyticsFollowersDemographics",
    "desc": "LinkedIn follower demographics by industry, country, and other dimensions",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-get-top-posts",
    "fn": "linkedinAnalyticsGetTopPosts",
    "desc": "LinkedIn top posts with hashtag and media type filter",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "enum": [
          "post_engagement",
          "impressions",
          "reach",
          "comments",
          "favorites",
          "repost",
          "post_clicks",
          "created_at"
        ]
      },
      {
        "name": "hashtags",
        "type": "array",
        "required": false
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-hashtags",
    "fn": "linkedinAnalyticsHashtags",
    "desc": "LinkedIn top hashtags by engagement",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-page-views",
    "fn": "linkedinAnalyticsPageViews",
    "desc": "LinkedIn page views over time (desktop vs mobile)",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-posts-per-days",
    "fn": "linkedinAnalyticsPostsPerDays",
    "desc": "LinkedIn post count distribution by day of week",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-publishing-behaviour",
    "fn": "linkedinAnalyticsPublishingBehaviour",
    "desc": "LinkedIn post engagement by media type over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false,
        "description": "Filter by media type (text, images, videos, carousel, link, documents)"
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-single-post",
    "fn": "linkedinAnalyticsSinglePost",
    "desc": "Get a single LinkedIn post by ID",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "post_id",
        "type": "string",
        "required": true,
        "description": "Platform-native identifier of the post."
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-summary",
    "fn": "linkedinAnalyticsSummary",
    "desc": "LinkedIn summary KPIs — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:linkedin-top-posts",
    "fn": "linkedinAnalyticsTopPosts",
    "desc": "LinkedIn top-performing posts",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "enum": [
          "post_engagement",
          "impressions",
          "reach",
          "comments",
          "favorites",
          "repost",
          "post_clicks",
          "created_at"
        ],
        "default": "post_engagement"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-ai-insights",
    "fn": "pinterestAnalyticsAiInsights",
    "desc": "Pinterest AI-generated insights",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "AI insights type key"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 5
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "default": "en",
        "description": "Response language (ISO 639-1)"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-engagement-trend",
    "fn": "pinterestAnalyticsEngagementTrend",
    "desc": "Pinterest cumulative engagement trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-engagement-trend-daily",
    "fn": "pinterestAnalyticsEngagementTrendDaily",
    "desc": "Pinterest daily-delta engagement trend",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-follower-trend",
    "fn": "pinterestAnalyticsFollowerTrend",
    "desc": "Pinterest cumulative follower trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-follower-trend-daily",
    "fn": "pinterestAnalyticsFollowerTrendDaily",
    "desc": "Pinterest daily-delta follower trend",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-impressions-trend",
    "fn": "pinterestAnalyticsImpressionsTrend",
    "desc": "Pinterest cumulative impressions trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-impressions-trend-daily",
    "fn": "pinterestAnalyticsImpressionsTrendDaily",
    "desc": "Pinterest daily-delta impressions trend",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-pin-performance",
    "fn": "pinterestAnalyticsPinPerformance",
    "desc": "Pinterest pin performance metrics over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-pin-posting",
    "fn": "pinterestAnalyticsPinPosting",
    "desc": "Pinterest cumulative pin posting activity over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-pin-posting-daily",
    "fn": "pinterestAnalyticsPinPostingDaily",
    "desc": "Pinterest daily-delta pin posting activity",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-pin-rollup",
    "fn": "pinterestAnalyticsPinRollup",
    "desc": "Pinterest pin performance rollup — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-single-pin",
    "fn": "pinterestAnalyticsSinglePin",
    "desc": "Get a single Pinterest pin by ID",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "post_id",
        "type": "string",
        "required": true,
        "description": "Platform-native identifier of the pin."
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-summary",
    "fn": "pinterestAnalyticsSummary",
    "desc": "Pinterest summary KPIs — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "board_id",
        "type": "string",
        "required": false,
        "description": "Filter metrics to a specific board ID."
      }
    ]
  },
  {
    "cmd": "analytics:pinterest-top-pins",
    "fn": "pinterestAnalyticsTopPins",
    "desc": "Pinterest top-performing and least-performing pins",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:tiktok-ai-insights",
    "fn": "tiktokAnalyticsAiInsights",
    "desc": "TikTok AI-generated insights",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "AI insights type key"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 5
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "default": "en",
        "description": "Response language (ISO 639-1)"
      }
    ]
  },
  {
    "cmd": "analytics:tiktok-engagement-trend",
    "fn": "tiktokAnalyticsEngagementTrend",
    "desc": "TikTok daily engagement trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:tiktok-follower-trend",
    "fn": "tiktokAnalyticsFollowerTrend",
    "desc": "TikTok follower and views trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:tiktok-publishing-behaviour",
    "fn": "tiktokAnalyticsPublishingBehaviour",
    "desc": "TikTok daily post volume and engagement breakdown over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:tiktok-single-post",
    "fn": "tiktokAnalyticsSinglePost",
    "desc": "Get a single TikTok post by ID",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "post_id",
        "type": "string",
        "required": true,
        "description": "Platform-native identifier of the post."
      }
    ]
  },
  {
    "cmd": "analytics:tiktok-sorted-top-posts",
    "fn": "tiktokAnalyticsSortedTopPosts",
    "desc": "TikTok posts sorted by a configurable metric",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "sort_order",
        "type": "string",
        "required": false,
        "enum": [
          "post_engagement",
          "engagements_count",
          "likes_count",
          "comments_count",
          "shares_count",
          "views_count",
          "created_time"
        ],
        "default": "post_engagement"
      }
    ]
  },
  {
    "cmd": "analytics:tiktok-summary",
    "fn": "tiktokAnalyticsSummary",
    "desc": "TikTok summary KPIs — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:tiktok-top-posts",
    "fn": "tiktokAnalyticsTopPosts",
    "desc": "TikTok top and least performing posts",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      }
    ]
  },
  {
    "cmd": "analytics:twitter-credits-used",
    "fn": "twitterAnalyticsCreditsUsed",
    "desc": "Twitter API credits usage for the workspace",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:twitter-engagement-impression",
    "fn": "twitterAnalyticsEngagementImpression",
    "desc": "Twitter engagement and impression trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:twitter-followers-trend",
    "fn": "twitterAnalyticsFollowersTrend",
    "desc": "Twitter follower trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:twitter-least-tweets",
    "fn": "twitterAnalyticsLeastTweets",
    "desc": "Twitter least-performing tweets",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "tweet_type",
        "type": "array",
        "required": false,
        "description": "Comma-separated tweet types forwarded to upstream verbatim."
      }
    ]
  },
  {
    "cmd": "analytics:twitter-single-tweet",
    "fn": "twitterAnalyticsSingleTweet",
    "desc": "Get a single Twitter/X tweet by ID",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "post_id",
        "type": "string",
        "required": true,
        "description": "Platform-native identifier of the tweet."
      }
    ]
  },
  {
    "cmd": "analytics:twitter-summary",
    "fn": "twitterAnalyticsSummary",
    "desc": "Twitter summary KPIs — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:twitter-top-tweets",
    "fn": "twitterAnalyticsTopTweets",
    "desc": "Twitter top-performing tweets",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "enum": [
          "post_engagement",
          "like_count",
          "reply_count",
          "quote_count",
          "retweet_count",
          "impression_count",
          "bookmark_count"
        ],
        "default": "post_engagement"
      },
      {
        "name": "tweet_type",
        "type": "array",
        "required": false,
        "description": "Comma-separated tweet types forwarded to upstream verbatim."
      }
    ]
  },
  {
    "cmd": "analytics:youtube-ai-insights",
    "fn": "youtubeAnalyticsAiInsights",
    "desc": "YouTube AI-generated insights",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "AI insights type key"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 5
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "default": "en",
        "description": "Response language (ISO 639-1)"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-demographics",
    "fn": "youtubeAnalyticsDemographics",
    "desc": "YouTube audience demographics — age & gender, device type, subscriber change",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-engagement-trend",
    "fn": "youtubeAnalyticsEngagementTrend",
    "desc": "YouTube cumulative engagement trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-engagement-trend-daily",
    "fn": "youtubeAnalyticsEngagementTrendDaily",
    "desc": "YouTube daily-delta engagement trend",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-find-video",
    "fn": "youtubeAnalyticsFindVideo",
    "desc": "YouTube traffic source breakdown (how viewers found videos)",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-least-posts",
    "fn": "youtubeAnalyticsLeastPosts",
    "desc": "YouTube least-performing videos ordered by views and engagement",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:youtube-performance-schedule",
    "fn": "youtubeAnalyticsPerformanceSchedule",
    "desc": "YouTube video performance metrics grouped by publish date",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-single-video",
    "fn": "youtubeAnalyticsSingleVideo",
    "desc": "Get a single YouTube video by ID",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "post_id",
        "type": "string",
        "required": true,
        "description": "Platform-native identifier of the video."
      }
    ]
  },
  {
    "cmd": "analytics:youtube-sorted-top-posts",
    "fn": "youtubeAnalyticsSortedTopPosts",
    "desc": "YouTube videos sorted by a configurable metric",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "enum": [
          "views",
          "likes",
          "dislikes",
          "engagement",
          "comments",
          "shares",
          "engagement_rate",
          "minutes_watched",
          "published_at"
        ],
        "default": "views"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:youtube-subscriber-trend",
    "fn": "youtubeAnalyticsSubscriberTrend",
    "desc": "YouTube cumulative subscriber trend over time",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-subscriber-trend-daily",
    "fn": "youtubeAnalyticsSubscriberTrendDaily",
    "desc": "YouTube daily-delta subscriber trend",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-summary",
    "fn": "youtubeAnalyticsSummary",
    "desc": "YouTube summary KPIs — current vs previous period",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-top-geographies",
    "fn": "youtubeAnalyticsTopGeographies",
    "desc": "YouTube top geographies — countries pre-sorted by views, watch time, view duration and view percentage",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-top-posts",
    "fn": "youtubeAnalyticsTopPosts",
    "desc": "YouTube top videos ordered by views and engagement",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "media_type",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:youtube-video-sharing",
    "fn": "youtubeAnalyticsVideoSharing",
    "desc": "YouTube sharing platform breakdown",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-views-trend",
    "fn": "youtubeAnalyticsViewsTrend",
    "desc": "YouTube cumulative views split by subscriber / non-subscriber",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-views-trend-daily",
    "fn": "youtubeAnalyticsViewsTrendDaily",
    "desc": "YouTube daily-delta views trend",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-watch-time-trend",
    "fn": "youtubeAnalyticsWatchTimeTrend",
    "desc": "YouTube cumulative watch time split by subscriber / non-subscriber",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:youtube-watch-time-trend-daily",
    "fn": "youtubeAnalyticsWatchTimeTrendDaily",
    "desc": "YouTube daily-delta watch time trend",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-accounts",
    "fn": "metaAdsAnalyticsAccounts",
    "desc": "List connected Meta ad accounts",
    "params": [
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-ad-sets",
    "fn": "metaAdsAnalyticsAdSets",
    "desc": "Ad sets with per-ad-set metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "campaign_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single campaign."
      },
      {
        "name": "status",
        "type": "string",
        "required": false,
        "description": "Filter by delivery status. Accepted values vary per account and are returned in each list response under `available_statuses`."
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-ads",
    "fn": "metaAdsAnalyticsAds",
    "desc": "Ads with per-ad metrics and creative details",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "campaign_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single campaign."
      },
      {
        "name": "ad_set_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single ad set."
      },
      {
        "name": "status",
        "type": "string",
        "required": false,
        "description": "Filter by delivery status. Accepted values vary per account and are returned in each list response under `available_statuses`."
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-ai-insights",
    "fn": "metaAdsAnalyticsAiInsights",
    "desc": "AI-generated insights for an ad account",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": true,
        "enum": [
          "aiInsightsSummary",
          "aiInsightsDetailed"
        ],
        "description": "Which insight to generate."
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "description": "Response language, ISO 639-1. Falls back to the request locale, then English."
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-campaigns",
    "fn": "metaAdsAnalyticsCampaigns",
    "desc": "Campaigns with per-campaign metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "status",
        "type": "string",
        "required": false,
        "description": "Filter by delivery status. Accepted values vary per account and are returned in each list response under `available_statuses`."
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      },
      {
        "name": "objective",
        "type": "string",
        "required": false,
        "description": "Campaign objective filter. Accepted values are returned in `available_objectives`."
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-demographics",
    "fn": "metaAdsAnalyticsDemographics",
    "desc": "Audience breakdown by age and gender, region or country",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "breakdown",
        "type": "string",
        "required": false,
        "enum": [
          "age_gender",
          "region",
          "country"
        ],
        "default": "age_gender"
      },
      {
        "name": "country",
        "type": "string",
        "required": false,
        "description": "ISO country code; narrows the `region` breakdown. Accepted values come back in that breakdown's `available_countries`."
      },
      {
        "name": "metric",
        "type": "string",
        "required": false,
        "enum": [
          "spend",
          "impressions",
          "reach",
          "clicks",
          "cpm",
          "cpc",
          "ctr",
          "frequency"
        ],
        "default": "spend",
        "description": "Applies to `breakdown=age_gender` only. The geographic breakdowns return every metric per row and ignore this."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-performance-by-level",
    "fn": "metaAdsAnalyticsPerformanceByLevel",
    "desc": "One metric broken down by campaign, ad set or ad",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "level",
        "type": "string",
        "required": false,
        "enum": [
          "campaign",
          "adset",
          "ad"
        ],
        "default": "campaign"
      },
      {
        "name": "metric",
        "type": "string",
        "required": false,
        "enum": [
          "spend",
          "impressions",
          "reach",
          "clicks",
          "cpm",
          "cpc",
          "ctr",
          "frequency"
        ],
        "default": "spend"
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-performance-by-placement",
    "fn": "metaAdsAnalyticsPerformanceByPlacement",
    "desc": "One metric broken down by publisher platform and placement",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "metric",
        "type": "string",
        "required": false,
        "enum": [
          "spend",
          "impressions",
          "reach",
          "clicks",
          "cpm",
          "cpc",
          "ctr",
          "frequency"
        ],
        "default": "spend"
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-performance-over-time",
    "fn": "metaAdsAnalyticsPerformanceOverTime",
    "desc": "Daily time series for one or more metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "metrics",
        "type": "string",
        "required": false,
        "description": "Comma-separated metric list. Unknown names are ignored. When omitted, `metric` is used."
      },
      {
        "name": "metric",
        "type": "string",
        "required": false,
        "enum": [
          "spend",
          "impressions",
          "reach",
          "clicks",
          "cpm",
          "cpc",
          "ctr",
          "frequency"
        ],
        "default": "spend",
        "description": "Single metric, used only when `metrics` is absent."
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-results-by-objective",
    "fn": "metaAdsAnalyticsResultsByObjective",
    "desc": "Results and spend grouped by campaign objective",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:meta-ads-summary",
    "fn": "metaAdsAnalyticsSummary",
    "desc": "Meta Ads headline KPIs \u2014 current vs previous period",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-accounts",
    "fn": "googleAdsAnalyticsAccounts",
    "desc": "List connected Google Ads accounts",
    "params": [
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-ad-groups",
    "fn": "googleAdsAnalyticsAdGroups",
    "desc": "Ad groups with per-ad-group metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      },
      {
        "name": "campaign_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single campaign."
      },
      {
        "name": "status",
        "type": "string",
        "required": false,
        "description": "Filter by delivery status. Accepted values vary per account and are returned in each list response under `available_statuses`."
      },
      {
        "name": "type",
        "type": "string",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-ads",
    "fn": "googleAdsAnalyticsAds",
    "desc": "Ads with per-ad metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      },
      {
        "name": "campaign_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single campaign."
      },
      {
        "name": "ad_group_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single ad group."
      },
      {
        "name": "status",
        "type": "string",
        "required": false,
        "description": "Filter by delivery status. Accepted values vary per account and are returned in each list response under `available_statuses`."
      },
      {
        "name": "type",
        "type": "string",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-ai-insights",
    "fn": "googleAdsAnalyticsAiInsights",
    "desc": "AI-generated insights for an ad account",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "type",
        "type": "string",
        "required": true,
        "enum": [
          "aiInsightsSummary",
          "aiInsightsDetailed"
        ],
        "description": "Which insight to generate."
      },
      {
        "name": "language",
        "type": "string",
        "required": false,
        "description": "Response language, ISO 639-1. Falls back to the request locale, then English."
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-campaigns",
    "fn": "googleAdsAnalyticsCampaigns",
    "desc": "Campaigns with per-campaign metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      },
      {
        "name": "status",
        "type": "string",
        "required": false,
        "description": "Filter by delivery status. Accepted values vary per account and are returned in each list response under `available_statuses`."
      },
      {
        "name": "type",
        "type": "string",
        "required": false,
        "description": "Advertising channel type filter. Accepted values are returned in `available_types`."
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-conversion-actions",
    "fn": "googleAdsAnalyticsConversionActions",
    "desc": "Conversion actions configured on the account",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      },
      {
        "name": "campaign_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single campaign."
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-conversion-funnel",
    "fn": "googleAdsAnalyticsConversionFunnel",
    "desc": "Conversion funnel \u2014 impressions through to conversions",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-conversions-by-action",
    "fn": "googleAdsAnalyticsConversionsByAction",
    "desc": "Conversions grouped by conversion action",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-conversions-over-time",
    "fn": "googleAdsAnalyticsConversionsOverTime",
    "desc": "Conversions over time",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-demographics",
    "fn": "googleAdsAnalyticsDemographics",
    "desc": "Audience breakdown by age, gender and location",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "country",
        "type": "string",
        "required": false,
        "description": "ISO country code."
      },
      {
        "name": "metric",
        "type": "string",
        "required": false,
        "enum": [
          "spend",
          "impressions",
          "clicks",
          "conversions",
          "conversion_rate",
          "cost_per_conversion",
          "avg_cpc",
          "ctr",
          "cpm"
        ],
        "default": "spend"
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-keywords",
    "fn": "googleAdsAnalyticsKeywords",
    "desc": "Keywords with per-keyword metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      },
      {
        "name": "campaign_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single campaign."
      },
      {
        "name": "ad_group_id",
        "type": "string",
        "required": false
      },
      {
        "name": "status",
        "type": "string",
        "required": false,
        "description": "Filter by delivery status. Accepted values vary per account and are returned in each list response under `available_statuses`."
      },
      {
        "name": "match_type",
        "type": "string",
        "required": false,
        "enum": [
          "EXACT",
          "PHRASE",
          "BROAD"
        ],
        "description": "Keyword match type. Accepted values are returned in `available_match_types`."
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-performance-by-level",
    "fn": "googleAdsAnalyticsPerformanceByLevel",
    "desc": "One metric broken down by campaign, ad group or ad",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "level",
        "type": "string",
        "required": false,
        "enum": [
          "campaign",
          "adgroup",
          "ad"
        ],
        "default": "campaign"
      },
      {
        "name": "metric",
        "type": "string",
        "required": false,
        "enum": [
          "spend",
          "impressions",
          "clicks",
          "conversions",
          "conversion_rate",
          "cost_per_conversion",
          "avg_cpc",
          "ctr",
          "cpm"
        ],
        "default": "spend"
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-performance-by-type",
    "fn": "googleAdsAnalyticsPerformanceByType",
    "desc": "One metric broken down by campaign type",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "metric",
        "type": "string",
        "required": false,
        "enum": [
          "spend",
          "impressions",
          "clicks",
          "conversions",
          "conversion_rate",
          "cost_per_conversion",
          "avg_cpc",
          "ctr",
          "cpm"
        ],
        "default": "spend"
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-performance-over-time",
    "fn": "googleAdsAnalyticsPerformanceOverTime",
    "desc": "Daily time series for one or more metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "metrics",
        "type": "string",
        "required": false,
        "description": "Comma-separated metric list. Unknown names are ignored. When omitted, `metric` is used."
      },
      {
        "name": "metric",
        "type": "string",
        "required": false,
        "enum": [
          "spend",
          "impressions",
          "clicks",
          "conversions",
          "conversion_rate",
          "cost_per_conversion",
          "avg_cpc",
          "ctr",
          "cpm"
        ],
        "default": "spend",
        "description": "Single metric, used only when `metrics` is absent."
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-search-terms",
    "fn": "googleAdsAnalyticsSearchTerms",
    "desc": "Search terms with per-term metrics",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      },
      {
        "name": "campaign_id",
        "type": "string",
        "required": false,
        "description": "Restrict results to a single campaign."
      },
      {
        "name": "ad_group_id",
        "type": "string",
        "required": false
      },
      {
        "name": "match_type",
        "type": "string",
        "required": false,
        "enum": [
          "EXACT",
          "PHRASE",
          "BROAD"
        ]
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-shopping",
    "fn": "googleAdsAnalyticsShopping",
    "desc": "Shopping campaign product performance",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false,
        "default": 15
      },
      {
        "name": "offset",
        "type": "integer",
        "required": false,
        "default": 0,
        "description": "Number of records to skip for pagination"
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive substring match on the row's name."
      },
      {
        "name": "order_by",
        "type": "string",
        "required": false,
        "description": "Metric to sort by. The accepted set is documented per endpoint."
      },
      {
        "name": "order_dir",
        "type": "string",
        "required": false,
        "enum": [
          "asc",
          "desc"
        ],
        "default": "desc"
      }
    ]
  },
  {
    "cmd": "analytics:google-ads-summary",
    "fn": "googleAdsAnalyticsSummary",
    "desc": "Google Ads headline KPIs \u2014 current vs previous period",
    "params": [
      {
        "name": "account_id",
        "type": "string",
        "required": true,
        "description": "The ad account identifier, as returned by the ad-accounts endpoint. Meta accepts the `act_`-prefixed or bare form; Google accepts the hyphenated or bare customer id."
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      }
    ]
  },
  {
    "cmd": "analytics:campaigns-labels-breakdown",
    "fn": "campaignLabelAnalyticsBreakdown",
    "desc": "Per-campaign and per-label totals, current vs previous period",
    "params": [
      {
        "name": "start_date",
        "type": "string",
        "required": true
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true
      },
      {
        "name": "campaigns",
        "type": "array",
        "required": false
      },
      {
        "name": "labels",
        "type": "array",
        "required": false
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false
      },
      {
        "name": "facebook_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "instagram_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "linkedin_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "tiktok_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "youtube_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "pinterest_accounts",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:campaigns-labels-insights-breakdown",
    "fn": "campaignLabelAnalyticsInsightsBreakdown",
    "desc": "Daily time series per campaign and per label",
    "params": [
      {
        "name": "start_date",
        "type": "string",
        "required": true
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true
      },
      {
        "name": "campaigns",
        "type": "array",
        "required": false
      },
      {
        "name": "labels",
        "type": "array",
        "required": false
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false
      },
      {
        "name": "facebook_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "instagram_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "linkedin_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "tiktok_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "youtube_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "pinterest_accounts",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:campaigns-labels-posts",
    "fn": "campaignLabelAnalyticsPosts",
    "desc": "Per-post table for the selected campaigns & labels",
    "params": [
      {
        "name": "start_date",
        "type": "string",
        "required": true
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true
      },
      {
        "name": "campaigns",
        "type": "array",
        "required": false
      },
      {
        "name": "labels",
        "type": "array",
        "required": false
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false
      },
      {
        "name": "facebook_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "instagram_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "linkedin_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "tiktok_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "youtube_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "pinterest_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "platforms",
        "type": "array",
        "required": false,
        "description": "Networks to include. Empty or omitted means every network the account selection enables."
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive caption match."
      },
      {
        "name": "sort_by",
        "type": "string",
        "required": false,
        "enum": [
          "engagement",
          "views",
          "impressions",
          "reach",
          "link_clicks",
          "video_views",
          "likes",
          "comments",
          "shares",
          "saves",
          "published_at"
        ]
      },
      {
        "name": "sort_order",
        "type": "string",
        "required": false,
        "enum": [
          "desc",
          "asc"
        ]
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:campaigns-labels-summary",
    "fn": "campaignLabelAnalyticsSummary",
    "desc": "Campaign & label summary KPIs \u2014 current vs previous period",
    "params": [
      {
        "name": "start_date",
        "type": "string",
        "required": true
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true
      },
      {
        "name": "campaigns",
        "type": "array",
        "required": false
      },
      {
        "name": "labels",
        "type": "array",
        "required": false
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false
      },
      {
        "name": "facebook_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "instagram_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "linkedin_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "tiktok_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "youtube_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "pinterest_accounts",
        "type": "array",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:campaigns-labels-top-posts",
    "fn": "campaignLabelAnalyticsTopPosts",
    "desc": "Top 5 posts per network for the selected campaigns & labels",
    "params": [
      {
        "name": "start_date",
        "type": "string",
        "required": true
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true
      },
      {
        "name": "campaigns",
        "type": "array",
        "required": false
      },
      {
        "name": "labels",
        "type": "array",
        "required": false
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false
      },
      {
        "name": "facebook_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "instagram_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "linkedin_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "tiktok_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "youtube_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "pinterest_accounts",
        "type": "array",
        "required": false
      },
      {
        "name": "platforms",
        "type": "array",
        "required": false,
        "description": "Networks to include. Empty or omitted means every network the account selection enables."
      },
      {
        "name": "search",
        "type": "string",
        "required": false,
        "description": "Case-insensitive caption match."
      },
      {
        "name": "sort_by",
        "type": "string",
        "required": false,
        "enum": [
          "engagement",
          "views",
          "impressions",
          "reach",
          "link_clicks",
          "video_views",
          "likes",
          "comments",
          "shares",
          "saves",
          "published_at"
        ]
      },
      {
        "name": "sort_order",
        "type": "string",
        "required": false,
        "enum": [
          "desc",
          "asc"
        ]
      },
      {
        "name": "limit",
        "type": "integer",
        "required": false
      }
    ]
  },
  {
    "cmd": "analytics:youtube-publishing-behaviour",
    "fn": "youtubeAnalyticsPublishingBehaviour",
    "desc": "Publishing behaviour breakdown by content type",
    "params": [
      {
        "name": "platform_id",
        "type": "string",
        "required": true,
        "description": "Platform Account ID"
      },
      {
        "name": "start_date",
        "type": "string",
        "required": true,
        "description": "Start of the date range (YYYY-MM-DD)"
      },
      {
        "name": "end_date",
        "type": "string",
        "required": true,
        "description": "End of the date range (YYYY-MM-DD)"
      },
      {
        "name": "date",
        "type": "string",
        "required": false,
        "description": "Alternative date range in 'YYYY-MM-DD - YYYY-MM-DD' format (overrides start_date/end_date)"
      },
      {
        "name": "timezone",
        "type": "string",
        "required": false,
        "default": "UTC",
        "description": "IANA timezone name"
      },
      {
        "name": "media_type",
        "type": "string",
        "required": false
      }
    ]
  }
];

function kebabFlag(name: string): string {
  return name.replace(/_/g, "-");
}

function camelOfKebab(k: string): string {
  return k.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
}

/** Read an option by its snake_case param name, trying both yargs spellings. */
function readOpt(argv: any, name: string): unknown {
  const k = kebabFlag(name);
  return argv[k] ?? argv[camelOfKebab(k)];
}

function buildOptions(y: Argv<any>, params: AnalyticsParamSpec[]): Argv<any> {
  for (const p of params) {
    const flag = kebabFlag(p.name);
    if (p.type === "array") {
      y = y.option(flag, { type: "string", array: true, describe: p.description });
    } else if (p.type === "integer") {
      y = y.option(flag, { type: "number", describe: p.description, default: p.default as number | undefined });
    } else if (p.enum) {
      y = y.option(flag, {
        type: "string",
        choices: p.enum,
        describe: p.description,
        default: p.default as string | undefined,
      });
    } else {
      y = y.option(flag, { type: "string", describe: p.description, default: p.default as string | undefined });
    }
  }
  return y;
}

function collectParams(argv: any, params: AnalyticsParamSpec[]): AnalyticsParams {
  const collected: Record<string, unknown> = {};
  for (const p of params) {
    const v = readOpt(argv, p.name);
    if (v !== undefined) collected[p.name] = v;
  }
  return collected as unknown as AnalyticsParams;
}

function registerOne<T>(yargs: Argv<T>, spec: AnalyticsOpSpec): Argv<T> {
  return yargs.command(
    spec.cmd,
    spec.desc,
    (y) => buildOptions(y, spec.params),
    run(async (argv: any, g) => {
      const { cfg, client } = buildClient(g);
      const wid = resolveWorkspace(cfg, g);
      const params = collectParams(argv, spec.params);
      const missing = spec.params.filter((p) => p.required && (params as any)[p.name] === undefined);
      if (missing.length) {
        throw new ConfigError(
          `${missing.map((p) => `--${kebabFlag(p.name)}`).join(", ")} required.`,
        );
      }
      const fn = (api as any)[spec.fn] as (c: any, workspaceId: string, params: AnalyticsParams) => Promise<unknown>;
      const data = await fn(client, wid, params);
      out.emitSuccess(data, g);
    }),
  );
}

export function registerAnalytics<T>(yargs: Argv<T>): Argv<T> {
  let y: Argv<T> = yargs;
  for (const spec of ANALYTICS_OPS) {
    y = registerOne(y, spec);
  }
  return y;
}

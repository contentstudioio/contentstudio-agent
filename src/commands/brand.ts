/**
 * Brand Knowledge — the workspace's brand (CONT-3684 branch).
 *
 * One brand per workspace: style, profile, voice, source materials and brand
 * assets. ContentStudio's AI resolves it server-side for generation; these
 * commands read and edit the same record as the app's Brand Knowledge editor.
 *
 * brand:create, brand:source-add and brand:sync run the app's brand analysis
 * synchronously (up to ~2 minutes). They use a 180s client timeout
 * (`--timeout` overrides) and no automatic retry, so a 502
 * BRAND_ANALYSIS_FAILED is reported instead of silently re-running an analysis.
 */

import type { Argv } from "yargs";

import {
  BRAND_ANALYSIS_TIMEOUT_MS,
  BRAND_SECTIONS,
  BrandSourcesBody,
  addBrandSources,
  createBrand,
  deleteBrand,
  deleteBrandSource,
  getBrand,
  getBrandPostSettings,
  getBrandSection,
  syncBrand,
  updateBrand,
  updateBrandPostSettings,
} from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import {
  buildClient,
  emitDryRun,
  isDryRun,
  parseJsonOption,
  resolveWorkspace,
  run,
} from "../cliCtx";

export const BRAND_SOCIAL_PLATFORMS = [
  "instagram",
  "facebook",
  "twitter",
  "telegram",
  "tiktok",
  "gmb",
  "threads",
  "bluesky",
  "linkedin",
  "tumblr",
] as const;

export const BRAND_LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "Portuguese",
  "German",
  "Italian",
  "Dutch",
  "Turkish",
  "Indonesian",
  "Tagalog",
  "Swedish",
  "Danish",
  "Norwegian",
  "Romanian",
  "Polish",
  "Finnish",
  "Hungarian",
  "Greek",
  "Czech",
  "Malay",
  "Vietnamese",
  "Chinese (Simplified)",
  "Chinese (Traditional)",
] as const;

export const BRAND_POST_TYPES = ["image", "text", "text_image"] as const;
export const BRAND_USAGE_LEVELS = ["none", "low", "medium", "high"] as const;
export const BRAND_ASPECT_RATIOS = [
  "8:1",
  "4:1",
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "5:4",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "1:4",
  "1:8",
] as const;
export const BRAND_IMAGE_STYLES = [
  "none",
  "abstract",
  "oil-painting",
  "neon-punk",
  "app-icon",
  "black-white",
  "bokeh",
  "cartoon",
  "cinematic",
  "cyberpunk",
  "digital-watercolor",
  "film-noir",
  "film-poster",
  "flat-design",
  "futuristic",
  "grunge",
  "highly-detailed",
  "isometric",
  "minimalistic",
  "photorealistic",
  "pixel-art",
  "polaroid",
  "pop-art",
  "retro-80s",
  "steampunk",
  "sticker",
  "super-realistic",
  "surrealism",
  "tattoo",
  "unreal-engine",
  "vaporwave",
] as const;

export function registerBrand<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "brand:get",
      "Read the workspace's brand. A workspace without one answers is_set_up: false (not an error).",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data = await getBrand(client, wid);
        out.emitSuccess(data, g, renderBrand);
      }),
    )
    .command(
      "brand:section <section>",
      "Read one part of the brand: style, profile or voice.",
      (y) =>
        y.positional("section", {
          type: "string",
          choices: [...BRAND_SECTIONS],
          demandOption: true,
        }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const section = String(argv.section) as (typeof BRAND_SECTIONS)[number];
        const data = await getBrandSection(client, wid, section);
        out.emitSuccess(data, g, (d: any) => {
          out.status("Set up", d?.is_set_up ? "yes" : "no");
          out.status("Updated", String(d?.updated_at ?? "-"));
          console.log(JSON.stringify(d?.[`brand_${section}`] ?? {}, null, 2));
        });
      }),
    )
    .command(
      "brand:create",
      "Build the brand by AI analysis of the sources given (the app's \"Build My Brand Knowledge\"). Synchronous — can take ~2 minutes. Fails with 409 BRAND_ALREADY_EXISTS if the workspace has a brand.",
      (y) =>
        applySourceOptions(y)
          .option("timeout", timeoutOption())
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const body = sourcesBodyOf(argv);
        const { cfg, client } = analysisClient(g, argv);
        const wid = resolveWorkspace(cfg, g);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/brand`,
            body as Record<string, unknown>,
            "build the brand by AI analysis",
          );
        }
        const data = await createBrand(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Brand created.");
          renderBrand(d);
          out.info("Brand assets discovered by the analysis are added in the background shortly after.");
        });
      }),
    )
    .command(
      "brand:update",
      "Partially update the brand (creates it, without analysis, if none). Only fields sent change; a list sent replaces that list; unknown keys are rejected.",
      (y) =>
        y
          .option("brand-style", {
            type: "string",
            describe:
              "JSON object → brand_style: {logo, colors:[{hex:\"#RRGGBB\", role:brand|background|text|accent}] (≤6; ≤1 each of brand/background/text), title_font, body_font, visual_identity_description}. logo \"\" or null clears it.",
          })
          .option("brand-profile", {
            type: "string",
            describe:
              "JSON object → brand_profile: {business_name, core_identity, market_positioning (≤10000 chars), competitors[], competitive_advantages[], primary_customer_segments[], primary_value_drivers[] (entries ≤200)}.",
          })
          .option("brand-voice", {
            type: "string",
            describe:
              "JSON object → brand_voice: {purpose, audience, voice_description (≤10000 chars), tone[], emotion[], character[], language[] (free text, entries ≤200)}.",
          })
          .option("brand-enabled", {
            type: "boolean",
            describe:
              "Whether AI generation uses the brand. --brand-enabled / --no-brand-enabled.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const body: Record<string, unknown> = {};
        const style = argv["brand-style"] ?? argv.brandStyle;
        if (style !== undefined) body.brand_style = parseJsonOption(style, "--brand-style");
        const profile = argv["brand-profile"] ?? argv.brandProfile;
        if (profile !== undefined) body.brand_profile = parseJsonOption(profile, "--brand-profile");
        const voice = argv["brand-voice"] ?? argv.brandVoice;
        if (voice !== undefined) body.brand_voice = parseJsonOption(voice, "--brand-voice");
        const enabled = argv["brand-enabled"] ?? argv.brandEnabled;
        if (enabled !== undefined) body.brand_enabled = !!enabled;

        if (!Object.keys(body).length) {
          throw new ConfigError(
            "Pass at least one of --brand-style / --brand-profile / --brand-voice / --brand-enabled.",
          );
        }
        if (isDryRun(argv)) {
          return emitDryRun(g, `PATCH /workspaces/${wid}/brand`, body, "update the brand");
        }
        const data = await updateBrand(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Brand updated.");
          renderBrand(d);
        });
      }),
    )
    .command(
      "brand:delete",
      "Permanently delete the brand with its brand-asset media, logo and source-material files. Not reversible.",
      (y) => y.option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        if (isDryRun(argv)) {
          return emitDryRun(g, `DELETE /workspaces/${wid}/brand`, {}, "delete the brand");
        }
        const data = await deleteBrand(client, wid);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Brand deleted.");
          out.status("Brand assets removed", String(d?.brand_assets ?? 0));
          out.status("Source materials removed", String(d?.source_materials ?? 0));
          out.status("Logo removed", d?.logo ? "yes" : "no");
        });
      }),
    )
    .command(
      "brand:source-add",
      "Add source materials and AI-blend each into the existing brand. Synchronous — allow ~2 minutes per source. Each added source comes back synced or unreachable.",
      (y) =>
        applySourceOptions(y)
          .option("timeout", timeoutOption())
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const body = sourcesBodyOf(argv);
        const { cfg, client } = analysisClient(g, argv);
        const wid = resolveWorkspace(cfg, g);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/brand/sources`,
            body as Record<string, unknown>,
            "add brand source materials",
          );
        }
        const data = await addBrandSources(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Source materials added.");
          renderSources(d?.added ?? []);
        });
      }),
    )
    .command(
      "brand:source-delete <source_id>",
      "Delete one source material and the brand assets it produced. Names any inbox auto-reply rules it was detached from.",
      (y) =>
        y
          .positional("source_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const id = String(argv.source_id);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/brand/sources/${id}`,
            {},
            `delete brand source ${id}`,
          );
        }
        const data = await deleteBrandSource(client, wid, id);
        out.emitSuccess(data, g, (d: any) => {
          out.success(`Deleted brand source ${id}.`);
          const rules: string[] = d?.auto_reply_rules_affected ?? [];
          if (rules.length) {
            out.warning(`Detached from auto-reply rules: ${rules.join(", ")}`);
          }
        });
      }),
    )
    .command(
      "brand:sync",
      "Re-analyse ALL source materials and overwrite the brand style, profile and voice (the app's Sync). Synchronous — can take ~2 minutes.",
      (y) =>
        y
          .option("timeout", timeoutOption())
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = analysisClient(g, argv);
        const wid = resolveWorkspace(cfg, g);
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/brand/sync`,
            {},
            "re-sync every brand source",
          );
        }
        const data = await syncBrand(client, wid);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Brand re-synced from its source materials.");
          renderBrand(d);
        });
      }),
    )
    .command(
      "brand:post-settings",
      "Read the AI Content Library post generation defaults for this brand.",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data = await getBrandPostSettings(client, wid);
        out.emitSuccess(data, g, renderPostSettings);
      }),
    )
    .command(
      "brand:post-settings-update",
      "Update the post generation defaults (partial). Nothing saves until a social platform is stored or sent. Creates the brand if none.",
      (y) =>
        y
          .option("social-platform", {
            type: "string",
            choices: [...BRAND_SOCIAL_PLATFORMS],
            describe: "→ social_platform. Required on the first save.",
          })
          .option("language", {
            type: "string",
            choices: [...BRAND_LANGUAGES],
            describe: "→ language (quote multi-word values, e.g. \"Chinese (Simplified)\").",
          })
          .option("post-type", {
            type: "string",
            choices: [...BRAND_POST_TYPES],
            describe: "→ post_type.",
          })
          .option("number-of-posts", {
            type: "number",
            describe: "→ no_of_posts, 1–10.",
          })
          .option("caption-length", {
            type: "number",
            describe: "→ caption_length, 20–200.",
          })
          .option("emoji-usage", {
            type: "string",
            choices: [...BRAND_USAGE_LEVELS],
            describe: "→ emoji_usage.",
          })
          .option("hashtag-usage", {
            type: "string",
            choices: [...BRAND_USAGE_LEVELS],
            describe: "→ hashtag_usage.",
          })
          .option("aspect-ratio", {
            type: "string",
            choices: [...BRAND_ASPECT_RATIOS],
            describe: "→ aspect_ratio.",
          })
          .option("image-style", {
            type: "string",
            choices: [...BRAND_IMAGE_STYLES],
            describe: "→ image_style.",
          })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const body: Record<string, unknown> = {};
        const str = (flag: string, camel: string, key: string) => {
          const v = argv[flag] ?? argv[camel];
          if (v !== undefined) body[key] = String(v);
        };
        const int = (flag: string, camel: string, key: string, min: number, max: number) => {
          const v = argv[flag] ?? argv[camel];
          if (v === undefined) return;
          if (!Number.isInteger(v) || v < min || v > max) {
            throw new ConfigError(`--${flag} must be an integer from ${min} to ${max} (got ${v}).`);
          }
          body[key] = v;
        };
        str("social-platform", "socialPlatform", "social_platform");
        str("language", "language", "language");
        str("post-type", "postType", "post_type");
        int("number-of-posts", "numberOfPosts", "no_of_posts", 1, 10);
        int("caption-length", "captionLength", "caption_length", 20, 200);
        str("emoji-usage", "emojiUsage", "emoji_usage");
        str("hashtag-usage", "hashtagUsage", "hashtag_usage");
        str("aspect-ratio", "aspectRatio", "aspect_ratio");
        str("image-style", "imageStyle", "image_style");

        if (!Object.keys(body).length) {
          throw new ConfigError(
            "Pass at least one setting (--social-platform, --language, --post-type, --number-of-posts, --caption-length, --emoji-usage, --hashtag-usage, --aspect-ratio, --image-style).",
          );
        }
        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `PATCH /workspaces/${wid}/brand/post-generation-settings`,
            body,
            "update the brand's post generation settings",
          );
        }
        const data = await updateBrandPostSettings(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Post generation settings updated.");
          renderPostSettings(d);
        });
      }),
    );
}

/** Source flags shared by brand:create and brand:source-add. */
function applySourceOptions<T>(y: Argv<T>): Argv<T> {
  return y
    .option("website-url", {
      type: "string",
      describe: "→ website_url. A website to scrape and analyse.",
    })
    .option("text", {
      type: "string",
      describe: "→ text. Brand info, ≤10000 characters.",
    })
    .option("file", {
      type: "string",
      array: true,
      describe:
        "→ files[].url. Public https URL of a PDF/DOCX/TXT/Markdown document. Repeatable (≤50 files in total).",
    })
    .option("files", {
      type: "string",
      describe:
        "JSON array → files, for documents with a display name: '[{\"url\":\"https://…/guide.pdf\",\"name\":\"Brand guide\"}]' (name ≤255). Combined with --file.",
    })
    .option("social-account", {
      type: "string",
      array: true,
      describe:
        "→ social_accounts[]. An account `id` from accounts:list (connected facebook, twitter, instagram, linkedin, pinterest, telegram, youtube, tiktok, tumblr, gmb or bluesky account). Repeatable.",
    });
}

function sourcesBodyOf(argv: any): BrandSourcesBody {
  const body: BrandSourcesBody = {};
  const website = argv["website-url"] ?? argv.websiteUrl;
  if (website !== undefined) body.website_url = String(website);
  if (argv.text !== undefined) body.text = String(argv.text);

  const files: { url: string; name?: string }[] = [];
  for (const url of (argv.file as string[] | undefined) ?? []) {
    if (String(url)) files.push({ url: String(url) });
  }
  if (argv.files !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(argv.files));
    } catch (e) {
      throw new ConfigError(`--files: invalid JSON — ${(e as Error).message}`);
    }
    if (!Array.isArray(parsed)) {
      throw new ConfigError("--files: JSON must be an array of {url, name?} objects.");
    }
    for (const f of parsed) {
      if (!f || typeof f !== "object" || typeof (f as any).url !== "string") {
        throw new ConfigError("--files: every entry needs a string `url`.");
      }
      const entry: { url: string; name?: string } = { url: (f as any).url };
      if ((f as any).name !== undefined) entry.name = String((f as any).name);
      files.push(entry);
    }
  }
  if (files.length) body.files = files;

  const accounts = ((argv["social-account"] ?? argv.socialAccount) as string[] | undefined)
    ?.map(String)
    .filter(Boolean);
  if (accounts?.length) body.social_accounts = accounts;

  if (!Object.keys(body).length) {
    throw new ConfigError(
      "Pass at least one source: --website-url, --text, --file / --files, or --social-account.",
    );
  }
  return body;
}

function timeoutOption() {
  return {
    type: "number" as const,
    describe: `Client timeout in seconds (default ${BRAND_ANALYSIS_TIMEOUT_MS / 1000}). The analysis is synchronous and can take ~2 minutes.`,
  };
}

/**
 * A Client for the analysis calls: long timeout and no automatic retry, so a
 * 502 BRAND_ANALYSIS_FAILED is reported once instead of re-running the analysis.
 */
function analysisClient(g: any, argv: any) {
  const secs = argv.timeout;
  let timeoutMs = BRAND_ANALYSIS_TIMEOUT_MS;
  if (secs !== undefined) {
    if (!Number.isFinite(secs) || secs <= 0) {
      throw new ConfigError(`--timeout must be a positive number of seconds (got ${secs}).`);
    }
    timeoutMs = Math.round(secs * 1000);
  }
  return buildClient(g, { timeoutMs, retries: 0 });
}

function list(v: unknown): string {
  return Array.isArray(v) && v.length ? v.join(", ") : "-";
}

function renderBrand(d: any): void {
  if (!d?.is_set_up) {
    out.info("This workspace has no brand set up yet. Create one with brand:create (AI analysis) or brand:update (by hand).");
  }
  out.status("Set up", d?.is_set_up ? "yes" : "no");
  out.status("Brand enabled", d?.brand_enabled ? "yes" : "no");

  const st = d?.brand_style ?? {};
  out.section("Style");
  out.status("Logo", String(st.logo ?? "-"));
  out.status(
    "Colors",
    Array.isArray(st.colors) && st.colors.length
      ? st.colors.map((c: any) => `${c.hex} (${c.role})`).join(", ")
      : "-",
  );
  out.status("Title font", String(st.title_font ?? "-"));
  out.status("Body font", String(st.body_font ?? "-"));

  const pr = d?.brand_profile ?? {};
  out.section("Profile");
  out.status("Business name", String(pr.business_name ?? "-"));
  out.status("Competitors", list(pr.competitors));

  const vo = d?.brand_voice ?? {};
  out.section("Voice");
  out.status("Tone", list(vo.tone));
  out.status("Emotion", list(vo.emotion));
  out.status("Character", list(vo.character));
  out.status("Language", list(vo.language));

  const sources = d?.source_materials ?? [];
  if (Array.isArray(sources) && sources.length) {
    out.section("Source materials");
    renderSources(sources);
  }
  out.status("Brand assets", String((d?.brand_assets ?? []).length));
  out.status("Updated", String(d?.updated_at ?? "-"));
}

function renderSources(items: any[]): void {
  out.table(
    ["ID", "Type", "Name", "Status", "Last synced"],
    items.map((s: any) => [
      String(s.id ?? "-"),
      s.type ?? "-",
      s.name ?? "-",
      s.status ?? "-",
      s.last_synced_at ?? "-",
    ]),
  );
}

function renderPostSettings(d: any): void {
  out.status("Social platform", String(d?.social_platform ?? "- (not set — required before saving)"));
  out.status("Language", String(d?.language ?? "-"));
  out.status("Post type", String(d?.post_type ?? "-"));
  out.status("Posts", String(d?.no_of_posts ?? "-"));
  out.status("Caption length", String(d?.caption_length ?? "-"));
  out.status("Emoji usage", String(d?.emoji_usage ?? "-"));
  out.status("Hashtag usage", String(d?.hashtag_usage ?? "-"));
  out.status("Aspect ratio", String(d?.aspect_ratio ?? "-"));
  out.status("Image style", String(d?.image_style ?? "-"));
}

/**
 * AI carousels — templates, estimate, generate and edit. Like images:generate, generate and edit
 * answer when the deck is done (up to about 3 minutes) and print the slides' media IDs, ready for
 * `posts:create --post-type carousel --media-id ...`.
 */

import type { Argv } from "yargs";

import {
  AiCarouselBody,
  AiCarouselEditBody,
  AiCarouselStyle,
  editAiCarousel,
  estimateAiCarousel,
  generateAiCarousel,
  listAiCarouselTemplates,
} from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import { buildClient, emitDryRun, isDryRun, resolveWorkspace, run } from "../cliCtx";

const MAX_PROMPT_LENGTH = 2000;
const MAX_REFERENCES = 2;
// Billed and not idempotent, so never retried; an AI-drawn deck takes up to about 3 minutes.
const BUILD = { retries: 0, timeoutMs: 300_000 };

function optionFlags<T>(y: Argv<T>) {
  return y
    .option("prompt", { type: "string", describe: `Required. Max ${MAX_PROMPT_LENGTH} chars.` })
    .option("slides", {
      type: "number",
      describe: "slide_count (3-10). Omit it and the AI chooses the length.",
    })
    .option("size", {
      type: "string",
      choices: ["portrait", "square"] as const,
      describe: "portrait is 4:5 (default), square is 1:1.",
    })
    .option("template", {
      type: "string",
      describe: "A template id from carousels:templates (style mode template).",
    })
    .option("description", {
      type: "string",
      describe: "Describe the look in plain words (style mode custom).",
    })
    .option("reference", {
      type: "string",
      array: true,
      describe: `An image to match: a media ID or public URL (repeatable, max ${MAX_REFERENCES}, style mode custom).`,
    })
    .option("brand-colours", {
      type: "boolean",
      describe: "Use the brand's colours (default). --no-brand-colours keeps the template's own.",
    })
    .option("use-brand", {
      type: "boolean",
      describe: "Brand knowledge (voice, logo). Omit it to follow the workspace setting.",
    })
    .option("language", { type: "string", describe: "Language of the slides and caption." });
}

export function registerCarousels<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "carousels:templates",
      "List carousel templates (id, name, best for, sizes, cover preview).",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await listAiCarouselTemplates(client, wid);
        const templates = (data?.templates as any[]) ?? [];
        out.emitSuccess(data, g, () =>
          out.table(
            ["ID", "NAME", "SIZES", "BEST FOR"],
            templates.map((t: any) => [
              String(t?.id ?? "-"),
              String(t?.name ?? "-"),
              Array.isArray(t?.sizes) ? t.sizes.join(",") : "-",
              trim(t?.best_for, 60),
            ]),
          ),
        );
      }),
    )
    .command(
      "carousels:estimate",
      "Get the credit cost as {min, max}. Nothing is generated or charged.",
      (y) => optionFlags(y),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await estimateAiCarousel(client, wid, buildCarouselBody(argv));
        out.emitSuccess(data, g, (d: any) => {
          const { min, max } = d?.credits ?? {};
          out.status("Credits", min === max ? String(min ?? "-") : `${min} to ${max}`);
          if (!d?.route_known) out.info("The AI picks the route while planning; it never charges more than the max.");
        });
      }),
    )
    .command(
      "carousels:generate",
      "Generate a carousel (ordered slides plus one caption), waiting for it by default.",
      (y) =>
        optionFlags(y).option("dry-run", {
          type: "boolean",
          default: false,
          describe: "Print the body that would be sent without calling the API.",
        }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g, BUILD);
        const wid = resolveWorkspace(cfg, g);
        const body = buildCarouselBody(argv);

        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/ai/carousels/generate`,
            body as unknown as Record<string, unknown>,
            "generate an AI carousel",
          );
        }

        if (!g.useJson) out.info("Making the carousel; this takes up to about 3 minutes...");
        const deck: any = await generateAiCarousel(client, wid, body);
        out.emitSuccess(deck, g, (d: any) => printDeck(d));
      }),
    )
    .command(
      "carousels:edit <carousel_id>",
      "Apply one plain-language change to a finished carousel, waiting for it by default.",
      (y) =>
        y
          .positional("carousel_id", { type: "string", demandOption: true })
          .option("instruction", { type: "string", describe: "Required. The change, in plain words." })
          .option("slide", { type: "number", describe: "1-based slide the change is about." })
          .option("language", { type: "string" })
          .option("use-brand", { type: "boolean" })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g, BUILD);
        const wid = resolveWorkspace(cfg, g);
        const carouselId = String(argv.carousel_id);
        const body = buildEditBody(argv);

        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/ai/carousels/${carouselId}/edit`,
            body as unknown as Record<string, unknown>,
            `edit carousel ${carouselId}`,
          );
        }

        if (!g.useJson) out.info("Editing the carousel...");
        const deck: any = await editAiCarousel(client, wid, carouselId, body);
        out.emitSuccess(deck, g, (d: any) => printDeck(d));
      }),
    );
}

function printDeck(d: any): void {
  out.success("Carousel ready.");
  out.status("Carousel ID", String(d?.carousel_id ?? "-"));
  out.status("Credits", String(d?.credits ?? "-"));
  out.status("Caption", String(d?.caption ?? ""));
  out.table(
    ["SLIDE", "MEDIA ID", "URL"],
    ((d?.slides as any[]) ?? []).map((s: any) => [String(s?.position ?? "-"), String(s?.media_id ?? "-"), String(s?.url ?? "-")]),
  );
  if (Array.isArray(d?.failed_slots) && d.failed_slots.length) {
    out.warning(`Slides not drawn: ${d.failed_slots.map((n: number) => n + 1).join(", ")}`);
  }
}

/**
 * Build + validate the generate/estimate body from argv. Runs in --dry-run too, so the printed
 * payload is what would be sent. The style mode follows the flags: --template is a template,
 * --description or --reference is custom, neither lets the AI choose.
 */
export function buildCarouselBody(argv: any): AiCarouselBody {
  if (!argv.prompt) throw new ConfigError("--prompt is required.");
  const prompt = String(argv.prompt);
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new ConfigError(`--prompt exceeds ${MAX_PROMPT_LENGTH} characters (got ${prompt.length}).`);
  }
  const references = ((argv.reference as string[] | undefined) ?? []).map(String);
  if (references.length > MAX_REFERENCES) {
    throw new ConfigError(`--reference may be repeated at most ${MAX_REFERENCES} times (got ${references.length}).`);
  }
  const custom = !!argv.description || references.length > 0;
  if (argv.template && custom) {
    throw new ConfigError("--template and --description/--reference are different styles; pass one or the other.");
  }

  const body: AiCarouselBody = { prompt };
  if (argv.slides !== undefined) body.slide_count = Number(argv.slides);
  if (argv.size) body.size = argv.size;
  if (argv.language) body.language = String(argv.language);
  const useBrand = argv["use-brand"] ?? argv.useBrand;
  if (useBrand !== undefined) body.use_brand = !!useBrand;

  const style: AiCarouselStyle = {};
  if (argv.template) {
    style.mode = "template";
    style.template_id = String(argv.template);
  } else if (custom) {
    style.mode = "custom";
    if (argv.description) style.description = String(argv.description);
    if (references.length) style.references = references;
  }
  const colours = argv["brand-colours"] ?? argv.brandColours;
  if (colours !== undefined) style.brand_colours = !!colours;
  if (Object.keys(style).length) body.style = style;
  return body;
}

function buildEditBody(argv: any): AiCarouselEditBody {
  if (!argv.instruction) throw new ConfigError("--instruction is required.");
  const body: AiCarouselEditBody = { instruction: String(argv.instruction) };
  if (argv.slide !== undefined) body.slide = Number(argv.slide);
  if (argv.language) body.language = String(argv.language);
  const useBrand = argv["use-brand"] ?? argv.useBrand;
  if (useBrand !== undefined) body.use_brand = !!useBrand;
  return body;
}

function trim(value: unknown, max: number): string {
  const text = String(value ?? "-");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

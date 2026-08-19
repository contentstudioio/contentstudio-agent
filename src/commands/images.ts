/**
 * AI image commands (added v1.3.0).
 *
 *   images:tools / images:models / images:brand  — discovery
 *   images:generate                              — prompt → image (or an edit)
 *   images:<tool>                                — one command per dedicated tool
 *   images:tool <tool_key> --body '<json>'       — any tool, every control
 *
 * Both generation paths return the same `data`, whose `media_id` goes straight
 * into `posts:create --media-id`. That two-step is the whole point of the group:
 *
 *   ID=$(contentstudio --json images:generate -p "autumn coffee flat-lay" \
 *          | jq -r '.data.media_id')
 *   contentstudio posts:create -c "Autumn blend is back." -i <account_id> \
 *          -t draft --media-id "$ID"
 */

import type { Argv } from "yargs";

import {
  IMAGE_DIMENSIONS,
  IMAGE_TIMEOUT_MS,
  MAX_IMAGE_PROMPT,
  MAX_IMAGE_URL,
  type ImageResult,
  generateImage,
  getAiBrandStatus,
  invokeImageTool,
  listImageModels,
  listImageTools,
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

/**
 * The dedicated image tools and the fields each one reads. Every field is a
 * string, so one table drives six commands — the tools differ only in which
 * fields they take. Flag name is the API field name with dashes:
 * `target_image_url` → `--target-image-url`.
 *
 * `image-to-image` is deliberately absent: `images:generate --image-url` is the
 * same operation with the prompt as the edit instruction, and `images:tool
 * image-to-image --body` reaches its extra controls.
 */
const IMAGE_TOOLS: Array<{
  key: string;
  describe: string;
  required: string[];
  optional: string[];
}> = [
  {
    key: "product-image",
    describe: "Restage a product photo into a new scene.",
    required: ["product_image_url"],
    optional: ["reference_image_url", "aspect_ratio", "resolution", "instructions"],
  },
  {
    key: "headshot",
    describe: "Turn a photo of a person into a professional headshot.",
    required: ["image_url"],
    optional: ["aspect_ratio", "resolution"],
  },
  {
    key: "face-swap",
    describe: "Put the face from one image onto the subject of another.",
    required: ["target_image_url", "face_image_url"],
    optional: ["resolution"],
  },
  {
    key: "outfit-swap",
    describe: "Virtual try-on: dress the subject in a garment from another image.",
    required: ["target_image_url", "outfit_image_url"],
    optional: [],
  },
  {
    key: "upscale",
    describe: "Increase an image's resolution.",
    required: ["image_url"],
    optional: ["resolution"],
  },
  {
    key: "remove-background",
    describe: "Cut the subject out of its background.",
    required: ["image_url"],
    optional: [],
  },
];

const FIELD_HELP: Record<string, string> = {
  image_url: "Source image URL — must be publicly fetchable over http(s).",
  target_image_url: "The image being edited (its scene and body are kept).",
  face_image_url: "The face to place onto the target.",
  outfit_image_url: "The garment to put on the target.",
  product_image_url: "The product photo to restage.",
  reference_image_url: "Optional style or scene reference.",
  resolution:
    "Output resolution, for a tool that declares one — take the value from its `controls` in " +
    "images:tools. A tool listing no resolution control accepts the field but may ignore it.",
  aspect_ratio:
    "Output aspect ratio, for a tool that declares one — take the value from its `controls` in " +
    "images:tools.",
  instructions: `Extra direction for the scene (≤${MAX_IMAGE_PROMPT} chars).`,
};

const flagOf = (field: string) => field.replace(/_/g, "-");

/** Read a `--kebab-case` flag whichever spelling yargs hands back. */
function flagValue(argv: any, field: string): string | undefined {
  const kebab = flagOf(field);
  const camel = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const v = argv[kebab] ?? argv[camel];
  return v === undefined || v === null ? undefined : String(v);
}

const TOOL_BY_KEY = new Map(IMAGE_TOOLS.map((t) => [t.key, t]));

/**
 * How to invoke a tool and with which flags — for the `images:tools` table.
 *
 * The descriptor's `inputs[].name` is NOT usable here: it is the underlying
 * tool's slot name (`image`, `target_image`, `product`), not the wire field
 * (`image_url`, `target_image_url`, `product_image_url`) and not a CLI flag, so
 * printing it sends the reader to a flag that does not exist. The wire field set
 * is what this CLI's own table encodes; the descriptor is only authoritative
 * about which controls the underlying tool honours.
 *
 * A key with no dedicated command — `image-to-image`, or a tool added upstream
 * after this release — falls back to the generic escape hatch.
 */
function howToRun(key: string): [string, string] {
  const spec = TOOL_BY_KEY.get(key);
  if (!spec) return [`images:tool ${key} --body '<json>'`, ""];
  return [
    `images:${key}`,
    [
      ...spec.required.map((f) => `--${flagOf(f)}*`),
      ...spec.optional.map((f) => `--${flagOf(f)}`),
    ].join(" "),
  ];
}

/** `resolution=1K|2K|4K` — the values a per-tool `--resolution` must come from. */
function controlSummary(controls: unknown): string {
  const list = Array.isArray(controls) ? controls : [];
  if (!list.length) return "none";
  return list
    .map((c: any) => `${c?.name}=${(c?.options ?? []).join("|") || "?"}`)
    .join("  ");
}

/**
 * Client-side checks for the limits the API already enforces. Worth doing: every
 * rejected call still costs an API request credit, and a `file://` path or a
 * pasted 3KB signed URL is a typo, not a decision worth a round-trip.
 */
function assertUrl(value: string, flag: string): void {
  if (!/^https?:\/\//i.test(value)) {
    throw new ConfigError(
      `${flag} must be an http(s) URL (got "${value.slice(0, 60)}"). The image ` +
        `service downloads it, so a local path cannot work — upload it first with ` +
        `\`media:upload --file\` and use the returned URL.`,
    );
  }
  if (value.length > MAX_IMAGE_URL) {
    throw new ConfigError(`${flag} is longer than ${MAX_IMAGE_URL} characters.`);
  }
}

function assertMaxLen(value: string, max: number, flag: string): void {
  if (value.length > max) {
    throw new ConfigError(`${flag} is ${value.length} characters; the limit is ${max}.`);
  }
}

/** Collect + validate a tool's flags into the request body. */
function toolBody(argv: any, spec: (typeof IMAGE_TOOLS)[number]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const field of [...spec.required, ...spec.optional]) {
    const v = flagValue(argv, field);
    if (v === undefined) continue;
    const flag = `--${flagOf(field)}`;
    if (field.endsWith("_url")) assertUrl(v, flag);
    if (field === "instructions") assertMaxLen(v, MAX_IMAGE_PROMPT, flag);
    body[field] = v;
  }
  for (const field of spec.required) {
    if (body[field] === undefined) {
      throw new ConfigError(`--${flagOf(field)} is required for images:${spec.key}.`);
    }
  }
  return body;
}

/**
 * A Client sized for generation: it waits past the server's own 120s deadline,
 * and it does not retry. Retries are off because these POSTs are billable and
 * not idempotent — the built-in 429/5xx retry would re-run a generation that may
 * already have consumed an image credit. A 429 here needs the full throttle
 * minute anyway, which is longer than the retry backoff ever waits.
 */
function imageClient(g: any, timeoutMs: number) {
  return buildClient(g, { timeoutMs, retries: 0 });
}

/** `--timeout <seconds>` → ms, defaulting to IMAGE_TIMEOUT_MS. */
function timeoutMs(argv: any): number {
  const secs = argv.timeout;
  if (secs === undefined) return IMAGE_TIMEOUT_MS;
  if (!Number.isFinite(secs) || secs <= 0) {
    throw new ConfigError(`--timeout must be a positive number of seconds (got ${secs}).`);
  }
  return Math.round(secs * 1000);
}

function renderResult(d: ImageResult): void {
  out.success(d.media_id ? "Image generated and saved to the media library." : "Image generated.");
  out.status("Media ID", d.media_id ?? "-");
  out.status("URL", d.url ?? "-");
  const size = d.width && d.height ? `${d.width}×${d.height}` : "unknown size";
  out.status("Image", `${size} ${d.mime_type ?? ""}`.trim());
  out.status("Model used", d.model_used ?? "-");
  out.status("Brand applied", d.brand_applied ? "yes" : "no");
  const avail = d.credits?.available;
  out.status(
    "Image credits",
    `${d.credits?.consumed ?? "?"} consumed, ${avail === null || avail === undefined ? "balance unknown" : `${avail} left`}`,
  );

  if (d.persist_error) {
    out.warning(
      d.persist_error === "media_storage_full"
        ? "The image was generated and charged but the workspace is out of media storage, " +
            "so there is no media ID. Free up storage — retrying costs another credit and " +
            "fails the same way. Download the URL above now; it is temporary."
        : `The image was generated and charged but could not be saved (${d.persist_error}). ` +
            "Download the URL above now — it is temporary — or retry the call.",
    );
    return;
  }
  if (d.media_id) {
    out.info(
      `Publish it: contentstudio posts:create -c "<text>" -i <account_id> -t draft --media-id ${d.media_id}` +
        ` (swap -t draft for -t scheduled -s "YYYY-MM-DD HH:MM:SS" to send it)`,
    );
  }
}

/** Flags shared by every command that generates an image. */
function generationOptions<T>(y: Argv<T>) {
  return y
    .option("timeout", {
      type: "number",
      describe: `Client timeout in seconds (default ${IMAGE_TIMEOUT_MS / 1000}). The server's own deadline is 120s, so keep this above it.`,
    })
    .option("dry-run", {
      type: "boolean",
      default: false,
      describe: "Print the endpoint and body that would be sent; call no API.",
    });
}

export function registerImages<T>(yargs: Argv<T>): Argv<T> {
  let cli = yargs
    .command(
      "images:tools",
      "List the AI image tools this API can invoke, with their inputs and controls.",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const tools = await listImageTools(client, wid);
        out.emitSuccess(tools, g, () => {
          if (!tools.length) {
            out.warning(
              "No tools returned. The catalogue is unreachable rather than empty — retry shortly.",
            );
            return;
          }
          out.table(
            ["Tool", "Run with", "Controls"],
            tools.map((t: any) => {
              const [cmd, flags] = howToRun(String(t.key ?? ""));
              return [
                String(t.key ?? "-"),
                `${cmd} ${flags}`.trim(),
                controlSummary(t.controls),
              ];
            }),
          );
          out.info(
            "* = required. Pick --resolution / --aspect-ratio values from that tool's Controls.",
          );
          out.info(
            "Controls describe the underlying tool; only the flags above are in the public payload. " +
              "A control with no flag cannot be sent, including through `images:tool --body`.",
          );
        });
      }),
    )
    .command(
      "images:models",
      "List the model identifiers images:generate accepts.",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const models = await listImageModels(client, wid);
        out.emitSuccess(models, g, () => {
          out.table(["Model"], models.map((m) => [m]));
          out.info(
            "Omit --model to use the service default. Costs differ per model — read `credits.consumed` on the result.",
          );
        });
      }),
    )
    .command(
      "images:brand",
      "Whether --use-brand will apply anything (brand status only, never brand content).",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data = await getAiBrandStatus(client, wid);
        out.emitSuccess(data, g, (d) => {
          out.status("Brand profile configured", d.configured ? "yes" : "no");
          out.status("Brand enabled", d.enabled ? "yes" : "no");
          if (!d.configured || !d.enabled) {
            out.info(
              "`images:generate --use-brand` will come back with `brand_applied: false` — " +
                "that is not an error. Brand knowledge is set up in the ContentStudio web app.",
            );
          }
        });
      }),
    )
    .command(
      "images:generate",
      "Generate an image from a prompt (or edit one with --image-url) and save it to the media library.",
      (y) =>
        generationOptions(
          y
            .option("prompt", {
              type: "string",
              alias: "p",
              demandOption: true,
              describe: `What to generate — or, with --image-url, the edit to make (≤${MAX_IMAGE_PROMPT} chars).`,
            })
            .option("image-url", {
              type: "string",
              describe:
                "Edit this image instead of generating from scratch. Must be publicly fetchable over http(s). `dimensions` is ignored and `brand_applied` is always false on this path.",
            })
            .option("model", {
              type: "string",
              describe: "Model identifier from images:models. Omit for the service default.",
            })
            .option("dimensions", {
              type: "string",
              choices: [...IMAGE_DIMENSIONS],
              describe: "Output shape (text→image only). Exact pixels are the model's choice.",
            })
            .option("use-brand", {
              type: "boolean",
              default: false,
              describe:
                "Apply the workspace's brand knowledge, resolved server-side. Check images:brand first; the response reports brand_applied.",
            })
            .option("enhance-prompt", {
              type: "boolean",
              describe:
                "Let the service rewrite the prompt for better results (on by default server-side; pass --no-enhance-prompt to send it verbatim).",
            }),
        ),
      run(async (argv: any, g) => {
        const prompt = String(argv.prompt);
        assertMaxLen(prompt, MAX_IMAGE_PROMPT, "--prompt");
        const imageUrl = argv["image-url"] ?? argv.imageUrl;
        if (imageUrl !== undefined) assertUrl(String(imageUrl), "--image-url");

        const body: Record<string, unknown> = { prompt };
        if (imageUrl !== undefined) body.image_url = String(imageUrl);
        if (argv.model !== undefined) body.model = argv.model;
        if (argv.dimensions !== undefined) body.dimensions = argv.dimensions;
        if (argv["use-brand"] ?? argv.useBrand) body.use_brand = true;
        const enhance = argv["enhance-prompt"] ?? argv.enhancePrompt;
        if (enhance !== undefined) body.enhance_prompt = !!enhance;

        const ms = timeoutMs(argv);
        const { cfg, client } = imageClient(g, ms);
        const wid = resolveWorkspace(cfg, g);

        if (isDryRun(argv)) {
          emitDryRun(
            g,
            `POST /workspaces/${wid}/ai/images/generate`,
            body,
            "generate an image",
          );
          return;
        }
        const data = await generateImage(client, wid, body as any);
        out.emitSuccess(data, g, renderResult);
      }),
    )
    .command(
      "images:tool <tool_key>",
      "Invoke any image tool with its full control set, body supplied as JSON.",
      (y) =>
        generationOptions(
          y
            .positional("tool_key", {
              type: "string",
              describe: "Tool key from images:tools, e.g. image-to-image.",
            })
            .option("body", {
              type: "string",
              demandOption: true,
              describe:
                'The tool payload as a JSON object, e.g. \'{"prompt":"snowy street at dusk","attachments":["https://example.com/base.png"]}\'. Fields the tool does not declare are dropped by the API.',
            }),
        ),
      run(async (argv: any, g) => {
        const toolKey = String(argv.tool_key ?? argv.toolKey);
        const body = parseJsonOption(argv.body, "--body");
        const ms = timeoutMs(argv);
        const { cfg, client } = imageClient(g, ms);
        const wid = resolveWorkspace(cfg, g);

        if (isDryRun(argv)) {
          emitDryRun(
            g,
            `POST /workspaces/${wid}/ai/images/tools/${toolKey}`,
            body,
            `invoke the ${toolKey} tool`,
          );
          return;
        }
        const data = await invokeImageTool(client, wid, toolKey, body);
        out.emitSuccess(data, g, renderResult);
      }),
    );

  // One command per dedicated tool. Same shape every time, so it is generated
  // from IMAGE_TOOLS rather than written out six times.
  for (const spec of IMAGE_TOOLS) {
    cli = cli.command(
      `images:${spec.key}`,
      spec.describe,
      (y) => {
        let b = y;
        for (const field of spec.required) {
          b = b.option(flagOf(field), {
            type: "string",
            demandOption: true,
            describe: FIELD_HELP[field] ?? field,
          });
        }
        for (const field of spec.optional) {
          b = b.option(flagOf(field), {
            type: "string",
            describe: FIELD_HELP[field] ?? field,
          });
        }
        return generationOptions(b);
      },
      run(async (argv: any, g) => {
        const body = toolBody(argv, spec);
        const ms = timeoutMs(argv);
        const { cfg, client } = imageClient(g, ms);
        const wid = resolveWorkspace(cfg, g);

        if (isDryRun(argv)) {
          emitDryRun(
            g,
            `POST /workspaces/${wid}/ai/images/tools/${spec.key}`,
            body,
            `invoke the ${spec.key} tool`,
          );
          return;
        }
        const data = await invokeImageTool(client, wid, spec.key, body);
        out.emitSuccess(data, g, renderResult);
      }),
    );
  }

  return cli;
}

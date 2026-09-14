/**
 * AI Video — tool/model catalogs, credit/time estimate, async generation,
 * dedicated tools (motion-control / lip-sync / talking-avatar), and job
 * tracking (list/get/cancel). Workspace-scoped; rides the `ai-tools`
 * rate-limit bucket on the backend.
 */

import type { Argv } from "yargs";

import {
  AiVideoEstimateBody,
  AiVideoGenerateBody,
  cancelAiVideoJob,
  estimateAiVideo,
  generateAiVideo,
  getAiVideoJob,
  listAiVideoJobs,
  listAiVideoModels,
  listAiVideoTools,
  runAiVideoTool,
} from "../api";
import { ConfigError } from "../errors";
import * as out from "../output";
import { buildClient, emitDryRun, isDryRun, resolveWorkspace, run } from "../cliCtx";

const TOOL_KEYS = ["motion-control", "lip-sync", "talking-avatar"] as const;
const JOB_STATUSES = [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
const MAX_PROMPT_LENGTH = 1000;
const MAX_REFERENCE_IMAGES = 8;

export function registerAiVideo<T>(yargs: Argv<T>): Argv<T> {
  return yargs
    .command(
      "ai-video:tools",
      "List enabled AI video tools (key/label/inputs/controls).",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const tools = await listAiVideoTools(client, wid);
        out.emitSuccess(tools, g, () =>
          out.table(
            ["KEY", "LABEL", "DESCRIPTION"],
            tools.map((t: any) => [
              String(t?.key ?? "-"),
              String(t?.label ?? "-"),
              trim(t?.description, 60),
            ]),
          ),
        );
      }),
    )
    .command(
      "ai-video:models",
      "List every model that generate/estimate can select.",
      (y) => y,
      run(async (_argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const models = await listAiVideoModels(client, wid);
        out.emitSuccess(models, g, () =>
          out.table(
            ["KEY", "PROVIDER", "MODES", "AUDIO"],
            models.map((m: any) => [
              String(m?.key ?? "-"),
              String(m?.provider ?? "-"),
              Array.isArray(m?.modes) ? m.modes.join(",") : "-",
              m?.supports_audio ? "yes" : "no",
            ]),
          ),
        );
      }),
    )
    .command(
      "ai-video:estimate",
      "Get a real credit/time estimate. Nothing is submitted or charged.",
      (y) =>
        y
          .option("duration", {
            type: "number",
            describe: "Duration in seconds (default 4.0).",
          })
          .option("model", { type: "string" })
          .option("resolution", { type: "string" })
          .option("mode", {
            type: "string",
            choices: [
              "text-to-video",
              "image-to-video",
              "reference-to-video",
            ] as const,
            describe: "generation_mode (default text-to-video).",
          })
          .option("audio", {
            type: "boolean",
            describe: "enable_audio.",
          })
          .option("aspect-ratio", { type: "string" })
          .option("enhance-prompt", { type: "boolean" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const body: AiVideoEstimateBody = {};
        if (argv.duration !== undefined) body.duration_seconds = Number(argv.duration);
        if (argv.model) body.model = String(argv.model);
        if (argv.resolution) body.resolution = String(argv.resolution);
        if (argv.mode) body.generation_mode = argv.mode;
        if (argv.audio !== undefined) body.enable_audio = !!argv.audio;
        const aspectRatio = argv["aspect-ratio"] ?? argv.aspectRatio;
        if (aspectRatio) body.aspect_ratio = String(aspectRatio);
        const enhancePrompt = argv["enhance-prompt"] ?? argv.enhancePrompt;
        if (enhancePrompt !== undefined) body.enhance_prompt = !!enhancePrompt;

        const data: any = await estimateAiVideo(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.status("Credits", String(d?.credits ?? "-"));
          out.status("Estimated seconds", String(d?.estimated_seconds ?? "-"));
        });
      }),
    )
    .command(
      "ai-video:generate",
      "Submit an async video generation job (text/image/reference-to-video).",
      (y) =>
        y
          .option("prompt", {
            type: "string",
            describe: `Required. Max ${MAX_PROMPT_LENGTH} chars.`,
          })
          .option("image-url", {
            type: "string",
            describe:
              "Switches to image-to-video. Mutually exclusive with --reference-image-url.",
          })
          .option("reference-image-url", {
            type: "string",
            array: true,
            describe:
              `Switches to reference-to-video (repeatable, max ${MAX_REFERENCE_IMAGES}). ` +
              "Mutually exclusive with --image-url.",
          })
          .option("model", { type: "string" })
          .option("duration", { type: "number", describe: "duration_seconds." })
          .option("resolution", { type: "string" })
          .option("aspect-ratio", { type: "string" })
          .option("audio", { type: "boolean", describe: "enable_audio." })
          .option("enhance-prompt", { type: "boolean" })
          .option("style", { type: "string" })
          .option("use-brand", {
            type: "boolean",
            default: false,
            describe: "Resolve brand assets server-side (no brand_id accepted).",
          })
          .option("dry-run", {
            type: "boolean",
            default: false,
            describe: "Print the body that would be sent without calling the API.",
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const body = buildGenerateBody(argv);

        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/ai/videos/generate`,
            body as unknown as Record<string, unknown>,
            "generate an AI video",
          );
        }

        const data: any = await generateAiVideo(client, wid, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success("Video generation job submitted.");
          out.status("Job ID", String(d?.job_id ?? "-"));
          out.status("Status", String(d?.status ?? "-"));
          out.status("Status URL", String(d?.status_url ?? "-"));
          out.status("Estimated credits", String(d?.estimated_credits ?? "-"));
          if (d?.estimated_seconds !== undefined) {
            out.status("Estimated seconds", String(d.estimated_seconds));
          }
        });
      }),
    )
    .command(
      "ai-video:run-tool <tool_key>",
      "Invoke a dedicated video tool: motion-control, lip-sync, or talking-avatar.",
      (y) =>
        y
          .positional("tool_key", {
            type: "string",
            demandOption: true,
            choices: [...TOOL_KEYS] as any,
          })
          .option("image-url", {
            type: "string",
            describe: "motion-control + talking-avatar.",
          })
          .option("video-url", {
            type: "string",
            describe: "motion-control + lip-sync.",
          })
          .option("audio-url", {
            type: "string",
            describe: "lip-sync + talking-avatar.",
          })
          .option("dry-run", {
            type: "boolean",
            default: false,
            describe: "Print the body that would be sent without calling the API.",
          }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const toolKey = String(argv.tool_key);
        const body = buildToolBody(toolKey, argv);

        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `POST /workspaces/${wid}/ai/videos/tools/${toolKey}`,
            body,
            `run the ${toolKey} tool`,
          );
        }

        const data: any = await runAiVideoTool(client, wid, toolKey, body);
        out.emitSuccess(data, g, (d: any) => {
          out.success(`${toolKey} job submitted.`);
          out.status("Job ID", String(d?.job_id ?? "-"));
          out.status("Status", String(d?.status ?? "-"));
          out.status("Status URL", String(d?.status_url ?? "-"));
        });
      }),
    )
    .command(
      "ai-video:jobs",
      "List video jobs submitted through this API (paginated).",
      (y) =>
        y
          .option("status", { type: "string", choices: [...JOB_STATUSES] as any })
          .option("page", { type: "number" })
          .option("per-page", { type: "number" }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const resp = await listAiVideoJobs(client, wid, {
          status: argv.status,
          page: argv.page,
          per_page: argv["per-page"] ?? argv.perPage,
        });
        const items = (resp.data as any[]) ?? [];
        out.emitSuccess(
          resp.data,
          g,
          () =>
            out.table(
              ["JOB ID", "STATUS", "STAGE", "CREDITS"],
              items.map((j: any) => [
                String(j?.job_id ?? "-"),
                String(j?.status ?? "-"),
                String(j?.stage ?? "-"),
                String(j?.credits ?? j?.estimated_credits ?? "-"),
              ]),
            ),
          { pagination: resp.pagination },
        );
      }),
    )
    .command(
      "ai-video:job <job_id>",
      "Get a single video job's status.",
      (y) => y.positional("job_id", { type: "string", demandOption: true }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const data: any = await getAiVideoJob(client, wid, String(argv.job_id));
        out.emitSuccess(data, g, (d: any) => {
          out.status("Job ID", String(d?.job_id ?? "-"));
          out.status("Status", String(d?.status ?? "-"));
          if (d?.stage) out.status("Stage", String(d.stage));
          if (d?.message) out.status("Message", String(d.message));
          if (d?.result) out.status("Result", JSON.stringify(d.result));
        });
      }),
    )
    .command(
      "ai-video:cancel-job <job_id>",
      "Cancel a still-active video job. May charge for partial work already consumed.",
      (y) =>
        y
          .positional("job_id", { type: "string", demandOption: true })
          .option("dry-run", { type: "boolean", default: false }),
      run(async (argv: any, g) => {
        const { cfg, client } = buildClient(g);
        const wid = resolveWorkspace(cfg, g);
        const jid = String(argv.job_id);

        if (isDryRun(argv)) {
          return emitDryRun(
            g,
            `DELETE /workspaces/${wid}/ai/jobs/${jid}`,
            {},
            `cancel video job ${jid}`,
          );
        }

        const data: any = await cancelAiVideoJob(client, wid, jid);
        out.emitSuccess(data, g, () => out.success(`Cancelled video job ${jid}.`));
      }),
    );
}

/**
 * Build + validate the ai-video:generate body from argv. Runs even in
 * --dry-run mode so the printed payload matches what would actually be sent
 * (mirrors posts:create's buildPostBodyFromArgv).
 */
function buildGenerateBody(argv: any): AiVideoGenerateBody {
  if (!argv.prompt) {
    throw new ConfigError("--prompt is required.");
  }
  const prompt = String(argv.prompt);
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new ConfigError(
      `--prompt exceeds ${MAX_PROMPT_LENGTH} characters (got ${prompt.length}).`,
    );
  }

  const imageUrl = argv["image-url"] ?? argv.imageUrl;
  const referenceImageUrls = (argv["reference-image-url"] ??
    argv.referenceImageUrl) as string[] | undefined;

  if (imageUrl && referenceImageUrls?.length) {
    throw new ConfigError(
      "--image-url and --reference-image-url are mutually exclusive — pass at most one.",
    );
  }
  if (referenceImageUrls && referenceImageUrls.length > MAX_REFERENCE_IMAGES) {
    throw new ConfigError(
      `--reference-image-url may be repeated at most ${MAX_REFERENCE_IMAGES} times ` +
        `(got ${referenceImageUrls.length}).`,
    );
  }

  const body: AiVideoGenerateBody = { prompt };
  if (imageUrl) body.image_url = String(imageUrl);
  if (referenceImageUrls?.length) body.reference_image_urls = referenceImageUrls;
  if (argv.model) body.model = String(argv.model);
  if (argv.duration !== undefined) body.duration_seconds = Number(argv.duration);
  if (argv.resolution) body.resolution = String(argv.resolution);
  const aspectRatio = argv["aspect-ratio"] ?? argv.aspectRatio;
  if (aspectRatio) body.aspect_ratio = String(aspectRatio);
  if (argv.audio !== undefined) body.enable_audio = !!argv.audio;
  const enhancePrompt = argv["enhance-prompt"] ?? argv.enhancePrompt;
  if (enhancePrompt !== undefined) body.enhance_prompt = !!enhancePrompt;
  if (argv.style) body.style = String(argv.style);
  const useBrand = argv["use-brand"] ?? argv.useBrand;
  if (useBrand) body.use_brand = true;
  return body;
}

/**
 * Build + validate the ai-video:run-tool body for the given tool_key. Each
 * tool needs a different pair of inputs — mirrors the backend contract:
 *   motion-control  → image_url + video_url
 *   lip-sync        → video_url + audio_url
 *   talking-avatar  → image_url + audio_url
 */
function buildToolBody(toolKey: string, argv: any): Record<string, unknown> {
  const imageUrl = argv["image-url"] ?? argv.imageUrl;
  const videoUrl = argv["video-url"] ?? argv.videoUrl;
  const audioUrl = argv["audio-url"] ?? argv.audioUrl;

  const required: Record<string, [string, unknown][]> = {
    "motion-control": [
      ["image_url", imageUrl],
      ["video_url", videoUrl],
    ],
    "lip-sync": [
      ["video_url", videoUrl],
      ["audio_url", audioUrl],
    ],
    "talking-avatar": [
      ["image_url", imageUrl],
      ["audio_url", audioUrl],
    ],
  };

  const fields = required[toolKey];
  if (!fields) {
    throw new ConfigError(
      `Unknown tool_key "${toolKey}" — expected one of: ${TOOL_KEYS.join(", ")}.`,
    );
  }

  const body: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const [key, value] of fields) {
    if (!value) {
      missing.push(key);
      continue;
    }
    body[key] = String(value);
  }
  if (missing.length) {
    throw new ConfigError(
      `${toolKey} requires ${fields.map(([k]) => `--${k.replace(/_/g, "-")}`).join(" and ")} ` +
        `(missing: ${missing.join(", ")}).`,
    );
  }
  return body;
}

function trim(v: unknown, limit: number): string {
  const s = v == null ? "-" : String(v);
  return s.length > limit ? s.slice(0, limit - 1) + "…" : s;
}

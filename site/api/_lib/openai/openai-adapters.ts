import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ImageProvider, ImageRequest, ImageResult, QaProvider, QaRequest } from "./providers.ts";
import { qaResultSchema } from "./providers.ts";

/** Models that accept the `input_fidelity` edit parameter (per the API reference, 2026-11-18). */
const INPUT_FIDELITY_HIGH = new Set(["gpt-image-1.5"]);

/**
 * Generates one complete page per request with POST /v1/images/edits, sending
 * the actual reference images (identity sheets first) as multipart files.
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  constructor(apiKey: string, opts: { timeoutMs?: number; fetch?: typeof fetch } = {}) {
    // maxRetries: 0 -> the durable worker owns retries, backoff and budgets.
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: opts.timeoutMs ?? 240_000, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  }

  async generatePage(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult> {
    if (req.images.length === 0) throw new Error("At least one reference image is required.");
    if (req.images.length > 16) throw new Error("OpenAI accepts at most 16 input images.");
    const files = await Promise.all(req.images.map((img) => toFile(img.data, img.filename, { type: img.mime })));
    const res = await this.client.images.edit(
      {
        model: req.model,
        image: files,
        prompt: req.prompt,
        size: req.size,
        quality: req.quality,
        output_format: req.outputFormat,
        n: 1,
        safety_identifier: req.safetyIdentifier,
        ...(INPUT_FIDELITY_HIGH.has(req.model) ? { input_fidelity: "high" as const } : {}),
      },
      { signal },
    );
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw Object.assign(new Error("OpenAI returned no image data."), { status: 502 });
    return {
      image: Buffer.from(b64, "base64"),
      format: (res.output_format as ImageResult["format"]) ?? req.outputFormat,
      usage: res.usage ?? null,
      model: req.model,
    };
  }
}

/** Vision QA with structured output through the Responses API. */
export class OpenAIQaProvider implements QaProvider {
  private readonly client: OpenAI;
  constructor(apiKey: string, opts: { fetch?: typeof fetch } = {}) {
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  }

  async evaluate(req: QaRequest, signal?: AbortSignal) {
    const dataUrl = (mime: string, data: Buffer) => `data:${mime};base64,${data.toString("base64")}`;
    const content: OpenAI.Responses.ResponseInputContent[] = [
      { type: "input_text", text: req.instructions },
      { type: "input_text", text: "IMAGE A: the generated page to evaluate." },
      { type: "input_image", image_url: dataUrl(req.pageMime, req.page), detail: "high" },
    ];
    req.identitySheets.forEach((s, i) => {
      content.push({ type: "input_text", text: `IDENTITY SHEET ${i + 1}: ${s.label}. Canonical reference; compare likeness only.` });
      content.push({ type: "input_image", image_url: dataUrl(s.mime, s.data), detail: "low" });
    });
    if (req.previousPage) {
      content.push({ type: "input_text", text: `PREVIOUS PAGE: ${req.previousPage.label}. For continuity comparison only.` });
      content.push({ type: "input_image", image_url: dataUrl(req.previousPage.mime, req.previousPage.data), detail: "low" });
    }
    const res = await this.client.responses.parse(
      {
        model: req.model,
        input: [{ role: "user", content }],
        text: { format: zodTextFormat(qaResultSchema, "page_qa") },
        safety_identifier: req.safetyIdentifier,
      },
      { signal },
    );
    if (!res.output_parsed) throw Object.assign(new Error("QA model returned no structured result."), { status: 502 });
    return { result: res.output_parsed, usage: res.usage ? { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } : null };
  }
}

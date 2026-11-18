import { z } from "zod";
import type { Quality } from "../content/config.js";
import type { ReportedUsage } from "./pricing.js";

/**
 * Provider interfaces. Production implementations call the official OpenAI
 * SDK; automated tests inject mocks. No other image provider is supported.
 */
export interface ReferenceImage {
  label: string;
  filename: string;
  mime: "image/png" | "image/webp" | "image/jpeg";
  data: Buffer;
}

export interface ImageRequest {
  model: string;
  prompt: string;
  images: ReferenceImage[];
  size: "1024x1536";
  quality: Quality;
  outputFormat: "png" | "webp";
  /** Opaque, non-identifying label for OpenAI abuse monitoring. */
  safetyIdentifier: string;
}

export interface ImageResult {
  image: Buffer;
  format: "png" | "webp" | "jpeg";
  usage: ReportedUsage | null;
  model: string;
}

export interface ImageProvider {
  readonly name: string;
  generatePage(req: ImageRequest, signal?: AbortSignal): Promise<ImageResult>;
}

export const qaResultSchema = z.object({
  panelCount: z.number().int().min(0).max(20),
  readingOrderLeftToRight: z.boolean(),
  charactersPresent: z.array(z.object({ name: z.string(), confidence: z.number().min(0).max(1) })),
  unexpectedPeople: z.array(z.string()),
  likeness: z.array(z.object({ name: z.string(), score: z.number().min(0).max(1), notes: z.string() })),
  clothingMatches: z.array(z.object({ name: z.string(), matches: z.boolean(), notes: z.string() })),
  transcribedText: z.array(z.object({ panel: z.number().int().min(0).max(20), text: z.string(), kind: z.string() })),
  artifacts: z.array(z.string()),
  continuityIssues: z.array(z.string()),
  layoutMatches: z.boolean(),
  overallConfidence: z.number().min(0).max(1),
  summary: z.string(),
});
export type VisionQaResult = z.infer<typeof qaResultSchema>;

export interface QaRequest {
  model: string;
  page: Buffer;
  pageMime: string;
  identitySheets: ReferenceImage[];
  previousPage: ReferenceImage | null;
  instructions: string;
  safetyIdentifier: string;
}

export interface QaProvider {
  evaluate(req: QaRequest, signal?: AbortSignal): Promise<{ result: VisionQaResult; usage: { input_tokens?: number; output_tokens?: number } | null }>;
}

/** Classifies provider errors into what the worker should do next. */
export type FailureClass = "retryable" | "rate_limited" | "rejected" | "blocker";

export interface ClassifiedError {
  cls: FailureClass;
  message: string;
  status?: number;
  retryAfterMs?: number;
  code?: string;
}

export function classifyProviderError(err: unknown): ClassifiedError {
  const e = err as { status?: number; code?: string; type?: string; message?: string; headers?: Headers | Record<string, string>; name?: string };
  const status = typeof e?.status === "number" ? e.status : undefined;
  const code = e?.code ?? e?.type;
  const message = String(e?.message ?? err).slice(0, 500);
  const header = (k: string) => {
    const h = e?.headers;
    if (!h) return undefined;
    if (typeof (h as Headers).get === "function") return (h as Headers).get(k) ?? undefined;
    return (h as Record<string, string>)[k];
  };
  const retryAfterRaw = header("retry-after-ms") ?? (header("retry-after") ? String(Number(header("retry-after")) * 1000) : undefined);
  const retryAfterMs = retryAfterRaw && Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw) : undefined;
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached") return { cls: "blocker", message: "OpenAI reports the API quota or billing limit is reached.", status, code };
  if (status === 401 || status === 403) return { cls: "blocker", message: "OpenAI rejected the API key or the organization is not verified for this model.", status, code };
  if (status === 404) return { cls: "blocker", message: "OpenAI does not recognise the configured model for this key.", status, code };
  if (status === 429) return { cls: "rate_limited", message: "OpenAI rate limit reached.", status, retryAfterMs, code };
  if (status === 400 && /moderation|safety|content.?policy/i.test(`${code} ${message}`)) return { cls: "rejected", message: "OpenAI's safety system rejected this request.", status, code };
  if (status === 400 || status === 422) return { cls: "blocker", message: `OpenAI rejected the request parameters: ${message}`, status, code };
  if (status && status >= 500) return { cls: "retryable", message: `OpenAI server error (${status}).`, status, code };
  if (e?.name === "AbortError" || /timeout|timed out|ECONNRESET|ETIMEDOUT|network|fetch failed/i.test(message)) return { cls: "retryable", message: "Network error or timeout talking to OpenAI.", status, code };
  return { cls: "retryable", message, status, code };
}

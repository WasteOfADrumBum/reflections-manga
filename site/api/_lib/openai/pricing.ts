import type { Quality } from "../content/config.ts";

/**
 * Pricing used for estimates. Sources (checked 2026-11-18):
 * - https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
 *   Standard: text input $5.00/1M, image input $8.00/1M, image output $30.00/1M.
 * - https://developers.openai.com/api/docs/pricing lists a lower table for the
 *   same model ($2.50 / $4.00 / $15.00) without saying which tier it is.
 *   The studio uses the HIGHER Standard figures so budgets stop early, never late.
 * - https://developers.openai.com/api/docs/models/gpt-6-luna: $0.10 in / $0.50 out per 1M.
 *
 * OpenAI does not publish per-image output token counts for GPT-Image-2.5
 * (its calculator does not cover it). OUTPUT_TOKENS_ASSUMED below are
 * conservative assumptions, clearly labelled as such in the UI. When the API
 * reports usage, the studio records a cost calculated from that usage
 * ("reported usage"); it is still not an invoice amount.
 */
export interface ImageModelPricing {
  textInputPerM: number;
  imageInputPerM: number;
  imageOutputPerM: number;
  verifiedOn: string;
  source: string;
}

export const IMAGE_PRICING: Record<string, ImageModelPricing> = {
  "gpt-image-2.5-sunburst": {
    textInputPerM: 5,
    imageInputPerM: 8,
    imageOutputPerM: 30,
    verifiedOn: "2026-11-18",
    source: "https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst",
  },
  "gpt-image-2.5-flare": {
    textInputPerM: 5,
    imageInputPerM: 8,
    imageOutputPerM: 30,
    verifiedOn: "2026-11-18",
    source: "https://developers.openai.com/api/docs/pricing (higher table used)",
  },
};

export const TEXT_PRICING: Record<string, { inputPerM: number; outputPerM: number; verifiedOn: string; source: string }> = {
  "gpt-6-luna": { inputPerM: 0.1, outputPerM: 0.5, verifiedOn: "2026-11-18", source: "https://developers.openai.com/api/docs/models/gpt-6-luna" },
};

/** Assumed output tokens for one 1024x1536 page. Assumptions, not published figures. */
export const OUTPUT_TOKENS_ASSUMED: Record<Quality, number> = {
  low: 600,
  medium: 2500,
  high: 7000,
  xhigh: 12000,
  max: 20000,
};

/** Assumed tokens for one attached reference image (no published figure). */
export const IMAGE_INPUT_TOKENS_ASSUMED = 2000;
export const PROMPT_TEXT_TOKENS_ASSUMED = 2500;
export const QA_COST_ASSUMED_USD = 0.01;

export function pricingFor(model: string): ImageModelPricing | null {
  return IMAGE_PRICING[model] ?? null;
}

export interface PageEstimate {
  imageUsd: number;
  qaUsd: number;
  totalUsd: number;
  assumptions: string[];
  basis: "estimate";
}

export function estimatePageCost(model: string, quality: Quality, referenceImages: number): PageEstimate {
  const p = pricingFor(model);
  if (!p) throw new Error(`No verified pricing for model "${model}". Add it to openai/pricing.ts after checking OpenAI's documentation.`);
  const out = OUTPUT_TOKENS_ASSUMED[quality];
  const imageUsd =
    (out * p.imageOutputPerM + referenceImages * IMAGE_INPUT_TOKENS_ASSUMED * p.imageInputPerM + PROMPT_TEXT_TOKENS_ASSUMED * p.textInputPerM) / 1_000_000;
  const qaUsd = QA_COST_ASSUMED_USD;
  return {
    imageUsd: round(imageUsd),
    qaUsd,
    totalUsd: round(imageUsd + qaUsd),
    basis: "estimate",
    assumptions: [
      `${out.toLocaleString("en-US")} output tokens per ${quality} page (assumed; OpenAI publishes no per-image figure for ${model})`,
      `${IMAGE_INPUT_TOKENS_ASSUMED.toLocaleString("en-US")} input tokens per reference image (assumed)`,
      `Prices from ${p.source}, checked ${p.verifiedOn}`,
    ],
  };
}

export interface ReportedUsage {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: { image_tokens?: number; text_tokens?: number };
}

/** Cost calculated from token usage the API reported. Null when usage is absent. */
export function costFromUsage(model: string, usage: ReportedUsage | null | undefined): number | null {
  const p = pricingFor(model);
  if (!p || !usage || typeof usage.output_tokens !== "number") return null;
  const img = usage.input_tokens_details?.image_tokens ?? 0;
  const txt = usage.input_tokens_details?.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - img);
  return round((usage.output_tokens * p.imageOutputPerM + img * p.imageInputPerM + txt * p.textInputPerM) / 1_000_000);
}

export function qaCostFromUsage(model: string, usage: { input_tokens?: number; output_tokens?: number } | null | undefined): number | null {
  const p = TEXT_PRICING[model];
  if (!p || !usage) return null;
  return round(((usage.input_tokens ?? 0) * p.inputPerM + (usage.output_tokens ?? 0) * p.outputPerM) / 1_000_000);
}

export function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export interface JobEstimate {
  pages: number;
  perPage: PageEstimate;
  expectedUsd: number;
  worstCaseUsd: number;
  assumptions: string[];
}

export function estimateJob(opts: { model: string; quality: Quality; pages: number; referencesPerPage: number; expectedRetryRate: number; maxAttempts: number }): JobEstimate {
  const perPage = estimatePageCost(opts.model, opts.quality, opts.referencesPerPage);
  const expectedUsd = round(perPage.totalUsd * opts.pages * (1 + opts.expectedRetryRate));
  const worstCaseUsd = round(perPage.totalUsd * opts.pages * opts.maxAttempts);
  return {
    pages: opts.pages,
    perPage,
    expectedUsd,
    worstCaseUsd,
    assumptions: [...perPage.assumptions, `Expected retries: ${Math.round(opts.expectedRetryRate * 100)}% extra attempts; worst case ${opts.maxAttempts} attempts per page`],
  };
}

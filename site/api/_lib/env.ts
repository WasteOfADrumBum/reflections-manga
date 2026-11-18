import { z } from "zod";

/**
 * Server-side environment. Validated once per cold start. Nothing here is ever
 * sent to the browser; secrets are only read inside api/ functions.
 */
const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

export const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  // Admin sign-in
  ADMIN_USERNAME: z.string().min(1).default("admin"),
  ADMIN_PASSWORD_HASH: z.string().regex(/^scrypt\$/, "use `npm run hash-password` to create it"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  // Background worker + Vercel Cron share this bearer secret.
  CRON_SECRET: z.string().min(24, "CRON_SECRET must be at least 24 characters"),
  // Storage
  DATABASE_URL: z.string().url(),
  BLOB_STORE_ID: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // GitHub source of truth (read prompts/sheets, open publishing PRs)
  GITHUB_TOKEN: z.string().min(10),
  GITHUB_REPOSITORY: z.string().regex(/^[\w.-]+\/[\w.-]+$/).default("WasteOfADrumBum/reflections-manga"),
  GITHUB_BRANCH: z.string().default("main"),
  GITHUB_DISPATCH_WORKFLOW: z.string().optional(),
  // OpenAI
  OPENAI_API_KEY: z.string().optional(),
  // Master switch for paid requests. Off by default.
  STUDIO_GENERATION_ENABLED: bool,
  STUDIO_PUBLIC_URL: z.string().url().optional(),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Studio configuration is incomplete: ${issues.join("; ")}`);
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Report variable names and rule messages only, never values.
    const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new EnvError(issues);
  }
  return result.data;
}

/** Base URL the worker uses to call itself. */
export function publicBaseUrl(env: Env, requestUrl?: string): string {
  if (env.STUDIO_PUBLIC_URL) return env.STUDIO_PUBLIC_URL.replace(/\/$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (requestUrl) return new URL(requestUrl).origin;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:8137";
}

/** Names of required variables that are missing, for the setup screen. */
export function missingConfiguration(source: Record<string, string | undefined>): string[] {
  const result = envSchema.safeParse(source);
  const missing = result.success ? [] : result.error.issues.map((i) => String(i.path[0]));
  if (!source.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!source.BLOB_STORE_ID && !source.BLOB_READ_WRITE_TOKEN) missing.push("BLOB_STORE_ID (connect a private Blob store)");
  return [...new Set(missing)];
}

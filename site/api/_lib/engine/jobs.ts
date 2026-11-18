import { z } from "zod";
import type { StudioDeps } from "../context.ts";
import { content } from "../context.ts";
import type { ChapterInventory } from "../content/chapters.ts";
import { type GenerationSettings, generationSettingsSchema, pad3 } from "../content/config.ts";
import { one } from "../db/client.ts";
import { badRequest, conflict, forbidden, notFound } from "../errors.ts";
import { estimateJob, estimatePageCost, pricingFor } from "../openai/pricing.ts";
import { logEvent } from "./events.ts";
import type { JobPageRow, JobRow } from "./types.ts";
import { ACTIVE_JOB_STATUSES } from "./types.ts";

export const settingsOverrideSchema = generationSettingsSchema.partial().strict();
export type SettingsOverride = z.infer<typeof settingsOverrideSchema>;

export async function getStudioSetting<T>(deps: StudioDeps, key: string, fallback: T): Promise<T> {
  const row = await one<{ value: T }>(deps.db, `SELECT value FROM studio_settings WHERE key = $1`, [key]);
  return row ? row.value : fallback;
}

export async function setStudioSetting(deps: StudioDeps, key: string, value: unknown) {
  await deps.db.query(
    `INSERT INTO studio_settings (key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, JSON.stringify(value), deps.clock.now()],
  );
}

export async function chapterOverrides(deps: StudioDeps, chapterId: string): Promise<SettingsOverride> {
  const row = await one<{ settings: SettingsOverride }>(deps.db, `SELECT settings FROM chapter_settings WHERE chapter_id = $1`, [chapterId]);
  return row?.settings ?? {};
}

export async function saveChapterOverrides(deps: StudioDeps, chapterId: string, overrides: unknown) {
  const parsed = settingsOverrideSchema.safeParse(overrides);
  if (!parsed.success) throw badRequest("Invalid generation settings.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  const c = await content(deps);
  if (!c.chapterConfig(chapterId)) throw notFound("Unknown chapter.");
  await deps.db.query(
    `INSERT INTO chapter_settings (chapter_id, settings, updated_at) VALUES ($1,$2,$3) ON CONFLICT (chapter_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
    [chapterId, JSON.stringify(parsed.data), deps.clock.now()],
  );
  return parsed.data;
}

export async function effectiveSettings(deps: StudioDeps, chapterId: string, overrides: SettingsOverride = {}): Promise<GenerationSettings> {
  const c = await content(deps);
  const base = c.studioConfig.generation;
  const merged = generationSettingsSchema.parse({ ...base, ...(await chapterOverrides(deps, chapterId)), ...overrides });
  if (!pricingFor(merged.imageModel)) throw badRequest(`Model "${merged.imageModel}" has no verified pricing, so a budget cannot be enforced.`);
  return merged;
}

export interface PageEligibility {
  page: number;
  eligible: boolean;
  reason: string | null;
}

/** Server-side gate: locked or unprepared pages can never be queued. */
export function checkEligibility(inv: ChapterInventory, pages: number[]): PageEligibility[] {
  return pages.map((page) => {
    const info = inv.pages.find((p) => p.page === page);
    if (!info) return { page, eligible: false, reason: `Page ${pad3(page)} is outside this chapter.` };
    if (info.locked) return { page, eligible: false, reason: info.lockReason ?? "Locked." };
    if (!info.prepared) return { page, eligible: false, reason: info.unpreparedReason ?? "Not prepared." };
    return { page, eligible: true, reason: null };
  });
}

export const createJobSchema = z.object({
  chapterId: z.string().regex(/^\d{3}$/),
  pages: z.array(z.number().int().min(1).max(500)).min(1).max(60),
  settings: settingsOverrideSchema.optional(),
  budgetUsd: z.number().min(0.5).max(200).optional(),
  test: z.boolean().optional(),
  confirmPaid: z.literal(true, { message: "Confirm that this starts paid OpenAI requests." }),
});
export type CreateJobInput = z.infer<typeof createJobSchema>;

export async function estimate(deps: StudioDeps, chapterId: string, pages: number[], overrides: SettingsOverride = {}) {
  const c = await content(deps);
  if (!c.chapterConfig(chapterId)) throw notFound("Unknown chapter.");
  const inv = await c.inventory(chapterId);
  const eligibility = checkEligibility(inv, [...new Set(pages)].sort((a, b) => a - b));
  const settings = await effectiveSettings(deps, chapterId, overrides);
  const eligible = eligibility.filter((e) => e.eligible).map((e) => e.page);
  let refs = 0;
  for (const p of eligible) {
    const prompt = await c.loadPrompt(chapterId, p);
    refs += (prompt?.referenceOrder.length ?? 0) + Math.min(prompt?.sceneReferences.length ?? 0, settings.maxSceneReferences);
  }
  const avgRefs = eligible.length ? Math.ceil(refs / eligible.length) : 0;
  const est = estimateJob({
    model: settings.imageModel,
    quality: settings.quality,
    pages: eligible.length,
    referencesPerPage: avgRefs,
    expectedRetryRate: settings.expectedRetryRate,
    maxAttempts: settings.maxAttemptsPerPage,
  });
  return { eligibility, settings, estimate: est };
}

export async function createJob(deps: StudioDeps, input: CreateJobInput, opts: { createdBy: string; idempotencyKey: string | null }) {
  if (opts.idempotencyKey) {
    const existing = await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE idempotency_key = $1`, [opts.idempotencyKey]);
    if (existing) return { job: existing, duplicate: true };
  }
  if (!deps.generationEnabled) throw forbidden("Paid generation is switched off. Set STUDIO_GENERATION_ENABLED=true in the deployment settings to allow it.");
  if (!deps.images) throw forbidden("OPENAI_API_KEY is not configured on the server.");
  const pages = [...new Set(input.pages)].sort((a, b) => a - b);
  const verified = await getStudioSetting(deps, "real_generation_verified", false);
  if (!verified && (pages.length > 1 || !input.test)) {
    throw conflict("Run one test page first. After you approve that page, full-chapter jobs unlock.", { code: "test_required" });
  }
  const { eligibility, settings, estimate: est } = await estimate(deps, input.chapterId, pages, input.settings ?? {});
  const blocked = eligibility.filter((e) => !e.eligible);
  if (blocked.length) throw conflict("Some selected pages cannot be generated.", { pages: blocked });
  const budget = input.budgetUsd ?? settings.budgetUsdPerJob;
  if (est.perPage.totalUsd > budget) throw badRequest(`The budget ($${budget.toFixed(2)}) is lower than the estimated cost of one page ($${est.perPage.totalUsd.toFixed(2)}).`);
  const now = deps.clock.now();
  const jobId = deps.newId();
  try {
    await deps.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO jobs (id, chapter_id, status, page_numbers, settings, budget_usd, is_test, idempotency_key, created_by, created_at, updated_at)
         VALUES ($1,$2,'queued',$3,$4,$5,$6,$7,$8,$9,$9)`,
        [jobId, input.chapterId, pages, JSON.stringify(settings), budget, !!input.test, opts.idempotencyKey, opts.createdBy, now],
      );
      let position = 0;
      for (const page of pages) {
        await tx.query(
          `INSERT INTO job_pages (id, job_id, chapter_id, page, position, status, phase, max_attempts, updated_at) VALUES ($1,$2,$3,$4,$5,'queued','generate',$6,$7)`,
          [deps.newId(), jobId, input.chapterId, page, position++, settings.maxAttemptsPerPage, now],
        );
      }
    });
  } catch (err) {
    if (String((err as Error).message).includes("jobs_one_active_per_chapter") || (err as { code?: string }).code === "23505") {
      throw conflict("This chapter already has an unfinished job. Pause, resume or cancel it first.", { code: "duplicate_job" });
    }
    throw err;
  }
  await logEvent(deps.db, now, {
    jobId,
    chapterId: input.chapterId,
    level: "info",
    message: `Job created for pages ${pages.map(pad3).join(", ")}${input.test ? " (single test page)" : ""}`,
    data: { budgetUsd: budget, expectedUsd: est.expectedUsd, worstCaseUsd: est.worstCaseUsd, model: settings.imageModel, quality: settings.quality },
  });
  deps.kick("job-created");
  const job = (await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE id = $1`, [jobId]))!;
  return { job, duplicate: false, estimate: est };
}

async function loadJob(deps: StudioDeps, jobId: string): Promise<JobRow> {
  const job = await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE id = $1`, [jobId]);
  if (!job) throw notFound("Job not found.");
  return job;
}

export async function pauseJob(deps: StudioDeps, jobId: string) {
  const job = await loadJob(deps, jobId);
  if (!["queued", "running"].includes(job.status)) throw conflict(`A ${job.status} job cannot be paused.`);
  await deps.db.query(`UPDATE jobs SET status = 'paused', updated_at = $2 WHERE id = $1`, [jobId, deps.clock.now()]);
  await logEvent(deps.db, deps.clock.now(), { jobId, chapterId: job.chapter_id, level: "info", message: "Paused. The page in progress finishes its current step, then the job waits." });
}

export async function resumeJob(deps: StudioDeps, jobId: string) {
  const job = await loadJob(deps, jobId);
  if (!["paused", "budget_exceeded", "blocked"].includes(job.status)) throw conflict(`A ${job.status} job cannot be resumed.`);
  if (!deps.generationEnabled) throw forbidden("Paid generation is switched off (STUDIO_GENERATION_ENABLED).");
  if (job.status === "budget_exceeded") {
    const next = estimatePageCost(job.settings.imageModel, job.settings.quality, 3).totalUsd;
    if (job.budget_usd - job.spent_estimate_usd < next) {
      throw conflict(`The job has $${Math.max(0, job.budget_usd - job.spent_estimate_usd).toFixed(2)} left, less than one more page (about $${next.toFixed(2)}). Raise the budget to resume.`, { code: "budget" });
    }
  }
  const now = deps.clock.now();
  await deps.db.query(`UPDATE jobs SET status = 'running', error = NULL, updated_at = $2 WHERE id = $1`, [jobId, now]);
  await logEvent(deps.db, now, { jobId, chapterId: job.chapter_id, level: "info", message: "Resumed." });
  deps.kick("job-resumed");
}

export async function raiseBudget(deps: StudioDeps, jobId: string, budgetUsd: number) {
  const job = await loadJob(deps, jobId);
  if (!(budgetUsd > job.budget_usd) || budgetUsd > 200) throw badRequest("The new budget must be higher than the current one and at most $200.");
  await deps.db.query(`UPDATE jobs SET budget_usd = $2, updated_at = $3 WHERE id = $1`, [jobId, budgetUsd, deps.clock.now()]);
  await logEvent(deps.db, deps.clock.now(), { jobId, chapterId: job.chapter_id, level: "info", message: `Budget raised to $${budgetUsd.toFixed(2)}.` });
}

export async function cancelJob(deps: StudioDeps, jobId: string) {
  const job = await loadJob(deps, jobId);
  if (!ACTIVE_JOB_STATUSES.includes(job.status as never) && !["budget_exceeded", "blocked"].includes(job.status)) throw conflict(`A ${job.status} job cannot be cancelled.`);
  const now = deps.clock.now();
  await deps.db.tx(async (tx) => {
    await tx.query(`UPDATE jobs SET status = 'cancelled', finished_at = $2, updated_at = $2 WHERE id = $1`, [jobId, now]);
    // Pages still waiting are cancelled. A page mid-request keeps its lease; the
    // worker discards nothing it already paid for, but starts no new step.
    await tx.query(`UPDATE job_pages SET status = 'cancelled', updated_at = $2 WHERE job_id = $1 AND status IN ('queued','retry_wait')`, [jobId, now]);
  });
  await logEvent(deps.db, now, { jobId, chapterId: job.chapter_id, level: "info", message: "Cancelled. Finished pages are kept for review." });
}

/** Re-queues one page: inside the active job if it is part of it, otherwise as a new one-page job. */
export async function regeneratePage(deps: StudioDeps, chapterId: string, page: number, opts: { createdBy: string; settings?: SettingsOverride; budgetUsd?: number }) {
  if (!deps.generationEnabled) throw forbidden("Paid generation is switched off (STUDIO_GENERATION_ENABLED).");
  const c = await content(deps);
  const inv = await c.inventory(chapterId);
  const [elig] = checkEligibility(inv, [page]);
  if (!elig?.eligible) throw conflict(elig?.reason ?? "Page cannot be generated.", { code: "protected_page" });
  const active = await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE chapter_id = $1 AND status IN ('queued','running','paused')`, [chapterId]);
  const now = deps.clock.now();
  if (active) {
    const jp = await one<JobPageRow>(deps.db, `SELECT * FROM job_pages WHERE job_id = $1 AND page = $2`, [active.id, page]);
    if (!jp) throw conflict("A different job is running for this chapter. Let it finish or cancel it first.", { code: "duplicate_job" });
    if (!["awaiting_review", "failed", "blocked", "cancelled"].includes(jp.status)) throw conflict("That page is already queued or in progress.");
    await deps.db.query(
      `UPDATE job_pages SET status = 'queued', phase = 'generate', attempts = 0, next_attempt_at = NULL, last_error = NULL, updated_at = $2 WHERE id = $1`,
      [jp.id, now],
    );
    await logEvent(deps.db, now, { jobId: active.id, chapterId, page, level: "info", message: `Page ${pad3(page)} re-queued for regeneration.` });
    deps.kick("regenerate");
    return { jobId: active.id, created: false };
  }
  const verified = await getStudioSetting(deps, "real_generation_verified", false);
  const res = await createJob(
    deps,
    { chapterId, pages: [page], settings: opts.settings, budgetUsd: opts.budgetUsd, test: !verified, confirmPaid: true },
    { createdBy: opts.createdBy, idempotencyKey: null },
  );
  return { jobId: res.job.id, created: true };
}

export async function jobDetail(deps: StudioDeps, jobId: string) {
  const job = await loadJob(deps, jobId);
  const pages = await deps.db.query<JobPageRow>(`SELECT * FROM job_pages WHERE job_id = $1 ORDER BY position`, [jobId]);
  const events = await deps.db.query(`SELECT id, page, level, message, data, created_at FROM event_log WHERE job_id = $1 ORDER BY id DESC LIMIT 100`, [jobId]);
  return { job, pages, events };
}

export async function listJobs(deps: StudioDeps, limit = 20) {
  return deps.db.query<JobRow & { done: number; total: number }>(
    `SELECT j.*, (SELECT count(*)::int FROM job_pages p WHERE p.job_id = j.id AND p.status IN ('awaiting_review','failed','blocked','skipped','cancelled')) AS done,
            (SELECT count(*)::int FROM job_pages p WHERE p.job_id = j.id) AS total
       FROM jobs j ORDER BY j.created_at DESC LIMIT $1`,
    [limit],
  );
}

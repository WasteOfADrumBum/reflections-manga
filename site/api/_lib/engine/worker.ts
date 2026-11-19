import type { StudioDeps } from "../context.js";
import { content } from "../context.js";
import { applySheetLabels, type CharacterRecord, findSheet, resolveSheetFiles } from "../content/characters.js";
import type { LoadedPrompt } from "../content/chapters.js";
import { pad3 } from "../content/config.js";
import { expectedLettering, parsePrompt, sha256 } from "../content/prompt-parser.js";
import type { Db } from "../db/client.js";
import { one } from "../db/client.js";
import { inspectImage, normalizeToTarget, prepareReference } from "../images.js";
import { classifyProviderError, type ReferenceImage } from "../openai/providers.js";
import { costFromUsage, estimatePageCost, QA_COST_ASSUMED_USD, qaCostFromUsage } from "../openai/pricing.js";
import { checkPromptAgainstScript } from "../qa/dialogue.js";
import { buildQaInstructions, combineQa } from "../qa/evaluate.js";
import { BlobExistsError } from "../storage/blobs.js";
import { buildContinuityState, type ContinuityState, continuitySummary } from "./continuity.js";
import { logEvent } from "./events.js";
import { checkEligibility, setStudioSetting } from "./jobs.js";
import { buildFinalPrompt, planReferences, type ReferenceManifestEntry, type SceneImageCandidate, type UploadedReference } from "./references.js";
import type { AttemptRow, JobPageRow, JobRow, PageRunOptions, VersionRow } from "./types.js";

/**
 * Durable worker. Each call performs at most ONE step (generate or validate)
 * for ONE page, claimed under a lease in Postgres. All state lives in the
 * database and blob store, so a step can be retried by any later invocation:
 * after a deploy, a crash, a timeout, or the browser closing.
 */
export interface StepResult {
  worked: boolean;
  more: boolean;
  jobId?: string;
  page?: number;
  outcome?: string;
}

const GLOBAL_LOCK = 814202;
const RATE_LIMIT_FLOOR_MS = 20_000;

/** Capped at 3 minutes so an unattended job keeps moving within one worker invocation. */
export function backoffMs(attempt: number, base = 30_000, cap = 180_000, rand = Math.random): number {
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.8 + rand() * 0.4));
}

export async function runWorkerStep(deps: StudioDeps): Promise<StepResult> {
  const now = deps.clock.now();
  const claimed = await deps.db.tx(async (tx) => {
    const lock = await tx.query<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [GLOBAL_LOCK]);
    if (!lock[0]?.ok) return "busy" as const;
    const busy = await one<{ id: string }>(tx, `SELECT id FROM job_pages WHERE status IN ('generating','validating') AND lease_until >= $1 LIMIT 1`, [now]);
    if (busy) return "busy" as const; // controlled concurrency: one paid request at a time
    const jp = await one<JobPageRow & { job_status: string }>(
      tx,
      `SELECT jp.*, j.status AS job_status FROM job_pages jp JOIN jobs j ON j.id = jp.job_id
        WHERE j.status IN ('queued','running')
          AND (
            (jp.status IN ('queued','retry_wait') AND (jp.next_attempt_at IS NULL OR jp.next_attempt_at <= $1))
            OR (jp.status IN ('generating','validating') AND jp.lease_until < $1)
          )
          AND NOT EXISTS (
            SELECT 1 FROM job_pages e WHERE e.job_id = jp.job_id AND e.position < jp.position
               AND e.status IN ('queued','generating','validating','retry_wait'))
        ORDER BY j.created_at, jp.position
        LIMIT 1
        FOR UPDATE OF jp SKIP LOCKED`,
      [now],
    );
    if (!jp) return null;
    const recovered = jp.status === "generating" || jp.status === "validating";
    const newStatus = jp.phase === "validate" ? "validating" : "generating";
    await tx.query(`UPDATE job_pages SET status = $2, lease_owner = $3, lease_until = $4, updated_at = $5 WHERE id = $1`, [
      jp.id,
      newStatus,
      deps.workerId,
      new Date(now.getTime() + deps.leaseMs),
      now,
    ]);
    await tx.query(`UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, $2), updated_at = $2 WHERE id = $1`, [jp.job_id, now]);
    return { jp: { ...jp, status: newStatus } as JobPageRow, recovered };
  });

  if (claimed === "busy") return { worked: false, more: false, outcome: "busy" };
  if (!claimed) {
    const pending = await hasRunnableWork(deps);
    return { worked: false, more: pending.now, outcome: pending.later ? "waiting" : "idle" };
  }
  const { jp, recovered } = claimed;
  const job = (await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE id = $1`, [jp.job_id]))!;
  let outcome: string;
  try {
    if (recovered) await recoverInterruptedStep(deps, job, jp);
    outcome = jp.phase === "validate" ? await validateStep(deps, job, jp) : await generateStep(deps, job, jp);
  } catch (err) {
    // Unexpected internal error: release the page for a later retry, never lose it.
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.error("worker step failed", { jobId: job.id, page: jp.page, error: err });
    await releaseForRetry(deps, jp, `Internal error: ${msg}`, backoffMs(jp.attempts + 1));
    await logEvent(deps.db, deps.clock.now(), { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "error", message: `Internal error, will retry: ${msg}` });
    outcome = "internal_error";
  }
  await settleJob(deps, job.id);
  const pending = await hasRunnableWork(deps);
  return { worked: true, more: pending.now, jobId: job.id, page: jp.page, outcome };
}

async function hasRunnableWork(deps: StudioDeps): Promise<{ now: boolean; later: boolean }> {
  const now = deps.clock.now();
  const rows = await deps.db.query<{ ready: boolean }>(
    `SELECT (jp.status = 'queued' OR (jp.status = 'retry_wait' AND jp.next_attempt_at <= $1) OR (jp.status IN ('generating','validating') AND jp.lease_until < $1)) AS ready
       FROM job_pages jp JOIN jobs j ON j.id = jp.job_id
      WHERE j.status IN ('queued','running') AND jp.status IN ('queued','retry_wait','generating','validating')`,
    [now],
  );
  return { now: rows.some((r) => r.ready), later: rows.length > 0 };
}

/** Fenced update: only the current lease holder may move the page. */
async function updatePage(db: Db, jp: JobPageRow, workerId: string, set: Record<string, unknown>, at: Date): Promise<boolean> {
  const keys = Object.keys(set);
  const assignments = keys.map((k, i) => `${k} = $${i + 4}`).join(", ");
  const rows = await db.query<{ id: string }>(
    `UPDATE job_pages SET ${assignments}, updated_at = $3 WHERE id = $1 AND lease_owner = $2 RETURNING id`,
    [jp.id, workerId, at, ...keys.map((k) => set[k])],
  );
  return rows.length > 0;
}

async function releaseForRetry(deps: StudioDeps, jp: JobPageRow, error: string, delayMs: number) {
  const now = deps.clock.now();
  await updatePage(deps.db, jp, deps.workerId, { status: "retry_wait", next_attempt_at: new Date(now.getTime() + delayMs), lease_owner: null, lease_until: null, last_error: error.slice(0, 500) }, now);
}

/**
 * A previous invocation died mid-step. If it already stored the image, adopt it
 * (no second paid request). Otherwise the in-flight attempt is marked abandoned
 * and its estimated cost stays counted, because OpenAI may have billed it.
 */
async function recoverInterruptedStep(deps: StudioDeps, job: JobRow, jp: JobPageRow) {
  const inflight = await one<AttemptRow>(deps.db, `SELECT * FROM generation_attempts WHERE job_page_id = $1 AND status = 'in_flight' AND kind = 'image' ORDER BY attempt_no DESC LIMIT 1`, [jp.id]);
  if (!inflight) return;
  const now = deps.clock.now();
  if (await deps.blobs.exists(inflight.blob_path)) {
    const stored = await deps.blobs.get(inflight.blob_path);
    if (stored) {
      const info = await inspectImage(stored.data);
      const versionId = await insertVersion(deps, job, jp, inflight, info, inflight.reference_manifest as ReferenceManifestEntry[]);
      await deps.db.query(`UPDATE generation_attempts SET status = 'succeeded', finished_at = $2 WHERE id = $1`, [inflight.id, now]);
      await updatePage(deps.db, jp, deps.workerId, { phase: "validate", status: "validating", current_version_id: versionId }, now);
      jp.phase = "validate";
      jp.current_version_id = versionId;
      await logEvent(deps.db, now, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "warn", message: `Recovered page ${pad3(jp.page)}: the image was saved before an interruption, so it was adopted without a new request.` });
      return;
    }
  }
  await deps.db.query(`UPDATE generation_attempts SET status = 'abandoned', finished_at = $2, error = $3 WHERE id = $1`, [
    inflight.id,
    now,
    JSON.stringify({ message: "Interrupted before the result was saved. Estimated cost kept, since the request may have been billed." }),
  ]);
  await logEvent(deps.db, now, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "warn", message: `Page ${pad3(jp.page)} attempt ${inflight.attempt_no} was interrupted; it counts toward the attempt limit and budget.` });
}

async function insertVersion(deps: StudioDeps, job: JobRow, jp: JobPageRow, attempt: AttemptRow, info: Awaited<ReturnType<typeof inspectImage>>, manifest: ReferenceManifestEntry[]): Promise<string> {
  const existing = await one<{ id: string }>(deps.db, `SELECT id FROM page_versions WHERE blob_path = $1`, [attempt.blob_path]);
  if (existing) return existing.id;
  const id = deps.newId();
  const prompt = await one<{ prompt_path: string; prompt_sha256: string; settings: unknown }>(deps.db, `SELECT prompt_path, prompt_sha256, settings FROM generation_attempts WHERE id = $1`, [attempt.id]);
  await deps.db.query(
    `INSERT INTO page_versions (id, chapter_id, page, job_id, attempt_id, source, blob_path, sha256, width, height, format, bytes, prompt_path, prompt_sha256, model,
                                reference_manifest, settings, retry_count, cost_estimate_usd, created_at, prompt_edited)
     VALUES ($1,$2,$3,$4,$5,'generated',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      id,
      job.chapter_id,
      jp.page,
      job.id,
      attempt.id,
      attempt.blob_path,
      info.sha256,
      info.width,
      info.height,
      info.format,
      info.bytes,
      prompt?.prompt_path ?? null,
      prompt?.prompt_sha256 ?? null,
      attempt.model,
      JSON.stringify(manifest),
      JSON.stringify(prompt?.settings ?? {}),
      Math.max(0, attempt.attempt_no - 1),
      attempt.cost_estimate_usd,
      deps.clock.now(),
      !!jp.options?.promptOverride,
    ],
  );
  return id;
}

async function blockPage(deps: StudioDeps, job: JobRow, jp: JobPageRow, reasons: string[]) {
  const now = deps.clock.now();
  await updatePage(deps.db, jp, deps.workerId, { status: "blocked", lease_owner: null, lease_until: null, last_error: reasons.join(" ").slice(0, 1000) }, now);
  await logEvent(deps.db, now, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "error", message: `Page ${pad3(jp.page)} needs attention before it can be generated.`, data: { reasons } });
}

async function loadSceneCandidates(deps: StudioDeps, chapterId: string, beforePage: number, inv: Awaited<ReturnType<Awaited<ReturnType<typeof content>>["inventory"]>>) {
  const versions = await deps.db.query<VersionRow>(
    `SELECT * FROM page_versions WHERE chapter_id = $1 AND page < $2 AND review_status IN ('approved','awaiting_review') AND qa_status IN ('pass','uncertain') ORDER BY created_at DESC`,
    [chapterId, beforePage],
  );
  return (page: number): SceneImageCandidate | null => {
    const info = inv.pages.find((p) => p.page === page);
    if (info?.sourceImagePath) return { page, source: "repo", path: info.sourceImagePath, provisional: false, label: `Page ${pad3(page)} (approved repository artwork)` };
    const approved = versions.find((v) => v.page === page && v.review_status === "approved");
    if (approved) return { page, source: "studio", path: approved.blob_path, provisional: false, label: `Page ${pad3(page)} (approved studio version)` };
    const draft = versions.find((v) => v.page === page && v.review_status === "awaiting_review" && v.qa_status === "pass");
    if (draft) return { page, source: "studio", path: draft.blob_path, provisional: true, label: `Page ${pad3(page)} (QA-passed draft awaiting review)` };
    return null;
  };
}

async function loadUploads(deps: StudioDeps): Promise<UploadedReference[]> {
  const rows = await deps.db.query<{ id: string; character_id: string | null; kind: UploadedReference["kind"]; status: UploadedReference["status"]; label: string; blob_path: string; chapter_id: string | null; pages: number[] | null }>(
    `SELECT id, character_id, kind, status, label, blob_path, chapter_id, pages FROM reference_assets ORDER BY created_at`,
  );
  return rows.map((r) => ({ id: r.id, characterId: r.character_id, kind: r.kind, status: r.status, label: r.label, blobPath: r.blob_path, chapterId: r.chapter_id, pages: r.pages }));
}

// Identity sheets are multi-megabyte PNGs. prepareReference re-encodes each one
// at maximum compression, which is most of the time spent on a page, and the
// same sheets are attached again on later pages and again during QA. The bytes
// depend only on the file contents, so reuse them for the life of this process.
const preparedRefs = new Map<string, Buffer>();
const PREPARED_REF_CACHE = 24;

async function readReference(deps: StudioDeps, e: ReferenceManifestEntry): Promise<ReferenceImage> {
  const raw = e.source === "repo" ? await deps.repo.readBinary(e.path) : (await deps.blobs.get(e.path))?.data ?? null;
  if (!raw) throw new Error(`Reference image missing: ${e.label}`);
  const hash = sha256(raw);
  e.sha256 = hash;
  let data = preparedRefs.get(hash);
  if (data) {
    preparedRefs.delete(hash);
    preparedRefs.set(hash, data);
  } else {
    data = await prepareReference(raw);
    preparedRefs.set(hash, data);
    while (preparedRefs.size > PREPARED_REF_CACHE) {
      const oldest = preparedRefs.keys().next().value;
      if (oldest === undefined) break;
      preparedRefs.delete(oldest);
    }
  }
  return { label: e.label, filename: `ref-${e.slot}.png`, mime: "image/png", data };
}

/** Names the owner gave sheets in the studio. */
export async function sheetLabels(deps: Pick<StudioDeps, "db">): Promise<Map<string, string>> {
  const rows = await deps.db.query<{ path: string; label: string }>(`SELECT path, label FROM sheet_labels`);
  return new Map(rows.map((r) => [r.path, r.label]));
}

/** The character library with the owner's sheet names applied. */
export async function studioCharacters(deps: StudioDeps): Promise<CharacterRecord[]> {
  const c = await content(deps);
  return applySheetLabels(await c.characters(), await sheetLabels(deps));
}

export interface PageCastEntry {
  characterId: string;
  displayName: string;
  /** Sheet the prompt asks for (repository path of the character's sheet). */
  promptSheet: string;
  /** Sheet that will be attached for this run. */
  selectedSheet: string;
  sheets: { path: string; label: string; file: string; isDefault: boolean; category: string | null; needsReview: boolean }[];
}

/** Builds everything for one page without spending money. Used by the worker and the page / generate screens. */
export async function planPage(deps: StudioDeps, chapterId: string, page: number, settings: { maxSceneReferences: number }, options: PageRunOptions = {}) {
  const c = await content(deps);
  const inv = await c.inventory(chapterId);
  const [elig] = checkEligibility(inv, [page]);
  const repoPrompt = (await c.loadPrompt(chapterId, page)) as LoadedPrompt | null;
  const script = await c.scriptPage(chapterId, page);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!elig?.eligible) blockers.push(elig?.reason ?? "Page not eligible.");
  if (!repoPrompt) return { inv, prompt: null, repoPrompt: null, promptEdited: false, script, plan: null, finalPrompt: null, cast: [] as PageCastEntry[], blockers: [...blockers, "No prompt file."], warnings };
  const override = options.promptOverride?.replace(/\r\n/g, "\n");
  const promptEdited = !!override && override.trim() !== repoPrompt.text.trim();
  const prompt: LoadedPrompt = promptEdited ? { ...parsePrompt(override!, { page, version: repoPrompt.version }), path: repoPrompt.path } : repoPrompt;
  if (promptEdited) warnings.push("This run uses an edited prompt. The repository prompt is unchanged.");
  const consistency = checkPromptAgainstScript(expectedLettering(prompt), script);
  if (!consistency.ok) {
    const problems = consistency.problems.map((p) => `Script check: ${p}`);
    if (promptEdited && options.allowScriptDrift) warnings.push(...problems.map((p) => `${p} (you confirmed this edit)`));
    else blockers.push(...problems);
  }
  const characters = await studioCharacters(deps);
  const sheetFiles = await resolveSheetFiles(
    deps.repo,
    characters,
    inv.config.identitySheetDirs,
    prompt.referenceOrder.flatMap((r) => (r.file ? [r.file] : [])),
  );
  const plan = planReferences({
    chapterId,
    prompt,
    characters,
    sheetFiles,
    sheetOverrides: options.sheets,
    uploads: await loadUploads(deps),
    findScenePage: await loadSceneCandidates(deps, chapterId, page, inv),
    maxSceneReferences: settings.maxSceneReferences,
  });
  // What the prompt asks for per character (before the owner's picks), for the outfit picker.
  const defaultPlan = options.sheets ? planReferences({ chapterId, prompt, characters, sheetFiles, uploads: [], findScenePage: () => null, maxSceneReferences: 0 }) : plan;
  const cast: PageCastEntry[] = [];
  for (const e of defaultPlan.entries) {
    if (e.role !== "identity" || !e.characterId || cast.some((x) => x.characterId === e.characterId)) continue;
    const ch = characters.find((x) => x.id === e.characterId);
    if (!ch) continue;
    const promptSheet = findSheet([ch], e.path)?.sheet.path ?? e.path;
    const selected = plan.entries.find((x) => x.role === "identity" && x.characterId === ch.id)?.path ?? e.path;
    cast.push({
      characterId: ch.id,
      displayName: ch.displayName,
      promptSheet,
      selectedSheet: findSheet([ch], selected)?.sheet.path ?? selected,
      sheets: ch.sheets.map((s) => ({ path: s.path, label: s.label, file: s.file, isDefault: s.isDefault, category: s.category, needsReview: s.needsReview })),
    });
  }
  blockers.push(...plan.blockers);
  warnings.push(...prompt.warnings, ...plan.warnings);
  return { inv, prompt, repoPrompt, promptEdited, script, plan, finalPrompt: buildFinalPrompt(prompt, plan), cast, blockers, warnings };
}

async function generateStep(deps: StudioDeps, job: JobRow, jp: JobPageRow): Promise<string> {
  const now = deps.clock.now();
  const s = job.settings;
  if (!deps.images || !deps.generationEnabled) {
    await deps.db.query(`UPDATE jobs SET status = 'blocked', error = $2, updated_at = $3 WHERE id = $1`, [job.id, "Paid generation is switched off or OPENAI_API_KEY is missing.", now]);
    await updatePage(deps.db, jp, deps.workerId, { status: "queued", lease_owner: null, lease_until: null }, now);
    return "generation_disabled";
  }
  if (jp.attempts >= jp.max_attempts) {
    await updatePage(deps.db, jp, deps.workerId, { status: "failed", lease_owner: null, lease_until: null, last_error: `Reached the limit of ${jp.max_attempts} attempts.` }, now);
    return "max_attempts";
  }

  const planned = await planPage(deps, job.chapter_id, jp.page, s, jp.options ?? {});
  if (planned.blockers.length || !planned.prompt || !planned.plan || !planned.finalPrompt) {
    await blockPage(deps, job, jp, planned.blockers.length ? planned.blockers : ["Prompt could not be loaded."]);
    return "blocked";
  }
  const { prompt, plan, finalPrompt } = planned;

  const est = estimatePageCost(s.imageModel, s.quality, plan.entries.length);
  const fresh = (await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE id = $1`, [job.id]))!;
  if (fresh.status !== "running") {
    await updatePage(deps.db, jp, deps.workerId, { status: "queued", lease_owner: null, lease_until: null }, now);
    return "job_not_running";
  }
  if (fresh.spent_estimate_usd + est.totalUsd > fresh.budget_usd) {
    await deps.db.query(`UPDATE jobs SET status = 'budget_exceeded', error = $2, updated_at = $3 WHERE id = $1`, [
      job.id,
      `Stopped before page ${pad3(jp.page)}: the next attempt (about $${est.totalUsd.toFixed(2)}) would pass the $${fresh.budget_usd.toFixed(2)} budget.`,
      now,
    ]);
    await updatePage(deps.db, jp, deps.workerId, { status: "queued", lease_owner: null, lease_until: null }, now);
    await logEvent(deps.db, now, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "warn", message: "Budget limit reached; job stopped automatically." });
    return "budget_exceeded";
  }

  // attemptNo counts toward the limit; seq is the unique record number (rate
  // limits and regenerations do not consume attempts but still create records).
  const attemptNo = jp.attempts + 1;
  const seq = ((await one<{ n: number }>(deps.db, `SELECT COALESCE(max(attempt_no), 0)::int AS n FROM generation_attempts WHERE job_page_id = $1 AND kind = 'image'`, [jp.id]))?.n ?? 0) + 1;
  const attemptId = deps.newId();
  const blobPath = `studio/drafts/${job.chapter_id}/p${pad3(jp.page)}/${attemptId}.png`;
  const requestHash = sha256(JSON.stringify({ p: prompt.sha256, refs: plan.entries.map((e) => e.path), s: [s.imageModel, s.quality, s.size] }));
  await deps.db.tx(async (tx) => {
    await tx.query(
      `INSERT INTO generation_attempts (id, job_id, job_page_id, chapter_id, page, attempt_no, kind, status, model, settings, prompt_path, prompt_sha256, request_hash, reference_manifest, blob_path, cost_estimate_usd, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,'image','in_flight',$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [attemptId, job.id, jp.id, job.chapter_id, jp.page, seq, s.imageModel, JSON.stringify(s), prompt.path, prompt.sha256, requestHash, JSON.stringify(plan.entries), blobPath, est.imageUsd, now],
    );
    await tx.query(`UPDATE job_pages SET attempts = $2 WHERE id = $1`, [jp.id, attemptNo]);
    await tx.query(`UPDATE jobs SET spent_estimate_usd = spent_estimate_usd + $2, updated_at = $3 WHERE id = $1`, [job.id, est.imageUsd, now]);
  });
  jp.attempts = attemptNo;
  await logEvent(deps.db, now, {
    jobId: job.id,
    chapterId: job.chapter_id,
    page: jp.page,
    level: "info",
    message: `Generating page ${pad3(jp.page)}, attempt ${attemptNo} of ${jp.max_attempts}, with ${plan.entries.length} reference image(s).`,
    data: { references: plan.entries.map((e) => `${e.slot}: ${e.label}`), warnings: planned.warnings, estimateUsd: est.imageUsd },
  });

  try {
    const images = [];
    for (const e of plan.entries) images.push(await readReference(deps, e));
    const result = await deps.images.generatePage({
      model: s.imageModel,
      prompt: finalPrompt,
      images,
      size: s.size,
      quality: s.quality,
      outputFormat: s.outputFormat,
      safetyIdentifier: deps.safetyIdentifier,
    });
    const normalized = await normalizeToTarget(result.image);
    try {
      await deps.blobs.put(blobPath, normalized.data, "image/png");
    } catch (err) {
      if (!(err instanceof BlobExistsError)) throw err;
    }
    const info = await inspectImage(normalized.data);
    const reported = costFromUsage(s.imageModel, result.usage);
    const attemptRow = (await one<AttemptRow>(deps.db, `SELECT * FROM generation_attempts WHERE id = $1`, [attemptId]))!;
    const versionId = await insertVersion(deps, job, jp, attemptRow, info, plan.entries);
    const at = deps.clock.now();
    await deps.db.tx(async (tx) => {
      await tx.query(`UPDATE generation_attempts SET status = 'succeeded', usage = $2, cost_reported_usd = $3, reference_manifest = $4, finished_at = $5 WHERE id = $1`, [
        attemptId,
        result.usage ? JSON.stringify(result.usage) : null,
        reported,
        JSON.stringify(plan.entries),
        at,
      ]);
      if (reported != null) await tx.query(`UPDATE jobs SET spent_reported_usd = spent_reported_usd + $2 WHERE id = $1`, [job.id, reported]);
    });
    await updatePage(deps.db, jp, deps.workerId, { phase: "validate", status: "queued", current_version_id: versionId, lease_owner: null, lease_until: null, next_attempt_at: null }, at);
    await logEvent(deps.db, at, {
      jobId: job.id,
      chapterId: job.chapter_id,
      page: jp.page,
      level: "info",
      message: `Page ${pad3(jp.page)} image saved; running quality checks.${normalized.note ? ` ${normalized.note}` : ""}`,
      data: { reportedCostUsd: reported, usage: result.usage },
    });
    deps.kick("validate");
    return "generated";
  } catch (err) {
    const c = classifyProviderError(err);
    const at = deps.clock.now();
    const httpAnswered = typeof c.status === "number";
    await deps.db.query(`UPDATE generation_attempts SET status = 'failed', error = $2, finished_at = $3 WHERE id = $1`, [attemptId, JSON.stringify({ cls: c.cls, status: c.status, code: c.code, message: c.message }), at]);
    // A request OpenAI answered with an error is not billed; release its reservation.
    if (httpAnswered) await deps.db.query(`UPDATE jobs SET spent_estimate_usd = GREATEST(0, spent_estimate_usd - $2) WHERE id = $1`, [job.id, est.imageUsd]);
    if (c.cls === "blocker") {
      await deps.db.query(`UPDATE job_pages SET attempts = attempts - 1 WHERE id = $1`, [jp.id]);
      await deps.db.query(`UPDATE jobs SET status = 'blocked', error = $2, updated_at = $3 WHERE id = $1`, [job.id, c.message, at]);
      await updatePage(deps.db, jp, deps.workerId, { status: "queued", lease_owner: null, lease_until: null, last_error: c.message }, at);
      await logEvent(deps.db, at, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "error", message: `Job paused: ${c.message}` });
      return "blocker";
    }
    if (c.cls === "rejected") {
      await updatePage(deps.db, jp, deps.workerId, { status: "failed", lease_owner: null, lease_until: null, last_error: c.message }, at);
      await logEvent(deps.db, at, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "error", message: `Page ${pad3(jp.page)} was refused: ${c.message} It needs a human decision; not retried.` });
      return "rejected";
    }
    if (c.cls === "rate_limited") {
      // Rate limits do not use up an attempt.
      await deps.db.query(`UPDATE job_pages SET attempts = attempts - 1 WHERE id = $1`, [jp.id]);
      const delay = Math.max(RATE_LIMIT_FLOOR_MS, c.retryAfterMs ?? backoffMs(attemptNo));
      await releaseForRetry(deps, jp, c.message, delay);
      await logEvent(deps.db, at, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "warn", message: `Rate limited; retrying page ${pad3(jp.page)} in about ${Math.round(delay / 1000)} s.` });
      return "rate_limited";
    }
    if (attemptNo >= jp.max_attempts) {
      await updatePage(deps.db, jp, deps.workerId, { status: "failed", lease_owner: null, lease_until: null, last_error: c.message }, at);
      await logEvent(deps.db, at, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "error", message: `Page ${pad3(jp.page)} failed after ${attemptNo} attempts: ${c.message}` });
      return "failed";
    }
    const delay = backoffMs(attemptNo);
    await releaseForRetry(deps, jp, c.message, delay);
    await logEvent(deps.db, at, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "warn", message: `Attempt ${attemptNo} failed (${c.message}); retrying in about ${Math.round(delay / 1000)} s.` });
    return "retry";
  }
}

async function validateStep(deps: StudioDeps, job: JobRow, jp: JobPageRow): Promise<string> {
  const now = deps.clock.now();
  const s = job.settings;
  const version = jp.current_version_id ? await one<VersionRow>(deps.db, `SELECT * FROM page_versions WHERE id = $1`, [jp.current_version_id]) : undefined;
  if (!version) {
    await updatePage(deps.db, jp, deps.workerId, { phase: "generate", status: "queued", lease_owner: null, lease_until: null }, now);
    return "no_version";
  }
  const stored = await deps.blobs.get(version.blob_path);
  if (!stored) throw new Error("Generated image is missing from storage.");
  const info = await inspectImage(stored.data);
  const c = await content(deps);
  const prompt = (await c.loadPrompt(job.chapter_id, jp.page)) as LoadedPrompt;
  const script = await c.scriptPage(job.chapter_id, jp.page);
  const prevState = await one<{ state: ContinuityState }>(deps.db, `SELECT state FROM continuity_states WHERE chapter_id = $1 AND page < $2 ORDER BY page DESC LIMIT 1`, [job.chapter_id, jp.page]);

  let vision = null;
  let visionError: string | null = null;
  const fresh = (await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE id = $1`, [job.id]))!;
  if (!deps.qa) visionError = "QA model not configured";
  else if (fresh.spent_estimate_usd + QA_COST_ASSUMED_USD > fresh.budget_usd) visionError = "skipped to stay within the budget";
  else {
    try {
      const manifest = (version.reference_manifest as ReferenceManifestEntry[]) ?? [];
      const identity: ReferenceImage[] = [];
      for (const e of manifest.filter((m) => m.role === "identity")) identity.push(await readReference(deps, { ...e }));
      const prevEntry = manifest.find((m) => m.role === "scene");
      const previous = prevEntry ? await readReference(deps, { ...prevEntry }) : null;
      const res = await deps.qa.evaluate({
        model: s.qaModel,
        page: stored.data,
        pageMime: stored.contentType,
        identitySheets: identity,
        previousPage: previous,
        instructions: buildQaInstructions(prompt, script, continuitySummary(prevState?.state ?? null)),
        safetyIdentifier: deps.safetyIdentifier,
      });
      vision = res.result;
      const qaCost = qaCostFromUsage(s.qaModel, res.usage) ?? QA_COST_ASSUMED_USD;
      await deps.db.query(`UPDATE jobs SET spent_estimate_usd = spent_estimate_usd + $2, spent_reported_usd = spent_reported_usd + $3 WHERE id = $1`, [job.id, QA_COST_ASSUMED_USD, res.usage ? qaCost : 0]);
    } catch (err) {
      const cls = classifyProviderError(err);
      if (cls.cls === "rate_limited") {
        await releaseForRetry(deps, jp, cls.message, Math.max(RATE_LIMIT_FLOOR_MS, cls.retryAfterMs ?? 30_000));
        return "qa_rate_limited";
      }
      visionError = cls.message;
    }
  }

  const report = combineQa({ info, prompt, script, vision, visionError, passThreshold: s.qaPassThreshold, reviewThreshold: s.qaReviewThreshold });
  const at = deps.clock.now();
  const canRetry = report.status === "fail" && report.retryRecommended && jp.attempts < jp.max_attempts;
  await deps.db.query(`UPDATE page_versions SET qa = $2, qa_status = $3, qa_confidence = $4, review_status = $5 WHERE id = $1`, [
    version.id,
    JSON.stringify(report),
    report.status,
    report.confidence,
    report.status === "fail" ? "auto_rejected" : "awaiting_review",
  ]);

  if (report.status !== "fail") {
    const approvedPrev = await one<{ page: number }>(deps.db, `SELECT page FROM page_versions WHERE chapter_id = $1 AND page < $2 AND review_status = 'approved' ORDER BY page DESC LIMIT 1`, [job.chapter_id, jp.page]);
    const state = buildContinuityState({
      prompt,
      script,
      previous: prevState?.state ?? null,
      previousApprovedPage: approvedPrev?.page ?? null,
      observedIssues: report.status === "uncertain" ? report.reasons : [],
    });
    await deps.db.query(
      `INSERT INTO continuity_states (chapter_id, page, version_id, state, source, updated_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (chapter_id, page) DO UPDATE SET version_id = EXCLUDED.version_id, state = EXCLUDED.state, source = EXCLUDED.source, updated_at = EXCLUDED.updated_at`,
      [job.chapter_id, jp.page, version.id, JSON.stringify(state), state.source, at],
    );
    await updatePage(deps.db, jp, deps.workerId, { status: "awaiting_review", lease_owner: null, lease_until: null, last_error: report.status === "uncertain" ? "Flagged for review: automatic checks were not confident." : null }, at);
    await logEvent(deps.db, at, {
      jobId: job.id,
      chapterId: job.chapter_id,
      page: jp.page,
      level: report.status === "pass" ? "info" : "warn",
      message: report.status === "pass" ? `Page ${pad3(jp.page)} passed automatic checks (confidence ${report.confidence}); awaiting your review.` : `Page ${pad3(jp.page)} needs a closer look: ${report.reasons.slice(0, 3).join("; ")}`,
    });
    return report.status;
  }

  if (canRetry) {
    await updatePage(deps.db, jp, deps.workerId, { phase: "generate", status: "retry_wait", next_attempt_at: new Date(at.getTime() + 5_000), lease_owner: null, lease_until: null, last_error: `QA failed: ${report.reasons.slice(0, 3).join("; ")}` }, at);
    await logEvent(deps.db, at, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "warn", message: `Page ${pad3(jp.page)} failed checks; retrying automatically.`, data: { reasons: report.reasons } });
    deps.kick("qa-retry");
    return "qa_retry";
  }
  await updatePage(deps.db, jp, deps.workerId, { status: "failed", lease_owner: null, lease_until: null, last_error: `QA failed: ${report.reasons.slice(0, 3).join("; ")}` }, at);
  await logEvent(deps.db, at, { jobId: job.id, chapterId: job.chapter_id, page: jp.page, level: "error", message: `Page ${pad3(jp.page)} failed checks and has no attempts left. The last version is kept for you to compare or approve manually.` });
  return "qa_failed";
}

/** Closes a job once every page is terminal. */
export async function settleJob(deps: StudioDeps, jobId: string) {
  const job = await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE id = $1`, [jobId]);
  if (!job || !["running", "queued"].includes(job.status)) return;
  const pages = await deps.db.query<JobPageRow>(`SELECT * FROM job_pages WHERE job_id = $1`, [jobId]);
  const open = pages.filter((p) => ["queued", "generating", "validating", "retry_wait"].includes(p.status));
  if (open.length) return;
  const versions = await deps.db.query<{ qa_status: string }>(`SELECT v.qa_status FROM page_versions v JOIN job_pages p ON p.current_version_id = v.id WHERE p.job_id = $1`, [jobId]);
  const issues = pages.some((p) => p.status !== "awaiting_review") || versions.some((v) => v.qa_status !== "pass");
  const now = deps.clock.now();
  await deps.db.query(`UPDATE jobs SET status = $2, finished_at = $3, updated_at = $3 WHERE id = $1 AND status IN ('running','queued')`, [jobId, issues ? "completed_with_issues" : "completed", now]);
  await logEvent(deps.db, now, { jobId, chapterId: job.chapter_id, level: "info", message: issues ? "Job finished. Some pages need your attention." : "Job finished. All pages passed automatic checks and await your review." });
}

/** Marks real generation as verified once the owner approves a page from a test job. */
export async function noteApproval(deps: StudioDeps, version: VersionRow) {
  if (!version.job_id) return;
  const job = await one<JobRow>(deps.db, `SELECT * FROM jobs WHERE id = $1`, [version.job_id]);
  if (job?.is_test) await setStudioSetting(deps, "real_generation_verified", true);
}

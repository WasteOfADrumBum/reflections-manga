import type { StudioDeps } from "../context.js";
import { content } from "../context.js";
import { pad3 } from "../content/config.js";
import { reconcilePublished } from "../publish/service.js";
import { reconcileRepoArt } from "../publish/repo-art.js";
import { getStudioSetting } from "./jobs.js";
import type { JobPageRow, VersionRow } from "./types.js";

export type PageDisplayStatus =
  | "published"
  | "has_art"
  | "locked"
  | "approved"
  | "queued"
  | "generating"
  | "checking"
  | "retrying"
  | "awaiting_review"
  | "needs_attention"
  | "failed"
  | "blocked"
  | "ready"
  | "unprepared";

/** Short on purpose: these sit in small page tiles. */
export const STATUS_LABELS: Record<PageDisplayStatus, string> = {
  published: "Published",
  has_art: "Has art",
  locked: "Locked",
  approved: "Approved",
  queued: "Queued",
  generating: "Generating",
  checking: "Checking",
  retrying: "Retrying",
  awaiting_review: "To review",
  needs_attention: "Check closely",
  failed: "Failed",
  blocked: "Blocked",
  ready: "Ready",
  unprepared: "Not prepared",
};

export const DONE_STATUSES: PageDisplayStatus[] = ["published", "has_art", "approved"];

export async function chapterOverview(deps: StudioDeps, chapterId: string) {
  const c = await content(deps);
  const inv = await c.inventory(chapterId);
  const inReader = new Set(inv.pages.filter((p) => p.publishedSrc).map((p) => p.page));
  await reconcilePublished(deps, chapterId, inReader);
  await reconcileRepoArt(deps, chapterId, inReader);
  const versions = await deps.db.query<VersionRow>(`SELECT * FROM page_versions WHERE chapter_id = $1 ORDER BY created_at DESC`, [chapterId]);
  const activeJobPages = await deps.db.query<JobPageRow & { job_status: string }>(
    `SELECT jp.*, j.status AS job_status FROM job_pages jp JOIN jobs j ON j.id = jp.job_id WHERE jp.chapter_id = $1 ORDER BY j.created_at DESC`,
    [chapterId],
  );
  const pages = inv.pages.map((p) => {
    const vs = versions.filter((v) => v.page === p.page);
    const approved = vs.find((v) => v.review_status === "approved") ?? null;
    const latest = vs[0] ?? null;
    const jp = activeJobPages.find((j) => j.page === p.page) ?? null;
    const replacementPending = approved != null && approved.publication_status === "unpublished";
    let status: PageDisplayStatus;
    if (p.locked) status = "locked";
    else if (jp && ["queued", "running", "paused"].includes(jp.job_status) && ["queued", "generating", "validating", "retry_wait"].includes(jp.status)) {
      status = jp.status === "generating" ? "generating" : jp.status === "validating" || (jp.status === "queued" && jp.phase === "validate") ? "checking" : jp.status === "retry_wait" ? "retrying" : "queued";
    } else if (latest && latest.review_status === "awaiting_review") status = latest.qa_status === "pass" || latest.source === "upload" ? "awaiting_review" : "needs_attention";
    else if (replacementPending) status = "approved";
    else if (p.publishedSrc) status = "published";
    else if (p.sourceImagePath) status = "has_art";
    else if (approved) status = "approved";
    else if (jp?.status === "blocked") status = "blocked";
    else if (jp?.status === "failed" || (latest && latest.review_status === "auto_rejected")) status = "failed";
    else if (!p.prepared) status = "unprepared";
    else status = "ready";
    return {
      ...p,
      label: pad3(p.page),
      status,
      statusLabel: STATUS_LABELS[status],
      versionCount: vs.length,
      latestVersionId: latest?.id ?? null,
      approvedVersionId: approved?.id ?? null,
      qaStatus: latest?.qa_status ?? null,
      qaConfidence: latest?.qa_confidence ?? null,
      lastError: jp?.last_error ?? null,
      attempts: jp?.attempts ?? 0,
      publicationStatus: approved?.publication_status ?? null,
    };
  });
  const done = pages.filter((p) => DONE_STATUSES.includes(p.status) || (p.status === "awaiting_review" && p.hasArt)).length;
  return {
    id: chapterId,
    title: inv.config.title,
    arcTitle: inv.config.arcTitle ?? null,
    arcNumber: inv.config.arcNumber,
    plannedPages: inv.config.plannedPages,
    completionPercent: Math.round((done / inv.config.plannedPages) * 100),
    doneCount: done,
    revisionLabel: inv.config.revisionLabel,
    arcId: inv.config.arcId,
    counts: Object.fromEntries(Object.keys(STATUS_LABELS).map((k) => [k, pages.filter((p) => p.status === k).length])),
    pages,
    scriptPath: inv.scriptPath,
  };
}

export async function dashboard(deps: StudioDeps) {
  const c = await content(deps);
  const chapters = [];
  for (const id of c.chapterIds()) {
    const o = await chapterOverview(deps, id);
    chapters.push({ id: o.id, title: o.title, arcTitle: o.arcTitle, plannedPages: o.plannedPages, completionPercent: o.completionPercent, doneCount: o.doneCount, counts: o.counts });
  }
  const jobs = await deps.db.query(
    `SELECT j.id, j.chapter_id, j.status, j.page_numbers, j.budget_usd, j.spent_estimate_usd, j.spent_reported_usd, j.is_test, j.error, j.created_at, j.finished_at,
            (SELECT count(*)::int FROM job_pages p WHERE p.job_id = j.id AND p.status IN ('awaiting_review','failed','blocked','skipped','cancelled')) AS done,
            (SELECT count(*)::int FROM job_pages p WHERE p.job_id = j.id) AS total
       FROM jobs j ORDER BY j.created_at DESC LIMIT 10`,
  );
  const monthStart = new Date(deps.clock.now());
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const usage = (
    await deps.db.query<{ attempts: number; estimate: number; reported: number; reported_count: number }>(
      `SELECT count(*)::int AS attempts, COALESCE(sum(cost_estimate_usd),0)::float AS estimate, COALESCE(sum(cost_reported_usd),0)::float AS reported, count(cost_reported_usd)::int AS reported_count
         FROM generation_attempts WHERE started_at >= $1`,
      [monthStart],
    )
  )[0];
  const attention = await deps.db.query(
    `SELECT jp.chapter_id, jp.page, jp.status, jp.last_error, jp.job_id FROM job_pages jp JOIN jobs j ON j.id = jp.job_id
      WHERE jp.status IN ('failed','blocked') AND j.created_at > $1 ORDER BY jp.updated_at DESC LIMIT 20`,
    [new Date(deps.clock.now().getTime() - 30 * 86400_000)],
  );
  const blockedJobs = await deps.db.query(`SELECT id, chapter_id, status, error FROM jobs WHERE status IN ('blocked','budget_exceeded') ORDER BY updated_at DESC LIMIT 10`);
  return {
    chapters,
    jobs,
    usage: { month: monthStart.toISOString().slice(0, 7), ...usage },
    attention,
    blockedJobs,
    generationEnabled: deps.generationEnabled,
    realGenerationVerified: await getStudioSetting(deps, "real_generation_verified", false),
    missingConfig: deps.missingConfig,
  };
}

import type { StudioDeps } from "../context.js";
import { content } from "../context.js";
import { pad3 } from "../content/config.js";
import { badRequest, conflict, forbidden, HttpError } from "../errors.js";
import { logEvent } from "../engine/events.js";
import type { VersionRow } from "../engine/types.js";
import { toReaderWebp } from "../images.js";
import { altTextFromScript } from "./alt-text.js";
import { addPagesToChaptersJs, type ReaderPageEntry, updateChapterNote } from "./chapters-js.js";

/**
 * Explicit publishing. Only versions the owner approved are included; nothing
 * is published as a side effect of generation. The result is a pull request
 * that adds new files only (WebP for the reader, the original PNG next to the
 * manuscript, a provenance record) and appends entries to site/js/chapters.js.
 * Merging it to main deploys the reader through Vercel.
 */
export async function publishChapter(
  deps: StudioDeps,
  opts: { chapterId: string; versionIds: string[]; altText: Record<string, string>; allowGap: boolean; createdBy: string; replacePages?: number[] },
) {
  if (!deps.publisher) throw forbidden("GITHUB_TOKEN is not configured, so publishing is unavailable.");
  if (!opts.versionIds.length) throw badRequest("Choose at least one approved page.");
  const c = await content(deps, true);
  const config = c.chapterConfig(opts.chapterId);
  if (!config) throw badRequest("Unknown chapter.");
  const inv = await c.inventory(opts.chapterId);
  const versions = await deps.db.query<VersionRow>(`SELECT * FROM page_versions WHERE id = ANY($1::uuid[]) AND chapter_id = $2`, [opts.versionIds, opts.chapterId]);
  if (versions.length !== opts.versionIds.length) throw badRequest("Some selected versions do not exist in this chapter.");
  for (const v of versions) {
    if (v.review_status !== "approved") throw conflict(`Page ${pad3(v.page)} is not approved. Approve it before publishing.`);
    if (v.publication_status !== "unpublished") throw conflict(`Page ${pad3(v.page)} already has a publishing pull request.`);
    const info = inv.pages.find((p) => p.page === v.page);
    if (!info || info.locked) throw conflict(`Page ${pad3(v.page)} is locked: ${info?.lockReason ?? "unknown page"}`);
  }
  const replace = new Set(opts.replacePages ?? []);
  const needsReplace = versions.filter((v) => inv.pages.find((p) => p.page === v.page)?.hasArt && !replace.has(v.page)).map((v) => v.page);
  if (needsReplace.length) {
    throw conflict(`Page ${needsReplace.map(pad3).join(", ")} already has artwork. Confirm that the approved version should replace it.`, { code: "replace_required", pages: needsReplace });
  }
  if (new Set(versions.map((v) => v.page)).size !== versions.length) throw badRequest("Only one version per page can be published.");

  const publishedPages = new Set(inv.pages.filter((p) => p.publishedSrc).map((p) => p.page));
  const selected = new Set(versions.map((v) => v.page));
  const gaps: number[] = [];
  for (let p = 1; p < Math.max(...selected); p++) if (!publishedPages.has(p) && !selected.has(p)) gaps.push(p);
  if (gaps.length && !opts.allowGap) {
    throw conflict(`The reader would skip pages ${gaps.map(pad3).join(", ")}. Publish those first, or confirm that a gap is intended.`, { code: "gap", gaps });
  }

  const chaptersJs = await deps.publisher.readFile("site/js/chapters.js");
  if (!chaptersJs) throw new Error("site/js/chapters.js is missing on the base branch.");
  const files: { path: string; content: Buffer }[] = [];
  const entries: ReaderPageEntry[] = [];
  const mustNotExist: string[] = [];
  const replacing = new Set<number>();
  const sorted = [...versions].sort((a, b) => a.page - b.page);
  for (const v of sorted) {
    const info = inv.pages.find((p) => p.page === v.page)!;
    const stored = await deps.blobs.get(v.blob_path);
    if (!stored) throw new Error(`Image for page ${pad3(v.page)} is missing from storage.`);
    const webp = await toReaderWebp(stored.data);
    const webpPath = `${config.publishedDir}/${pad3(v.page)}.webp`;
    const originalSource = `${config.storyDir}/${config.sourcePagePattern.replace("{page}", pad3(v.page))}`;
    // A replacement never overwrites the original manuscript PNG: the studio
    // version is saved next to it under its own name, and only the reader
    // image (WebP) and its reader entry change.
    const isReplacement = info.hasArt;
    if (isReplacement) replacing.add(v.page);
    const sourcePath = isReplacement ? originalSource.replace(/\.png$/, `.studio-${v.id.slice(0, 8)}.png`) : originalSource;
    const provenancePath = sourcePath.replace(/\.png$/, isReplacement ? ".json" : ".studio.json");
    const script = await c.scriptPage(opts.chapterId, v.page);
    const alt = (opts.altText[v.id] ?? v.alt_text ?? altTextFromScript(script)).trim();
    if (alt.length < 20) throw badRequest(`Page ${pad3(v.page)} needs descriptive alt text (what happens and what is said).`);
    files.push({ path: webpPath, content: webp });
    files.push({ path: sourcePath, content: stored.data });
    files.push({
      path: provenancePath,
      content: Buffer.from(
        `${JSON.stringify(
          {
            chapter: opts.chapterId,
            page: v.page,
            versionId: v.id,
            model: v.model,
            prompt: { path: v.prompt_path, sha256: v.prompt_sha256 },
            references: v.reference_manifest,
            settings: v.settings,
            qa: { status: v.qa_status, confidence: v.qa_confidence },
            retryCount: v.retry_count,
            costEstimateUsd: v.cost_estimate_usd,
            source: v.source,
            promptEdited: v.prompt_edited ?? false,
            replacedExistingArt: isReplacement,
            sha256: v.sha256,
            createdAt: v.created_at,
            approvedAt: v.reviewed_at,
          },
          null,
          2,
        )}\n`,
      ),
    });
    mustNotExist.push(sourcePath);
    if (!isReplacement) mustNotExist.push(webpPath);
    entries.push({ page: v.page, src: `${config.publishedSrcPrefix}${pad3(v.page)}.webp`, alt, width: v.width, height: v.height });
  }
  let nextJs = addPagesToChaptersJs(chaptersJs, opts.chapterId, entries, { replace: new Set([...replacing].filter((p) => publishedPages.has(p))) });
  nextJs = updateChapterNote(nextJs, opts.chapterId, new Set([...publishedPages, ...entries.map((e) => e.page)]).size, config.plannedPages);
  files.push({ path: "site/js/chapters.js", content: Buffer.from(nextJs) });

  const now = deps.clock.now();
  const publicationId = deps.newId();
  const claimed = await deps.db.query<{ id: string }>(
    `UPDATE page_versions SET publication_status = 'pr_open', publication_id = $2 WHERE id = ANY($1::uuid[]) AND publication_status = 'unpublished' RETURNING id`,
    [opts.versionIds, publicationId],
  );
  if (claimed.length !== opts.versionIds.length) {
    await deps.db.query(`UPDATE page_versions SET publication_status = 'unpublished', publication_id = NULL WHERE publication_id = $1`, [publicationId]);
    throw conflict("Another publish request is already handling one of these pages.");
  }
  await deps.db.query(`INSERT INTO publications (id, chapter_id, version_ids, status, created_by, created_at, updated_at) VALUES ($1,$2,$3,'opening',$4,$5,$5)`, [
    publicationId,
    opts.chapterId,
    opts.versionIds,
    opts.createdBy,
    now,
  ]);
  const pagesLabel = sorted.map((v) => pad3(v.page)).join(", ");
  const branch = `studio/publish-ch${opts.chapterId}-${now.toISOString().replace(/[-:T]/g, "").slice(0, 12)}`;
  try {
    const res = await deps.publisher.openPullRequest({
      branch,
      title: `Publish chapter ${opts.chapterId} pages ${pagesLabel}`,
      commitMessage: `Publish chapter ${opts.chapterId} pages ${pagesLabel}\n\nApproved in Reflections Studio. Adds reader WebP files, original PNG pages and provenance records; appends reader entries.`,
      body: [
        `Approved in Reflections Studio by the owner. Merging this deploys the pages to the public reader.`,
        ``,
        `Pages: ${pagesLabel}`,
        `- New reader images under \`${config.publishedDir}/\``,
        `- Original PNGs and \`.studio.json\` provenance next to the manuscript pages`,
        `- Reader entries added to \`site/js/chapters.js\``,
        ``,
        replacing.size
          ? `Replaces the reader image for page ${[...replacing].map(pad3).join(", ")}, as chosen in the studio. The original manuscript PNGs stay untouched; the studio versions are saved beside them with a .studio- suffix.`
          : `No existing artwork is modified or overwritten.`,
      ].join("\n"),
      files,
      mustNotExist,
    });
    await deps.db.query(`UPDATE publications SET status = 'pr_open', branch = $2, pr_url = $3, updated_at = $4 WHERE id = $1`, [publicationId, res.branch, res.prUrl, deps.clock.now()]);
    if (replacing.size) await deps.db.query(`UPDATE page_versions SET replaces_art = true WHERE publication_id = $1 AND page = ANY($2::int[])`, [publicationId, [...replacing]]);
    await deps.db.query(`UPDATE page_versions SET alt_text = COALESCE($2::jsonb ->> id::text, alt_text) WHERE publication_id = $1`, [publicationId, JSON.stringify(Object.fromEntries(entries.map((e, i) => [sorted[i]!.id, e.alt])))]);
    await logEvent(deps.db, deps.clock.now(), { chapterId: opts.chapterId, level: "info", message: `Publishing pull request opened for pages ${pagesLabel}.`, data: { prUrl: res.prUrl } });
    return { publicationId, prUrl: res.prUrl, branch: res.branch, pages: sorted.map((v) => v.page) };
  } catch (err) {
    await deps.db.query(`UPDATE page_versions SET publication_status = 'unpublished', publication_id = NULL WHERE publication_id = $1`, [publicationId]);
    await deps.db.query(`UPDATE publications SET status = 'failed', error = $2, updated_at = $3 WHERE id = $1`, [publicationId, (err as Error).message.slice(0, 500), deps.clock.now()]);
    const status = (err as { status?: number }).status;
    if (status === 409) throw conflict((err as Error).message);
    throw new HttpError(502, `GitHub did not accept the publishing request: ${(err as Error).message}`, "publish_failed");
  }
}

/** Marks versions as published once their pages appear in the reader on main. */
export async function reconcilePublished(deps: StudioDeps, chapterId: string, publishedPages: Set<number>) {
  if (!publishedPages.size) return;
  await deps.db.query(`UPDATE page_versions SET publication_status = 'published' WHERE chapter_id = $1 AND publication_status = 'pr_open' AND review_status = 'approved' AND NOT replaces_art AND page = ANY($2::int[])`, [
    chapterId,
    [...publishedPages],
  ]);
}

import { z } from "zod";
import type { Session } from "../auth/auth.js";
import type { StudioDeps } from "../context.js";
import { content } from "../context.js";
import { pad3 } from "../content/config.js";
import { badRequest, conflict, forbidden, HttpError } from "../errors.js";
import { logEvent } from "../engine/events.js";
import { json, readJson, type Router } from "../http.js";
import { inspectImage, toReaderWebp } from "../images.js";
import { altTextFromScript } from "./alt-text.js";
import { addPagesToChaptersJs, type ReaderPageEntry, updateChapterNote } from "./chapters-js.js";
import type { PublishFile } from "./publisher.js";

/**
 * Publishing page art that is already committed to the repository (for
 * example pages made in ChatGPT and saved as stories/.../pages/A01-C001-P002.png).
 * The pull request adds only the reader WebP and the reader entry in
 * site/js/chapters.js; the PNG in the repository is not touched. Pages already
 * in the reader are never overwritten here; replacing reader art goes through
 * a studio version and Review.
 */
type RequireAdmin = (req: Request) => Promise<Session>;

export interface RepoArtPage {
  chapterId: string;
  page: number;
  title: string | null;
  sourceImagePath: string;
  suggestedAltText: string;
  pendingPrUrl: string | null;
}

/** Pages with art in the repository that the reader does not show yet. */
export async function repoArtPages(deps: StudioDeps, chapterId?: string): Promise<RepoArtPage[]> {
  const c = await content(deps);
  const pending = await pendingRepoArt(deps);
  const out: RepoArtPage[] = [];
  for (const id of chapterId ? [chapterId] : c.chapterIds()) {
    const inv = await c.inventory(id).catch(() => null);
    if (!inv) continue;
    for (const p of inv.pages) {
      if (!p.sourceImagePath || p.publishedSrc) continue;
      const script = await c.scriptPage(id, p.page);
      out.push({ chapterId: id, page: p.page, title: p.scriptTitle ?? null, sourceImagePath: p.sourceImagePath, suggestedAltText: altTextFromScript(script), pendingPrUrl: pending.get(`${id}:${p.page}`) ?? null });
    }
  }
  return out;
}

/** "001:2" -> pull request URL, for repository-art publications still open. */
export async function pendingRepoArt(deps: StudioDeps): Promise<Map<string, string>> {
  const rows = await deps.db.query<{ chapter_id: string; pages: number[]; pr_url: string | null }>(`SELECT chapter_id, pages, pr_url FROM publications WHERE kind = 'repo_art' AND status = 'pr_open'`);
  const out = new Map<string, string>();
  for (const r of rows) for (const p of r.pages) out.set(`${r.chapter_id}:${p}`, r.pr_url ?? "");
  return out;
}

export async function publishRepoArt(deps: StudioDeps, opts: { chapterId: string; pages: number[]; altText: Record<string, string>; allowGap: boolean; createdBy: string }) {
  if (!deps.publisher) throw forbidden("GITHUB_TOKEN is not configured, so publishing is unavailable.");
  const pages = [...new Set(opts.pages)].sort((a, b) => a - b);
  if (!pages.length) throw badRequest("Choose at least one page.");
  const c = await content(deps, true);
  const config = c.chapterConfig(opts.chapterId);
  if (!config) throw badRequest("Unknown chapter.");
  const inv = await c.inventory(opts.chapterId);
  const pending = await pendingRepoArt(deps);
  for (const page of pages) {
    const info = inv.pages.find((p) => p.page === page);
    if (!info?.sourceImagePath) throw conflict(`Page ${pad3(page)} has no art in the repository.`);
    if (info.publishedSrc) throw conflict(`Page ${pad3(page)} is already in the reader. To replace it, upload the art as a version and publish it from Review.`);
    if (pending.has(`${opts.chapterId}:${page}`)) throw conflict(`Page ${pad3(page)} already has a publishing pull request open.`);
  }
  const published = new Set(inv.pages.filter((p) => p.publishedSrc).map((p) => p.page));
  const selected = new Set(pages);
  const gaps: number[] = [];
  for (let p = 1; p < Math.max(...pages); p++) if (!published.has(p) && !selected.has(p)) gaps.push(p);
  if (gaps.length && !opts.allowGap) throw conflict(`The reader would skip pages ${gaps.map(pad3).join(", ")}. Publish those first, or confirm that a gap is intended.`, { code: "gap", gaps });

  const chaptersJs = await deps.publisher.readFile("site/js/chapters.js");
  if (!chaptersJs) throw new Error("site/js/chapters.js is missing on the base branch.");
  const files: PublishFile[] = [];
  const entries: ReaderPageEntry[] = [];
  for (const page of pages) {
    const info = inv.pages.find((p) => p.page === page)!;
    const png = await deps.repo.readBinary(info.sourceImagePath!);
    if (!png) throw new Error(`Page ${pad3(page)}'s image could not be read from the repository.`);
    const webp = await toReaderWebp(png);
    const meta = await inspectImage(webp);
    const alt = (opts.altText[String(page)] ?? altTextFromScript(await c.scriptPage(opts.chapterId, page))).trim();
    if (alt.length < 20) throw badRequest(`Page ${pad3(page)} needs descriptive alt text (what happens and what is said).`);
    files.push({ path: `${config.publishedDir}/${pad3(page)}.webp`, content: webp });
    entries.push({ page, src: `${config.publishedSrcPrefix}${pad3(page)}.webp`, alt, width: meta.width, height: meta.height });
  }
  let nextJs = addPagesToChaptersJs(chaptersJs, opts.chapterId, entries);
  nextJs = updateChapterNote(nextJs, opts.chapterId, new Set([...published, ...pages]).size, config.plannedPages);
  files.push({ path: "site/js/chapters.js", content: Buffer.from(nextJs) });

  const now = deps.clock.now();
  const publicationId = deps.newId();
  const label = pages.map(pad3).join(", ");
  await deps.db.query(`INSERT INTO publications (id, chapter_id, version_ids, status, created_by, created_at, updated_at, kind, pages) VALUES ($1,$2,'{}','opening',$3,$4,$4,'repo_art',$5)`, [
    publicationId,
    opts.chapterId,
    opts.createdBy,
    now,
    pages,
  ]);
  try {
    const res = await deps.publisher.openPullRequest({
      branch: `studio/publish-art-ch${opts.chapterId}-${now.toISOString().replace(/[-:T]/g, "").slice(0, 12)}`,
      title: `Publish chapter ${opts.chapterId} pages ${label}`,
      commitMessage: `Publish chapter ${opts.chapterId} pages ${label}\n\nArt already in the repository, published from Reflections Studio.`,
      body: [
        `Published from Reflections Studio by ${opts.createdBy}. Merging this puts the pages in the public reader.`,
        ``,
        `Pages: ${label}`,
        `- Reader images under \`${config.publishedDir}/\`, made from the page PNGs already in \`${config.storyDir}/\``,
        `- Reader entries added to \`site/js/chapters.js\``,
        ``,
        `The repository PNGs are not changed, and no existing reader page is overwritten.`,
      ].join("\n"),
      files,
      mustNotExist: files.filter((f) => f.path.endsWith(".webp")).map((f) => f.path),
    });
    await deps.db.query(`UPDATE publications SET status = 'pr_open', branch = $2, pr_url = $3, updated_at = $4 WHERE id = $1`, [publicationId, res.branch, res.prUrl, deps.clock.now()]);
    await logEvent(deps.db, deps.clock.now(), { chapterId: opts.chapterId, level: "info", message: `Publishing pull request opened for repository art, pages ${label}.`, data: { prUrl: res.prUrl } });
    return { publicationId, prUrl: res.prUrl, pages };
  } catch (err) {
    await deps.db.query(`UPDATE publications SET status = 'failed', error = $2, updated_at = $3 WHERE id = $1`, [publicationId, (err as Error).message.slice(0, 500), deps.clock.now()]);
    if ((err as { status?: number }).status === 409) throw conflict((err as Error).message);
    throw new HttpError(502, `GitHub did not accept the publishing request: ${(err as Error).message}`, "publish_failed");
  }
}

/** Closes repository-art publications once all their pages show in the reader on main. */
export async function reconcileRepoArt(deps: StudioDeps, chapterId: string, publishedPages: Set<number>) {
  const rows = await deps.db.query<{ id: string; pages: number[] }>(`SELECT id, pages FROM publications WHERE kind = 'repo_art' AND status = 'pr_open' AND chapter_id = $1`, [chapterId]);
  for (const r of rows) if (r.pages.every((p) => publishedPages.has(p))) await deps.db.query(`UPDATE publications SET status = 'merged', updated_at = $2 WHERE id = $1`, [r.id, deps.clock.now()]);
}

export function registerRepoArtRoutes(r: Router, deps: StudioDeps, requireAdmin: RequireAdmin) {
  r.add("POST", "/chapters/:id/publish-repo-art", async ({ req, params }) => {
    const s = await requireAdmin(req);
    const chapterId = z.string().regex(/^\d{3}$/).parse(params.id);
    const body = z
      .object({
        pages: z.array(z.number().int().min(1).max(500)).min(1).max(60),
        altText: z.record(z.string().regex(/^\d+$/), z.string().max(4000)).default({}),
        allowGap: z.boolean().default(false),
        confirm: z.literal(true),
      })
      .safeParse(await readJson(req));
    if (!body.success) throw badRequest("Choose the pages to publish and confirm.");
    const res = await publishRepoArt(deps, { chapterId, ...body.data, createdBy: s.user });
    return json(res, 201);
  });
}

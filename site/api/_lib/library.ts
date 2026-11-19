import { z } from "zod";
import type { Session } from "./auth/auth.js";
import type { StudioDeps } from "./context.js";
import { content } from "./context.js";
import { findSheet } from "./content/characters.js";
import { pad3 } from "./content/config.js";
import { one } from "./db/client.js";
import { badRequest, conflict, forbidden, HttpError, notFound } from "./errors.js";
import { logEvent } from "./engine/events.js";
import { chapterOverrides, getStudioSetting, pageRunOptionsSchema, setStudioSetting } from "./engine/jobs.js";
import { chapterOverview } from "./engine/overview.js";
import type { VersionRow } from "./engine/types.js";
import { planPage, studioCharacters } from "./engine/worker.js";
import { json, readJson, type Router } from "./http.js";
import { inspectImage, thumbnail, validateUpload } from "./images.js";
import { estimatePageCost, IMAGE_PRICING, OUTPUT_TOKENS_ASSUMED, pricingFor } from "./openai/pricing.js";
import { altTextFromScript } from "./publish/alt-text.js";
import type { PublishFile } from "./publish/publisher.js";

/**
 * Routes added by the studio rework: arcs, review queue, outfit names, page
 * planning with per-run choices, manual page uploads, spending, creating
 * characters / arcs / chapters, and site image visibility. Everything that
 * changes the repository goes through a pull request the owner merges.
 */
type RequireAdmin = (req: Request) => Promise<Session>;

const chapterParam = (s: string) => {
  if (!/^\d{3}$/.test(s)) throw badRequest("Invalid chapter id.");
  return s;
};
const pageNumber = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw badRequest("Invalid page number.");
  return n;
};

export const ATTEMPT_FLAG_DEFAULT = 5;
const VISIBILITY_PATH = "site/js/visibility-data.js";
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

async function readUpload(req: Request, maxBytes = 4_400_000): Promise<{ form: FormData; file: File; data: Buffer }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new HttpError(413, "Upload must be under 4 MB.", "too_large");
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Choose an image file.");
  return { form, file, data: Buffer.from(await file.arrayBuffer()) };
}

function fields(form: FormData): Record<string, string> {
  return Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string") as [string, string][]);
}

export function registerLibraryRoutes(r: Router, deps: StudioDeps, requireAdmin: RequireAdmin) {
  // ---- arcs > chapters ----
  r.add("GET", "/arcs", async ({ req }) => {
    await requireAdmin(req);
    const c = await content(deps);
    const arcs = await c.arcs();
    const out = [];
    for (const a of arcs) {
      const chapters = [];
      for (const id of a.chapterIds) {
        const [o, syn] = await Promise.all([chapterOverview(deps, id), c.chapterSynopsis(id)]);
        chapters.push({ id, title: o.title, plannedPages: o.plannedPages, completionPercent: o.completionPercent, doneCount: o.doneCount, counts: o.counts, synopsis: syn.synopsis, revisionLabel: o.revisionLabel });
      }
      out.push({ ...a, chapters });
    }
    return json({ arcs: out });
  });

  // ---- review queue: one query, every chapter ----
  r.add("GET", "/review", async ({ req }) => {
    await requireAdmin(req);
    const c = await content(deps);
    const rows = await deps.db.query<VersionRow>(
      `SELECT * FROM page_versions
        WHERE review_status = 'awaiting_review' OR (review_status = 'approved' AND publication_status = 'unpublished')
        ORDER BY chapter_id, page, created_at DESC`,
    );
    const counts = await deps.db.query<{ chapter_id: string; page: number; n: number }>(`SELECT chapter_id, page, count(*)::int AS n FROM page_versions GROUP BY chapter_id, page`);
    const pages = new Map<string, { chapterId: string; page: number; title: string | null; hasArt: boolean; sourceImagePath: string | null; publishedSrc: string | null; suggestedAltText: string; versions: ReturnType<typeof versionSummary>[]; totalVersions: number }>();
    for (const v of rows) {
      const key = `${v.chapter_id}:${v.page}`;
      if (!pages.has(key)) {
        const inv = await c.inventory(v.chapter_id).catch(() => null);
        const info = inv?.pages.find((p) => p.page === v.page);
        const script = await c.scriptPage(v.chapter_id, v.page);
        pages.set(key, {
          chapterId: v.chapter_id,
          page: v.page,
          title: info?.scriptTitle ?? null,
          hasArt: info?.hasArt ?? false,
          sourceImagePath: info?.sourceImagePath ?? null,
          publishedSrc: info?.publishedSrc ?? null,
          suggestedAltText: altTextFromScript(script),
          versions: [],
          totalVersions: counts.find((x) => x.chapter_id === v.chapter_id && x.page === v.page)?.n ?? 0,
        });
      }
      pages.get(key)!.versions.push(versionSummary(v));
    }
    const chapters = c.chapterIds().map((id) => ({ id, title: c.chapterConfig(id)!.title }));
    return json({ pages: [...pages.values()], chapters, publisherReady: !!deps.publisher });
  });

  // ---- outfit names ----
  r.add("PUT", "/sheets/label", async ({ req }) => {
    await requireAdmin(req);
    const body = z.object({ path: z.string().max(300), label: z.string().trim().max(80) }).safeParse(await readJson(req));
    if (!body.success) throw badRequest("Give the outfit a name of up to 80 characters.");
    const chars = await studioCharacters(deps);
    if (!findSheet(chars, body.data.path)) throw notFound("That sheet is not in the character library.");
    if (!body.data.label) await deps.db.query(`DELETE FROM sheet_labels WHERE path = $1`, [body.data.path]);
    else
      await deps.db.query(`INSERT INTO sheet_labels (path, label, updated_at) VALUES ($1,$2,$3) ON CONFLICT (path) DO UPDATE SET label = EXCLUDED.label, updated_at = EXCLUDED.updated_at`, [
        body.data.path,
        body.data.label,
        deps.clock.now(),
      ]);
    return json({ ok: true });
  });

  // ---- plan one page with the owner's choices (no cost) ----
  r.add("POST", "/chapters/:id/pages/:page/plan", async ({ req, params }) => {
    await requireAdmin(req);
    const id = chapterParam(params.id!);
    const page = pageNumber(params.page!);
    const body = z.object({ options: pageRunOptionsSchema.optional(), quality: z.enum(["low", "medium", "high", "xhigh", "max"]).optional() }).safeParse(await readJson(req, 64 * 1024));
    if (!body.success) throw badRequest("Invalid page options.", body.error.issues.map((i) => i.message));
    const c = await content(deps);
    const settings = { ...c.studioConfig.generation, ...(await chapterOverrides(deps, id)) };
    const quality = body.data.quality ?? settings.quality;
    const planned = await planPage(deps, id, page, settings, body.data.options ?? {});
    const refs = planned.plan?.entries.length ?? 0;
    return json({
      references: planned.plan?.entries ?? [],
      cast: planned.cast,
      finalPrompt: planned.finalPrompt,
      promptEdited: planned.promptEdited,
      blockers: planned.blockers,
      warnings: planned.warnings,
      cost: costCard(settings.imageModel, quality, refs, settings.maxAttemptsPerPage),
    });
  });

  // ---- manual page upload (made elsewhere, e.g. ChatGPT; no API cost) ----
  r.add("POST", "/chapters/:id/pages/:page/upload", async ({ req, params }) => {
    const s = await requireAdmin(req);
    const id = chapterParam(params.id!);
    const page = pageNumber(params.page!);
    const c = await content(deps);
    const inv = await c.inventory(id).catch(() => null);
    const info = inv?.pages.find((p) => p.page === page);
    if (!info) throw notFound("Unknown chapter or page.");
    if (info.locked) throw conflict(`Page ${pad3(page)} is locked: ${info.lockReason ?? ""}`);
    const { form, data } = await readUpload(req);
    let checked;
    try {
      checked = await validateUpload(data, 4_000_000);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const ratio = checked.width / checked.height;
    if (Math.abs(ratio - 2 / 3) > 0.02) throw badRequest(`Pages are portrait 2:3 (1024 x 1536). This image is ${checked.width} x ${checked.height}.`);
    const sharp = (await import("sharp")).default;
    // Re-encode: strips metadata and anything that is not image data; sized like generated pages.
    const clean = await sharp(data).rotate().resize({ width: 1024, height: 1536, fit: "fill" }).png().toBuffer();
    const meta = await inspectImage(clean);
    const versionId = deps.newId();
    const blobPath = `studio/uploads/${id}/p${pad3(page)}/${versionId}.png`;
    await deps.blobs.put(blobPath, clean, "image/png");
    const note = (fields(form).note ?? "").trim().slice(0, 1000) || null;
    await deps.db.query(
      `INSERT INTO page_versions (id, chapter_id, page, job_id, attempt_id, source, blob_path, sha256, width, height, format, bytes, model, reference_manifest, settings, qa, qa_status,
                                  cost_estimate_usd, review_status, review_note, created_at, uploaded_by)
       VALUES ($1,$2,$3,NULL,NULL,'upload',$4,$5,$6,$7,$8,$9,NULL,'[]','{}',$10,'pending',0,'awaiting_review',$11,$12,$13)`,
      [
        versionId,
        id,
        page,
        blobPath,
        meta.sha256,
        meta.width,
        meta.height,
        meta.format,
        meta.bytes,
        JSON.stringify({ checks: [{ name: "Upload", status: "uncertain", detail: "Uploaded by hand. Automatic checks did not run; check it yourself before approving." }], disclaimer: "No automatic QA for uploads." }),
        note,
        deps.clock.now(),
        s.user,
      ],
    );
    await logEvent(deps.db, deps.clock.now(), { chapterId: id, page, level: "info", message: `${s.user} uploaded a version of page ${pad3(page)} for review.` });
    return json({ id: versionId }, 201);
  });

  // ---- spending and performance ----
  r.add("GET", "/spending", async ({ req }) => {
    await requireAdmin(req);
    return json(await spendingReport(deps));
  });

  r.add("PUT", "/spending/threshold", async ({ req }) => {
    await requireAdmin(req);
    const body = z.object({ attempts: z.number().int().min(2).max(50) }).safeParse(await readJson(req));
    if (!body.success) throw badRequest("Choose a number of attempts between 2 and 50.");
    await setStudioSetting(deps, "attempt_flag_threshold", body.data.attempts);
    return json({ ok: true });
  });

  // ---- create characters, arcs and chapters (pull requests) ----
  r.add("POST", "/create/character", async ({ req }) => {
    const s = await requireAdmin(req);
    const publisher = needPublisher(deps);
    const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
    let input: Record<string, string>;
    let sheet: Buffer | null = null;
    if (isForm) {
      const len = Number(req.headers.get("content-length") ?? "0");
      if (len > 4_400_000) throw new HttpError(413, "Upload must be under 4 MB.", "too_large");
      const form = await req.formData();
      input = fields(form);
      const f = form.get("file");
      if (f instanceof File && f.size > 0) sheet = Buffer.from(await f.arrayBuffer());
    } else input = (await readJson(req)) as Record<string, string>;
    const body = z
      .object({
        displayName: z.string().trim().min(2).max(80),
        id: z.string().regex(/^[a-z][a-z0-9-]{1,59}$/).optional().or(z.literal("")),
        role: z.string().trim().max(400).optional(),
        sheetLabel: z.string().trim().max(80).optional(),
      })
      .safeParse(input);
    if (!body.success) throw badRequest("Give the character a name (2 to 80 characters).", body.error.issues.map((i) => i.message));
    const id = body.data.id || slug(body.data.displayName);
    if (!id) throw badRequest("Choose a folder name using letters, numbers and dashes.");
    const chars = await studioCharacters(deps);
    if (chars.some((c) => c.id === id) || (await deps.repo.exists(`characters/${id}/index.md`))) throw conflict(`characters/${id} already exists.`);
    const template = (await deps.repo.readText("characters/_template/index.md")) ?? "# Character Name\n\nStatus: Draft\n";
    const index = template.replace(/^# .*$/m, `# ${body.data.displayName}`).replace(/^## Role\s*$/m, `## Role\n\n${body.data.role ?? ""}`.trimEnd());
    const files: PublishFile[] = [{ path: `characters/${id}/index.md`, content: Buffer.from(index.endsWith("\n") ? index : `${index}\n`) }];
    const refLines = [`# ${body.data.displayName}: Reference Images`, "", `Added in Reflections Studio by ${s.user}.`, ""];
    if (sheet) {
      try {
        await validateUpload(sheet, 4_000_000);
      } catch (err) {
        throw badRequest((err as Error).message);
      }
      const sharp = (await import("sharp")).default;
      const png = await sharp(sheet).rotate().png().toBuffer();
      const file = `${id}-reference-sheet-v1.png`;
      files.push({ path: `characters/${id}/references/${file}`, content: png });
      refLines.push("## Current Card", "", `- [${body.data.displayName} reference sheet](${file})`, "- Version: v1.", "");
      if (body.data.sheetLabel) refLines.push(`## Outfits`, "", `- [${body.data.sheetLabel} v1](${file})`, "");
    } else refLines.push("No sheet yet. Add one from the studio's character library or in a normal commit.", "");
    files.push({ path: `characters/${id}/references/index.md`, content: Buffer.from(refLines.join("\n")) });
    const res = await publisher.openPullRequest({
      branch: `studio/character-${id}-${stamp(deps)}`,
      title: `Add character: ${body.data.displayName}`,
      commitMessage: `Add character ${body.data.displayName}\n\nCreated in Reflections Studio.`,
      body: `Adds \`characters/${id}/\` from the character template${sheet ? " with a first reference sheet" : ""}. Created in Reflections Studio by ${s.user}. Merge to add them to the studio's character library.`,
      files,
      mustNotExist: files.map((f) => f.path),
    });
    await logEvent(deps.db, deps.clock.now(), { level: "info", message: `Pull request opened to add character ${body.data.displayName}.`, data: { prUrl: res.prUrl } });
    return json({ prUrl: res.prUrl, id }, 201);
  });

  r.add("POST", "/characters/:id/sheets", async ({ req, params }) => {
    const s = await requireAdmin(req);
    const publisher = needPublisher(deps);
    const id = z.string().regex(/^[a-z0-9-]+$/).parse(params.id);
    const chars = await studioCharacters(deps);
    const ch = chars.find((c) => c.id === id);
    if (!ch) throw notFound("Unknown character.");
    const { form, data } = await readUpload(req);
    const label = z.string().trim().min(2).max(80).safeParse(fields(form).label);
    if (!label.success) throw badRequest("Name the outfit (for example: Winter coat).");
    try {
      await validateUpload(data, 4_000_000);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const next = Math.max(0, ...ch.sheets.filter((x) => x.source === "references").map((x) => x.version ?? 0)) + 1;
    const file = `${id}-reference-sheet-v${next}.png`;
    const sharp = (await import("sharp")).default;
    const png = await sharp(data).rotate().png().toBuffer();
    const indexPath = `characters/${id}/references/index.md`;
    const current = (await publisher.readFile(indexPath)) ?? `# ${ch.displayName}: Reference Images\n`;
    const addition = `\n## Outfit v${next}: ${label.data}\n\n- [${label.data} v${next}](${file})\n- Added in Reflections Studio by ${s.user}.\n`;
    const res = await publisher.openPullRequest({
      branch: `studio/sheet-${id}-v${next}-${stamp(deps)}`,
      title: `Add ${ch.firstName}'s ${label.data} sheet (v${next})`,
      commitMessage: `Add ${ch.displayName} outfit sheet v${next}: ${label.data}\n\nAdded in Reflections Studio.`,
      body: `Adds \`characters/${id}/references/${file}\` and names it "${label.data}" in the references index. Existing sheets are untouched.`,
      files: [
        { path: `characters/${id}/references/${file}`, content: png },
        { path: indexPath, content: Buffer.from(`${current.trimEnd()}\n${addition}`) },
      ],
      mustNotExist: [`characters/${id}/references/${file}`],
    });
    return json({ prUrl: res.prUrl, file }, 201);
  });

  r.add("POST", "/create/arc", async ({ req }) => {
    const s = await requireAdmin(req);
    const publisher = needPublisher(deps);
    const body = z.object({ title: z.string().trim().min(2).max(100), focus: z.string().trim().max(1500).optional() }).safeParse(await readJson(req));
    if (!body.success) throw badRequest("Give the arc a title (2 to 100 characters).");
    const c = await content(deps);
    const arcs = await c.arcs();
    const number = Math.max(0, ...arcs.map((a) => a.number)) + 1;
    const id = `arc-${String(number).padStart(2, "0")}`;
    const md = [`# Arc ${String(number).padStart(2, "0")}: ${body.data.title}`, "", `Status: DRAFT, added in Reflections Studio by ${s.user}.`, "", "## Focus", "", body.data.focus || "TBD", "", "## Chapter Allocation", "", "None yet.", ""].join("\n");
    const res = await publisher.openPullRequest({
      branch: `studio/${id}-${stamp(deps)}`,
      title: `Add arc ${number}: ${body.data.title}`,
      commitMessage: `Add arc ${number}: ${body.data.title}\n\nCreated in Reflections Studio.`,
      body: `Adds \`stories/${id}/index.md\`. Created in Reflections Studio by ${s.user}.`,
      files: [{ path: `stories/${id}/index.md`, content: Buffer.from(md) }],
      mustNotExist: [`stories/${id}/index.md`],
    });
    return json({ prUrl: res.prUrl, id }, 201);
  });

  r.add("POST", "/create/chapter", async ({ req }) => {
    const s = await requireAdmin(req);
    const publisher = needPublisher(deps);
    const body = z
      .object({
        arcId: z.string().regex(/^arc-\d{2}$/),
        title: z.string().trim().min(2).max(120),
        logline: z.string().trim().max(1500).optional(),
        plannedPages: z.number().int().min(1).max(200),
        chapterId: z.string().regex(/^\d{3}$/).optional(),
      })
      .safeParse(await readJson(req));
    if (!body.success) throw badRequest("Check the chapter details.", body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    const c = await content(deps, true);
    const arcs = await c.arcs();
    const arc = arcs.find((a) => a.id === body.data.arcId);
    if (!arc) throw badRequest("Unknown arc.");
    const chapterId = body.data.chapterId ?? pad3(Math.max(0, ...c.chapterIds().map(Number)) + 1);
    if (c.chapterConfig(chapterId)) throw conflict(`Chapter ${chapterId} already exists in the studio config.`);
    const arcChapters = arc.chapterIds.length + 1;
    const storyDir = `stories/${arc.id}/chapter-${chapterId}`;
    const configText = await publisher.readFile("production/studio/config.json");
    if (!configText) throw new Error("production/studio/config.json is missing on the base branch.");
    const config = JSON.parse(configText) as { chapters: Record<string, unknown> };
    config.chapters[chapterId] = {
      arcId: arc.id,
      arcNumber: arc.number,
      arcTitle: arc.title,
      title: body.data.title,
      storyDir,
      revisionLabel: "",
      plannedPages: body.data.plannedPages,
      promptDir: "prompts",
      scriptFile: "script.md",
      identitySheetDirs: ["characters/_reference-sheets/main_characters", "characters/_reference-sheets/main_characters/children"],
      lockedPages: "",
      lockReason: "Locked.",
      unpreparedPages: "",
      unpreparedReason: "Not prepared yet.",
      sourcePagePattern: `pages/A${String(arc.number).padStart(2, "0")}-C${chapterId}-P{page}.png`,
      publishedDir: `site/pages/chapter-${chapterId}`,
      publishedSrcPrefix: `/pages/chapter-${chapterId}/`,
    };
    const files: PublishFile[] = [{ path: "production/studio/config.json", content: Buffer.from(`${JSON.stringify(config, null, 2)}\n`) }];
    for (const entry of await deps.repo.walk("stories/_chapter-template")) {
      const rel = entry.path.slice("stories/_chapter-template/".length);
      let text = (await deps.repo.readText(entry.path)) ?? "";
      if (rel === "outline.md") text = text.replace(/## Title\s*\n\s*\n\s*Untitled/, `## Title\n\n${body.data.title}`).replace(/## Logline\s*\n\s*\n\s*TBD/, `## Logline\n\n${body.data.logline || "TBD"}`);
      files.push({ path: `${storyDir}/${rel}`, content: Buffer.from(text) });
    }
    const res = await publisher.openPullRequest({
      branch: `studio/chapter-${chapterId}-${stamp(deps)}`,
      title: `Add chapter ${chapterId}: ${body.data.title}`,
      commitMessage: `Add chapter ${chapterId}: ${body.data.title}\n\nCreated in Reflections Studio.`,
      body: [
        `Adds chapter ${chapterId} (arc ${arc.number}, chapter ${arcChapters} of the arc) to the studio config and creates \`${storyDir}/\` from the chapter template.`,
        ``,
        `Next: write the script and page prompts in that folder (\`script.md\`, \`prompts/page-001-v1.txt\` and so on). The reader entry in \`site/js/chapters.js\` is added when the first pages are published.`,
        ``,
        `Created in Reflections Studio by ${s.user}.`,
      ].join("\n"),
      files,
      mustNotExist: files.filter((f) => f.path !== "production/studio/config.json").map((f) => f.path),
    });
    return json({ prUrl: res.prUrl, chapterId }, 201);
  });

  // ---- public site images: show / hide, album additions ----
  r.add("GET", "/site/images", async ({ req }) => {
    await requireAdmin(req);
    const [charactersHtml, memoriesHtml, visibilityJs] = await Promise.all([deps.repo.readText("site/characters.html"), deps.repo.readText("site/memories.html"), deps.repo.readText(VISIBILITY_PATH)]);
    const drafts = await deps.db.query(`SELECT id, title, alt, wide, width, height, status, pr_url, created_at FROM album_items WHERE status <> 'removed' ORDER BY created_at`);
    return json({
      characters: parseCharacterGalleries(charactersHtml ?? ""),
      album: parseAlbum(memoriesHtml ?? ""),
      visibility: parseVisibility(visibilityJs ?? ""),
      drafts,
      publisherReady: !!deps.publisher,
    });
  });

  r.add("POST", "/site/album-items", async ({ req }) => {
    const s = await requireAdmin(req);
    const { form, data } = await readUpload(req);
    const meta = z.object({ title: z.string().trim().min(2).max(80), alt: z.string().trim().min(20).max(600) }).safeParse(fields(form));
    if (!meta.success) throw badRequest("Give the photo a short caption and a description of at least 20 characters for screen readers.");
    let info;
    try {
      info = await validateUpload(data, 4_000_000);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const id = deps.newId();
    const sharp = (await import("sharp")).default;
    const clean = await sharp(data).rotate().png().toBuffer();
    await deps.blobs.put(`studio/album/${id}.png`, clean, "image/png");
    const wide = info.width / info.height > 1.7;
    await deps.db.query(`INSERT INTO album_items (id, title, alt, wide, width, height, blob_path, status, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9)`, [
      id,
      meta.data.title,
      meta.data.alt,
      wide,
      info.width,
      info.height,
      `studio/album/${id}.png`,
      s.user,
      deps.clock.now(),
    ]);
    return json({ id }, 201);
  });

  r.add("DELETE", "/site/album-items/:id", async ({ req, params }) => {
    await requireAdmin(req);
    const id = z.string().uuid().parse(params.id);
    await deps.db.query(`UPDATE album_items SET status = 'removed' WHERE id = $1 AND status = 'draft'`, [id]);
    return json({ ok: true });
  });

  r.add("GET", "/site/album-items/:id/image", async ({ req, params }) => {
    await requireAdmin(req);
    const row = await one<{ blob_path: string }>(deps.db, `SELECT blob_path FROM album_items WHERE id = $1`, [z.string().uuid().parse(params.id)]);
    if (!row) throw notFound();
    const obj = await deps.blobs.get(row.blob_path);
    if (!obj) throw notFound();
    return new Response(new Uint8Array(await thumbnail(obj.data, 480)), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=3600" } });
  });

  r.add("POST", "/site/publish", async ({ req }) => {
    const s = await requireAdmin(req);
    const publisher = needPublisher(deps);
    const body = z
      .object({
        hidden: z.object({ characters: z.record(z.string().regex(/^[a-z0-9-]+$/), z.array(z.string().regex(/^\/images\/[\w./-]+\.(webp|png|jpe?g)$/i)).max(200)), album: z.array(z.string().regex(/^\/images\/[\w./-]+\.(webp|png|jpe?g)$/i)).max(200) }),
        addAlbumItems: z.array(z.string().uuid()).max(20).default([]),
        confirm: z.literal(true),
      })
      .safeParse(await readJson(req));
    if (!body.success) throw badRequest("Check the site image changes.", body.error.issues.map((i) => i.message));
    const currentJs = (await publisher.readFile(VISIBILITY_PATH)) ?? "";
    const current = parseVisibility(currentJs);
    const files: PublishFile[] = [];
    const additions = [...current.albumAdditions];
    const items = body.data.addAlbumItems.length
      ? await deps.db.query<{ id: string; title: string; alt: string; wide: boolean; blob_path: string }>(`SELECT id, title, alt, wide, blob_path FROM album_items WHERE id = ANY($1::uuid[]) AND status = 'draft'`, [body.data.addAlbumItems])
      : [];
    const sharp = (await import("sharp")).default;
    for (const it of items) {
      const obj = await deps.blobs.get(it.blob_path);
      if (!obj) continue;
      const base = `${slug(it.title) || "photo"}-${it.id.slice(0, 6)}`;
      const full = await sharp(obj.data).resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
      const small = await sharp(obj.data).resize({ width: 800, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      const fullMeta = await inspectImage(full);
      const smallMeta = await inspectImage(small);
      files.push({ path: `site/images/moments/${base}-full.webp`, content: full }, { path: `site/images/memories/${base}-800.webp`, content: small });
      additions.push({ src: `/images/memories/${base}-800.webp`, full: `/images/moments/${base}-full.webp`, w: fullMeta.width, h: fullMeta.height, thumbW: smallMeta.width, thumbH: smallMeta.height, title: it.title, alt: it.alt, wide: it.wide });
    }
    const next = { hidden: body.data.hidden, albumAdditions: additions };
    files.push({ path: VISIBILITY_PATH, content: Buffer.from(visibilityJs(next)) });
    const hiddenCount = Object.values(next.hidden.characters).reduce((n, l) => n + l.length, 0) + next.hidden.album.length;
    const res = await publisher.openPullRequest({
      branch: `studio/site-images-${stamp(deps)}`,
      title: `Update site images${items.length ? `: add ${items.length} album photo(s)` : ""}`,
      commitMessage: `Update which site images are shown\n\nChanged in Reflections Studio.`,
      body: [
        `Changes made in Reflections Studio by ${s.user}.`,
        ``,
        `- ${hiddenCount} image(s) hidden across the character galleries and the Memories album (nothing is deleted; hidden images stay in the repository).`,
        items.length ? `- ${items.length} new album photo(s), added at the end of the Memories album.` : `- No new album photos.`,
        ``,
        `Only \`${VISIBILITY_PATH}\`${items.length ? " and the new image files" : ""} change. Merging deploys it.`,
      ].join("\n"),
      files,
      mustNotExist: files.filter((f) => f.path !== VISIBILITY_PATH).map((f) => f.path),
    });
    if (items.length) await deps.db.query(`UPDATE album_items SET status = 'pr_open', pr_url = $2 WHERE id = ANY($1::uuid[])`, [items.map((i) => i.id), res.prUrl]);
    return json({ prUrl: res.prUrl }, 201);
  });
}

function needPublisher(deps: StudioDeps) {
  if (!deps.publisher) throw forbidden("GITHUB_TOKEN is not configured, so changes to the repository are unavailable.");
  return deps.publisher;
}

function stamp(deps: StudioDeps) {
  return deps.clock.now().toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

/** What one generation costs and what the budget means, in plain words, for the Generate screen. */
export function costCard(model: string, quality: keyof typeof OUTPUT_TOKENS_ASSUMED, referenceImages: number, maxAttempts: number) {
  const p = pricingFor(model);
  const per = p ? estimatePageCost(model, quality, referenceImages) : null;
  const byQuality = p ? (Object.keys(OUTPUT_TOKENS_ASSUMED) as (keyof typeof OUTPUT_TOKENS_ASSUMED)[]).map((q) => ({ quality: q, usd: estimatePageCost(model, q, referenceImages).totalUsd })) : [];
  return {
    model,
    pricingSource: p?.source ?? null,
    pricingCheckedOn: p?.verifiedOn ?? null,
    perAttemptUsd: per?.totalUsd ?? null,
    worstCasePageUsd: per ? per.totalUsd * maxAttempts : null,
    byQuality,
    referenceImages,
    knownModels: Object.keys(IMAGE_PRICING),
  };
}

export async function spendingReport(deps: StudioDeps) {
  const since = new Date(deps.clock.now());
  since.setUTCMonth(since.getUTCMonth() - 11, 1);
  since.setUTCHours(0, 0, 0, 0);
  const months = await deps.db.query<{ month: string; kind: string; attempts: number; estimate: number; reported: number; input_tokens: number; output_tokens: number }>(
    `SELECT to_char(date_trunc('month', started_at), 'YYYY-MM') AS month, kind, count(*)::int AS attempts,
            COALESCE(sum(cost_estimate_usd), 0)::float AS estimate, COALESCE(sum(cost_reported_usd), 0)::float AS reported,
            COALESCE(sum((usage ->> 'input_tokens')::bigint), 0)::float AS input_tokens, COALESCE(sum((usage ->> 'output_tokens')::bigint), 0)::float AS output_tokens
       FROM generation_attempts WHERE started_at >= $1 GROUP BY 1, 2 ORDER BY 1`,
    [since],
  );
  const pagesByMonth = await deps.db.query<{ month: string; generated: number; uploaded: number; used: number }>(
    `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
            count(*) FILTER (WHERE source = 'generated')::int AS generated,
            count(*) FILTER (WHERE source = 'upload')::int AS uploaded,
            count(*) FILTER (WHERE review_status = 'approved' OR publication_status <> 'unpublished' OR (review_status = 'superseded' AND reviewed_at IS NOT NULL))::int AS used
       FROM page_versions WHERE created_at >= $1 GROUP BY 1 ORDER BY 1`,
    [since],
  );
  const perPage = await deps.db.query<{ chapter_id: string; page: number; attempts: number; versions: number; accepted: number; spent: number }>(
    `SELECT a.chapter_id, a.page, count(*)::int AS attempts,
            (SELECT count(*)::int FROM page_versions v WHERE v.chapter_id = a.chapter_id AND v.page = a.page AND v.source = 'generated') AS versions,
            (SELECT count(*)::int FROM page_versions v WHERE v.chapter_id = a.chapter_id AND v.page = a.page AND (v.review_status = 'approved' OR v.publication_status <> 'unpublished')) AS accepted,
            COALESCE(sum(COALESCE(a.cost_reported_usd, a.cost_estimate_usd)), 0)::float AS spent
       FROM generation_attempts a WHERE a.kind = 'image' GROUP BY a.chapter_id, a.page ORDER BY a.chapter_id, a.page`,
  );
  const threshold = await getStudioSetting(deps, "attempt_flag_threshold", ATTEMPT_FLAG_DEFAULT);
  const monthKeys: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(since);
    d.setUTCMonth(since.getUTCMonth() + i);
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const byMonth = monthKeys.map((m) => {
    const rows = months.filter((r) => r.month === m);
    const pages = pagesByMonth.find((r) => r.month === m);
    return {
      month: m,
      imageAttempts: rows.filter((r) => r.kind === "image").reduce((n, r) => n + r.attempts, 0),
      estimateUsd: rows.reduce((n, r) => n + r.estimate, 0),
      reportedUsd: rows.reduce((n, r) => n + r.reported, 0),
      inputTokens: rows.reduce((n, r) => n + r.input_tokens, 0),
      outputTokens: rows.reduce((n, r) => n + r.output_tokens, 0),
      pagesGenerated: pages?.generated ?? 0,
      pagesUploaded: pages?.uploaded ?? 0,
      pagesUsed: pages?.used ?? 0,
    };
  });
  const accepted = perPage.filter((p) => p.accepted > 0);
  const flags = perPage
    .filter((p) => p.attempts >= threshold)
    .map((p) => ({
      chapterId: p.chapter_id,
      page: p.page,
      attempts: p.attempts,
      accepted: p.accepted > 0,
      spentUsd: p.spent,
      message: p.accepted > 0 ? `Took ${p.attempts} attempts to get one you kept. Consider revising this page's prompt.` : `${p.attempts} attempts and none kept yet. Revise the prompt or outfit choices before trying again.`,
    }));
  return {
    byMonth,
    totals: {
      estimateUsd: byMonth.reduce((n, m) => n + m.estimateUsd, 0),
      reportedUsd: byMonth.reduce((n, m) => n + m.reportedUsd, 0),
      inputTokens: byMonth.reduce((n, m) => n + m.inputTokens, 0),
      outputTokens: byMonth.reduce((n, m) => n + m.outputTokens, 0),
      pagesGenerated: byMonth.reduce((n, m) => n + m.pagesGenerated, 0),
      pagesUsed: byMonth.reduce((n, m) => n + m.pagesUsed, 0),
    },
    attemptsPerAcceptedPage: accepted.length ? accepted.reduce((n, p) => n + p.attempts, 0) / accepted.length : null,
    threshold,
    flags,
    note: "Dollar amounts are estimates (and, where OpenAI reported token usage, costs calculated from it). Your OpenAI billing page is the real bill.",
  };
}

export function versionSummary(v: VersionRow) {
  return {
    id: v.id,
    page: v.page,
    chapterId: v.chapter_id,
    jobId: v.job_id,
    source: v.source,
    model: v.model,
    width: v.width,
    height: v.height,
    qaStatus: v.qa_status,
    qaConfidence: v.qa_confidence,
    qa: v.qa,
    reviewStatus: v.review_status,
    publicationStatus: v.publication_status,
    retryCount: v.retry_count,
    costEstimateUsd: v.cost_estimate_usd,
    altText: v.alt_text,
    reviewNote: v.review_note,
    references: v.reference_manifest,
    promptEdited: v.prompt_edited ?? false,
    uploadedBy: v.uploaded_by ?? null,
    createdAt: v.created_at,
    reviewedAt: v.reviewed_at,
  };
}

// ---- site HTML parsing (the pages are static HTML; the full-size path is the key) ----
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? m[1]!.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&") : null;
};

export function parseCharacterGalleries(html: string) {
  const out: { id: string; name: string; images: { href: string; thumb: string | null; alt: string | null }[] }[] = [];
  const articleRe = /<article[^>]*class="[^"]*\bchar\b[^"]*"[^>]*id="([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/article>|<article[^>]*id="([a-z0-9-]+)"[^>]*class="[^"]*\bchar\b[^"]*"[^>]*>([\s\S]*?)<\/article>/g;
  let m: RegExpExecArray | null;
  while ((m = articleRe.exec(html)) !== null) {
    const id = m[1] ?? m[3]!;
    const body = m[2] ?? m[4]!;
    const name = /<h[23][^>]*>([^<]+)</.exec(body)?.[1]?.trim() ?? id;
    const strip = /<ul class="gal-strip"[\s\S]*?<\/ul>/.exec(body)?.[0] ?? "";
    const images = [...strip.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>\s*(<img[^>]*>)/g)].map((x) => ({ href: x[1]!, thumb: attr(x[2]!, "src"), alt: attr(x[0], "data-alt") ?? attr(x[2]!, "alt") }));
    if (images.length) out.push({ id, name, images });
  }
  return out;
}

export function parseAlbum(html: string) {
  return [...html.matchAll(/<a class="snap-link"([^>]*)>\s*(<img[^>]*>)/g)].map((x) => ({ href: attr(x[1]!, "href")!, title: attr(x[1]!, "data-title"), thumb: attr(x[2]!, "src"), alt: attr(x[2]!, "alt") }));
}

export interface AlbumAddition {
  src: string;
  full: string;
  w: number;
  h: number;
  thumbW?: number;
  thumbH?: number;
  title: string;
  alt: string;
  wide?: boolean;
}

export interface SiteVisibility {
  hidden: { characters: Record<string, string[]>; album: string[] };
  albumAdditions: AlbumAddition[];
}

export function parseVisibility(js: string): SiteVisibility {
  const empty: SiteVisibility = { hidden: { characters: {}, album: [] }, albumAdditions: [] };
  const start = js.indexOf("window.REFLECTIONS_VISIBILITY = ");
  if (start < 0) return empty;
  const body = js.slice(start + "window.REFLECTIONS_VISIBILITY = ".length).trim().replace(/;\s*$/, "");
  try {
    const v = JSON.parse(body) as Partial<SiteVisibility>;
    return { hidden: { characters: v.hidden?.characters ?? {}, album: v.hidden?.album ?? [] }, albumAdditions: v.albumAdditions ?? [] };
  } catch {
    return empty;
  }
}

export function visibilityJs(v: SiteVisibility): string {
  return [
    "// Managed by Reflections Studio (Studio > Site images). Each change arrives as a",
    "// reviewed pull request; editing by hand in a normal commit also works.",
    "// hidden.characters: character id -> full-size image paths to leave out of that gallery.",
    "// hidden.album: full-size image paths to leave out of the Memories album.",
    "// albumAdditions: photos added to the end of the Memories album.",
    `window.REFLECTIONS_VISIBILITY = ${JSON.stringify(v, null, 2)};`,
    "",
  ].join("\n");
}

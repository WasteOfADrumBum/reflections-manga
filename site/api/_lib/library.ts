import { z } from "zod";
import type { Session } from "./auth/auth.js";
import type { StudioDeps } from "./context.js";
import { content } from "./context.js";
import { findSheet, MANIFEST_PATH, OUTFIT_CATEGORIES, parseManifest } from "./content/characters.js";
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
import { repoArtPages } from "./publish/repo-art.js";

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
const SHEET_SOURCES_PATH = "production/studio/site-sheet-sources.json";
export const slug = (s: string) =>
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
    return json({ pages: [...pages.values()], repoArt: await repoArtPages(deps), chapters, publisherReady: !!deps.publisher });
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
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > 4_400_000) throw new HttpError(413, "Upload must be under 4 MB.", "too_large");
    if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) throw badRequest("Send the character with its main reference sheet.");
    const form = await req.formData();
    const f = form.get("file");
    const sheet = f instanceof File && f.size > 0 ? Buffer.from(await f.arrayBuffer()) : null;
    const manifestText = await publisher.readFile(MANIFEST_PATH);
    const manifest = parseManifest(manifestText);
    const groups = Object.keys(manifest?.characterGroups ?? { main: 1, friends: 1 });
    const body = z
      .object({
        displayName: z.string().trim().min(2).max(80),
        id: z.string().regex(/^[a-z][a-z0-9-]{1,59}$/).optional().or(z.literal("")),
        group: z.string().refine((g) => groups.includes(g), "Choose a cast group."),
        role: z.string().trim().max(400).optional(),
      })
      .safeParse(fields(form));
    if (!body.success) throw badRequest("Give the character a name and a cast group.", body.error.issues.map((i) => i.message));
    // Every character in the manifest has exactly one main reference, so the first sheet is required.
    if (!sheet) throw badRequest("Add the character's main reference sheet. Every character needs one.");
    const id = body.data.id || slug(body.data.displayName);
    if (!id) throw badRequest("Choose a folder name using letters, numbers and dashes.");
    const chars = await studioCharacters(deps);
    const dir = `characters/${body.data.group}/${id}`;
    if (chars.some((c) => c.id === id) || (await deps.repo.exists(`${dir}/index.md`))) throw conflict(`A character with the id ${id} already exists.`);
    let png: Buffer;
    try {
      await validateUpload(sheet, 4_000_000);
      png = await (await import("sharp")).default(sheet).rotate().png().toBuffer();
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const template = (await deps.repo.readText("characters/_template/index.md")) ?? "# Character Name\n\nStatus: Draft\n";
    const index = template.replace(/^# .*$/m, `# ${body.data.displayName}`).replace(/^## Role\s*$/m, `## Role\n\n${body.data.role ?? ""}`.trimEnd());
    const mainFile = `${id}-reference-main.png`;
    const files: PublishFile[] = [
      { path: `${dir}/index.md`, content: Buffer.from(index.endsWith("\n") ? index : `${index}\n`) },
      { path: `${dir}/references/${mainFile}`, content: png },
      {
        path: `${dir}/references/index.md`,
        content: Buffer.from([`# ${body.data.displayName}: Reference Images`, "", `Added in Reflections Studio by ${s.user}.`, "", "## Current Card", "", `- [${body.data.displayName} main reference](${mainFile})`, ""].join("\n")),
      },
      { path: `${dir}/outfits/index.md`, content: Buffer.from(`# ${id}: Outfit Library\n\n- [Main reference](../references/${mainFile})\n\n| Category | Outfit sheet | Review |\n|---|---|---|\n`) },
    ];
    if (manifest && manifestText) {
      const next = await withAsset(manifestText, { path: `${dir}/references/${mainFile}`, data: png, characterId: id, role: "main", category: "casual", characterPath: dir, user: s.user }, { group: body.data.group, id });
      files.push({ path: MANIFEST_PATH, content: Buffer.from(next) });
    }
    const res = await publisher.openPullRequest({
      branch: `studio/character-${id}-${stamp(deps)}`,
      title: `Add character: ${body.data.displayName}`,
      commitMessage: `Add character ${body.data.displayName}\n\nCreated in Reflections Studio.`,
      body: `Adds \`${dir}/\` from the character template with a main reference sheet${manifest ? ", and registers both in `characters/asset-manifest.json`" : ""}. Created in Reflections Studio by ${s.user}. Merge to add them to the studio's character library.`,
      files,
      mustNotExist: files.filter((x) => x.path !== MANIFEST_PATH).map((x) => x.path),
    });
    await logEvent(deps.db, deps.clock.now(), { level: "info", message: `Pull request opened to add character ${body.data.displayName}.`, data: { prUrl: res.prUrl } });
    return json({ prUrl: res.prUrl, id, dir }, 201);
  });

  r.add("POST", "/characters/:id/sheets", async ({ req, params }) => {
    const s = await requireAdmin(req);
    const publisher = needPublisher(deps);
    const id = z.string().regex(/^[a-z0-9-]+$/).parse(params.id);
    const chars = await studioCharacters(deps);
    const ch = chars.find((c) => c.id === id);
    if (!ch) throw notFound("Unknown character.");
    const { form, data } = await readUpload(req);
    const manifestText = await publisher.readFile(MANIFEST_PATH);
    const manifest = parseManifest(manifestText);
    const categories = manifest?.categories?.length ? manifest.categories : OUTFIT_CATEGORIES;
    const input = z.object({ label: z.string().trim().min(2).max(80), category: z.string().refine((c) => categories.includes(c), "Choose a category.") }).safeParse(fields(form));
    if (!input.success) throw badRequest("Name the outfit (for example: Winter coat) and choose its category.");
    let png: Buffer;
    try {
      await validateUpload(data, 4_000_000);
      png = await (await import("sharp")).default(data).rotate().png().toBuffer();
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    // Outfit files are named <id>-<category>-<descriptor>.png, as in the rest of the library.
    let file = `${id}-${input.data.category}-${slug(input.data.label) || "outfit"}.png`;
    for (let n = 2; ch.sheets.some((x) => x.file === file); n++) file = `${id}-${input.data.category}-${slug(input.data.label) || "outfit"}-v${n}.png`;
    const path = `${ch.dir}/outfits/${file}`;
    const indexPath = `${ch.dir}/outfits/index.md`;
    const currentIndex = (await publisher.readFile(indexPath)) ?? `# ${id}: Outfit Library\n\n| Category | Outfit sheet | Review |\n|---|---|---|\n`;
    const row = `| ${input.data.category} | [${file.replace(/\.png$/, "")}](${file}) | Added in Reflections Studio by ${s.user}. |`;
    const files: PublishFile[] = [
      { path, content: png },
      { path: indexPath, content: Buffer.from(`${currentIndex.trimEnd()}\n${row}\n`) },
    ];
    if (manifest && manifestText) files.push({ path: MANIFEST_PATH, content: Buffer.from(await withAsset(manifestText, { path, data: png, characterId: id, role: "outfit", category: input.data.category, characterPath: ch.dir, user: s.user })) });
    const res = await publisher.openPullRequest({
      branch: `studio/outfit-${id}-${stamp(deps)}`,
      title: `Add ${ch.firstName}'s ${input.data.label} outfit sheet`,
      commitMessage: `Add ${ch.displayName} outfit sheet: ${input.data.label}\n\nAdded in Reflections Studio.`,
      body: `Adds \`${path}\` (${input.data.category}), lists it in the outfit library${manifest ? " and registers it in `characters/asset-manifest.json`" : ""}. Existing sheets are untouched.`,
      files,
      mustNotExist: [path],
    });
    return json({ prUrl: res.prUrl, file, path }, 201);
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

  // ---- public site images: show / hide, sheets from the repository, album order and captions ----
  r.add("GET", "/site/images", async ({ req }) => {
    await requireAdmin(req);
    const [charactersHtml, memoriesHtml, visibilityText, sourcesText, chars] = await Promise.all([
      deps.repo.readText("site/characters.html"),
      deps.repo.readText("site/memories.html"),
      deps.repo.readText(VISIBILITY_PATH),
      deps.repo.readText(SHEET_SOURCES_PATH),
      studioCharacters(deps),
    ]);
    const drafts = await deps.db.query(`SELECT id, title, alt, wide, width, height, status, pr_url, created_at FROM album_items WHERE status <> 'removed' ORDER BY created_at`);
    const onSite = new Set(Object.values(parseSheetSources(sourcesText)));
    // Every repository sheet not on the public site yet, so it can be added (hidden by default).
    const sheets = chars
      .map((c) => ({
        id: c.id,
        name: c.displayName,
        sheets: c.sheets.filter((s) => !onSite.has(s.path)).map((s) => ({ path: s.path, label: s.label, category: s.needsReview ? null : s.category, needsReview: s.needsReview, sensitive: s.sensitive })),
      }))
      .filter((c) => c.sheets.length);
    return json({
      characters: parseCharacterGalleries(charactersHtml ?? ""),
      album: parseAlbum(memoriesHtml ?? ""),
      visibility: parseVisibility(visibilityText ?? ""),
      sheets,
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
    const href = z.string().regex(/^\/images\/[\w./-]+\.(webp|png|jpe?g)$/i);
    const body = z
      .object({
        hidden: z.object({ characters: z.record(z.string().regex(/^[a-z0-9-]+$/), z.array(href).max(300)), album: z.array(href).max(300) }),
        sensitive: z.array(href).max(600).default([]),
        album: z
          .object({
            order: z.array(href).max(300).default([]),
            captions: z.record(href, z.object({ title: z.string().trim().max(80).optional(), alt: z.string().trim().max(600).optional() })).default({}),
          })
          .default({ order: [], captions: {} }),
        addSheets: z.array(z.object({ characterId: z.string().regex(/^[a-z0-9-]+$/), path: z.string().max(300), sensitive: z.boolean().default(false) })).max(40).default([]),
        addAlbumItems: z.array(z.string().uuid()).max(20).default([]),
        confirm: z.literal(true),
      })
      .safeParse(await readJson(req, 512_000));
    if (!body.success) throw badRequest("Check the site image changes.", body.error.issues.map((i) => i.message));
    const currentJs = (await publisher.readFile(VISIBILITY_PATH)) ?? "";
    const current = parseVisibility(currentJs);
    const files: PublishFile[] = [];
    const sharp = (await import("sharp")).default;

    // Album photos uploaded in the studio.
    const additions = [...current.albumAdditions];
    const items = body.data.addAlbumItems.length
      ? await deps.db.query<{ id: string; title: string; alt: string; wide: boolean; blob_path: string }>(`SELECT id, title, alt, wide, blob_path FROM album_items WHERE id = ANY($1::uuid[]) AND status = 'draft'`, [body.data.addAlbumItems])
      : [];
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

    // Character sheets from the repository, added to that character's public gallery.
    const sensitive = new Set(body.data.sensitive);
    const characterAdditions: Record<string, CharacterAddition[]> = Object.fromEntries(Object.entries(current.characterAdditions).map(([k, v]) => [k, [...v]]));
    const sourcesText = await publisher.readFile(SHEET_SOURCES_PATH);
    const sources = parseSheetSources(sourcesText);
    if (body.data.addSheets.length) {
      const chars = await studioCharacters(deps);
      for (const add of body.data.addSheets) {
        const ch = chars.find((c) => c.id === add.characterId);
        const sheet = ch?.sheets.find((x) => x.path === add.path);
        if (!ch || !sheet) throw badRequest(`That sheet is not one of ${add.characterId}'s sheets.`);
        if (Object.values(sources).includes(sheet.path)) continue;
        const data = await deps.repo.readBinary(sheet.path);
        if (!data) throw badRequest(`Could not read ${sheet.path} from the repository.`);
        const stem = sheet.file.replace(/\.(png|webp|jpe?g)$/i, "");
        const fullPath = `site/images/characters/refs/${stem}.webp`;
        const thumbPath = `site/images/characters/refs/${stem}-thumb.webp`;
        const full = await sharp(data).resize({ width: 1536, height: 1536, fit: "inside", withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
        const thumb = await sharp(data).resize({ height: 240, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
        const fullMeta = await inspectImage(full);
        const thumbMeta = await inspectImage(thumb);
        files.push({ path: fullPath, content: full }, { path: thumbPath, content: thumb });
        const what = sheet.isDefault ? "main reference sheet" : `${sheet.needsReview ? "outfit" : (sheet.category ?? "outfit")} sheet, ${sheet.label}`;
        const fullHref = `/${fullPath.slice("site/".length)}`;
        (characterAdditions[ch.id] ??= []).push({
          src: `/${thumbPath.slice("site/".length)}`,
          full: fullHref,
          w: fullMeta.width,
          h: fullMeta.height,
          thumbW: thumbMeta.width,
          thumbH: thumbMeta.height,
          label: sheet.label,
          alt: `${ch.displayName} ${what}: front, three-quarter and back views, plus facial expressions.`,
        });
        sources[fullHref] = sheet.path;
        if (add.sensitive) sensitive.add(fullHref);
      }
      files.push({ path: SHEET_SOURCES_PATH, content: Buffer.from(sheetSourcesJson(sourcesText, sources)) });
    }

    const captions: Record<string, { title?: string; alt?: string }> = {};
    for (const [k, v] of Object.entries(body.data.album.captions)) {
      const c: { title?: string; alt?: string } = {};
      if (v.title) c.title = v.title;
      if (v.alt && v.alt.length >= 20) c.alt = v.alt;
      if (c.title || c.alt) captions[k] = c;
    }
    const next: SiteVisibility = {
      hidden: body.data.hidden,
      sensitive: [...sensitive].sort(),
      album: { order: body.data.album.order, captions },
      characterAdditions,
      albumAdditions: additions,
    };
    files.push({ path: VISIBILITY_PATH, content: Buffer.from(visibilityJs(next)) });
    const hiddenCount = Object.values(next.hidden.characters).reduce((n, l) => n + l.length, 0) + next.hidden.album.length;
    const sheetCount = body.data.addSheets.length;
    const res = await publisher.openPullRequest({
      branch: `studio/site-images-${stamp(deps)}`,
      title: `Update site images${sheetCount ? `: add ${sheetCount} sheet(s)` : ""}${items.length ? `${sheetCount ? "," : ":"} add ${items.length} album photo(s)` : ""}`,
      commitMessage: `Update which site images are shown\n\nChanged in Reflections Studio.`,
      body: [
        `Changes made in Reflections Studio by ${s.user}.`,
        ``,
        `- ${hiddenCount} image(s) hidden across the character galleries and the Memories album (nothing is deleted; hidden images stay in the repository).`,
        `- ${next.sensitive.length} image(s) blurred until the reader confirms they are 18 or older.`,
        sheetCount ? `- ${sheetCount} character sheet(s) from the repository added to the galleries.` : null,
        items.length ? `- ${items.length} new album photo(s), added to the Memories album.` : null,
        next.album.order.length ? `- Memories album order set in the studio.` : null,
        Object.keys(captions).length ? `- ${Object.keys(captions).length} album caption(s) or description(s) changed.` : null,
        ``,
        `\`${VISIBILITY_PATH}\`${files.length > 1 ? " and the new image files" : ""} change. Merging deploys it.`,
      ]
        .filter((l) => l !== null)
        .join("\n"),
      files,
      mustNotExist: files.filter((f) => f.path !== VISIBILITY_PATH && f.path !== SHEET_SOURCES_PATH).map((f) => f.path),
    });
    if (items.length) await deps.db.query(`UPDATE album_items SET status = 'pr_open', pr_url = $2 WHERE id = ANY($1::uuid[])`, [items.map((i) => i.id), res.prUrl]);
    return json({ prUrl: res.prUrl }, 201);
  });
}

/**
 * Adds one image to characters/asset-manifest.json in the shape
 * tools/validate-character-assets.py checks: real hash, size and PNG
 * dimensions, and an originalPath that is not a real repository path (so the
 * validator's stale-path check never flags links to the new file).
 */
export async function withAsset(
  manifestText: string,
  a: { path: string; data: Buffer; characterId: string; role: "main" | "outfit"; category: string; characterPath: string; user: string },
  addToGroup?: { group: string; id: string },
): Promise<string> {
  const m = JSON.parse(manifestText) as { assets: Record<string, unknown>[]; characterGroups?: Record<string, { characterIds: string[] }> };
  const meta = await inspectImage(a.data);
  m.assets.push({
    path: a.path,
    sha256: meta.sha256,
    dimensions: [meta.width, meta.height],
    size: a.data.byteLength,
    originalPath: `studio-upload:${a.path.split("/").pop()}`,
    characterId: a.characterId,
    role: a.role,
    category: a.category,
    evidence: `Uploaded in Reflections Studio by ${a.user}; category chosen there. No master-art approval inferred.`,
    review: null,
    legacyAliases: [],
    characterPath: a.characterPath,
  });
  if (addToGroup && m.characterGroups?.[addToGroup.group] && !m.characterGroups[addToGroup.group]!.characterIds.includes(addToGroup.id)) m.characterGroups[addToGroup.group]!.characterIds.push(addToGroup.id);
  return `${JSON.stringify(m, null, 2)}\n`;
}

export function needPublisher(deps: StudioDeps) {
  if (!deps.publisher) throw forbidden("GITHUB_TOKEN is not configured, so changes to the repository are unavailable.");
  return deps.publisher;
}

export function stamp(deps: StudioDeps) {
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
  return [...html.matchAll(/<figure class="([^"]*)">\s*<a class="snap-link"([^>]*)>\s*(<img[^>]*>)/g)].map((x) => ({
    href: attr(x[2]!, "href")!,
    title: attr(x[2]!, "data-title"),
    thumb: attr(x[3]!, "src"),
    alt: attr(x[3]!, "alt"),
    shape: /\bsnap-tall\b/.test(x[1]!) ? "tall" : /\bsnap-wide\b/.test(x[1]!) ? "wide" : "normal",
  }));
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

/** A repository sheet added to a character's public gallery from the studio. */
export interface CharacterAddition {
  src: string;
  full: string;
  w: number;
  h: number;
  thumbW?: number;
  thumbH?: number;
  label: string;
  alt: string;
}

export interface SiteVisibility {
  hidden: { characters: Record<string, string[]>; album: string[] };
  /** Full-size image paths blurred until the reader confirms they are 18 or older. */
  sensitive: string[];
  /** Memories album: photo order (full-size paths) and edited captions and descriptions. */
  album: { order: string[]; captions: Record<string, { title?: string; alt?: string }> };
  characterAdditions: Record<string, CharacterAddition[]>;
  albumAdditions: AlbumAddition[];
}

export function parseVisibility(js: string): SiteVisibility {
  const empty: SiteVisibility = { hidden: { characters: {}, album: [] }, sensitive: [], album: { order: [], captions: {} }, characterAdditions: {}, albumAdditions: [] };
  const start = js.indexOf("window.REFLECTIONS_VISIBILITY = ");
  if (start < 0) return empty;
  const body = js.slice(start + "window.REFLECTIONS_VISIBILITY = ".length).trim().replace(/;\s*$/, "");
  try {
    const v = JSON.parse(body) as Partial<SiteVisibility>;
    return {
      hidden: { characters: v.hidden?.characters ?? {}, album: v.hidden?.album ?? [] },
      sensitive: v.sensitive ?? [],
      album: { order: v.album?.order ?? [], captions: v.album?.captions ?? {} },
      characterAdditions: v.characterAdditions ?? {},
      albumAdditions: v.albumAdditions ?? [],
    };
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
    "// sensitive: full-size image paths blurred until the reader confirms they are 18 or older.",
    "// album.order / album.captions: Memories album order and edited captions (title) and descriptions (alt).",
    "// characterAdditions: repository sheets added to a character's gallery.",
    "// albumAdditions: photos added to the Memories album.",
    `window.REFLECTIONS_VISIBILITY = ${JSON.stringify(v, null, 2)};`,
    "",
  ].join("\n");
}

/** production/studio/site-sheet-sources.json: public gallery image -> repository sheet it was made from. */
export function parseSheetSources(text: string | null): Record<string, string> {
  if (!text) return {};
  try {
    const v = JSON.parse(text) as { sources?: Record<string, string> };
    return v.sources ?? {};
  } catch {
    return {};
  }
}

export function sheetSourcesJson(previousText: string | null, sources: Record<string, string>): string {
  let comment = "Which repository sheet each public character-gallery image was made from. Maintained by Reflections Studio (Site images).";
  try {
    comment = (JSON.parse(previousText ?? "{}") as { $comment?: string }).$comment ?? comment;
  } catch {
    // keep the default comment
  }
  return `${JSON.stringify({ $comment: comment, sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`;
}

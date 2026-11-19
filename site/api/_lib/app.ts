import { z } from "zod";
import {
  assertSameOrigin,
  checkLoginAllowed,
  clearLoginFailures,
  clearSessionCookie,
  clientKey,
  constantTimeEqual,
  cookieName,
  createSessionToken,
  isSecureRequest,
  parseCookies,
  readSessionToken,
  recordLoginFailure,
  requireBearer,
  type Session,
  sessionCookie,
  verifyPassword,
} from "./auth/auth.js";
import type { StudioDeps } from "./context.js";
import { content } from "./context.js";
import { pad3 } from "./content/config.js";
import { ensureMigrated } from "./db/schema.js";
import { one } from "./db/client.js";
import { badRequest, conflict, HttpError, notFound, unauthorized } from "./errors.js";
import { logEvent } from "./engine/events.js";
import {
  cancelJob,
  createJob,
  createJobSchema,
  estimate,
  getStudioSetting,
  jobDetail,
  listJobs,
  pauseJob,
  pageRunOptionsSchema,
  raiseBudget,
  regeneratePage,
  resumeJob,
  saveChapterOverrides,
  chapterOverrides,
  setStudioSetting,
  settingsOverrideSchema,
} from "./engine/jobs.js";
import { chapterOverview, dashboard } from "./engine/overview.js";
import type { VersionRow } from "./engine/types.js";
import { noteApproval, planPage, runWorkerStep, studioCharacters } from "./engine/worker.js";
import { costCard, registerLibraryRoutes, versionSummary } from "./library.js";
import { MANIFEST_PATH, OUTFIT_CATEGORIES, parseManifest } from "./content/characters.js";
import { errorResponse, json, readJson, Router, SECURITY_HEADERS } from "./http.js";
import { thumbnail, toReaderWebp, validateUpload } from "./images.js";
import { altTextFromScript } from "./publish/alt-text.js";
import { publishChapter } from "./publish/service.js";
import { assertRepoPath } from "./repo/source.js";
import { createZip } from "./zip.js";

export const API_PREFIX = "/api/studio";

function image(data: Buffer, contentType: string, extra: Record<string, string> = {}) {
  return new Response(new Uint8Array(data), { status: 200, headers: { ...SECURITY_HEADERS, "Content-Type": contentType, "Cache-Control": "private, no-store", ...extra } });
}

const uuid = z.string().uuid();
const pageNumber = (s: string) => {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw badRequest("Invalid page number.");
  return n;
};
const chapterParam = (s: string) => {
  if (!/^\d{3}$/.test(s)) throw badRequest("Invalid chapter id.");
  return s;
};

/** Repository images the studio may display: character sheets, manuscript pages and public site images. */
const REPO_IMAGE_ALLOW = [
  // A character's own sheets: characters/main/<id>/..., characters/family/<family>/<id>/..., characters/friends/<id>/...
  /^characters\/(?:[a-z0-9-]+\/){1,3}(?:references|outfits(?:\/_review)?)\/[\w.-]+\.(png|webp|jpe?g)$/i,
  /^characters\/_reference-sheets\/(?:[\w-]+\/)*[\w.-]+\.(png|webp|jpe?g)$/i,
  /^stories\/arc-\d{2}\/chapter-\d{3}\/pages\/(?:version_\d+\/)?[\w.-]+\.(png|webp)$/i,
  /^site\/(?:images|pages)\/[\w./-]+\.(png|webp|jpe?g)$/i,
];
const THUMB_WIDTHS = new Set([160, 320, 480, 960]);

const thumbCache = new Map<string, Buffer>();

export function createApp(deps: StudioDeps) {
  const r = new Router();

  async function session(req: Request): Promise<Session | null> {
    const cookies = parseCookies(req.headers.get("cookie"));
    const token = cookies[cookieName(true)] ?? cookies[cookieName(false)];
    const s = readSessionToken(token, deps.auth.sessionSecret, deps.clock.now().getTime());
    if (!s) return null;
    const epoch = await getStudioSetting(deps, "session_epoch", 1);
    return s.epoch === epoch ? s : null;
  }
  async function requireAdmin(req: Request): Promise<Session> {
    const s = await session(req);
    if (!s) throw unauthorized();
    assertSameOrigin(req);
    return s;
  }

  // ---- public ----
  r.add("GET", "/health", async ({ req }) => {
    const s = await session(req).catch(() => null);
    return json({ ok: true, ready: deps.missingConfig.length === 0, ...(s ? { missingConfig: deps.missingConfig } : {}) });
  });

  r.add("POST", "/auth/login", async ({ req }) => {
    assertSameOrigin(req);
    const body = z.object({ username: z.string().max(200), password: z.string().max(500) }).safeParse(await readJson(req, 4096));
    if (!body.success) throw badRequest("Enter your username and password.");
    const keys = [clientKey(req, deps.auth.sessionSecret), "global"];
    const now = deps.clock.now();
    await checkLoginAllowed(deps.db, keys, now);
    const userOk = constantTimeEqual(body.data.username, deps.auth.username);
    const passOk = await verifyPassword(body.data.password, deps.auth.passwordHash);
    if (!userOk || !passOk) {
      await recordLoginFailure(deps.db, keys, now);
      throw unauthorized("That username and password do not match.");
    }
    await clearLoginFailures(deps.db, keys.slice(0, 1));
    const epoch = await getStudioSetting(deps, "session_epoch", 1);
    const ttl = deps.auth.sessionTtlHours * 3600;
    const token = createSessionToken({ user: deps.auth.username, exp: now.getTime() + ttl * 1000, epoch }, deps.auth.sessionSecret);
    return json({ ok: true, user: deps.auth.username }, 200, { "Set-Cookie": sessionCookie(token, isSecureRequest(req), ttl) });
  });

  r.add("POST", "/auth/logout", async ({ req }) => {
    assertSameOrigin(req);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(isSecureRequest(req)) });
  });

  r.add("POST", "/auth/logout-everywhere", async ({ req }) => {
    await requireAdmin(req);
    const epoch = await getStudioSetting(deps, "session_epoch", 1);
    await setStudioSetting(deps, "session_epoch", epoch + 1);
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(isSecureRequest(req)) });
  });

  r.add("GET", "/auth/me", async ({ req }) => {
    const s = await session(req);
    if (!s) throw unauthorized();
    return json({ user: s.user, expiresAt: new Date(s.exp).toISOString() });
  });

  // ---- worker (bearer secret; used by self-chaining, Vercel Cron and the optional GitHub Actions heartbeat) ----
  const workerRun: Parameters<Router["add"]>[2] = async ({ req }) => {
    requireBearer(req, deps.cronSecret);
    const result = await runWorkerLoop(deps);
    return json(result);
  };
  r.add("POST", "/worker/run", workerRun);
  r.add("GET", "/worker/cron", workerRun);

  // Used by the optional GitHub Actions heartbeat to know when to stop.
  r.add("GET", "/worker/status", async ({ req }) => {
    requireBearer(req, deps.cronSecret);
    const row = await one<{ n: number }>(deps.db, `SELECT count(*)::int AS n FROM jobs WHERE status IN ('queued','running')`);
    return json({ activeJobs: row?.n ?? 0 });
  });

  r.add("POST", "/worker/kick", async ({ req }) => {
    await requireAdmin(req);
    deps.kick("manual");
    return json({ ok: true });
  });

  // ---- dashboard ----
  r.add("GET", "/dashboard", async ({ req }) => {
    await requireAdmin(req);
    const data = await dashboard(deps);
    // An open dashboard nudges the worker if anything is waiting (recovers stalls).
    const stalled = await one<{ n: number }>(
      deps.db,
      `SELECT count(*)::int AS n FROM job_pages jp JOIN jobs j ON j.id = jp.job_id WHERE j.status IN ('queued','running')
         AND ((jp.status IN ('queued') ) OR (jp.status = 'retry_wait' AND jp.next_attempt_at <= $1) OR (jp.status IN ('generating','validating') AND jp.lease_until < $1))`,
      [deps.clock.now()],
    );
    if ((stalled?.n ?? 0) > 0) deps.kick("dashboard");
    return json(data);
  });

  // ---- characters and references ----
  r.add("GET", "/characters", async ({ req }) => {
    await requireAdmin(req);
    const chars = await studioCharacters(deps);
    const uploads = await deps.db.query(`SELECT id, character_id, chapter_id, pages, label, kind, status, width, height, bytes, created_at FROM reference_assets ORDER BY created_at DESC`);
    const manifest = parseManifest(await deps.repo.readText(MANIFEST_PATH));
    const groups = Object.entries(manifest?.characterGroups ?? {}).map(([key, g]) => ({ key, label: g.label }));
    return json({ characters: chars, uploads, publisherReady: !!deps.publisher, groups, categories: manifest?.categories?.length ? manifest.categories : OUTFIT_CATEGORIES });
  });

  r.add("GET", "/repo-image", async ({ req, url }) => {
    await requireAdmin(req);
    let path: string;
    try {
      path = assertRepoPath(url.searchParams.get("path") ?? "");
    } catch {
      throw badRequest("Invalid path.");
    }
    if (!REPO_IMAGE_ALLOW.some((re) => re.test(path))) throw notFound();
    const thumbParam = url.searchParams.get("thumb");
    const width = thumbParam === "1" ? 480 : Number(url.searchParams.get("w") ?? 0);
    const thumb = THUMB_WIDTHS.has(width);
    const cacheKey = `${path}@${width}`;
    let out = thumb ? thumbCache.get(cacheKey) : undefined;
    if (!out) {
      const data = await deps.repo.readBinary(path);
      if (!data) throw notFound();
      out = thumb ? await thumbnail(data, width) : data;
      if (thumb) {
        thumbCache.set(cacheKey, out);
        if (thumbCache.size > 300) thumbCache.delete(thumbCache.keys().next().value as string);
      }
    }
    // Repository images change only through commits; a short private cache keeps
    // the grids fast without hiding a merged change for long.
    return image(out, thumb ? "image/webp" : path.endsWith(".webp") ? "image/webp" : path.match(/\.jpe?g$/i) ? "image/jpeg" : "image/png", { "Cache-Control": "private, max-age=600" });
  });

  r.add("POST", "/references", async ({ req }) => {
    const s = await requireAdmin(req);
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > 4_400_000) throw new HttpError(413, "Upload must be under 4 MB.", "too_large");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Choose an image file.");
    const meta = z
      .object({
        kind: z.enum(["outfit", "location", "experimental"]),
        label: z.string().trim().min(3).max(120),
        characterId: z.string().regex(/^[a-z0-9-]+$/).optional().or(z.literal("")),
        chapterId: z.string().regex(/^\d{3}$/).optional().or(z.literal("")),
        pages: z.string().regex(/^[\d,\s-]*$/).optional(),
      })
      .safeParse(Object.fromEntries([...form.entries()].filter(([k]) => k !== "file")));
    if (!meta.success) throw badRequest("Check the reference details.", meta.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    const data = Buffer.from(await file.arrayBuffer());
    let info;
    try {
      info = await validateUpload(data, 4_000_000);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    if (meta.data.kind !== "location" && !meta.data.characterId) throw badRequest("Choose the character this reference belongs to.");
    if (meta.data.characterId) {
      const chars = await studioCharacters(deps);
      if (!chars.some((c) => c.id === meta.data.characterId)) throw badRequest("Unknown character.");
    }
    const id = deps.newId();
    const sharp = (await import("sharp")).default;
    const clean = await sharp(data).rotate().png().toBuffer(); // re-encode: strips metadata and any non-image payload
    const blobPath = `studio/references/${id}.png`;
    await deps.blobs.put(blobPath, clean, "image/png");
    const { parsePageRanges } = await import("./content/config.js");
    const pages = meta.data.pages?.trim() ? [...parsePageRanges(meta.data.pages)] : null;
    await deps.db.query(
      `INSERT INTO reference_assets (id, character_id, chapter_id, pages, label, kind, status, blob_path, sha256, width, height, bytes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'experimental',$7,$8,$9,$10,$11,$12)`,
      [id, meta.data.characterId || null, meta.data.chapterId || null, pages, meta.data.label, meta.data.kind, blobPath, info.sha256, info.width, info.height, clean.byteLength, deps.clock.now()],
    );
    await logEvent(deps.db, deps.clock.now(), { level: "info", message: `Reference uploaded by ${s.user}: ${meta.data.label} (experimental until approved).` });
    return json({ id, status: "experimental" }, 201);
  });

  r.add("POST", "/references/:id/status", async ({ req, params }) => {
    await requireAdmin(req);
    const id = uuid.parse(params.id);
    const body = z.object({ status: z.enum(["approved", "experimental"]) }).parse(await readJson(req));
    const row = await one<{ kind: string }>(deps.db, `SELECT kind FROM reference_assets WHERE id = $1`, [id]);
    if (!row) throw notFound();
    if (row.kind === "experimental" && body.status === "approved") throw conflict("Experimental references cannot be auto-attached. Re-upload as an outfit or location reference.");
    await deps.db.query(`UPDATE reference_assets SET status = $2 WHERE id = $1`, [id, body.status]);
    return json({ ok: true });
  });

  r.add("GET", "/references/:id/image", async ({ req, params, url }) => {
    await requireAdmin(req);
    const row = await one<{ blob_path: string }>(deps.db, `SELECT blob_path FROM reference_assets WHERE id = $1`, [uuid.parse(params.id)]);
    if (!row) throw notFound();
    const obj = await deps.blobs.get(row.blob_path);
    if (!obj) throw notFound();
    return url.searchParams.get("thumb") === "1" ? image(await thumbnail(obj.data), "image/webp") : image(obj.data, obj.contentType);
  });

  // ---- chapters ----
  r.add("GET", "/chapters", async ({ req }) => {
    await requireAdmin(req);
    const c = await content(deps);
    const out = [];
    for (const id of c.chapterIds()) {
      const o = await chapterOverview(deps, id);
      out.push({ id, title: o.title, arcTitle: o.arcTitle, arcNumber: o.arcNumber, plannedPages: o.plannedPages, completionPercent: o.completionPercent, counts: o.counts });
    }
    return json({ chapters: out });
  });

  r.add("GET", "/chapters/:id", async ({ req, params }) => {
    await requireAdmin(req);
    const id = chapterParam(params.id!);
    const c = await content(deps);
    if (!c.chapterConfig(id)) throw notFound("Unknown chapter.");
    const [overview, syn] = await Promise.all([chapterOverview(deps, id), c.chapterSynopsis(id)]);
    const settings = { defaults: c.studioConfig.generation, overrides: await chapterOverrides(deps, id) };
    const job = await one(deps.db, `SELECT * FROM jobs WHERE chapter_id = $1 ORDER BY created_at DESC LIMIT 1`, [id]);
    return json({ ...overview, synopsis: syn.synopsis, settings, latestJob: job ?? null, realGenerationVerified: await getStudioSetting(deps, "real_generation_verified", false), generationEnabled: deps.generationEnabled });
  });

  r.add("PUT", "/chapters/:id/settings", async ({ req, params }) => {
    await requireAdmin(req);
    const saved = await saveChapterOverrides(deps, chapterParam(params.id!), await readJson(req));
    return json({ overrides: saved });
  });

  r.add("GET", "/chapters/:id/pages/:page", async ({ req, params }) => {
    await requireAdmin(req);
    const id = chapterParam(params.id!);
    const page = pageNumber(params.page!);
    const c = await content(deps);
    const settings = { ...c.studioConfig.generation, ...(await chapterOverrides(deps, id)) };
    const [planned, versions, continuity, synopsis] = await Promise.all([
      planPage(deps, id, page, settings),
      deps.db.query<VersionRow>(`SELECT * FROM page_versions WHERE chapter_id = $1 AND page = $2 ORDER BY created_at DESC`, [id, page]),
      one(deps.db, `SELECT state, source, updated_at FROM continuity_states WHERE chapter_id = $1 AND page = $2`, [id, page]),
      c.chapterSynopsis(id),
    ]);
    const info = planned.inv.pages.find((p) => p.page === page);
    const config = c.chapterConfig(id)!;
    return json({
      chapterId: id,
      page,
      chapter: { id, title: config.title, arcId: config.arcId, arcNumber: config.arcNumber, arcTitle: config.arcTitle ?? null, plannedPages: config.plannedPages, synopsis: synopsis.synopsis },
      info,
      cast: planned.cast,
      cost: costCard(settings.imageModel, settings.quality, planned.plan?.entries.length ?? 0, settings.maxAttemptsPerPage),
      settings: { quality: settings.quality, budgetUsdPerJob: settings.budgetUsdPerJob, maxAttemptsPerPage: settings.maxAttemptsPerPage, imageModel: settings.imageModel },
      generationEnabled: deps.generationEnabled,
      realGenerationVerified: await getStudioSetting(deps, "real_generation_verified", false),
      prompt: planned.prompt
        ? { path: (planned.prompt as { path?: string }).path, version: planned.prompt.version, sha256: planned.prompt.sha256, text: planned.prompt.text, panelCount: planned.prompt.panelCount, layout: planned.prompt.layout, panels: planned.prompt.panels, referenceOrder: planned.prompt.referenceOrder, sceneReferences: planned.prompt.sceneReferences, characters: planned.prompt.characters }
        : null,
      script: planned.script,
      references: planned.plan?.entries ?? [],
      finalPrompt: planned.finalPrompt,
      blockers: planned.blockers,
      warnings: planned.warnings,
      suggestedAltText: altTextFromScript(planned.script),
      versions: versions.map(versionSummary),
      continuity: continuity ?? null,
    });
  });

  r.add("POST", "/chapters/:id/pages/:page/regenerate", async ({ req, params }) => {
    const s = await requireAdmin(req);
    const body = z
      .object({ settings: settingsOverrideSchema.optional(), budgetUsd: z.number().min(0.5).max(200).optional(), options: pageRunOptionsSchema.optional(), confirmPaid: z.literal(true) })
      .safeParse(await readJson(req, 64 * 1024));
    if (!body.success) throw badRequest("Confirm that regeneration starts a paid OpenAI request.");
    const res = await regeneratePage(deps, chapterParam(params.id!), pageNumber(params.page!), { createdBy: s.user, settings: body.data.settings, budgetUsd: body.data.budgetUsd, options: body.data.options });
    return json(res, 202);
  });

  // ---- jobs ----
  r.add("POST", "/estimate", async ({ req }) => {
    await requireAdmin(req);
    const body = z.object({ chapterId: z.string().regex(/^\d{3}$/), pages: z.array(z.number().int()).min(1).max(60), settings: settingsOverrideSchema.optional() }).safeParse(await readJson(req, 64 * 1024));
    if (!body.success) throw badRequest("Choose a chapter and pages.");
    const e = await estimate(deps, body.data.chapterId, body.data.pages, body.data.settings ?? {});
    return json({ ...e, cost: costCard(e.settings.imageModel, e.settings.quality, e.referencesPerPage, e.settings.maxAttemptsPerPage) });
  });

  r.add("POST", "/jobs", async ({ req }) => {
    const s = await requireAdmin(req);
    const parsed = createJobSchema.safeParse(await readJson(req, 512 * 1024));
    if (!parsed.success) throw badRequest("Check the job settings.", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
    const key = req.headers.get("idempotency-key");
    if (key && !/^[\w-]{8,80}$/.test(key)) throw badRequest("Invalid Idempotency-Key.");
    const res = await createJob(deps, parsed.data, { createdBy: s.user, idempotencyKey: key });
    return json(res, res.duplicate ? 200 : 201);
  });

  r.add("GET", "/jobs", async ({ req }) => {
    await requireAdmin(req);
    return json({ jobs: await listJobs(deps) });
  });

  r.add("GET", "/jobs/:id", async ({ req, params }) => {
    await requireAdmin(req);
    return json(await jobDetail(deps, uuid.parse(params.id)));
  });

  for (const action of ["pause", "resume", "cancel"] as const) {
    r.add("POST", `/jobs/:id/${action}`, async ({ req, params }) => {
      await requireAdmin(req);
      const id = uuid.parse(params.id);
      if (action === "pause") await pauseJob(deps, id);
      else if (action === "resume") await resumeJob(deps, id);
      else await cancelJob(deps, id);
      return json(await jobDetail(deps, id));
    });
  }

  r.add("POST", "/jobs/:id/budget", async ({ req, params }) => {
    await requireAdmin(req);
    const body = z.object({ budgetUsd: z.number() }).parse(await readJson(req));
    await raiseBudget(deps, uuid.parse(params.id), body.budgetUsd);
    return json({ ok: true });
  });

  r.add("GET", "/jobs/:id/export", async ({ req, params }) => {
    await requireAdmin(req);
    const id = uuid.parse(params.id);
    const { job, pages } = await jobDetail(deps, id);
    const files: { name: string; data: Buffer }[] = [];
    const manifest: unknown[] = [];
    for (const p of pages) {
      if (!p.current_version_id) continue;
      const v = await one<VersionRow>(deps.db, `SELECT * FROM page_versions WHERE id = $1`, [p.current_version_id]);
      if (!v) continue;
      const obj = await deps.blobs.get(v.blob_path);
      if (!obj) continue;
      files.push({ name: `chapter-${job.chapter_id}/${pad3(v.page)}.webp`, data: await toReaderWebp(obj.data) });
      files.push({ name: `chapter-${job.chapter_id}/originals/${pad3(v.page)}.png`, data: obj.data });
      manifest.push({ page: v.page, versionId: v.id, qa: v.qa_status, review: v.review_status, sha256: v.sha256, references: v.reference_manifest, model: v.model });
    }
    if (!files.length) throw conflict("This job has no generated pages to export yet.");
    files.push({ name: `chapter-${job.chapter_id}/manifest.json`, data: Buffer.from(JSON.stringify({ jobId: job.id, chapter: job.chapter_id, exportedAt: deps.clock.now(), pages: manifest }, null, 2)) });
    const zip = createZip(files.map((f) => ({ ...f, date: deps.clock.now() })));
    return new Response(new Uint8Array(zip), {
      headers: { ...SECURITY_HEADERS, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="reflections-ch${job.chapter_id}-${job.id.slice(0, 8)}.zip"` },
    });
  });

  // ---- versions / review ----
  r.add("GET", "/assets/:id", async ({ req, params, url }) => {
    await requireAdmin(req);
    const v = await one<VersionRow>(deps.db, `SELECT * FROM page_versions WHERE id = $1`, [uuid.parse(params.id)]);
    if (!v) throw notFound();
    const obj = await deps.blobs.get(v.blob_path);
    if (!obj) throw notFound();
    if (url.searchParams.get("thumb") === "1") return image(await thumbnail(obj.data), "image/webp");
    if (url.searchParams.get("download") === "webp") {
      return image(await toReaderWebp(obj.data), "image/webp", { "Content-Disposition": `attachment; filename="ch${v.chapter_id}-${pad3(v.page)}-${v.id.slice(0, 8)}.webp"` });
    }
    return image(obj.data, obj.contentType);
  });

  r.add("GET", "/versions/:id", async ({ req, params }) => {
    await requireAdmin(req);
    const v = await one<VersionRow>(deps.db, `SELECT * FROM page_versions WHERE id = $1`, [uuid.parse(params.id)]);
    if (!v) throw notFound();
    return json({ ...versionSummary(v), qa: v.qa, references: v.reference_manifest, settings: v.settings });
  });

  r.add("POST", "/versions/:id/approve", async ({ req, params }) => {
    const s = await requireAdmin(req);
    const body = z.object({ altText: z.string().max(1500).optional(), note: z.string().max(1000).optional() }).parse(await readJson(req));
    const id = uuid.parse(params.id);
    const v = await one<VersionRow>(deps.db, `SELECT * FROM page_versions WHERE id = $1`, [id]);
    if (!v) throw notFound();
    const c = await content(deps);
    const inv = await c.inventory(v.chapter_id);
    const info = inv.pages.find((p) => p.page === v.page);
    if (!info || info.locked) throw conflict(`Page ${pad3(v.page)} is locked: ${info?.lockReason ?? "unknown page"}`);
    const now = deps.clock.now();
    await deps.db.tx(async (tx) => {
      const prev = await tx.query<{ publication_status: string }>(`SELECT publication_status FROM page_versions WHERE chapter_id = $1 AND page = $2 AND review_status = 'approved' AND id <> $3`, [v.chapter_id, v.page, id]);
      if (prev.some((p) => p.publication_status !== "unpublished")) throw conflict("Another version of this page is already being published.");
      await tx.query(`UPDATE page_versions SET review_status = 'superseded' WHERE chapter_id = $1 AND page = $2 AND review_status = 'approved' AND id <> $3`, [v.chapter_id, v.page, id]);
      await tx.query(`UPDATE page_versions SET review_status = 'approved', reviewed_at = $2, review_note = $3, alt_text = COALESCE($4, alt_text) WHERE id = $1`, [id, now, body.note ?? null, body.altText ?? null]);
    });
    await noteApproval(deps, v);
    await logEvent(deps.db, now, { jobId: v.job_id, chapterId: v.chapter_id, page: v.page, level: "info", message: `${s.user} approved page ${pad3(v.page)}${v.qa_status !== "pass" ? ` (automatic QA said ${v.qa_status})` : ""}.` });
    return json({ ok: true });
  });

  r.add("POST", "/versions/:id/reject", async ({ req, params }) => {
    const s = await requireAdmin(req);
    const body = z.object({ note: z.string().max(1000).optional() }).parse(await readJson(req));
    const id = uuid.parse(params.id);
    const v = await one<VersionRow>(deps.db, `SELECT * FROM page_versions WHERE id = $1`, [id]);
    if (!v) throw notFound();
    if (v.publication_status !== "unpublished") throw conflict("This version is already in a publishing pull request.");
    await deps.db.query(`UPDATE page_versions SET review_status = 'rejected', reviewed_at = $2, review_note = $3 WHERE id = $1`, [id, deps.clock.now(), body.note ?? null]);
    await logEvent(deps.db, deps.clock.now(), { jobId: v.job_id, chapterId: v.chapter_id, page: v.page, level: "info", message: `${s.user} rejected a version of page ${pad3(v.page)}.` });
    return json({ ok: true });
  });

  r.add("PUT", "/versions/:id/alt", async ({ req, params }) => {
    await requireAdmin(req);
    const body = z.object({ altText: z.string().trim().min(20).max(1500) }).safeParse(await readJson(req));
    if (!body.success) throw badRequest("Alt text should describe the page in at least 20 characters.");
    await deps.db.query(`UPDATE page_versions SET alt_text = $2 WHERE id = $1`, [uuid.parse(params.id), body.data.altText]);
    return json({ ok: true });
  });

  // ---- publishing ----
  r.add("POST", "/publish", async ({ req }) => {
    const s = await requireAdmin(req);
    const body = z
      .object({
        chapterId: z.string().regex(/^\d{3}$/),
        versionIds: z.array(uuid).min(1).max(60),
        altText: z.record(z.string(), z.string().max(1500)).default({}),
        allowGap: z.boolean().default(false),
        replacePages: z.array(z.number().int().min(1).max(500)).max(60).default([]),
        confirm: z.literal(true),
      })
      .safeParse(await readJson(req));
    if (!body.success) throw badRequest("Choose approved pages and confirm publishing.");
    return json(await publishChapter(deps, { ...body.data, createdBy: s.user }), 201);
  });

  r.add("GET", "/publications", async ({ req }) => {
    await requireAdmin(req);
    return json({ publications: await deps.db.query(`SELECT * FROM publications ORDER BY created_at DESC LIMIT 20`) });
  });

  r.add("GET", "/events", async ({ req, url }) => {
    await requireAdmin(req);
    const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 50) || 50);
    return json({ events: await deps.db.query(`SELECT id, job_id, chapter_id, page, level, message, data, created_at FROM event_log ORDER BY id DESC LIMIT $1`, [limit]) });
  });

  registerLibraryRoutes(r, deps, requireAdmin);

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) || "/" : url.pathname;
    try {
      await ensureMigrated(deps.db);
      const m = r.match(req.method, path);
      if (m === "method") return json({ error: { code: "method_not_allowed", message: "Method not allowed." } }, 405);
      if (!m) throw notFound();
      return await m.handler({ req, params: m.params, url });
    } catch (err) {
      if (err instanceof z.ZodError) return errorResponse(badRequest("Invalid request.", err.issues.map((i) => i.message)), deps.logger);
      return errorResponse(err, deps.logger);
    }
  };
}

/**
 * Runs worker steps inside one invocation. Hands off to a fresh invocation
 * when more work is ready, and waits in place (idle, not billed as CPU) for
 * short retry delays so unattended jobs keep moving.
 */
export async function runWorkerLoop(deps: StudioDeps, opts: { budgetMs?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 250_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const steps: unknown[] = [];
  for (;;) {
    const res = await runWorkerStep(deps);
    steps.push(res);
    if (res.worked && res.more) {
      deps.kick("chain");
      break;
    }
    if (res.worked) continue;
    if (res.outcome !== "waiting") break;
    // Only retry timers are waited for here. A page held by a live worker is that
    // worker's job: it hands off when it finishes. Crashed workers are recovered by
    // the next kick (dashboard, daily cron or the optional GitHub Actions heartbeat).
    const next = await one<{ at: Date | null }>(
      deps.db,
      `SELECT min(jp.next_attempt_at) AS at FROM job_pages jp JOIN jobs j ON j.id = jp.job_id
        WHERE j.status IN ('queued','running') AND jp.status = 'retry_wait'`,
    );
    const waitMs = next?.at ? new Date(next.at).getTime() - deps.clock.now().getTime() + 500 : null;
    if (waitMs == null || Date.now() - started + waitMs > budgetMs) {
      if (waitMs != null) deps.kick("deferred");
      break;
    }
    await sleep(Math.max(250, waitMs));
  }
  return { steps };
}

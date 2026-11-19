import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSessionToken } from "../../api/_lib/auth/auth.js";
import { setStudioSetting } from "../../api/_lib/engine/jobs.js";
import { api, BASE, CRON_SECRET, createHarness, drain, type Harness, login, PASSWORD, REPO_ROOT, SESSION_SECRET } from "../helpers/harness.js";

const PROTECTED: [string, string][] = [
  ["GET", "/dashboard"],
  ["GET", "/characters"],
  ["GET", "/chapters"],
  ["GET", "/chapters/001"],
  ["GET", "/chapters/001/pages/21"],
  ["PUT", "/chapters/001/settings"],
  ["POST", "/estimate"],
  ["POST", "/jobs"],
  ["GET", "/jobs"],
  ["GET", "/jobs/00000000-0000-4000-8000-000000000000"],
  ["POST", "/jobs/00000000-0000-4000-8000-000000000000/pause"],
  ["GET", "/jobs/00000000-0000-4000-8000-000000000000/export"],
  ["POST", "/chapters/001/pages/21/regenerate"],
  ["GET", "/assets/00000000-0000-4000-8000-000000000000"],
  ["GET", "/repo-image?path=characters/main/ethan-walker/references/ethan-walker-reference-main.png"],
  ["POST", "/references"],
  ["POST", "/versions/00000000-0000-4000-8000-000000000000/approve"],
  ["POST", "/publish"],
  ["GET", "/events"],
  ["POST", "/worker/kick"],
  ["GET", "/publications"],
];

function raw(h: Harness, method: string, p: string, headers: Record<string, string> = {}, body?: string) {
  return h.handle(new Request(`${BASE}/api/studio${p}`, { method, headers: { host: "studio.test", ...headers }, body }));
}

describe("authentication and authorization", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => h.db.close?.());

  it.each(PROTECTED)("%s %s refuses requests without a session", async (method, p) => {
    const res = await raw(h, method, p, { "x-studio-request": "1", origin: BASE, "content-type": "application/json" }, method === "GET" ? undefined : "{}");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password and locks out after repeated failures", async () => {
    const attempt = (password: string) =>
      raw(h, "POST", "/auth/login", { "x-studio-request": "1", origin: BASE, "content-type": "application/json", "x-forwarded-for": "203.0.113.9" }, JSON.stringify({ username: "owner", password }));
    for (let i = 0; i < 5; i++) expect((await attempt("wrong password!!")).status).toBe(401);
    expect((await attempt(PASSWORD)).status).toBe(429);
    const other = await raw(h, "POST", "/auth/login", { "x-studio-request": "1", origin: BASE, "content-type": "application/json", "x-forwarded-for": "198.51.100.4" }, JSON.stringify({ username: "owner", password: PASSWORD }));
    expect(other.status).toBe(200);
  });

  it("sets a hardened session cookie", async () => {
    const res = await raw(h, "POST", "/auth/login", { "x-studio-request": "1", origin: BASE, "content-type": "application/json", "x-forwarded-for": "198.51.100.5" }, JSON.stringify({ username: "owner", password: PASSWORD }));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-rs_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Secure/);
    expect(await res.text()).not.toContain(SESSION_SECRET);
  });

  it("rejects tampered, expired and revoked sessions", async () => {
    const now = h.clock.now().getTime();
    const forged = createSessionToken({ user: "owner", exp: now + 3600_000, epoch: 1 }, "not-the-real-secret-0123456789abcdef");
    expect((await raw(h, "GET", "/dashboard", { cookie: `__Host-rs_session=${forged}` })).status).toBe(401);
    const expired = createSessionToken({ user: "owner", exp: now - 1, epoch: 1 }, SESSION_SECRET);
    expect((await raw(h, "GET", "/dashboard", { cookie: `__Host-rs_session=${expired}` })).status).toBe(401);
    const good = createSessionToken({ user: "owner", exp: now + 3600_000, epoch: 1 }, SESSION_SECRET);
    expect((await raw(h, "GET", "/dashboard", { cookie: `__Host-rs_session=${good}` })).status).toBe(200);
    await setStudioSetting(h.deps, "session_epoch", 2);
    expect((await raw(h, "GET", "/dashboard", { cookie: `__Host-rs_session=${good}` })).status).toBe(401);
    await setStudioSetting(h.deps, "session_epoch", 1);
  });

  it("blocks cross-site state changes (CSRF)", async () => {
    const cookie = await login(h);
    const body = JSON.stringify({ chapterId: "001", pages: [21] });
    const noHeader = await raw(h, "POST", "/estimate", { cookie, origin: BASE, "content-type": "application/json" }, body);
    expect(noHeader.status).toBe(403);
    const evil = await raw(h, "POST", "/estimate", { cookie, origin: "https://evil.example", "x-studio-request": "1", "content-type": "application/json" }, body);
    expect(evil.status).toBe(403);
    const ok = await raw(h, "POST", "/estimate", { cookie, origin: BASE, "x-studio-request": "1", "content-type": "application/json" }, body);
    expect(ok.status).toBe(200);
  });

  it("protects the worker endpoint with the cron secret", async () => {
    expect((await raw(h, "POST", "/worker/run")).status).toBe(401);
    expect((await raw(h, "POST", "/worker/run", { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await raw(h, "POST", "/worker/run", { authorization: `Bearer ${CRON_SECRET}` })).status).toBe(200);
    expect((await raw(h, "GET", "/worker/cron", { authorization: `Bearer ${CRON_SECRET}` })).status).toBe(200);
  });

  it("only serves allow-listed repository images", async () => {
    const call = api(h, await login(h));
    expect((await call("GET", "/repo-image?path=characters/main/ethan-walker/references/ethan-walker-reference-main.png&thumb=1")).status).toBe(200);
    for (const path of [
      "characters/main/ethan-walker/outfits/ethan-walker-formal-wedding-suit.png",
      "characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-black-top-olive-shorts-study-a.png",
      "characters/family/bennett/autumn-bennett/references/autumn-bennett-reference-main.png",
      "characters/family/hayes/diane-hayes/references/diane-hayes-reference-main.png",
      "characters/family/walker/linda-walker/references/linda-walker-reference-main.png",
      "characters/friends/natalie-greene/references/natalie-greene-reference-main.png",
    ]) {
      expect((await call("GET", `/repo-image?path=${path}&thumb=1`)).status).toBe(200);
    }
    expect((await call("GET", "/repo-image?path=../.git/config")).status).toBe(400);
    expect((await call("GET", "/repo-image?path=continuity/timeline.md")).status).toBe(404);
  });

  it("refuses to start paid generation when the master switch is off", async () => {
    const off = await createHarness({ generationEnabled: false });
    const call = api(off, await login(off));
    const res = await call("POST", "/jobs", { chapterId: "001", pages: [21], test: true, confirmPaid: true });
    expect(res.status).toBe(403);
    expect(off.images.calls).toHaveLength(0);
    await off.db.close?.();
  });

  it("requires explicit paid-request confirmation", async () => {
    const call = api(h, await login(h));
    const res = await call("POST", "/jobs", { chapterId: "001", pages: [21], test: true });
    expect(res.status).toBe(400);
    expect(h.images.calls).toHaveLength(0);
  });
});

describe("existing artwork is protected until the owner chooses a replacement", () => {
  let h: Harness;
  let call: ReturnType<typeof api>;
  beforeAll(async () => {
    h = await createHarness();
    call = api(h, await login(h));
    await setStudioSetting(h.deps, "real_generation_verified", true);
  });
  afterAll(async () => h.db.close?.());

  it("allows a new version of a page that already has artwork, without touching that artwork", async () => {
    const res = await call("POST", "/estimate", { chapterId: "001", pages: [1, 2] });
    expect(res.status).toBe(200);
    expect(res.data.eligibility.every((e: { eligible: boolean }) => e.eligible)).toBe(true);
  });

  it("refuses pages past the end of the 30-page v2 chapter instead of inventing them", async () => {
    const res = await call("POST", "/jobs", { chapterId: "001", pages: [31, 32], confirmPaid: true });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.data)).toMatch(/outside this chapter/);
  });

  it("refuses pages listed in lockedPages", async () => {
    const { content } = await import("../../api/_lib/context.js");
    const c = await content(h.deps, true);
    const cfg = c.chapterConfig("001")!;
    const prev = cfg.lockedPages;
    cfg.lockedPages = "5";
    const res = await call("POST", "/jobs", { chapterId: "001", pages: [5], confirmPaid: true });
    cfg.lockedPages = prev;
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.data)).toMatch(/locked/i);
  });

  it("blocks a queued page that became locked before the worker reached it", async () => {
    await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true });
    // Simulate the owner adding page 021 to lockedPages mid-job.
    const { content } = await import("../../api/_lib/context.js");
    const c = await content(h.deps, true);
    const cfg = c.chapterConfig("001")!;
    cfg.lockedPages = "21";
    cfg.lockReason = "Locked by the owner.";
    await drain(h);
    cfg.lockedPages = "";
    await content(h.deps, true);
    expect(h.images.calls).toHaveLength(0);
    const jp = (await h.db.query<{ status: string; last_error: string }>(`SELECT status, last_error FROM job_pages`))[0]!;
    expect(jp.status).toBe("blocked");
    expect(jp.last_error).toMatch(/Locked by the owner/);
  });

  it("never overwrites an existing blob", async () => {
    await h.blobs.put("studio/test/x.png", Buffer.from("a"), "image/png");
    await expect(h.blobs.put("studio/test/x.png", Buffer.from("b"), "image/png")).rejects.toThrow(/exists/);
  });
});

describe("unpublished assets stay private", () => {
  it("does not expose generated images without a session, and generation does not touch the reader", async () => {
    const h = await createHarness();
    const call = api(h, await login(h));
    await setStudioSetting(h.deps, "real_generation_verified", true);
    const before = await readFile(path.join(REPO_ROOT, "site/js/chapters.js"), "utf8");
    await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true });
    await drain(h);
    const v = (await h.db.query<{ id: string; blob_path: string }>(`SELECT id, blob_path FROM page_versions`))[0]!;
    expect(v.blob_path.startsWith("studio/drafts/")).toBe(true);
    expect((await raw(h, "GET", `/assets/${v.id}`)).status).toBe(401);
    expect((await call("GET", `/assets/${v.id}`)).status).toBe(200);
    expect(await readFile(path.join(REPO_ROOT, "site/js/chapters.js"), "utf8")).toBe(before);
    const reader = await call("GET", "/chapters/001");
    expect(reader.data.pages.find((p: { page: number }) => p.page === 21).publishedSrc).toBeNull();
    await h.db.close?.();
  });

  it("public pages never reference the studio API or draft storage", async () => {
    const site = path.join(REPO_ROOT, "site");
    const files = [...(await readdir(site)).filter((f) => f.endsWith(".html")).map((f) => path.join(site, f)), ...(await readdir(path.join(site, "js"))).map((f) => path.join(site, "js", f))];
    for (const f of files) {
      const text = await readFile(f, "utf8");
      expect(text, f).not.toMatch(/\/api\/studio\/assets|studio\/drafts|blob\.vercel-storage/);
    }
  });

  it("stores binaries in a private Vercel Blob store", async () => {
    const src = await readFile(path.join(REPO_ROOT, "site/api/_lib/storage/blobs.ts"), "utf8");
    expect(src).toMatch(/access: "private"/);
    expect(src).not.toMatch(/access: "public"/);
  });
});

describe("export", () => {
  it("exports a finished job as a ZIP with WebP pages, originals and a manifest", async () => {
    const h = await createHarness();
    const call = api(h, await login(h));
    await setStudioSetting(h.deps, "real_generation_verified", true);
    const job = await call("POST", "/jobs", { chapterId: "001", pages: [21, 22], confirmPaid: true });
    await drain(h);
    const res = await call("GET", `/jobs/${job.data.job.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const zip = res.data as Buffer;
    const names: string[] = [];
    let off = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const count = zip.readUInt16LE(off + 10);
    off = zip.readUInt32LE(off + 16);
    for (let i = 0; i < count; i++) {
      const len = zip.readUInt16LE(off + 28);
      names.push(zip.subarray(off + 46, off + 46 + len).toString());
      off += 46 + len + zip.readUInt16LE(off + 30) + zip.readUInt16LE(off + 32);
    }
    expect(names).toEqual(["chapter-001/021.webp", "chapter-001/originals/021.png", "chapter-001/022.webp", "chapter-001/originals/022.png", "chapter-001/manifest.json"]);
    const webp = await call("GET", `/assets/${(await h.db.query<{ id: string }>(`SELECT id FROM page_versions LIMIT 1`))[0]!.id}?download=webp`);
    expect(webp.headers.get("content-disposition")).toMatch(/attachment/);
    expect((webp.data as Buffer).subarray(8, 12).toString()).toBe("WEBP");
    await h.db.close?.();
  });
});

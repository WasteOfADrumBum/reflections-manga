import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStudioSetting } from "../../api/_lib/engine/jobs.ts";
import { api, createHarness, drain, type Harness, login } from "../helpers/harness.ts";

function evalChapters(js: string) {
  const sandbox = { window: {} as Record<string, unknown> };
  vm.runInNewContext(js, sandbox);
  return sandbox.window.REFLECTIONS_CHAPTERS as { id: string; pages: { src: string; alt: string }[] }[];
}

describe("review and publishing", () => {
  let h: Harness;
  let call: ReturnType<typeof api>;
  let original: string;

  beforeEach(async () => {
    h = await createHarness();
    call = api(h, await login(h));
    await setStudioSetting(h.deps, "real_generation_verified", true);
    await call("POST", "/jobs", { chapterId: "001", pages: [21, 22, 23], confirmPaid: true });
    await drain(h);
    original = (await h.repo.readText("site/js/chapters.js"))!;
  });
  afterEach(async () => h.db.close?.());

  async function versionFor(page: number) {
    return (await h.db.query<{ id: string }>(`SELECT id FROM page_versions WHERE page = $1 ORDER BY created_at DESC LIMIT 1`, [page]))[0]!.id;
  }

  it("refuses to publish pages that are not approved", async () => {
    const res = await call("POST", "/publish", { chapterId: "001", versionIds: [await versionFor(21)], confirm: true, allowGap: true });
    expect(res.status).toBe(409);
    expect(h.publisher.requests).toHaveLength(0);
  });

  it("warns about a gap in the reader unless confirmed", async () => {
    const id = await versionFor(21);
    await call("POST", `/versions/${id}/approve`, {});
    const res = await call("POST", "/publish", { chapterId: "001", versionIds: [id], confirm: true });
    expect(res.status).toBe(409);
    expect(res.data.error.details.gaps).toEqual([16, 17, 18, 19, 20]);
  });

  it("opens one pull request that only adds files and appends reader entries in order", async () => {
    const ids = [await versionFor(23), await versionFor(21), await versionFor(22)];
    for (const id of ids) expect((await call("POST", `/versions/${id}/approve`, {})).status).toBe(200);
    const res = await call("POST", "/publish", { chapterId: "001", versionIds: ids, confirm: true, allowGap: true });
    expect(res.status).toBe(201);
    expect(res.data.prUrl).toMatch(/pull\/1$/);
    const req = h.publisher.requests[0]!;
    const paths = req.files.map((f) => f.path);
    expect(paths).toContain("site/pages/chapter-001/021.webp");
    expect(paths).toContain("stories/arc-01/chapter-001/pages/A01-C001-P023.png");
    expect(paths).toContain("stories/arc-01/chapter-001/pages/A01-C001-P022.studio.json");
    expect(req.mustNotExist).toContain("site/pages/chapter-001/022.webp");
    const webp = req.files.find((f) => f.path.endsWith("021.webp"))!.content;
    expect(webp.subarray(8, 12).toString()).toBe("WEBP");

    const nextJs = req.files.find((f) => f.path === "site/js/chapters.js")!.content.toString();
    const before = evalChapters(original).find((c) => c.id === "001")!;
    const after = evalChapters(nextJs).find((c) => c.id === "001")!;
    // Existing entries (covers, 001-015 and end card) are untouched; new pages slot in before the end card.
    const srcs = after.pages.map((p) => p.src);
    expect(srcs.slice(0, before.pages.length - 1)).toEqual(before.pages.slice(0, -1).map((p) => p.src));
    expect(srcs.slice(-4)).toEqual(["/pages/chapter-001/021.webp", "/pages/chapter-001/022.webp", "/pages/chapter-001/023.webp", before.pages.at(-1)!.src]);
    // Descriptive alt text comes from the script, including exact dialogue.
    const alt23 = after.pages.find((p) => p.src.endsWith("023.webp"))!.alt;
    expect(alt23).toContain(`Morgan: "What's wrong with you today?"`);
    expect(alt23).toContain(`Ethan's thought caption: "Letting her lead is easy. Letting her see me struggling isn't."`);
    // Other chapters are untouched.
    expect(evalChapters(nextJs).filter((c) => c.id !== "001")).toEqual(evalChapters(original).filter((c) => c.id !== "001"));

    // A second publish of the same pages is refused.
    const again = await call("POST", "/publish", { chapterId: "001", versionIds: [ids[0]], confirm: true, allowGap: true });
    expect(again.status).toBe(409);
  });

  it("refuses to publish over files that already exist", async () => {
    const id = await versionFor(21);
    await call("POST", `/versions/${id}/approve`, {});
    h.publisher.existing.add("site/pages/chapter-001/021.webp");
    const res = await call("POST", "/publish", { chapterId: "001", versionIds: [id], confirm: true, allowGap: true });
    expect(res.status).toBe(409);
    // The version is released so it can be published later.
    const v = (await h.db.query<{ publication_status: string }>(`SELECT publication_status FROM page_versions WHERE id = $1`, [id]))[0]!;
    expect(v.publication_status).toBe("unpublished");
  });

  it("keeps only one approved version per page and lets the owner reject one", async () => {
    await call("POST", "/chapters/001/pages/21/regenerate", { confirmPaid: true });
    await drain(h);
    const versions = (await h.db.query<{ id: string }>(`SELECT id FROM page_versions WHERE page = 21 ORDER BY created_at`)).map((r) => r.id);
    expect(versions).toHaveLength(2);
    await call("POST", `/versions/${versions[0]}/approve`, {});
    await call("POST", `/versions/${versions[1]}/approve`, {});
    const rows = await h.db.query<{ id: string; review_status: string }>(`SELECT id, review_status FROM page_versions WHERE page = 21 ORDER BY created_at`);
    expect(rows.map((r) => r.review_status)).toEqual(["superseded", "approved"]);
    expect((await call("POST", `/versions/${versions[0]}/reject`, { note: "hands" })).status).toBe(200);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStudioSetting } from "../../api/_lib/engine/jobs.js";
import { api, createHarness, drain, type Harness, login } from "../helpers/harness.js";

const BATCH = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30];

describe("simulated chapter 001 generation (mocked OpenAI)", () => {
  let h: Harness;
  let call: ReturnType<typeof api>;

  beforeEach(async () => {
    h = await createHarness();
    call = api(h, await login(h));
  });
  afterEach(async () => {
    await h.db.close?.();
  });

  it("shows v2 pages that already have art, leaves the rest of the 30-page v2 chapter ready and invents nothing past 030", async () => {
    const { status, data } = await call("GET", "/chapters/001");
    expect(status).toBe(200);
    expect(data.pages).toHaveLength(30);
    const pages = data.pages as { page: number; status: string; sourceImagePath: string | null; publishedSrc: string | null }[];
    const byPage = new Map(pages.map((p) => [p.page, p]));
    expect(byPage.get(1)?.status).toBe("published");
    expect(byPage.get(2)).toMatchObject({ status: "has_art", sourceImagePath: "stories/arc-01/chapter-001/pages/A01-C001-P002.png" });
    for (const p of pages) {
      if (p.publishedSrc) expect(p.status, `page ${p.page}`).toBe("published");
      else if (p.sourceImagePath) expect(p.status, `page ${p.page}`).toBe("has_art");
      else expect(p.status, `page ${p.page}`).toBe("ready");
    }
    expect(byPage.get(30)?.status).toBe("ready");
    expect(byPage.has(31)).toBe(false);
  });

  it("requires a single test page before a full job, then runs all ten pages unattended in order", async () => {
    const blocked = await call("POST", "/jobs", { chapterId: "001", pages: BATCH, confirmPaid: true });
    expect(blocked.status).toBe(409);
    expect(blocked.data.error.details.code).toBe("test_required");

    // Controlled single real-request path (mocked here).
    const test = await call("POST", "/jobs", { chapterId: "001", pages: [21], test: true, confirmPaid: true });
    expect(test.status).toBe(201);
    await drain(h);
    expect(h.images.calls).toHaveLength(1);
    const page21 = await call("GET", "/chapters/001/pages/21");
    expect(page21.data.versions).toHaveLength(1);
    expect(page21.data.versions[0].qaStatus).toBe("pass");
    const approve = await call("POST", `/versions/${page21.data.versions[0].id}/approve`, {});
    expect(approve.status).toBe(200);

    // Approving the test page unlocks unattended multi-page jobs.
    const rest = BATCH.filter((p) => p !== 21);
    const job = await call("POST", "/jobs", { chapterId: "001", pages: rest, confirmPaid: true, budgetUsd: 25 });
    expect(job.status).toBe(201);
    await drain(h);

    const pagesSeen = h.images.calls.map((c) => Number(/\bPage (\d+)\./.exec(c.prompt)?.[1]));
    expect(pagesSeen).toEqual(BATCH); // strict sequential order
    const detail = await call("GET", `/jobs/${job.data.job.id}`);
    expect(detail.data.job.status).toBe("completed");
    expect(detail.data.pages.every((p: { status: string }) => p.status === "awaiting_review")).toBe(true);
    expect(detail.data.job.spent_estimate_usd).toBeGreaterThan(0);
    expect(detail.data.job.spent_reported_usd).toBeGreaterThan(0);

    // Nothing was published automatically.
    expect(h.publisher.requests).toHaveLength(0);
    const chapter = await call("GET", "/chapters/001");
    expect(chapter.data.pages.filter((p: { status: string }) => p.status === "published")).toHaveLength(1);
  });

  it("attaches the identity sheets each v2 prompt names, in its order, then scene pages, and records them", async () => {
    await setStudioSetting(h.deps, "real_generation_verified", true);
    await call("POST", "/jobs", { chapterId: "001", pages: [23, 24], confirmPaid: true });
    await drain(h);
    const [p23, p24] = h.images.calls;
    expect(p23!.images.map((i) => i.label)).toEqual([
      "Ruby Bennett-Walker identity sheet (bennett-walker-ruby.png)",
      "Ethan Walker identity sheet (walker-ethan.png)",
    ]);
    // Page 022 has no image yet, so it is not attached, and the prompt says so.
    expect(p23!.prompt).toContain("Not attached: page 022");
    // Page 024 references the new page 023 (a QA-passed draft) after its identity sheets.
    expect(p24!.images.map((i) => i.label)).toEqual([
      "Ethan Walker identity sheet (walker-ethan.png)",
      "Morgan H. Walker identity sheet (walker-morgan.png)",
      "Page 023 (QA-passed draft awaiting review)",
    ]);
    // The verbatim prompt is preserved.
    expect(p24!.prompt).toContain("SPEECH (Ethan)");
    const v = await call("GET", "/chapters/001/pages/24");
    const refs = v.data.versions[0].references as { role: string; path: string }[];
    expect(refs.map((r) => r.role)).toEqual(["identity", "identity", "scene"]);
    expect(refs[0]!.path).toBe("characters/_reference-sheets/main_characters/walker-ethan.png");
  });

  it("updates the continuity record after each successful page", async () => {
    await setStudioSetting(h.deps, "real_generation_verified", true);
    await call("POST", "/jobs", { chapterId: "001", pages: [25, 26, 27, 28], confirmPaid: true });
    await drain(h);
    const rows = await h.db.query<{ page: number; state: { timeOfDay: string; characters: { name: string; outfit: string }[] } }>(
      `SELECT page, state FROM continuity_states WHERE chapter_id = '001' ORDER BY page`,
    );
    expect(rows.map((r) => r.page)).toEqual([25, 26, 27, 28]);
    expect(rows[0]!.state.timeOfDay).toBe("evening");
    expect(rows[3]!.state.timeOfDay).toBe("next morning");
    const ethan28 = rows[3]!.state.characters.find((c) => c.name === "Ethan");
    expect(ethan28?.outfit).toMatch(/charcoal long-sleeve henley/);
  });
});

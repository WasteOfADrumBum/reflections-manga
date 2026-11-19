import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStudioSetting } from "../../api/_lib/engine/jobs.js";
import { parseAlbum, parseCharacterGalleries, parseVisibility, visibilityJs } from "../../api/_lib/library.js";
import { api, BASE, createHarness, drain, fakePage, type Harness, login } from "../helpers/harness.js";

/**
 * The studio rework: outfit picks, one-off prompt edits, uploads, replacing
 * existing art, spending, creating story and characters, and site images.
 * Everything runs against mocked OpenAI and a mock GitHub publisher.
 */
let h: Harness;
let call: ReturnType<typeof api>;
let cookie: string;

async function form(p: string, fields: Record<string, string>, file?: { data: Buffer; name: string; type: string }, method = "POST") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append("file", new Blob([new Uint8Array(file.data)], { type: file.type }), file.name);
  const res = await h.handle(new Request(`${BASE}/api/studio${p}`, { method, headers: { cookie, "x-studio-request": "1", origin: BASE, host: "studio.test" }, body: fd }));
  return { status: res.status, data: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeEach(async () => {
  h = await createHarness();
  cookie = await login(h);
  call = api(h, cookie);
  await setStudioSetting(h.deps, "real_generation_verified", true);
});
afterEach(async () => h.db.close?.());

describe("outfit picks and prompt edits", () => {
  it("attaches the outfit chosen for a character instead of the prompt's sheet, for that run only", async () => {
    const page = await call("GET", "/chapters/001/pages/23");
    const ethan = page.data.cast.find((c: { characterId: string }) => c.characterId === "ethan-walker");
    // The prompt names the family copy walker-ethan.png, which is his main reference.
    expect(ethan.promptSheet).toBe("characters/main/ethan-walker/references/ethan-walker-reference-main.png");
    const suit = "characters/main/ethan-walker/outfits/ethan-walker-formal-wedding-suit.png";
    const plan = await call("POST", "/chapters/001/pages/23/plan", { options: { sheets: { "ethan-walker": suit } } });
    expect(plan.status).toBe(200);
    expect(plan.data.blockers).toEqual([]);
    const refs = plan.data.references as { path: string; label: string; characterId?: string }[];
    expect(refs.find((r) => r.characterId === "ethan-walker")).toMatchObject({ path: suit });
    expect(refs.find((r) => r.characterId === "ethan-walker")!.label).toMatch(/Wedding suit \(ethan-walker-formal-wedding-suit\.png, chosen for this run\)/);

    const res = await call("POST", "/chapters/001/pages/23/regenerate", { confirmPaid: true, options: { sheets: { "ethan-walker": suit } } });
    expect(res.status).toBe(202);
    await drain(h);
    expect(h.images.calls).toHaveLength(1);
    expect(h.images.calls[0]!.images.some((i) => i.label.includes("Wedding suit"))).toBe(true);
    // The next plan without options goes back to the prompt's own sheet.
    const again = await call("POST", "/chapters/001/pages/23/plan", {});
    expect(again.data.references.find((r: { characterId?: string }) => r.characterId === "ethan-walker").path).not.toBe(suit);
  });

  it("refuses a sheet that belongs to someone else", async () => {
    const plan = await call("POST", "/chapters/001/pages/23/plan", { options: { sheets: { "ethan-walker": "characters/main/morgan-hayes/outfits/morgan-hayes-formal-wedding-lace-blouse-pink-skirt.png" } } });
    expect(plan.data.warnings.join(" ")).toMatch(/not one of theirs/);
    expect(plan.data.references.find((r: { characterId?: string }) => r.characterId === "ethan-walker").path).not.toMatch(/morgan/);
  });

  it("sends an edited prompt for one run without changing the repository, and blocks dialogue drift unless confirmed", async () => {
    const page = await call("GET", "/chapters/001/pages/23");
    const original: string = page.data.prompt.text;
    const extra = `${original}\n\nExtra direction: warmer evening light.`;
    const plan = await call("POST", "/chapters/001/pages/23/plan", { options: { promptOverride: extra } });
    expect(plan.data.promptEdited).toBe(true);
    expect(plan.data.blockers).toEqual([]);
    expect(plan.data.finalPrompt).toMatch(/warmer evening light/);

    const drift = original.replace("You missed two murders.", "You missed three murders.");
    const blocked = await call("POST", "/chapters/001/pages/23/plan", { options: { promptOverride: drift } });
    expect(blocked.data.blockers.join(" ")).toMatch(/Script check/);
    const allowed = await call("POST", "/chapters/001/pages/23/plan", { options: { promptOverride: drift, allowScriptDrift: true } });
    expect(allowed.data.blockers).toEqual([]);

    await call("POST", "/chapters/001/pages/23/regenerate", { confirmPaid: true, options: { promptOverride: extra } });
    await drain(h);
    expect(h.images.calls[0]!.prompt).toMatch(/warmer evening light/);
    expect(await h.repo.readText(page.data.prompt.path)).toBe(original);
    const v = (await h.db.query<{ prompt_edited: boolean }>(`SELECT prompt_edited FROM page_versions`))[0]!;
    expect(v.prompt_edited).toBe(true);
  });
});

describe("uploads and replacing existing art", () => {
  it("takes an uploaded page through review and publishes it as a replacement only when confirmed", async () => {
    const up = await form("/chapters/001/pages/2/upload", { note: "Made in ChatGPT" }, { data: await fakePage("upload"), name: "p2.png", type: "image/png" });
    expect(up.status).toBe(201);
    expect(h.images.calls).toHaveLength(0);
    const review = await call("GET", "/review");
    const p2 = review.data.pages.find((p: { page: number }) => p.page === 2);
    expect(p2).toMatchObject({ hasArt: true });
    expect(p2.versions[0]).toMatchObject({ source: "upload", reviewStatus: "awaiting_review", reviewNote: "Made in ChatGPT" });

    expect((await call("POST", `/versions/${up.data.id}/approve`, {})).status).toBe(200);
    const refused = await call("POST", "/publish", { chapterId: "001", versionIds: [up.data.id], confirm: true, allowGap: true });
    expect(refused.status).toBe(409);
    expect(refused.data.error.details.code).toBe("replace_required");

    const res = await call("POST", "/publish", { chapterId: "001", versionIds: [up.data.id], confirm: true, allowGap: true, replacePages: [2] });
    expect(res.status).toBe(201);
    const pr = h.publisher.requests.at(-1)!;
    const paths = pr.files.map((f) => f.path);
    // The original manuscript PNG is never overwritten; the studio copy sits beside it.
    expect(paths).not.toContain("stories/arc-01/chapter-001/pages/A01-C001-P002.png");
    expect(paths.some((p) => /A01-C001-P002\.studio-[0-9a-f]{8}\.png$/.test(p))).toBe(true);
    expect(paths).toContain("site/pages/chapter-001/002.webp");
    expect(pr.body).toMatch(/Replaces the reader image for page 002/);
  });

  it("rejects an upload that is not a portrait page", async () => {
    const up = await form("/chapters/001/pages/24/upload", {}, { data: await fakePage("wide", 1536, 1024), name: "wide.png", type: "image/png" });
    expect(up.status).toBe(400);
    expect(up.data.error.message).toMatch(/2:3/);
  });

  it("replaces a published page's reader entry instead of adding a second one", async () => {
    await call("POST", "/chapters/001/pages/1/regenerate", { confirmPaid: true });
    await drain(h);
    const id = (await h.db.query<{ id: string }>(`SELECT id FROM page_versions WHERE page = 1`))[0]!.id;
    await call("POST", `/versions/${id}/approve`, {});
    const res = await call("POST", "/publish", { chapterId: "001", versionIds: [id], confirm: true, replacePages: [1] });
    expect(res.status).toBe(201);
    const js = h.publisher.requests.at(-1)!.files.find((f) => f.path === "site/js/chapters.js")!.content.toString();
    const sandbox = { window: {} as Record<string, unknown> };
    vm.runInNewContext(js, sandbox);
    const ch = (sandbox.window.REFLECTIONS_CHAPTERS as { id: string; pages: { src: string }[] }[]).find((c) => c.id === "001")!;
    expect(ch.pages.filter((p) => p.src.endsWith("/001.webp"))).toHaveLength(1);
  });
});

describe("spending and performance", () => {
  it("reports monthly dollars and tokens, pages kept, and flags pages that needed many attempts", async () => {
    await setStudioSetting(h.deps, "attempt_flag_threshold", 2);
    await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true });
    await drain(h);
    await call("POST", "/chapters/001/pages/21/regenerate", { confirmPaid: true });
    await drain(h);
    const id = (await h.db.query<{ id: string }>(`SELECT id FROM page_versions WHERE page = 21 ORDER BY created_at DESC LIMIT 1`))[0]!.id;
    await call("POST", `/versions/${id}/approve`, {});
    const r = await call("GET", "/spending");
    expect(r.status).toBe(200);
    expect(r.data.byMonth).toHaveLength(12);
    const month = r.data.byMonth.at(-1);
    expect(month.imageAttempts).toBe(2);
    expect(month.outputTokens).toBeGreaterThan(0);
    expect(month.pagesGenerated).toBe(2);
    expect(month.pagesUsed).toBe(1);
    expect(r.data.attemptsPerAcceptedPage).toBe(2);
    expect(r.data.flags).toEqual([expect.objectContaining({ chapterId: "001", page: 21, attempts: 2, accepted: true })]);
  });
});

describe("creating story and characters through pull requests", () => {
  it("adds a character to a cast group with a main sheet, registered in the asset manifest", async () => {
    const res = await form("/create/character", { displayName: "June Carter", group: "friends", role: "Ruby's coworker" }, { data: await fakePage("sheet", 1536, 1024), name: "s.png", type: "image/png" });
    expect(res.status).toBe(201);
    const pr = h.publisher.requests.at(-1)!;
    expect(pr.files.map((f) => f.path).sort()).toEqual([
      "characters/asset-manifest.json",
      "characters/friends/june-carter/index.md",
      "characters/friends/june-carter/outfits/index.md",
      "characters/friends/june-carter/references/index.md",
      "characters/friends/june-carter/references/june-carter-reference-main.png",
    ]);
    expect(pr.files.find((f) => f.path.endsWith("june-carter/index.md"))!.content.toString()).toMatch(/^# June Carter/);
    const m = JSON.parse(pr.files.find((f) => f.path === "characters/asset-manifest.json")!.content.toString());
    const asset = m.assets.find((a: { characterId: string }) => a.characterId === "june-carter");
    expect(asset).toMatchObject({ role: "main", category: "casual", review: null, dimensions: [1536, 1024], characterPath: "characters/friends/june-carter" });
    expect(asset.originalPath).toMatch(/^studio-upload:/);
    expect(m.characterGroups.friends.characterIds).toContain("june-carter");
  });

  it("refuses a character that already exists or has no main sheet", async () => {
    const sheet = { data: await fakePage("sheet", 1536, 1024), name: "s.png", type: "image/png" };
    expect((await form("/create/character", { displayName: "Ethan Walker", group: "main" }, sheet)).status).toBe(409);
    expect((await form("/create/character", { displayName: "No Sheet", group: "friends" })).status).toBe(400);
  });

  it("adds an outfit sheet in its category, listed in the outfit library and the manifest", async () => {
    const res = await form("/characters/ethan-walker/sheets", { label: "Winter coat", category: "outerwear" }, { data: await fakePage("coat", 1536, 1024), name: "c.png", type: "image/png" });
    expect(res.status).toBe(201);
    expect(res.data.path).toBe("characters/main/ethan-walker/outfits/ethan-walker-outerwear-winter-coat.png");
    const pr = h.publisher.requests.at(-1)!;
    const index = pr.files.find((f) => f.path === "characters/main/ethan-walker/outfits/index.md")!.content.toString();
    expect(index).toMatch(/\| outerwear \| \[ethan-walker-outerwear-winter-coat\]\(ethan-walker-outerwear-winter-coat\.png\) \|/);
    const m = JSON.parse(pr.files.find((f) => f.path === "characters/asset-manifest.json")!.content.toString());
    expect(m.assets.find((a: { path: string }) => a.path === res.data.path)).toMatchObject({ role: "outfit", category: "outerwear", characterId: "ethan-walker" });
    expect((await form("/characters/ethan-walker/sheets", { label: "Coat", category: "nonsense" }, { data: await fakePage("coat", 1536, 1024), name: "c.png", type: "image/png" })).status).toBe(400);
  });

  it("adds an arc and a chapter, registering the chapter in the studio config", async () => {
    const arc = await call("POST", "/create/arc", { title: "Second Wind", focus: "What comes after." });
    expect(arc.status).toBe(201);
    expect(arc.data.id).toBe("arc-05");
    const ch = await call("POST", "/create/chapter", { arcId: "arc-01", title: "Different Languages", plannedPages: 24, logline: "Morgan and Ruby read Ethan differently." });
    expect(ch.status).toBe(201);
    expect(ch.data.chapterId).toBe("002");
    const pr = h.publisher.requests.at(-1)!;
    const cfg = JSON.parse(pr.files.find((f) => f.path === "production/studio/config.json")!.content.toString());
    expect(cfg.chapters["002"]).toMatchObject({ arcId: "arc-01", title: "Different Languages", plannedPages: 24, storyDir: "stories/arc-01/chapter-002" });
    expect(cfg.chapters["001"].title).toBe("Three Hearts, Different Needs");
    const outline = pr.files.find((f) => f.path === "stories/arc-01/chapter-002/outline.md")!.content.toString();
    expect(outline).toMatch(/Morgan and Ruby read Ethan differently\./);
  });

  it("names an outfit in the studio without touching the repository", async () => {
    const path = "characters/main/ethan-walker/outfits/ethan-walker-formal-wedding-suit.png";
    expect((await call("PUT", "/sheets/label", { path, label: "Gym" })).status).toBe(200);
    const chars = await call("GET", "/characters");
    const ethan = chars.data.characters.find((c: { id: string }) => c.id === "ethan-walker");
    expect(ethan.sheets.find((s: { path: string }) => s.path === path).label).toBe("Gym");
    expect((await call("PUT", "/sheets/label", { path: "characters/nobody/x.png", label: "x" })).status).toBe(404);
  });
});

describe("site images", () => {
  it("reads the galleries and album from the static pages", async () => {
    const chars = parseCharacterGalleries((await h.repo.readText("site/characters.html"))!);
    const ethan = chars.find((c) => c.id === "ethan-walker")!;
    expect(ethan.images.length).toBeGreaterThan(5);
    expect(ethan.images[0]!.href).toMatch(/^\/images\//);
    const album = parseAlbum((await h.repo.readText("site/memories.html"))!);
    expect(album[0]!.href).toBe("/images/family/family-1536.webp");
  });

  it("publishes hidden images and a new album photo in one pull request", async () => {
    const up = await form("/site/album-items", { title: "Porch swing", alt: "Ethan, Morgan and Ruby share the porch swing at dusk." }, { data: await fakePage("porch", 1536, 1024), name: "p.png", type: "image/png" });
    expect(up.status).toBe(201);
    const res = await call("POST", "/site/publish", { hidden: { characters: { "ethan-walker": ["/images/moments/ethan-cal-carry-1536.webp"] }, album: ["/images/moments/hayes-family-portrait-1536.webp"] }, addAlbumItems: [up.data.id], confirm: true });
    expect(res.status).toBe(201);
    const pr = h.publisher.requests.at(-1)!;
    const js = pr.files.find((f) => f.path === "site/js/visibility-data.js")!.content.toString();
    const v = parseVisibility(js);
    expect(v.hidden.characters["ethan-walker"]).toEqual(["/images/moments/ethan-cal-carry-1536.webp"]);
    expect(v.albumAdditions).toHaveLength(1);
    expect(v.albumAdditions[0]).toMatchObject({ title: "Porch swing", wide: false });
    expect(pr.files.filter((f) => f.path.startsWith("site/images/"))).toHaveLength(2);
    const sandbox = { window: {} as Record<string, unknown> };
    vm.runInNewContext(visibilityJs(v), sandbox);
    expect(sandbox.window.REFLECTIONS_VISIBILITY).toEqual(v);
  });

  it("refuses paths outside the site images folder", async () => {
    const res = await call("POST", "/site/publish", { hidden: { characters: {}, album: ["../../etc/passwd"] }, confirm: true });
    expect(res.status).toBe(400);
  });
});

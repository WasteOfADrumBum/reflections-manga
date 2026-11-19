import { describe, expect, it } from "vitest";
import { loadCharacters, resolveSheetFiles } from "../../api/_lib/content/characters.js";
import { ContentService, type LoadedPrompt } from "../../api/_lib/content/chapters.js";
import { loadStudioConfig } from "../../api/_lib/content/config.js";
import { parsePrompt } from "../../api/_lib/content/prompt-parser.js";
import { buildContinuityState, inferTimeOfDay } from "../../api/_lib/engine/continuity.js";
import { buildFinalPrompt, planReferences } from "../../api/_lib/engine/references.js";
import { backoffMs } from "../../api/_lib/engine/worker.js";
import { classifyProviderError } from "../../api/_lib/openai/providers.js";
import { costFromUsage, estimateJob, estimatePageCost } from "../../api/_lib/openai/pricing.js";
import { compareTranscription, normalizeText, similarity } from "../../api/_lib/qa/dialogue.js";
import { combineQa, deterministicChecks } from "../../api/_lib/qa/evaluate.js";
import { testRepo } from "../helpers/harness.js";

const repo = testRepo();
async function prompt(page: number) {
  const c = new ContentService(repo, await loadStudioConfig(repo));
  return { prompt: (await c.loadPrompt("001", page)) as LoadedPrompt, script: await c.scriptPage("001", page) };
}

async function sheets(p: LoadedPrompt) {
  const config = await loadStudioConfig(repo);
  return resolveSheetFiles(repo, await loadCharacters(repo), config.chapters["001"]!.identitySheetDirs, p.referenceOrder.flatMap((r) => (r.file ? [r.file] : [])));
}

describe("reference planning", () => {
  it("attaches the sheets the v2 prompt names, in its order, then outfits and scene pages", async () => {
    const { prompt: p } = await prompt(24);
    const plan = planReferences({
      chapterId: "001",
      prompt: p,
      characters: await loadCharacters(repo),
      sheetFiles: await sheets(p),
      uploads: [
        { id: "u1", characterId: "morgan-hayes", kind: "outfit", status: "approved", label: "porch cardigan", blobPath: "studio/references/u1.png", chapterId: "001", pages: [24] },
        { id: "u2", characterId: "morgan-hayes", kind: "outfit", status: "experimental", label: "draft", blobPath: "studio/references/u2.png", chapterId: null, pages: null },
        { id: "u3", characterId: "ethan-walker", kind: "outfit", status: "approved", label: "other chapter", blobPath: "studio/references/u3.png", chapterId: "002", pages: null },
      ],
      findScenePage: () => null,
      maxSceneReferences: 3,
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.entries.map((e) => `${e.slot}:${e.role}:${e.characterId ?? e.page ?? ""}`)).toEqual([
      "1:identity:ethan-walker",
      "2:identity:morgan-hayes",
      "3:outfit:morgan-hayes",
    ]);
    expect(plan.entries[0]!.path).toBe("characters/_reference-sheets/main_characters/walker-ethan.png");
    expect(plan.warnings.join(" ")).toMatch(/page 023 has no usable image/);
    const final = buildFinalPrompt(p, plan);
    expect(final.startsWith(p.text.trimEnd())).toBe(true);
    expect(final).toContain("image 1 = Ethan Walker identity sheet (walker-ethan.png)");
    expect(final).toContain("Not attached: page 023");
  });

  it("keeps all six sheets for page 001 and caps scene pages", async () => {
    const { prompt: p1 } = await prompt(1);
    const plan1 = planReferences({ chapterId: "001", prompt: p1, characters: await loadCharacters(repo), sheetFiles: await sheets(p1), uploads: [], findScenePage: () => null, maxSceneReferences: 3 });
    expect(plan1.blockers).toEqual([]);
    expect(plan1.entries.map((e) => e.path.split("/").pop())).toEqual([
      "bennett-walker-ruby.png",
      "walker-ethan.png",
      "walker-morgan.png",
      "morgan-hayes-formal-wedding-lace-blouse-pink-skirt.png",
      "ruby-bennett-walker-formal-wedding-dress.png",
      "ethan-walker-formal-wedding-suit.png",
    ]);
    const { prompt: p28 } = await prompt(28);
    const scene = (page: number) => ({ page, source: "repo" as const, path: `stories/x/P${page}.png`, provisional: false, label: `Page ${page}` });
    const plan28 = planReferences({ chapterId: "001", prompt: p28, characters: await loadCharacters(repo), sheetFiles: await sheets(p28), uploads: [], findScenePage: scene, maxSceneReferences: 2 });
    expect(plan28.entries.filter((e) => e.role === "scene").map((e) => e.page)).toEqual([27, 10]);
    expect(plan28.warnings.join(" ")).toMatch(/Skipped scene reference page 012/);
  });

  it("blocks a page when a named sheet cannot be found", async () => {
    const { prompt: p } = await prompt(23);
    const found = await sheets(p);
    found.set("walker-ethan.png", null);
    const plan = planReferences({ chapterId: "001", prompt: p, characters: await loadCharacters(repo), sheetFiles: found, uploads: [], findScenePage: () => null, maxSceneReferences: 2 });
    expect(plan.blockers.join(" ")).toMatch(/"walker-ethan.png" named in the reference order was not found/);
  });

  it("v1 prompts still use each character's canonical card", async () => {
    const text = (await repo.readText("stories/arc-01/chapter-001/prompts/version_001/page-023-v1.txt"))!;
    const p = { ...parsePrompt(text, { page: 23, version: 1 }), path: "v1" } as LoadedPrompt;
    const chars = (await loadCharacters(repo)).map((c) => (c.id === "morgan-hayes" ? { ...c, canonicalSheet: null } : c));
    const plan = planReferences({ chapterId: "001", prompt: p, characters: chars, uploads: [], findScenePage: () => null, maxSceneReferences: 2 });
    expect(plan.entries[0]!.label).toBe("Ethan Walker canonical identity sheet");
    expect(plan.blockers.join(" ")).toMatch(/Morgan H. Walker has no character sheet image/);
  });
});

describe("continuity", () => {
  it("infers time of day from explicit instructions", () => {
    expect(inferTimeOfDay("The NEXT morning, same kitchen")).toBe("next morning");
    expect(inferTimeOfDay("Second morning, all three at the table")).toBe("next morning");
    expect(inferTimeOfDay("Later THAT NIGHT")).toBe("night");
    expect(inferTimeOfDay("nothing here")).toBeNull();
  });

  it("builds a record from the page instructions", async () => {
    const { prompt: p, script } = await prompt(28);
    const s = buildContinuityState({ prompt: p, script, previous: null, previousApprovedPage: 27 });
    expect(s.timeOfDay).toBe("next morning");
    expect(s.location).toMatch(/kitchen/);
    expect(s.characters.find((c) => c.name === "Ethan")?.outfit).toMatch(/charcoal long-sleeve henley/);
    expect(s.scene).toBe(script!.title);
    expect(s.previousApprovedPage).toBe(27);
    expect(s.source).toBe("prompt");
  });
});

describe("costs", () => {
  it("estimates conservatively and labels assumptions", () => {
    const e = estimatePageCost("gpt-image-2.5-sunburst", "high", 3);
    expect(e.basis).toBe("estimate");
    expect(e.totalUsd).toBeGreaterThan(0.2);
    expect(e.assumptions.join(" ")).toMatch(/assumed/);
    const job = estimateJob({ model: "gpt-image-2.5-sunburst", quality: "high", pages: 10, referencesPerPage: 3, expectedRetryRate: 0.5, maxAttempts: 3 });
    expect(job.worstCaseUsd).toBeCloseTo(e.totalUsd * 30, 2);
    expect(job.expectedUsd).toBeCloseTo(e.totalUsd * 15, 2);
  });

  it("refuses models without verified pricing", () => {
    expect(() => estimatePageCost("gpt-image-9", "high", 1)).toThrow(/verified pricing/);
  });

  it("calculates cost from reported usage", () => {
    expect(costFromUsage("gpt-image-2.5-sunburst", { output_tokens: 1_000_000, input_tokens_details: { image_tokens: 0, text_tokens: 0 } })).toBe(30);
    expect(costFromUsage("gpt-image-2.5-sunburst", null)).toBeNull();
  });
});

describe("retry policy", () => {
  it("backs off exponentially with jitter and a cap", () => {
    expect(backoffMs(1, 30_000, 180_000, () => 0.5)).toBe(30_000);
    expect(backoffMs(2, 30_000, 180_000, () => 0.5)).toBe(60_000);
    expect(backoffMs(10, 30_000, 180_000, () => 0.5)).toBe(180_000);
    expect(backoffMs(1, 30_000, 180_000, () => 0)).toBe(24_000);
  });

  it("classifies provider errors", () => {
    expect(classifyProviderError({ status: 429, message: "x", headers: { "retry-after": "12" } })).toMatchObject({ cls: "rate_limited", retryAfterMs: 12_000 });
    expect(classifyProviderError({ status: 500, message: "x" }).cls).toBe("retryable");
    expect(classifyProviderError({ status: 401, message: "x" }).cls).toBe("blocker");
    expect(classifyProviderError({ status: 400, code: "insufficient_quota", message: "x" }).cls).toBe("blocker");
    expect(classifyProviderError({ status: 400, code: "moderation_blocked", message: "safety" }).cls).toBe("rejected");
    expect(classifyProviderError({ status: 400, message: "Invalid size" }).cls).toBe("blocker");
    expect(classifyProviderError(new Error("fetch failed")).cls).toBe("retryable");
  });
});

describe("dialogue and QA", () => {
  it("normalises typography", () => {
    expect(normalizeText("I’m tired… — “Morgan”")).toBe(`i'm tired... - "morgan"`);
    expect(similarity("Hello there", "hello there")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });

  it("finds missing, altered, duplicated and extra text", () => {
    const expected = [
      { text: "What's wrong with you today?", panel: 1 },
      { text: "Nothing.", panel: 1 },
      { text: "Bullshit. You haven't stopped moving.", panel: 2 },
    ];
    const r = compareTranscription(expected, [
      { panel: 1, text: "Whats wrong with you today" },
      { panel: 2, text: "Bullshit. You haven't stopped moving." },
      { panel: 2, text: "Bullshit. You haven't stopped moving." },
      { panel: 3, text: "LOL" },
    ]);
    expect(r.missing).toEqual(["Nothing."]);
    expect(r.altered).toHaveLength(1);
    expect(r.duplicated).toHaveLength(1);
    expect(r.extra).toEqual(["LOL"]);
    expect(r.score).toBeLessThan(0.5);
  });

  it("fails wrong dimensions deterministically", () => {
    const checks = deterministicChecks({ width: 1024, height: 1024, format: "png", bytes: 900_000, sha256: "x" });
    expect(checks.find((c) => c.name === "dimensions")!.status).toBe("fail");
  });

  it("is uncertain, never a pass, when the vision model is unavailable", async () => {
    const { prompt: p, script } = await prompt(23);
    const r = combineQa({ info: { width: 1024, height: 1536, format: "png", bytes: 900_000, sha256: "x" }, prompt: p, script, vision: null, visionError: "timeout", passThreshold: 0.8, reviewThreshold: 0.55 });
    expect(r.status).not.toBe("pass");
    expect(r.reasons.join(" ")).toMatch(/manual review/);
  });
});

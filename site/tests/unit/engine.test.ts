import { describe, expect, it } from "vitest";
import { loadCharacters } from "../../api/_lib/content/characters.ts";
import { ContentService, type LoadedPrompt } from "../../api/_lib/content/chapters.ts";
import { loadStudioConfig } from "../../api/_lib/content/config.ts";
import { buildContinuityState, inferTimeOfDay } from "../../api/_lib/engine/continuity.ts";
import { buildFinalPrompt, planReferences } from "../../api/_lib/engine/references.ts";
import { backoffMs } from "../../api/_lib/engine/worker.ts";
import { classifyProviderError } from "../../api/_lib/openai/providers.ts";
import { costFromUsage, estimateJob, estimatePageCost } from "../../api/_lib/openai/pricing.ts";
import { compareTranscription, normalizeText, similarity } from "../../api/_lib/qa/dialogue.ts";
import { combineQa, deterministicChecks } from "../../api/_lib/qa/evaluate.ts";
import { LocalRepoSource } from "../../api/_lib/repo/source.ts";
import { REPO_ROOT } from "../helpers/harness.ts";

const repo = new LocalRepoSource(REPO_ROOT);
async function prompt(page: number) {
  const c = new ContentService(repo, await loadStudioConfig(repo));
  return { prompt: (await c.loadPrompt("001", page)) as LoadedPrompt, script: await c.scriptPage("001", page) };
}

describe("reference planning", () => {
  it("puts identity sheets first in prompt order and caps scene pages", async () => {
    const { prompt: p } = await prompt(24);
    const plan = planReferences({
      chapterId: "001",
      prompt: p,
      characters: await loadCharacters(repo),
      uploads: [
        { id: "u1", characterId: "ruby-bennett-walker", kind: "outfit", status: "approved", label: "lavender cardigan", blobPath: "studio/references/u1.png", chapterId: "001", pages: [24] },
        { id: "u2", characterId: "ruby-bennett-walker", kind: "outfit", status: "experimental", label: "draft", blobPath: "studio/references/u2.png", chapterId: null, pages: null },
        { id: "u3", characterId: "morgan-hayes", kind: "outfit", status: "approved", label: "other chapter", blobPath: "studio/references/u3.png", chapterId: "002", pages: null },
      ],
      findScenePage: (page) => (page === 22 ? { page, source: "studio", path: "studio/drafts/p22.png", provisional: false, label: "Page 022 (approved studio version)" } : null),
      maxSceneReferences: 2,
    });
    expect(plan.blockers).toEqual([]);
    expect(plan.entries.map((e) => `${e.slot}:${e.role}:${e.characterId ?? e.page ?? ""}`)).toEqual([
      "1:identity:morgan-hayes",
      "2:identity:ruby-bennett-walker",
      "3:outfit:ruby-bennett-walker",
      "4:scene:22",
    ]);
    expect(plan.warnings.join(" ")).toMatch(/page 023 has no usable image/);
    const final = buildFinalPrompt(p, plan);
    expect(final.startsWith(p.text.trimEnd())).toBe(true);
    expect(final).toContain("image 4 = Page 022 (approved studio version) (scene continuity only; never overrides the identity sheets)");
    expect(final).toContain("Not attached: page 023");
  });

  it("blocks a page whose character has no canonical sheet", async () => {
    const { prompt: p } = await prompt(23);
    const chars = (await loadCharacters(repo)).map((c) => (c.id === "morgan-hayes" ? { ...c, canonicalSheet: null } : c));
    const plan = planReferences({ chapterId: "001", prompt: p, characters: chars, uploads: [], findScenePage: () => null, maxSceneReferences: 2 });
    expect(plan.blockers.join(" ")).toMatch(/Morgan H. Walker has no canonical reference sheet/);
  });
});

describe("continuity", () => {
  it("infers time of day from explicit instructions", () => {
    expect(inferTimeOfDay("The NEXT morning, same kitchen")).toBe("next morning");
    expect(inferTimeOfDay("Later THAT NIGHT")).toBe("night");
    expect(inferTimeOfDay("nothing here")).toBeNull();
  });

  it("builds a record from the page instructions", async () => {
    const { prompt: p, script } = await prompt(28);
    const s = buildContinuityState({ prompt: p, script, previous: null, previousApprovedPage: 27 });
    expect(s.timeOfDay).toBe("next morning");
    expect(s.location).toMatch(/kitchen/);
    expect(s.characters.find((c) => c.name === "Morgan H. Walker")?.outfit).toMatch(/BURGUNDY/);
    expect(s.props.join(" ")).toMatch(/mixing bowl/);
    expect(s.relationships.join(" ")).toMatch(/PLATONIC/);
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

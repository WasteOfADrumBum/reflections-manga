import { describe, expect, it } from "vitest";
import { loadCharacters, parseCurrentCard, resolveCharacter } from "../../api/_lib/content/characters.ts";
import { ContentService, findChapterBlock, publishedPagesFromChaptersJs } from "../../api/_lib/content/chapters.ts";
import { loadStudioConfig, parsePageRanges } from "../../api/_lib/content/config.ts";
import { classifyLettering, expectedLettering, parsePrompt, parsePromptFilename } from "../../api/_lib/content/prompt-parser.ts";
import { checkPromptAgainstScript } from "../../api/_lib/qa/dialogue.ts";
import { LocalRepoSource } from "../../api/_lib/repo/source.ts";
import { REPO_ROOT } from "../helpers/harness.ts";

const repo = new LocalRepoSource(REPO_ROOT);

describe("prompt parser", () => {
  it("parses file names", () => {
    expect(parsePromptFilename("page-023-v1.txt")).toEqual({ page: 23, version: 1 });
    expect(parsePromptFilename("page-23.txt")).toBeNull();
  });

  it("extracts page 023 exactly as written", async () => {
    const text = (await repo.readText("stories/arc-01/chapter-001/prompts/page-023-v1.txt"))!;
    const p = parsePrompt(text, { page: 23, version: 1 });
    expect(p.text).toBe(text); // verbatim, never summarised
    expect(p.panelCount).toBe(5);
    expect(p.panels).toHaveLength(5);
    expect(p.referenceOrder).toEqual([
      { index: 1, name: "Ethan" },
      { index: 2, name: "Morgan" },
    ]);
    expect(p.sceneReferences.map((s) => s.page)).toEqual([22, 7]);
    expect(p.characters.map((c) => c.name)).toEqual(["Ethan Walker", "Morgan H. Walker"]);
    expect(p.characters[1]!.outfit).toMatch(/olive utility overshirt/);
    expect(p.setting).toMatch(/^A little later that first morning/);
    expect(p.continuity[0]!.label).toBe("FIRST-MORNING CONTINUITY");
    const lines = expectedLettering(p);
    expect(lines[0]).toMatchObject({ kind: "speech", speaker: "Morgan", text: "What's wrong with you today?", panel: 1 });
    expect(lines.at(-1)).toMatchObject({ kind: "thought", speaker: "Ethan", panel: 5 });
    expect(p.warnings).toEqual([]);
  });

  it("marks conditional scene references as optional", async () => {
    const p21 = parsePrompt((await repo.readText("stories/arc-01/chapter-001/prompts/page-021-v1.txt"))!, { page: 21, version: 1 });
    expect(p21.sceneReferences).toEqual([
      expect.objectContaining({ page: 20, optional: true }),
      expect.objectContaining({ page: 10, optional: false }),
    ]);
  });

  it("classifies lettering labels", () => {
    expect(classifyLettering("Ethan INTERNAL CAPTION, no speech tail")).toEqual({ kind: "thought", speaker: "Ethan" });
    expect(classifyLettering("TIME CAPTION, no speech tail")).toEqual({ kind: "time", speaker: null });
    expect(classifyLettering("Ruby speech balloon")).toEqual({ kind: "speech", speaker: "Ruby" });
    expect(classifyLettering("Morgan")).toEqual({ kind: "speech", speaker: "Morgan" });
  });

  it.each([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])("page %i prompt matches the canonical script word for word", async (page) => {
    const config = await loadStudioConfig(repo);
    const c = new ContentService(repo, config);
    const prompt = (await c.loadPrompt("001", page))!;
    const script = await c.scriptPage("001", page);
    const result = checkPromptAgainstScript(expectedLettering(prompt), script);
    expect(result.problems).toEqual([]);
    expect(prompt.panels).toHaveLength(prompt.panelCount!);
    expect(prompt.referenceOrder.length).toBeGreaterThan(0);
  });

  it("detects a prompt that drifted from the script", async () => {
    const c = new ContentService(repo, await loadStudioConfig(repo));
    const prompt = (await c.loadPrompt("001", 23))!;
    const lines = expectedLettering(prompt);
    lines[1] = { ...lines[1]!, text: "Nothing at all." };
    const res = checkPromptAgainstScript(lines, await c.scriptPage("001", 23));
    expect(res.ok).toBe(false);
    expect(res.problems[0]).toMatch(/Nothing at all/);
  });
});

describe("chapter inventory", () => {
  it("reads page ranges", () => {
    expect([...parsePageRanges("1-3, 7")]).toEqual([1, 2, 3, 7]);
    expect(() => parsePageRanges("3-1")).toThrow();
  });

  it("finds published reader pages for chapter 001 only", async () => {
    const js = (await repo.readText("site/js/chapters.js"))!;
    const pub = publishedPagesFromChaptersJs(js, "001");
    expect([...pub.keys()]).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(publishedPagesFromChaptersJs(js, "002").size).toBe(0);
    expect(findChapterBlock(js, "004")?.text).toMatch(/Always the One Who Reaches/);
  });

  it("locks 001-020, leaves 021-030 ready and 031-032 unprepared", async () => {
    const c = new ContentService(repo, await loadStudioConfig(repo));
    const inv = await c.inventory("001");
    expect(inv.pages).toHaveLength(32);
    expect(inv.pages.filter((p) => p.locked).map((p) => p.page)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(inv.pages.filter((p) => !p.locked && p.prepared).map((p) => p.page)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
    expect(inv.pages.filter((p) => !p.prepared).map((p) => p.page)).toEqual([31, 32]);
    expect(inv.pages[15]!.sourceImagePath).toBe("stories/arc-01/chapter-001/pages/A01-C001-P016.png");
  });
});

describe("character library", () => {
  it("finds the canonical card and keeps other sheets experimental", async () => {
    const chars = await loadCharacters(repo);
    const ethan = chars.find((c) => c.id === "ethan-walker")!;
    expect(ethan.canonicalSheet).toBe("characters/ethan-walker/references/ethan-walker-reference-sheet-v1.png");
    expect(ethan.references[0]!.status).toBe("canonical");
    expect(ethan.references.filter((r) => r.status === "canonical")).toHaveLength(1);
    expect(ethan.references.length).toBeGreaterThan(1);
    expect(ethan.portrait).toBe("/images/characters/ethan-walker-portrait.webp");
    // Supporting cast without a "Current Card" have no canonical sheet.
    expect(chars.find((c) => c.id === "nathan-hayes")!.canonicalSheet).toBeNull();
  });

  it("resolves the names used in prompts", async () => {
    const chars = await loadCharacters(repo);
    expect(resolveCharacter(chars, "Morgan")?.id).toBe("morgan-hayes");
    expect(resolveCharacter(chars, "Ruby")?.id).toBe("ruby-bennett-walker");
    expect(resolveCharacter(chars, "Rowan")?.id).toBe("rowan-hayes-walker");
    expect(resolveCharacter(chars, "Cal")?.id).toBe("caleb-mercer");
    expect(resolveCharacter(chars, "Nobody")).toBeNull();
  });

  it("parses only the Current Card section", () => {
    expect(parseCurrentCard("# X\n## Current Card\n- [a](a-v1.png)\n## Other\n- [b](b-v2.png)")).toBe("a-v1.png");
    expect(parseCurrentCard("# X\n## Other\n- [b](b-v2.png)")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { characterForSheetName, loadCharacters, outfitLabelFromLinkText, parseCurrentCard, resolveCharacter, resolveSheetFiles } from "../../api/_lib/content/characters.js";
import { ContentService, findChapterBlock, type LoadedPrompt, publishedPagesFromChaptersJs } from "../../api/_lib/content/chapters.js";
import { loadStudioConfig, parsePageRanges } from "../../api/_lib/content/config.js";
import { classifyLettering, expectedLettering, nameFromSheetFile, parsePrompt, parsePromptFilename } from "../../api/_lib/content/prompt-parser.js";
import { parseScript } from "../../api/_lib/content/script-parser.js";
import { checkPromptAgainstScript } from "../../api/_lib/qa/dialogue.js";
import { LocalRepoSource } from "../../api/_lib/repo/source.js";
import { REPO_ROOT, testRepo } from "../helpers/harness.js";

const raw = new LocalRepoSource(REPO_ROOT);
const repo = testRepo();
const V2 = "stories/arc-01/chapter-001/prompts/version_002";
const V1 = "stories/arc-01/chapter-001/prompts/version_001";

describe("prompt parser (version 2 layout)", () => {
  it("parses file names", () => {
    expect(parsePromptFilename("page-023-v2.txt")).toEqual({ page: 23, version: 2 });
    expect(parsePromptFilename("page-023-v2.md")).toBeNull();
    expect(parsePromptFilename("page-23.txt")).toBeNull();
  });

  it("extracts page 023 exactly as written", async () => {
    const text = (await raw.readText(`${V2}/page-023-v2.txt`))!;
    const p = parsePrompt(text, { page: 23, version: 2 });
    expect(p.text).toBe(text); // verbatim, never summarised
    expect(p.panelCount).toBe(3);
    expect(p.panels).toHaveLength(3);
    expect(p.referenceOrder).toEqual([
      { index: 1, name: "Ruby", file: "bennett-walker-ruby.png" },
      { index: 2, name: "Ethan", file: "walker-ethan.png" },
    ]);
    expect(p.sceneReferences.map((s) => s.page)).toEqual([22]);
    expect(p.characters.map((c) => c.name)).toEqual(["Ruby", "Ethan"]);
    expect(p.characters[1]!.outfit).toMatch(/dark sage short-sleeve henley/);
    expect(p.setting).toMatch(/^Cream-walled kitchen/);
    expect(p.continuity[0]!.text).toMatch(/^Night one/);
    const lines = expectedLettering(p);
    expect(lines[0]).toMatchObject({ kind: "speech", speaker: "Ethan", text: "Sometimes it sounds like everyone's in the next room. It was like that this morning.", panel: 1 });
    expect(lines.at(-1)).toMatchObject({ kind: "speech", speaker: "Ethan", text: "Start with the first one.", panel: 3 });
    expect(p.warnings).toEqual([]);
  });

  it("reads numbered sheet lists, child sheets and extra scene pages", async () => {
    const p1 = parsePrompt((await raw.readText(`${V2}/page-001-v2.txt`))!, { page: 1, version: 2 });
    expect(p1.referenceOrder.map((r) => r.file)).toEqual([
      "bennett-walker-ruby.png",
      "walker-ethan.png",
      "walker-morgan.png",
      "morgan-hayes-reference-sheet-v7.png",
      "ruby-bennett-walker-reference-sheet-v11.png",
      "ethan-walker-reference-sheet-v5.png",
    ]);
    const p8 = parsePrompt((await raw.readText(`${V2}/page-008-v2.txt`))!, { page: 8, version: 2 });
    expect(p8.referenceOrder.map((r) => r.name)).toEqual(["Morgan", "Avery", "Rowan", "Riley"]);
    expect(p8.referenceOrder[1]!.file).toBe("children/bennett-walker-avery.png");
    const p28 = parsePrompt((await raw.readText(`${V2}/page-028-v2.txt`))!, { page: 28, version: 2 });
    expect(p28.sceneReferences.map((s) => [s.page, s.optional])).toEqual([
      [27, false],
      [10, true],
      [12, true],
    ]);
  });

  it("classifies lettering labels in both layouts", () => {
    expect(classifyLettering("SPEECH (Ruby)")).toEqual({ kind: "speech", speaker: "Ruby" });
    expect(classifyLettering("THOUGHT (Ethan)")).toEqual({ kind: "thought", speaker: "Ethan" });
    expect(classifyLettering("NARRATION (Narrator)")).toEqual({ kind: "caption", speaker: null });
    expect(classifyLettering("Ethan INTERNAL CAPTION, no speech tail")).toEqual({ kind: "thought", speaker: "Ethan" });
    expect(classifyLettering("TIME CAPTION, no speech tail")).toEqual({ kind: "time", speaker: null });
    expect(classifyLettering("Ruby speech balloon")).toEqual({ kind: "speech", speaker: "Ruby" });
  });

  it("names characters from sheet files", () => {
    expect(nameFromSheetFile("walker-ethan.png")).toBe("Ethan");
    expect(nameFromSheetFile("children/bennett-walker-avery.png")).toBe("Avery");
    expect(nameFromSheetFile("morgan-hayes-reference-sheet-v7.png")).toBe("Morgan");
  });

  it.each(Array.from({ length: 30 }, (_, i) => i + 1))("page %i prompt matches script-v2.md word for word", async (page) => {
    const config = await loadStudioConfig(repo);
    const c = new ContentService(repo, config);
    const prompt = (await c.loadPrompt("001", page)) as LoadedPrompt;
    expect(prompt.path).toBe(`${V2}/page-${String(page).padStart(3, "0")}-v2.txt`);
    const script = await c.scriptPage("001", page);
    const result = checkPromptAgainstScript(expectedLettering(prompt), script);
    expect(result.problems).toEqual([]);
    expect(prompt.panels).toHaveLength(prompt.panelCount!);
    expect(prompt.referenceOrder.length).toBeGreaterThan(0);
    expect(prompt.referenceOrder.every((r) => r.file)).toBe(true);
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

  it("still parses the version 1 layout", async () => {
    const text = (await raw.readText(`${V1}/page-023-v1.txt`))!;
    const p = parsePrompt(text, { page: 23, version: 1 });
    expect(p.panelCount).toBe(5);
    expect(p.panels).toHaveLength(5);
    expect(p.referenceOrder).toEqual([
      { index: 1, name: "Ethan" },
      { index: 2, name: "Morgan" },
    ]);
    expect(expectedLettering(p)[0]).toMatchObject({ kind: "speech", speaker: "Morgan", text: "What's wrong with you today?", panel: 1 });
  });
});

describe("script-v2.md", () => {
  it("parses thirty pages with panels and typed lines", async () => {
    const pages = parseScript((await raw.readText("stories/arc-01/chapter-001/script-v2.md"))!);
    expect([...pages.keys()]).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const p22 = pages.get(22)!;
    expect(p22.title).toBe("The unfinished page");
    expect(p22.panels.map((x) => x.lines.length)).toEqual([2, 1, 2]);
    expect(p22.panels[2]!.lines[1]).toMatchObject({ kind: "thought", speaker: "Ruby", text: "I thought he wanted me to leave him alone. Did I ever ask?" });
    expect(pages.get(1)!.panels[0]!.lines[0]).toMatchObject({ kind: "caption", speaker: null });
  });
});

describe("chapter inventory", () => {
  it("reads page ranges", () => {
    expect([...parsePageRanges("1-3, 7")]).toEqual([1, 2, 3, 7]);
    expect([...parsePageRanges("")]).toEqual([]);
    expect(() => parsePageRanges("3-1")).toThrow();
  });

  it("finds published reader pages for chapter 001 only", async () => {
    const js = (await repo.readText("site/js/chapters.js"))!;
    const pub = publishedPagesFromChaptersJs(js, "001");
    expect([...pub.keys()]).toEqual([1]);
    expect(publishedPagesFromChaptersJs(js, "002").size).toBe(0);
    expect(findChapterBlock(js, "004")?.text).toMatch(/Always the One Who Reaches/);
  });

  it("marks pages with v2 artwork as having art (not locked) and leaves the rest of the 30-page v2 chapter ready", async () => {
    const c = new ContentService(repo, await loadStudioConfig(repo));
    const inv = await c.inventory("001");
    expect(inv.pages).toHaveLength(30);
    expect(inv.scriptPath).toBe("stories/arc-01/chapter-001/script-v2.md");
    // Page 001 is in the reader. Page 002's finished file is part of the v2 layout.
    // Existing art no longer locks a page: new versions are allowed, and only
    // lockedPages in the config locks one.
    expect(inv.pages[0]!.publishedSrc).toBe("/pages/chapter-001/001.webp");
    expect(inv.pages[1]).toMatchObject({ locked: false, hasArt: true, sourceImagePath: "stories/arc-01/chapter-001/pages/A01-C001-P002.png" });
    for (const p of inv.pages) {
      expect(p.locked, `page ${p.page}`).toBe(false);
      expect(p.hasArt, `page ${p.page}`).toBe(p.publishedSrc != null || p.sourceImagePath != null);
    }
    expect(inv.pages[29]).toMatchObject({ locked: false, hasArt: false, sourceImagePath: null, prepared: true });
    expect(inv.pages[0]!.beat).toBe("The empty space");
    expect(inv.pages.every((p) => p.prepared)).toBe(true);
    // Old v1 numbering locks nothing: v1 art lives in pages/version_1/.
    expect(inv.pages[15]!.sourceImagePath).toBeNull();
  });
});

describe("character library", () => {
  it("treats every sheet as an outfit, picks a default and finds family copies", async () => {
    const chars = await loadCharacters(repo, { labelDocs: ["stories/arc-01/chapter-001/page-guide-v2.md"] });
    const ethan = chars.find((c) => c.id === "ethan-walker")!;
    expect(ethan.canonicalSheet).toBe("characters/ethan-walker/references/ethan-walker-reference-sheet-v1.png");
    expect(ethan.references[0]!.status).toBe("canonical");
    expect(ethan.references.filter((r) => r.status === "canonical")).toHaveLength(1);
    expect(ethan.portrait).toBe("/images/characters/ethan-walker-portrait.webp");
    expect(ethan.sheets.length).toBeGreaterThanOrEqual(8);
    // The family copy is the same sheet as v1, not a separate outfit.
    expect(ethan.sheets[0]!.aliases).toContain("characters/_reference-sheets/main_characters/walker-ethan.png");
    // Named by the page guide link "Ethan's wedding suit v5".
    expect(ethan.sheets.find((s) => s.version === 5)!.label).toBe("Wedding suit (v5)");
    // No "Current Card" no longer means "no sheet": every character with an image has a default.
    for (const c of chars) if (c.sheets.length) expect(c.canonicalSheet, c.id).not.toBeNull();
    expect(chars.find((c) => c.id === "nathan-hayes")!.canonicalSheet).toBe("characters/nathan-hayes/references/nathan-hayes-reference-character-sheet-v1.png");
    // A family sheet with no original in the index still belongs to its character.
    const diane = chars.find((c) => c.id === "diane-hayes")!;
    expect(diane.sheets.some((s) => s.path === "characters/_reference-sheets/hayes/hayes-diane.png" || s.aliases.includes("characters/_reference-sheets/hayes/hayes-diane.png"))).toBe(true);
  });

  it("names outfits from link text", () => {
    const c = { firstName: "Morgan", displayName: "Morgan H. Walker" };
    expect(outfitLabelFromLinkText("Morgan's wedding outfit v7", c)).toBe("Wedding outfit");
    expect(outfitLabelFromLinkText("Morgan H. Walker reference sheet", c)).toBe("Main sheet");
    expect(outfitLabelFromLinkText("Morgan", c)).toBeNull();
    expect(outfitLabelFromLinkText("Morgan identity input", c)).toBeNull();
  });

  it("resolves the names used in prompts", async () => {
    const chars = await loadCharacters(repo);
    expect(resolveCharacter(chars, "Morgan")?.id).toBe("morgan-hayes");
    expect(resolveCharacter(chars, "Ruby")?.id).toBe("ruby-bennett-walker");
    expect(resolveCharacter(chars, "Rowan")?.id).toBe("rowan-hayes-walker");
    expect(resolveCharacter(chars, "Nobody")).toBeNull();
  });

  it("resolves sheet files named by v2 prompts only inside the sheet folders", async () => {
    const chars = await loadCharacters(repo);
    const config = await loadStudioConfig(repo);
    const dirs = config.chapters["001"]!.identitySheetDirs;
    const found = await resolveSheetFiles(repo, chars, dirs, [
      "walker-ethan.png",
      "children/walker-riley.png",
      "morgan-hayes-reference-sheet-v7.png",
      "missing-person.png",
      "../site/images/x.png",
    ]);
    expect(found.get("walker-ethan.png")).toEqual({ path: "characters/_reference-sheets/main_characters/walker-ethan.png", characterId: "ethan-walker" });
    expect(found.get("children/walker-riley.png")).toEqual({ path: "characters/_reference-sheets/main_characters/children/walker-riley.png", characterId: "riley-hayes-walker" });
    expect(found.get("morgan-hayes-reference-sheet-v7.png")).toEqual({ path: "characters/morgan-hayes/references/morgan-hayes-reference-sheet-v7.png", characterId: "morgan-hayes" });
    expect(found.get("missing-person.png")).toBeNull();
    expect(found.get("../site/images/x.png")).toBeNull();
    expect(characterForSheetName(chars, "bennett-walker-ruby.png")?.id).toBe("ruby-bennett-walker");
    expect(characterForSheetName(chars, "walker-morgan.png")?.id).toBe("morgan-hayes");
  });

  it("parses only the Current Card section", () => {
    expect(parseCurrentCard("# X\n## Current Card\n- [a](a-v1.png)\n## Other\n- [b](b-v2.png)")).toBe("a-v1.png");
    expect(parseCurrentCard("# X\n## Other\n- [b](b-v2.png)")).toBeNull();
  });
});

import type { RepoSource } from "../repo/source.js";
import { type CharacterRecord, loadCharacters } from "./characters.js";
import { type ChapterConfig, type StudioConfig, pad3, parsePageRanges } from "./config.js";
import { type ParsedPrompt, parsePrompt, parsePromptFilename } from "./prompt-parser.js";
import { type ScriptPage, parseScript } from "./script-parser.js";

export interface RepoPageInfo {
  page: number;
  promptPath: string | null;
  promptVersion: number | null;
  sourceImagePath: string | null;
  publishedSrc: string | null;
  /** Artwork already exists (manuscript PNG or reader page). New versions are still allowed. */
  hasArt: boolean;
  /** Only pages listed in lockedPages are locked; existing artwork no longer locks a page. */
  locked: boolean;
  lockReason: string | null;
  prepared: boolean;
  unpreparedReason: string | null;
  scriptTitle: string | null;
  plot: string | null;
  /** One-line beat from the chapter page guide, when there is one. */
  beat: string | null;
}

export interface ArcInfo {
  id: string;
  number: number;
  title: string;
  focus: string | null;
  indexPath: string;
  chapterIds: string[];
}

/** Text of a "## Heading" section in a markdown file, with blank-line paragraphs joined. */
export function markdownSection(md: string, heading: RegExp): string | null {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => /^##\s/.test(l) && heading.test(l.replace(/^##\s+/, "")));
  if (start < 0) return null;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(l)) break;
    body.push(l);
  }
  const text = body
    .join("\n")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => p && !p.startsWith("|"))
    .join("\n\n");
  return text || null;
}

/** "| [001](...) | The empty space | ... |" rows of a page guide -> page -> beat. */
export function pageBeats(guide: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of guide.split("\n")) {
    const m = /^\|\s*\[?(\d{3})\]?(?:\([^)]*\))?\s*\|\s*([^|]+?)\s*\|/.exec(line);
    if (m) out.set(Number(m[1]), m[2]!.trim());
  }
  return out;
}

export interface ChapterInventory {
  id: string;
  config: ChapterConfig;
  pages: RepoPageInfo[];
  scriptPath: string;
}

export function publishedPagesFromChaptersJs(js: string, chapterId: string): Map<number, string> {
  const out = new Map<number, string>();
  const block = findChapterBlock(js, chapterId);
  if (!block) return out;
  const re = /src:\s*"(\/pages\/[^"]+\/(\d{3})\.webp)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block.text)) !== null) out.set(Number(m[2]), m[1] ?? "");
  return out;
}

/** Locates the `{ id: "001", ... }` object literal inside REFLECTIONS_CHAPTERS. */
export function findChapterBlock(js: string, chapterId: string): { start: number; end: number; text: string } | null {
  const arrayStart = js.indexOf("window.REFLECTIONS_CHAPTERS = [");
  if (arrayStart < 0) return null;
  const idRe = new RegExp(`\\{\\s*\\n?\\s*id:\\s*"${chapterId}"`, "g");
  idRe.lastIndex = arrayStart;
  const m = idRe.exec(js);
  if (!m) return null;
  const start = m.index;
  const end = matchBracket(js, start, "{", "}");
  if (end < 0) return null;
  return { start, end, text: js.slice(start, end + 1) };
}

/** Returns the index of the bracket closing the one at `openIndex`, skipping strings and comments. */
export function matchBracket(src: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2);
      if (i < 0) return -1;
      i++;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export class ContentService {
  private scriptCache = new Map<string, Promise<Map<number, ScriptPage>>>();
  private charactersCache: Promise<CharacterRecord[]> | null = null;
  private beatsCache = new Map<string, Promise<Map<number, string>>>();
  constructor(
    private readonly repo: RepoSource,
    private readonly config: StudioConfig,
  ) {}

  get studioConfig() {
    return this.config;
  }

  chapterIds(): string[] {
    return Object.keys(this.config.chapters).sort();
  }

  chapterConfig(id: string): ChapterConfig | null {
    return this.config.chapters[id] ?? null;
  }

  async promptFiles(chapter: ChapterConfig): Promise<Map<number, { path: string; version: number }>> {
    const entries = await this.repo.list(`${chapter.storyDir}/${chapter.promptDir}`);
    const latest = new Map<number, { path: string; version: number }>();
    for (const e of entries) {
      const meta = parsePromptFilename(e.name);
      if (!meta) continue;
      const cur = latest.get(meta.page);
      if (!cur || meta.version > cur.version) latest.set(meta.page, { path: e.path, version: meta.version });
    }
    return latest;
  }

  script(chapter: ChapterConfig): Promise<Map<number, ScriptPage>> {
    const path = `${chapter.storyDir}/${chapter.scriptFile}`;
    let p = this.scriptCache.get(path);
    if (!p) {
      p = this.repo.readText(path).then((t) => (t ? parseScript(t) : new Map()));
      this.scriptCache.set(path, p);
    }
    return p;
  }

  /** Page guides in a chapter folder ("page-guide-v2.md" preferred over "page-guide.md"). */
  async pageGuides(chapter: ChapterConfig): Promise<string[]> {
    const files = (await this.repo.list(chapter.storyDir)).filter((e) => e.type === "file" && /^page-guide[\w.-]*\.md$/.test(e.name)).map((e) => e.path);
    const rev = chapter.revisionLabel ? files.filter((f) => f.includes(`-${chapter.revisionLabel}.`)) : [];
    return rev.length ? rev : files;
  }

  beats(chapter: ChapterConfig): Promise<Map<number, string>> {
    let p = this.beatsCache.get(chapter.storyDir);
    if (!p) {
      p = this.pageGuides(chapter).then(async (files) => {
        const merged = new Map<number, string>();
        for (const f of files) for (const [k, v] of pageBeats((await this.repo.readText(f)) ?? "")) if (!merged.has(k)) merged.set(k, v);
        return merged;
      });
      this.beatsCache.set(chapter.storyDir, p);
    }
    return p;
  }

  /** The character library, read once per content refresh (about a minute). */
  characters(): Promise<CharacterRecord[]> {
    this.charactersCache ??= (async () => {
      const guides = (await Promise.all(Object.values(this.config.chapters).map((c) => this.pageGuides(c)))).flat();
      return loadCharacters(this.repo, { labelDocs: guides });
    })().catch((err) => {
      this.charactersCache = null;
      throw err;
    });
    return this.charactersCache;
  }

  /** Arcs from stories/arc-NN/index.md, with the chapters configured for each. */
  async arcs(): Promise<ArcInfo[]> {
    const dirs = (await this.repo.list("stories")).filter((e) => e.type === "dir" && /^arc-\d{2}$/.test(e.name));
    const arcs = await Promise.all(
      dirs.map(async (d) => {
        const md = (await this.repo.readText(`${d.path}/index.md`)) ?? "";
        const h1 = /^#\s+(.+)$/m.exec(md)?.[1]?.trim() ?? d.name;
        const number = Number(d.name.slice(4));
        return {
          id: d.name,
          number,
          title: h1.replace(/^Arc\s+\d+\s*[:·-]\s*/i, "").trim(),
          focus: markdownSection(md, /^Focus/i),
          indexPath: `${d.path}/index.md`,
          chapterIds: this.chapterIds().filter((id) => this.config.chapters[id]!.arcId === d.name),
        } satisfies ArcInfo;
      }),
    );
    for (const id of this.chapterIds()) {
      const c = this.config.chapters[id]!;
      if (!arcs.some((a) => a.id === c.arcId)) arcs.push({ id: c.arcId, number: c.arcNumber, title: c.arcTitle ?? c.arcId, focus: null, indexPath: "", chapterIds: [id] });
    }
    return arcs.sort((a, b) => a.number - b.number);
  }

  /** Chapter logline from outline.md ("## Logline"), else the outline's first paragraph. */
  async chapterSynopsis(chapterId: string): Promise<{ synopsis: string | null; outlinePath: string | null }> {
    const c = this.chapterConfig(chapterId);
    if (!c) return { synopsis: null, outlinePath: null };
    const path = `${c.storyDir}/outline.md`;
    const md = await this.repo.readText(path);
    if (!md) return { synopsis: null, outlinePath: null };
    return { synopsis: markdownSection(md, /^Logline/i) ?? markdownSection(md, /^(Summary|Synopsis|Premise)/i), outlinePath: path };
  }

  async inventory(chapterId: string): Promise<ChapterInventory> {
    const config = this.chapterConfig(chapterId);
    if (!config) throw new Error(`Unknown chapter ${chapterId}`);
    const [prompts, sourceEntries, chaptersJs, script, beats] = await Promise.all([
      this.promptFiles(config),
      this.repo.list(`${config.storyDir}/${config.sourcePagePattern.split("/").slice(0, -1).join("/")}`),
      this.repo.readText("site/js/chapters.js"),
      this.script(config),
      this.beats(config),
    ]);
    const sourceNames = new Set(sourceEntries.map((e) => e.name));
    const published = publishedPagesFromChaptersJs(chaptersJs ?? "", chapterId);
    const locked = parsePageRanges(config.lockedPages);
    const unprepared = parsePageRanges(config.unpreparedPages);
    const pages: RepoPageInfo[] = [];
    for (let page = 1; page <= config.plannedPages; page++) {
      const sourceRel = config.sourcePagePattern.replace("{page}", pad3(page));
      const sourceName = sourceRel.split("/").pop() ?? "";
      const sourceImagePath = sourceNames.has(sourceName) ? `${config.storyDir}/${sourceRel}` : null;
      const prompt = prompts.get(page);
      const isLocked = locked.has(page);
      const lockReason = isLocked ? config.lockReason : null;
      const prepared = !unprepared.has(page) && prompt != null && script.has(page);
      pages.push({
        page,
        promptPath: prompt?.path ?? null,
        promptVersion: prompt?.version ?? null,
        sourceImagePath,
        publishedSrc: published.get(page) ?? null,
        hasArt: sourceImagePath != null || published.has(page),
        locked: isLocked,
        lockReason: isLocked ? lockReason : null,
        prepared,
        unpreparedReason: prepared ? null : unprepared.has(page) ? config.unpreparedReason : !prompt ? "No page prompt file exists yet." : "The script has no entry for this page.",
        scriptTitle: script.get(page)?.title ?? null,
        plot: script.get(page)?.plot ?? null,
        beat: beats.get(page) ?? null,
      });
    }
    return { id: chapterId, config, pages, scriptPath: `${config.storyDir}/${config.scriptFile}` };
  }

  async loadPrompt(chapterId: string, page: number): Promise<ParsedPrompt | null> {
    const config = this.chapterConfig(chapterId);
    if (!config) return null;
    const files = await this.promptFiles(config);
    const f = files.get(page);
    if (!f) return null;
    const text = await this.repo.readText(f.path);
    if (!text) return null;
    return { ...parsePrompt(text, { page, version: f.version }), path: f.path } as ParsedPrompt & { path: string };
  }

  async scriptPage(chapterId: string, page: number): Promise<ScriptPage | null> {
    const config = this.chapterConfig(chapterId);
    if (!config) return null;
    return (await this.script(config)).get(page) ?? null;
  }
}

export type LoadedPrompt = ParsedPrompt & { path: string };

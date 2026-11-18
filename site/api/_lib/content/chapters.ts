import type { RepoSource } from "../repo/source.ts";
import { type ChapterConfig, type StudioConfig, pad3, parsePageRanges } from "./config.ts";
import { type ParsedPrompt, parsePrompt, parsePromptFilename } from "./prompt-parser.ts";
import { type ScriptPage, parseScript } from "./script-parser.ts";

export interface RepoPageInfo {
  page: number;
  promptPath: string | null;
  promptVersion: number | null;
  sourceImagePath: string | null;
  publishedSrc: string | null;
  locked: boolean;
  lockReason: string | null;
  prepared: boolean;
  unpreparedReason: string | null;
  scriptTitle: string | null;
  plot: string | null;
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

  async inventory(chapterId: string): Promise<ChapterInventory> {
    const config = this.chapterConfig(chapterId);
    if (!config) throw new Error(`Unknown chapter ${chapterId}`);
    const [prompts, sourceEntries, chaptersJs, script] = await Promise.all([
      this.promptFiles(config),
      this.repo.list(`${config.storyDir}/${config.sourcePagePattern.split("/").slice(0, -1).join("/")}`),
      this.repo.readText("site/js/chapters.js"),
      this.script(config),
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
      const isLocked = locked.has(page) || sourceImagePath != null || published.has(page);
      const lockReason = locked.has(page)
        ? config.lockReason
        : sourceImagePath
          ? "Finished artwork for this page is already in the repository."
          : published.has(page)
            ? "This page is already published in the reader."
            : null;
      const prepared = !unprepared.has(page) && prompt != null && script.has(page);
      pages.push({
        page,
        promptPath: prompt?.path ?? null,
        promptVersion: prompt?.version ?? null,
        sourceImagePath,
        publishedSrc: published.get(page) ?? null,
        locked: isLocked,
        lockReason: isLocked ? lockReason : null,
        prepared,
        unpreparedReason: prepared ? null : unprepared.has(page) ? config.unpreparedReason : !prompt ? "No page prompt file exists yet." : "The script has no entry for this page.",
        scriptTitle: script.get(page)?.title ?? null,
        plot: script.get(page)?.plot ?? null,
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

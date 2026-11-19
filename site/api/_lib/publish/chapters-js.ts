import { findChapterBlock, matchBracket } from "../content/chapters.js";

export interface ReaderPageEntry {
  page: number;
  src: string;
  alt: string;
  width: number;
  height: number;
}

function jsString(s: string): string {
  return JSON.stringify(s);
}

export function formatEntry(e: ReaderPageEntry): string {
  return `{ src: ${jsString(e.src)}, alt: ${jsString(e.alt)}, width: ${e.width}, height: ${e.height} }`;
}

/**
 * Inserts reader entries into the chapter's `pages: [...]` array in
 * site/js/chapters.js, keeping page order. Existing entries are never changed
 * or removed; a page that is already listed is refused unless the owner chose
 * to replace it (opts.replace).
 */
export function addPagesToChaptersJs(js: string, chapterId: string, entries: ReaderPageEntry[], opts: { replace?: Set<number> } = {}): string {
  const block = findChapterBlock(js, chapterId);
  if (!block) throw new Error(`Chapter ${chapterId} is not in site/js/chapters.js.`);
  const pagesKey = /\bpages:\s*\[/g;
  pagesKey.lastIndex = 0;
  const local = pagesKey.exec(block.text);
  if (!local) throw new Error(`Chapter ${chapterId} has no pages array.`);
  const open = block.start + local.index + local[0].length - 1;
  const close = matchBracket(js, open, "[", "]");
  if (close < 0 || close > block.end) throw new Error("Could not parse the pages array.");
  const inner = js.slice(open + 1, close);

  // Existing entries, one per line, as written by hand today.
  const existing: { page: number | null; text: string }[] = [];
  let i = 0;
  while (i < inner.length) {
    const start = inner.indexOf("{", i);
    if (start < 0) break;
    const end = matchBracket(inner, start, "{", "}");
    if (end < 0) throw new Error("Unbalanced page entry.");
    const text = inner.slice(start, end + 1);
    const m = /\/(\d{3})\.webp"/.exec(text);
    existing.push({ page: m ? Number(m[1]) : null, text });
    i = end + 1;
  }
  for (const e of entries) {
    if (!opts.replace?.has(e.page) && existing.some((x) => x.page === e.page)) throw new Error(`Page ${String(e.page).padStart(3, "0")} is already listed in the reader.`);
  }
  // A replacement swaps that page's entry (new alt text and size); every other entry stays as written.
  const kept = existing.filter((x) => !(x.page != null && opts.replace?.has(x.page) && entries.some((e) => e.page === x.page)));
  const merged = [...kept, ...entries.map((e) => ({ page: e.page, text: formatEntry(e) }))].sort((a, b) => (a.page ?? 0) - (b.page ?? 0));

  const indentMatch = /\n(\s*)\{/.exec(inner);
  const indent = indentMatch?.[1] ?? "      ";
  const closingIndent = /\n(\s*)$/.exec(inner)?.[1] ?? "    ";
  const body = merged.map((m) => `${indent}${m.text}`).join(",\n");
  return `${js.slice(0, open + 1)}\n${body}\n${closingIndent}${js.slice(close)}`;
}

/** Updates the chapter note when it still describes an early-look subset. */
export function updateChapterNote(js: string, chapterId: string, publishedCount: number, plannedPages: number): string {
  const block = findChapterBlock(js, chapterId);
  if (!block) return js;
  const noteRe = /note:\s*"([^"\\]|\\.)*"/;
  const m = noteRe.exec(block.text);
  if (!m) return js;
  const note =
    publishedCount >= plannedPages
      ? "All pages are up."
      : `The first ${publishedCount} of ${plannedPages} pages are up as an early look. More pages land here as they are finished.`;
  const replaced = block.text.replace(noteRe, `note: ${jsString(note)}`);
  return js.slice(0, block.start) + replaced + js.slice(block.end + 1);
}

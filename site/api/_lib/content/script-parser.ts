import { type LetteringKind, classifyLettering } from "./prompt-parser.js";

/**
 * Parser for chapter scripts (script-v2.md, or the older script.md layout). The script is the canonical source of
 * exact dialogue; prompts are checked against it before any paid request, and
 * generated pages are checked against it afterwards.
 */
export interface ScriptLine {
  id: string;
  panel: number;
  order: number;
  kind: LetteringKind;
  speaker: string | null;
  text: string;
}

export interface ScriptPage {
  page: number;
  title: string;
  plot: string | null;
  visibleCast: string | null;
  timeLocation: string | null;
  layout: string | null;
  panels: { number: number; visual: string; lines: ScriptLine[] }[];
}

const LINE = /^\s*(\d+)\.\s+`([^`]+)`\s+[—-]+\s+(.+?):\s*["“](.*)["”]\s*$/;

function kindFor(id: string, label: string): { kind: LetteringKind; speaker: string | null } {
  const l = label.toLowerCase();
  if (l.includes("time caption")) return { kind: "time", speaker: null };
  if (l.includes("internal caption") || l.includes("thought")) return { kind: "thought", speaker: label.split(",")[0]!.trim() };
  if (l.includes("caption") || l.includes("narration")) return { kind: "caption", speaker: null };
  if (/\.SFX/i.test(id)) return { kind: "sfx", speaker: null };
  return { kind: "speech", speaker: label.trim() };
}

const V2_PAGE = /^###\s+(\d{3})\s*[·•—-]\s*(.*)$/m;
const V2_LINE = /^((?:SPEECH|THOUGHT|NARRATION|CAPTION|SFX)\s*(?:\([^)]*\))?):\s*["“](.*)["”]\s*$/;

/**
 * v2 scripts (script-v2.md): "### 021 · Title", a scene note, then
 * "PANEL N: visual" followed by lines like SPEECH (Ruby): "...".
 */
export function parseScriptV2(markdown: string): Map<number, ScriptPage> {
  const pages = new Map<number, ScriptPage>();
  let page: ScriptPage | null = null;
  let panel: ScriptPage["panels"][number] | null = null;
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const pm = /^###\s+(\d{3})\s*[·•—-]\s*(.*)$/.exec(raw);
    if (pm) {
      page = { page: Number(pm[1]), title: (pm[2] ?? "").trim(), plot: null, visibleCast: null, timeLocation: null, layout: null, panels: [] };
      pages.set(page.page, page);
      panel = null;
      continue;
    }
    if (/^#{1,2}\s/.test(raw)) {
      page = null;
      panel = null;
      continue;
    }
    if (!page) continue;
    const t = raw.trim();
    const pn = /^PANEL\s+(\d+)\s*(?::|—|-)\s*(.*)$/.exec(t);
    if (pn) {
      panel = { number: Number(pn[1]), visual: (pn[2] ?? "").trim(), lines: [] };
      page.panels.push(panel);
      continue;
    }
    if (!panel) {
      if (t && !page.timeLocation) page.timeLocation = t;
      continue;
    }
    const lm = V2_LINE.exec(t);
    if (lm) {
      const { kind, speaker } = classifyLettering(lm[1] ?? "");
      const order = panel.lines.length + 1;
      panel.lines.push({ id: `${String(page.page).padStart(3, "0")}.${panel.number}.${order}`, panel: panel.number, order, kind, speaker, text: lm[2] ?? "" });
    }
  }
  for (const pg of pages.values()) pg.plot = pg.timeLocation;
  return pages;
}

export function parseScript(markdown: string): Map<number, ScriptPage> {
  if (V2_PAGE.test(markdown)) return parseScriptV2(markdown);
  const pages = new Map<number, ScriptPage>();
  let page: ScriptPage | null = null;
  let panel: ScriptPage["panels"][number] | null = null;
  for (const raw of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const pm = /^###\s+Page\s+(\d{3})\s*[—-]*\s*(.*)$/.exec(raw);
    if (pm) {
      page = { page: Number(pm[1]), title: (pm[2] ?? "").trim(), plot: null, visibleCast: null, timeLocation: null, layout: null, panels: [] };
      pages.set(page.page, page);
      panel = null;
      continue;
    }
    if (/^##\s/.test(raw)) {
      // A new top-level section ends the current page.
      page = null;
      panel = null;
      continue;
    }
    if (!page) continue;
    const pn = /^####\s+Panel\s+\d{3}\.(\d+)/.exec(raw);
    if (pn) {
      panel = { number: Number(pn[1]), visual: "", lines: [] };
      page.panels.push(panel);
      continue;
    }
    if (!panel) {
      if (raw.startsWith("Plot summary:")) page.plot = raw.slice(13).trim();
      else if (raw.startsWith("Visible cast across this page:")) page.visibleCast = raw.slice(30).trim();
      else if (raw.startsWith("Time/location:")) page.timeLocation = raw.slice(14).trim();
      else if (raw.startsWith("Proposed layout:")) page.layout = raw.slice(16).trim();
      continue;
    }
    if (raw.startsWith("- Visual:")) {
      panel.visual = raw.slice(9).trim();
      continue;
    }
    const lm = LINE.exec(raw);
    if (lm) {
      const id = lm[2] ?? "";
      const { kind, speaker } = kindFor(id, lm[3] ?? "");
      panel.lines.push({ id, panel: panel.number, order: Number(lm[1]), kind, speaker, text: lm[4] ?? "" });
    }
  }
  return pages;
}

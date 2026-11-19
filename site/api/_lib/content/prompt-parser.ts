import { createHash } from "node:crypto";

/**
 * Parser for the repository's full-page generation prompts, e.g.
 * stories/arc-01/chapter-001/prompts/version_002/page-023-v2.txt (v2 layout:
 * identity sheets named by file, SPEECH/THOUGHT/NARRATION lettering) or the
 * older v1 layout (image N = Name, labelled balloons).
 *
 * The prompt text itself is sent to OpenAI VERBATIM. This parser only extracts
 * structure the studio needs around it: which reference images to attach and
 * in what order, the expected cast, panel count and exact lettering for
 * validation, and the scene facts used for the continuity record.
 */

export type LetteringKind = "speech" | "thought" | "caption" | "time" | "sfx";

export interface LetteringItem {
  kind: LetteringKind;
  speaker: string | null;
  text: string;
  raw: string;
}

export interface PromptPanel {
  number: number;
  description: string;
  emotionalDirection: string | null;
  lettering: LetteringItem[];
  silent: boolean;
}

export interface ReferenceSlot {
  index: number;
  /** Character first name as used in the prompt ("Ethan"). */
  name: string;
  /** v2 prompts name the exact sheet file to attach, e.g. "children/walker-riley.png". */
  file?: string;
}

export interface SceneReference {
  page: number;
  note: string;
  /** "if available" / "may clarify": attach only when an image actually exists. */
  optional: boolean;
}

export interface PromptCharacter {
  name: string;
  description: string;
  outfit: string | null;
}

export interface ParsedPrompt {
  page: number;
  version: number;
  sha256: string;
  text: string;
  panelCount: number | null;
  referenceOrder: ReferenceSlot[];
  referenceInstructions: string;
  sceneReferences: SceneReference[];
  plot: string | null;
  format: string | null;
  visibleCast: string | null;
  characters: PromptCharacter[];
  setting: string | null;
  continuity: { label: string; text: string }[];
  layout: string | null;
  panels: PromptPanel[];
  ending: string | null;
  warnings: string[];
}

const NUMBER_WORDS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10 };

export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/** "page-023-v2.txt" -> { page: 23, version: 2 } */
export function parsePromptFilename(name: string): { page: number; version: number } | null {
  const m = /^page-(\d{3})-v(\d+)\.txt$/.exec(name);
  return m ? { page: Number(m[1]), version: Number(m[2]) } : null;
}

const HEADER = /^([A-Z][A-Z0-9 /'&-]{1,40}):\s?(.*)$/;

function splitBlocks(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
}

const V2_LABEL = /^(SPEECH|THOUGHT|NARRATION|CAPTION|SFX)\s*(?:\(([^)]*)\))?$/;

export function classifyLettering(label: string): { kind: LetteringKind; speaker: string | null } {
  const l = label.trim();
  const v2 = V2_LABEL.exec(l);
  if (v2) {
    const who = (v2[2] ?? "").trim();
    const kind: LetteringKind = v2[1] === "SPEECH" ? "speech" : v2[1] === "THOUGHT" ? "thought" : v2[1] === "SFX" ? "sfx" : "caption";
    const speaker = !who || /^narrator$/i.test(who) ? null : who;
    return { kind, speaker };
  }
  if (/time caption/i.test(l)) return { kind: "time", speaker: null };
  if (/internal caption|thought/i.test(l)) return { kind: "thought", speaker: l.replace(/\s*(internal caption|thought).*/i, "").replace(/,$/, "").trim() || null };
  if (/\bsfx\b|sound effect/i.test(l)) return { kind: "sfx", speaker: null };
  if (/caption|narration/i.test(l)) {
    const speaker = l.replace(/\s*(objective\s+)?(caption|narration).*/i, "").replace(/,$/, "").trim();
    return { kind: "caption", speaker: speaker || null };
  }
  return { kind: "speech", speaker: l.replace(/\s*speech balloon.*/i, "").replace(/\s*\(.*\)$/, "").trim() || null };
}

const LETTERING_LINE = /^(.{1,80}?):\s*["“](.*)["”]\s*$/;

function parsePanel(block: string): PromptPanel | null {
  const lines = block.split("\n");
  const head = /^PANEL\s+(\d+)\s*(?::|—|-)\s*(.*)$/.exec(lines[0] ?? "");
  if (!head) return null;
  const description: string[] = [head[2] ?? ""];
  let emotional: string | null = null;
  const lettering: LetteringItem[] = [];
  let inLettering = false;
  for (const line of lines.slice(1)) {
    const t = line.trim();
    if (/^emotional direction:/i.test(t)) {
      emotional = t.replace(/^emotional direction:\s*/i, "");
      continue;
    }
    if (/^(exact lettering|exact balloon order|lettering)\b/i.test(t)) {
      inLettering = true;
      continue;
    }
    const lm = LETTERING_LINE.exec(t);
    if (lm && (inLettering || /balloon|caption/i.test(lm[1] ?? "") || V2_LABEL.test((lm[1] ?? "").trim()))) {
      const label = (lm[1] ?? "").trim();
      const { kind, speaker } = classifyLettering(label);
      lettering.push({ kind, speaker, text: lm[2] ?? "", raw: t });
      continue;
    }
    if (!inLettering) description.push(t);
  }
  const desc = description.join(" ").trim();
  return {
    number: Number(head[1]),
    description: desc,
    emotionalDirection: emotional,
    lettering,
    silent: lettering.length === 0 || /\bsilent\b/i.test(desc),
  };
}

/** "walker-ethan.png" -> "Ethan"; "morgan-hayes-formal-wedding-lace-blouse-pink-skirt.png" -> "Morgan". */
export function nameFromSheetFile(file: string): string {
  const stem = (file.split("/").pop() ?? file).replace(/\.(png|webp|jpe?g)$/i, "");
  const parts = stem.split("-").filter(Boolean);
  const descriptive = /-(?:reference-(?:character-sheet|sheet|main)(?:-|$)|(?:casual|sleepwear|swimwear|activewear|formal|workwear|outerwear|seasonal|lingerie|review)-)/i.test(stem);
  const pick = descriptive ? parts[0] : parts.at(-1);
  const n = pick ?? stem;
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

function parseReferenceOrder(block: string): ReferenceSlot[] {
  const slots: ReferenceSlot[] = [];
  const firstPara = block.replace(/\n/g, " ");
  // v2: the prompt names each sheet file, in attachment order.
  const fileRe = /(?:^|[\s(:,])((?:[\w-]+\/)*[\w.-]+\.(?:png|webp|jpe?g))\b/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fileRe.exec(firstPara)) !== null) {
    const file = fm[1] ?? "";
    if (file.includes("..")) continue;
    slots.push({ index: slots.length + 1, name: nameFromSheetFile(file), file });
  }
  if (slots.length) return slots;
  const orderText = /REFERENCE ORDER:\s*(.*?)(?:\.\s|$)/.exec(firstPara)?.[1] ?? "";
  const re = /image\s+(\d+)\s*(?:=|:)?\s*([A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(orderText)) !== null) {
    const name = (m[2] ?? "").replace(/'s$/, "").trim();
    slots.push({ index: Number(m[1]), name: name.split(" ")[0] ?? name });
  }
  return slots.sort((a, b) => a.index - b.index);
}

function parseSceneReferences(instructions: string): SceneReference[] {
  const refs: SceneReference[] = [];
  const sentences = instructions.split(/(?<=[.;])\s+/);
  for (const s of sentences) {
    const re = /\b(?:rendered\s+|new\s+|preceding\s+)?pages?\s+(\d{1,3})((?:\s*(?:,|and|&)\s*\d{1,3}\b)*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const nums = [m[1] ?? "", ...((m[2] ?? "").match(/\d{1,3}/g) ?? [])].map(Number);
      for (const page of nums) {
        if (refs.some((r) => r.page === page)) continue;
        refs.push({ page, note: s.trim(), optional: /if available|may (?:additionally|clarify)|may show|for any phone insert/i.test(s) });
      }
    }
  }
  return refs;
}

export function parsePrompt(text: string, meta: { page: number; version: number }): ParsedPrompt {
  const warnings: string[] = [];
  const blocks = splitBlocks(text);
  const out: ParsedPrompt = {
    page: meta.page,
    version: meta.version,
    sha256: sha256(text),
    text,
    panelCount: null,
    referenceOrder: [],
    referenceInstructions: "",
    sceneReferences: [],
    plot: null,
    format: null,
    visibleCast: null,
    characters: [],
    setting: null,
    continuity: [],
    layout: null,
    panels: [],
    ending: null,
    warnings,
  };

  const exactly = /Exactly\s+([A-Z]+|\d+)\s+panels/i.exec(text);
  if (exactly) {
    const v = exactly[1] ?? "";
    out.panelCount = /^\d+$/.test(v) ? Number(v) : NUMBER_WORDS[v.toUpperCase()] ?? null;
  }

  const headerPage = /\bpage\s+(\d{1,3})\b/i.exec(blocks[0] ?? "");
  if (headerPage && Number(headerPage[1]) !== meta.page) {
    warnings.push(`Prompt header names page ${headerPage[1]} but the file is page ${meta.page}.`);
  }

  for (const block of blocks) {
    const firstLine = block.split("\n")[0] ?? "";
    if (firstLine.startsWith("REFERENCE ORDER")) {
      out.referenceOrder = parseReferenceOrder(block);
      out.referenceInstructions = block.replace(/\n/g, " ");
      const namesFiles = out.referenceOrder.some((r) => r.file);
      out.sceneReferences = parseSceneReferences(namesFiles ? block.replace(/\n/g, " ") : block.replace(/^REFERENCE ORDER:[^\n]*\n?/, " "));
      continue;
    }
    if (/^PANEL\s+\d+\s*(?::|—|-)/.test(firstLine)) {
      const panel = parsePanel(block);
      if (panel) out.panels.push(panel);
      continue;
    }
    const h = HEADER.exec(firstLine);
    if (h) {
      const key = (h[1] ?? "").trim();
      const body = [h[2] ?? "", ...block.split("\n").slice(1)].join("\n").trim();
      if (key === "PAGE PLOT") out.plot = body.split("\n")[0] ?? body;
      else if (/^(FORMAT|STYLE)/.test(key)) out.format = body;
      else if (key === "VISIBLE CAST") out.visibleCast = body;
      else if (key === "CAST") {
        out.visibleCast = body;
        // v2: one "Name: age, height, ... Scene wardrobe: ..." line per character.
        for (const line of body.split("\n")) {
          const cm2 = /^([A-Z][a-z]+(?:\s+[A-Z][A-Za-z-]+)*):\s+(.+)$/.exec(line.trim());
          if (!cm2 || !/\b\d{1,3}\b|cm\b/.test(cm2[2] ?? "")) continue;
          const desc = cm2[2] ?? "";
          const wardrobe = /Scene wardrobe:\s*([^.]*(?:\.[^A-Z][^.]*)*)\.?/.exec(desc)?.[1]?.trim() ?? null;
          out.characters.push({ name: cm2[1] ?? "", description: desc.replace(/\s*Scene wardrobe:.*$/, "").trim(), outfit: wardrobe });
        }
      } else if (/^SETTING/.test(key)) {
        out.setting = body.split("\n")[0] ?? body;
        if (/CONTINUITY/.test(key)) out.continuity.push({ label: key, text: body });
        for (const line of body.split("\n").slice(1)) {
          const cl = /^([A-Z /-]*CONTINUITY):\s*(.*)$/.exec(line.trim());
          if (cl) out.continuity.push({ label: cl[1] ?? "CONTINUITY", text: cl[2] ?? "" });
        }
      } else if (/CONTINUITY$/.test(key)) out.continuity.push({ label: key, text: body });
      else if (key === "LAYOUT") out.layout = body;
      else if (key === "ENDING" || key === "PAGE-ENDING FEEL") out.ending = body.split("\n")[0] ?? body;
      else if (key === "OUTFIT" || key === "OUTFITS/SCALE") {
        const last = out.characters.at(-1);
        if (last) last.outfit = body;
      }
      continue;
    }
    // Character blocks: "Ethan Walker: 38, 178 cm, ..." optionally followed by "OUTFIT: ..."
    const cm = /^([A-Z][a-z]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][A-Za-z-]+)*):\s+(.+)$/.exec(firstLine);
    if (cm && /\b\d{1,2}\b|cm\b|approximately/.test(cm[2] ?? "")) {
      const lines = block.split("\n");
      const outfitLine = lines.find((l) => /^OUTFIT:/.test(l));
      out.characters.push({
        name: cm[1] ?? "",
        description: (cm[2] ?? "").trim(),
        outfit: outfitLine ? outfitLine.replace(/^OUTFIT:\s*/, "").trim() : null,
      });
    }
  }

  if (out.referenceOrder.length === 0) warnings.push("No REFERENCE ORDER found; identity sheets cannot be selected automatically.");
  if (out.panelCount != null && out.panels.length !== out.panelCount) {
    warnings.push(`Prompt declares ${out.panelCount} panels but describes ${out.panels.length}.`);
  }
  return out;
}

/** All lettering for a page, flattened in reading order. */
export function expectedLettering(prompt: ParsedPrompt): (LetteringItem & { panel: number })[] {
  return prompt.panels.flatMap((p) => p.lettering.map((l) => ({ ...l, panel: p.number })));
}

/** Character first names that must be visible, from the reference order and cast line. */
export function expectedCast(prompt: ParsedPrompt): string[] {
  const names = new Set(prompt.referenceOrder.map((r) => r.name));
  for (const c of prompt.characters) names.add(c.name.split(" ")[0] ?? c.name);
  return [...names];
}

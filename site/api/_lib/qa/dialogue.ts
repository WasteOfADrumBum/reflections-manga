import type { LetteringItem } from "../content/prompt-parser.ts";
import type { ScriptLine, ScriptPage } from "../content/script-parser.ts";

/** Normalises typography differences (curly quotes, ellipses, dashes, case, spacing). */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Normalised Levenshtein similarity in [0,1]. */
export function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (x === y) return 1;
  if (!x.length || !y.length) return 0;
  const prev = new Array<number>(y.length + 1);
  for (let j = 0; j <= y.length; j++) prev[j] = j;
  for (let i = 1; i <= x.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (x[i - 1] === y[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length);
}

export interface ScriptConsistency {
  ok: boolean;
  problems: string[];
}

/**
 * Before any paid request: the prompt's exact lettering must match the
 * canonical script word for word, in the same order and with the same
 * speakers. A mismatch is a creative decision, so the page is blocked rather
 * than "fixed" automatically.
 */
export function checkPromptAgainstScript(promptLines: (LetteringItem & { panel: number })[], script: ScriptPage | null): ScriptConsistency {
  const problems: string[] = [];
  if (!script) return { ok: false, problems: ["The script has no entry for this page."] };
  const scriptLines: ScriptLine[] = script.panels.flatMap((p) => p.lines);
  if (scriptLines.length !== promptLines.length) {
    problems.push(`The prompt has ${promptLines.length} lettering items but the script has ${scriptLines.length}.`);
  }
  const n = Math.min(scriptLines.length, promptLines.length);
  for (let i = 0; i < n; i++) {
    const s = scriptLines[i]!;
    const p = promptLines[i]!;
    if (normalizeText(s.text) !== normalizeText(p.text)) {
      problems.push(`Panel ${p.panel}, item ${i + 1}: prompt text "${p.text}" differs from script "${s.text}".`);
    }
    if (s.panel !== p.panel) problems.push(`Item ${i + 1} is in panel ${p.panel} in the prompt but panel ${s.panel} in the script.`);
    if (s.kind !== p.kind) problems.push(`Item ${i + 1} is a ${p.kind} in the prompt but a ${s.kind} in the script.`);
    if (s.speaker && p.speaker && s.speaker.split(" ")[0] !== p.speaker.split(" ")[0]) {
      problems.push(`Item ${i + 1} is spoken by ${p.speaker} in the prompt but ${s.speaker} in the script.`);
    }
  }
  return { ok: problems.length === 0, problems };
}

export interface TranscribedItem {
  panel: number;
  text: string;
  kind?: string;
  speaker?: string | null;
}

export interface DialogueCheck {
  score: number;
  missing: string[];
  altered: { expected: string; found: string; similarity: number }[];
  extra: string[];
  duplicated: string[];
  outOfOrder: boolean;
}

/** Compares a vision model's transcription against the expected script lines. */
export function compareTranscription(expected: { text: string; panel: number }[], found: TranscribedItem[]): DialogueCheck {
  const used = new Set<number>();
  const missing: string[] = [];
  const altered: DialogueCheck["altered"] = [];
  const order: number[] = [];
  for (const e of expected) {
    let best = -1;
    let bestSim = 0;
    found.forEach((f, idx) => {
      if (used.has(idx)) return;
      const sim = similarity(e.text, f.text);
      if (sim > bestSim) {
        bestSim = sim;
        best = idx;
      }
    });
    if (best < 0 || bestSim < 0.6) {
      missing.push(e.text);
      continue;
    }
    used.add(best);
    order.push(best);
    if (bestSim < 0.97) altered.push({ expected: e.text, found: found[best]!.text, similarity: Number(bestSim.toFixed(3)) });
  }
  const leftovers = found.filter((_, i) => !used.has(i));
  const duplicated = leftovers.filter((f) => expected.some((e) => similarity(e.text, f.text) >= 0.9)).map((f) => f.text);
  const extra = leftovers.filter((f) => !duplicated.includes(f.text)).map((f) => f.text);
  const outOfOrder = order.some((v, i) => i > 0 && v < order[i - 1]!);
  const total = Math.max(expected.length, 1);
  const penalty = missing.length + altered.length * 0.5 + extra.length * 0.5 + duplicated.length * 0.75 + (outOfOrder ? 0.5 : 0);
  return { score: Math.max(0, Number((1 - penalty / total).toFixed(3))), missing, altered, extra, duplicated, outOfOrder };
}

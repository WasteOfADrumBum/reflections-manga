import type { ScriptPage } from "../content/script-parser.js";

/**
 * Descriptive alt text in the reader's existing style: what happens on the page
 * plus every line of dialogue, in order, with speakers. Built from the canonical
 * script, so it never depends on what a model claims to see. The owner can edit
 * it before publishing.
 */
export function altTextFromScript(script: ScriptPage | null): string {
  if (!script) return "";
  const parts: string[] = [];
  for (const panel of script.panels) {
    const visual = panel.visual.replace(/\s+/g, " ").trim();
    if (visual) parts.push(visual.replace(/\.?$/, "."));
    for (const line of panel.lines) {
      if (line.kind === "time") parts.push(`Caption: "${line.text}"`);
      else if (line.kind === "thought") parts.push(`${line.speaker ?? "Narration"}'s thought caption: "${line.text}"`);
      else if (line.kind === "caption") parts.push(`Caption: "${line.text}"`);
      else parts.push(`${line.speaker ?? "Someone"}: "${line.text}"`);
    }
  }
  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  return text.length > 1500 ? `${text.slice(0, 1497)}...` : text;
}

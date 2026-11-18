import type { LoadedPrompt } from "../content/chapters.ts";
import type { ScriptPage } from "../content/script-parser.ts";

/**
 * Structured continuity record. Built from the page's explicit instructions
 * (prompt + script), which always take precedence over anything inferred from
 * earlier artwork. Updated after a page is generated and passes QA; observed
 * QA issues are kept as notes, never as new canon.
 */
export interface ContinuityState {
  page: number;
  scene: string | null;
  timeOfDay: string | null;
  location: string | null;
  characters: { name: string; outfit: string | null; position: string | null }[];
  props: string[];
  lighting: string | null;
  relationships: string[];
  previousApprovedPage: number | null;
  emotionalState: string[];
  observedIssues: string[];
  source: "prompt" | "prompt+qa";
}

const TIME_WORDS = [
  ["next morning", "next morning"],
  ["late night", "late night"],
  ["night", "night"],
  ["first morning", "morning"],
  ["morning", "morning"],
  ["afternoon", "afternoon"],
  ["evening", "evening"],
  ["dusk", "dusk"],
] as const;

export function inferTimeOfDay(text: string): string | null {
  const t = text.toLowerCase();
  for (const [needle, label] of TIME_WORDS) if (t.includes(needle)) return label;
  return null;
}

function sentences(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildContinuityState(opts: {
  prompt: LoadedPrompt;
  script: ScriptPage | null;
  previous: ContinuityState | null;
  previousApprovedPage: number | null;
  observedIssues?: string[];
}): ContinuityState {
  const { prompt, script } = opts;
  const continuityText = prompt.continuity.map((c) => c.text).join(" ");
  const setting = prompt.setting ?? script?.timeLocation ?? null;
  const lighting = sentences(continuityText).find((s) => /light|daylight|lamp|dark/i.test(s)) ?? opts.previous?.lighting ?? null;
  const props = sentences(continuityText).filter((s) => /mug|cup|bag|tote|bottle|bowl|glass|keys|notebook|chair|spoon|bridge|blanket|lunchbox|book/i.test(s));
  const relationships = sentences(prompt.text).filter((s) => /married to|PLATONIC|coparent|regard all three adults/i.test(s));
  const location = setting ? (/(kitchen|nook|bathroom|bedroom|living room|entry|porch|yard|car|table)[^.,;]*/i.exec(setting)?.[0] ?? null) : opts.previous?.location ?? null;
  const emotional = prompt.panels.map((p) => p.emotionalDirection).filter((x): x is string => !!x);
  return {
    page: prompt.page,
    scene: script?.title ?? prompt.plot ?? null,
    timeOfDay: inferTimeOfDay(`${setting ?? ""} ${continuityText}`) ?? opts.previous?.timeOfDay ?? null,
    location,
    characters: prompt.characters.map((c) => ({ name: c.name, outfit: c.outfit, position: null })),
    props,
    lighting,
    relationships,
    previousApprovedPage: opts.previousApprovedPage,
    emotionalState: emotional,
    observedIssues: opts.observedIssues ?? [],
    source: opts.observedIssues?.length ? "prompt+qa" : "prompt",
  };
}

/** Short text form used inside the QA instructions. */
export function continuitySummary(state: ContinuityState | null): string | null {
  if (!state) return null;
  const parts = [
    state.timeOfDay ? `Time: ${state.timeOfDay}` : "",
    state.location ? `Location: ${state.location}` : "",
    state.lighting ? `Lighting: ${state.lighting}` : "",
    ...state.characters.filter((c) => c.outfit).map((c) => `${c.name} wears: ${c.outfit}`),
    ...state.props.slice(0, 6).map((p) => `Prop: ${p}`),
  ].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

import type { LoadedPrompt } from "../content/chapters.js";
import { expectedCast } from "../content/prompt-parser.js";
import type { ScriptPage } from "../content/script-parser.js";
import type { ImageInfo } from "../images.js";
import type { VisionQaResult } from "../openai/providers.js";
import { compareTranscription } from "./dialogue.js";

export type QaStatus = "pass" | "uncertain" | "fail";

export interface QaCheck {
  name: string;
  status: QaStatus;
  score: number;
  detail: string;
}

export interface QaReport {
  status: QaStatus;
  confidence: number;
  checks: QaCheck[];
  reasons: string[];
  /** True when an automatic retry is justified (clear, objective failure). */
  retryRecommended: boolean;
  visionSummary: string | null;
  disclaimer: string;
}

export const QA_DISCLAIMER =
  "Automatic checks are approximate. A vision model can misread lettering or likeness; uncertain pages are flagged for your review, and a pass is not a guarantee.";

/** Deterministic checks that need no model: format, dimensions, aspect ratio. */
export function deterministicChecks(info: ImageInfo, target = { width: 1024, height: 1536 }): QaCheck[] {
  const checks: QaCheck[] = [];
  const dimsOk = info.width === target.width && info.height === target.height;
  checks.push({
    name: "dimensions",
    status: dimsOk ? "pass" : "fail",
    score: dimsOk ? 1 : 0,
    detail: `${info.width} x ${info.height} (target ${target.width} x ${target.height})`,
  });
  const ratioOk = Math.abs(info.width / info.height - target.width / target.height) < 0.01;
  checks.push({ name: "portrait 2:3", status: ratioOk ? "pass" : "fail", score: ratioOk ? 1 : 0, detail: `ratio ${(info.width / info.height).toFixed(3)}` });
  const sizeOk = info.bytes > 20_000; // a blank or truncated page compresses far below this
  checks.push({ name: "image data", status: sizeOk ? "pass" : "fail", score: sizeOk ? 1 : 0, detail: `${Math.round(info.bytes / 1024)} KB ${info.format}` });
  return checks;
}

export function buildQaInstructions(prompt: LoadedPrompt, script: ScriptPage | null, continuityNote: string | null): string {
  const cast = expectedCast(prompt);
  const lettering = (script?.panels ?? []).flatMap((p) => p.lines.map((l) => `panel ${p.number}: ${l.kind}${l.speaker ? ` (${l.speaker})` : ""}: "${l.text}"`));
  const outfits = prompt.characters.filter((c) => c.outfit).map((c) => `${c.name}: ${c.outfit}`);
  return [
    "You are a strict manga production QA checker. Evaluate IMAGE A, one manga page, against the specification below. Be literal and conservative. If unsure, lower your confidence instead of guessing.",
    `Expected panels: exactly ${prompt.panelCount ?? "unspecified"}. Layout: ${prompt.layout ?? "unspecified"}. Reading order is English left to right, top to bottom.`,
    `Only these characters may appear: ${cast.join(", ") || "none listed"}. Report ANY other person, silhouette or face as unexpectedPeople.`,
    outfits.length ? `Required outfits:\n${outfits.join("\n")}` : "",
    "Transcribe every piece of text visible in the image exactly as printed, one entry per balloon or caption, with its panel number (1-based, reading order).",
    lettering.length ? `The script expects exactly this lettering, in order:\n${lettering.join("\n")}` : "The page should contain no lettering.",
    continuityNote ? `Continuity facts that must hold:\n${continuityNote}` : "",
    "Compare faces, hair, eye colour, build and permanent features with the identity sheets and score likeness from 0 to 1 per character. Ignore outfit differences on the sheets.",
    "List visual artifacts (malformed hands, merged figures, garbled text, broken panel borders, stray labels or watermarks).",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function combineQa(opts: {
  info: ImageInfo;
  prompt: LoadedPrompt;
  script: ScriptPage | null;
  vision: VisionQaResult | null;
  visionError?: string | null;
  passThreshold: number;
  reviewThreshold: number;
}): QaReport {
  const checks = deterministicChecks(opts.info);
  const reasons: string[] = [];
  const v = opts.vision;
  const cast = expectedCast(opts.prompt).map((n) => n.toLowerCase());

  if (!v) {
    checks.push({ name: "vision review", status: "uncertain", score: 0.5, detail: opts.visionError ?? "Vision QA unavailable" });
    reasons.push(`Vision QA could not run (${opts.visionError ?? "unavailable"}); manual review required.`);
  } else {
    const panelsOk = opts.prompt.panelCount == null || v.panelCount === opts.prompt.panelCount;
    checks.push({ name: "panel count", status: panelsOk ? "pass" : "fail", score: panelsOk ? 1 : 0, detail: `found ${v.panelCount}, expected ${opts.prompt.panelCount ?? "any"}` });
    checks.push({ name: "layout and reading order", status: v.layoutMatches && v.readingOrderLeftToRight ? "pass" : "uncertain", score: v.layoutMatches && v.readingOrderLeftToRight ? 1 : 0.5, detail: v.layoutMatches ? "layout matches" : "layout may differ" });

    const present = new Map(v.charactersPresent.map((c) => [c.name.toLowerCase().split(" ")[0] ?? "", c.confidence]));
    const missing = cast.filter((n) => (present.get(n) ?? 0) < 0.5);
    checks.push({ name: "expected cast", status: missing.length ? "fail" : "pass", score: missing.length ? 0 : 1, detail: missing.length ? `missing: ${missing.join(", ")}` : "all present" });
    checks.push({
      name: "no extra people",
      status: v.unexpectedPeople.length ? "fail" : "pass",
      score: v.unexpectedPeople.length ? 0 : 1,
      detail: v.unexpectedPeople.length ? v.unexpectedPeople.join("; ") : "none found",
    });

    const likeness = v.likeness.filter((l) => cast.includes(l.name.toLowerCase().split(" ")[0] ?? ""));
    const minLikeness = likeness.length ? Math.min(...likeness.map((l) => l.score)) : 0.5;
    checks.push({
      name: "approximate likeness",
      status: minLikeness >= 0.7 ? "pass" : minLikeness >= 0.45 ? "uncertain" : "fail",
      score: minLikeness,
      detail: likeness.map((l) => `${l.name} ${l.score.toFixed(2)}${l.notes ? ` (${l.notes})` : ""}`).join("; ") || "not scored",
    });

    const clothingBad = v.clothingMatches.filter((c) => !c.matches);
    checks.push({ name: "clothing", status: clothingBad.length ? "uncertain" : "pass", score: clothingBad.length ? 0.5 : 1, detail: clothingBad.map((c) => `${c.name}: ${c.notes}`).join("; ") || "matches" });

    const expected = (opts.script?.panels ?? []).flatMap((p) => p.lines.map((l) => ({ text: l.text, panel: p.number })));
    const dlg = compareTranscription(expected, v.transcribedText);
    const dlgDetail = [
      dlg.missing.length ? `missing: ${dlg.missing.map((t) => `"${t}"`).join(", ")}` : "",
      dlg.altered.length ? `altered: ${dlg.altered.map((a) => `"${a.found}" for "${a.expected}"`).join(", ")}` : "",
      dlg.duplicated.length ? `duplicated: ${dlg.duplicated.join(", ")}` : "",
      dlg.extra.length ? `extra text: ${dlg.extra.join(", ")}` : "",
      dlg.outOfOrder ? "order differs" : "",
    ]
      .filter(Boolean)
      .join("; ");
    checks.push({ name: "exact dialogue", status: dlg.score >= 0.95 ? "pass" : dlg.score >= 0.7 ? "uncertain" : "fail", score: dlg.score, detail: dlgDetail || "matches script" });

    checks.push({ name: "artifacts", status: v.artifacts.length ? "uncertain" : "pass", score: v.artifacts.length ? 0.6 : 1, detail: v.artifacts.join("; ") || "none reported" });
    checks.push({ name: "continuity", status: v.continuityIssues.length ? "uncertain" : "pass", score: v.continuityIssues.length ? 0.6 : 1, detail: v.continuityIssues.join("; ") || "no issues reported" });
  }

  for (const c of checks) if (c.status !== "pass") reasons.push(`${c.name}: ${c.detail}`);
  const scores = checks.map((c) => c.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const modelConfidence = v?.overallConfidence ?? 0.5;
  const confidence = Number(Math.min(mean, (mean + modelConfidence) / 2).toFixed(3));
  const hardFail = checks.some((c) => c.status === "fail");
  // Objective failures worth paying to retry: wrong size, wrong panel count,
  // missing/extra people, badly wrong dialogue or likeness.
  const retryRecommended = hardFail;
  let status: QaStatus;
  if (hardFail) status = "fail";
  else if (confidence >= opts.passThreshold && checks.every((c) => c.status === "pass")) status = "pass";
  else status = confidence >= opts.reviewThreshold ? "uncertain" : "fail";
  return { status, confidence, checks, reasons: [...new Set(reasons)], retryRecommended: retryRecommended || status === "fail", visionSummary: v?.summary ?? null, disclaimer: QA_DISCLAIMER };
}

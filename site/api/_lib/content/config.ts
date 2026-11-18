import { z } from "zod";
import type { RepoSource } from "../repo/source.ts";

export const CONFIG_PATH = "production/studio/config.json";

export const qualityValues = ["low", "medium", "high", "xhigh", "max"] as const;
export type Quality = (typeof qualityValues)[number];

export const generationSettingsSchema = z.object({
  imageModel: z.string().min(1).default("gpt-image-2.5-sunburst"),
  qaModel: z.string().min(1).default("gpt-6-luna"),
  size: z.enum(["1024x1536"]).default("1024x1536"),
  quality: z.enum(qualityValues).default("high"),
  outputFormat: z.enum(["png", "webp"]).default("png"),
  maxAttemptsPerPage: z.number().int().min(1).max(6).default(3),
  maxSceneReferences: z.number().int().min(0).max(4).default(2),
  budgetUsdPerJob: z.number().min(0.5).max(200).default(10),
  expectedRetryRate: z.number().min(0).max(3).default(0.5),
  qaPassThreshold: z.number().min(0).max(1).default(0.8),
  qaReviewThreshold: z.number().min(0).max(1).default(0.55),
});
export type GenerationSettings = z.infer<typeof generationSettingsSchema>;

const chapterConfigSchema = z.object({
  arcId: z.string(),
  arcNumber: z.number().int(),
  arcTitle: z.string().optional(),
  title: z.string(),
  storyDir: z.string(),
  plannedPages: z.number().int().min(1).max(200),
  lockedPages: z.string().default(""),
  lockReason: z.string().default("Locked."),
  unpreparedPages: z.string().default(""),
  unpreparedReason: z.string().default("Not prepared yet."),
  /** Revision shown in the UI, e.g. "v2". */
  revisionLabel: z.string().default(""),
  /** Folder (under storyDir) holding page-NNN-vN.txt prompts for the active revision. */
  promptDir: z.string().regex(/^[\w./-]+$/).refine((v) => !v.includes(".."), "promptDir must stay inside storyDir").default("prompts"),
  /** Canonical script file (under storyDir) for the active revision. */
  scriptFile: z.string().regex(/^[\w.-]+\.md$/).default("script.md"),
  /** Folders searched for identity sheets that prompts name by file (e.g. "walker-ethan.png"). */
  identitySheetDirs: z.array(z.string().regex(/^characters\/[\w./-]+$/).refine((v) => !v.includes(".."))).default([]),
  sourcePagePattern: z.string(),
  publishedDir: z.string(),
  publishedSrcPrefix: z.string(),
});
export type ChapterConfig = z.infer<typeof chapterConfigSchema>;

export const studioConfigSchema = z.object({
  version: z.literal(1),
  chapters: z.record(z.string().regex(/^\d{3}$/), chapterConfigSchema),
  generation: generationSettingsSchema,
});
export type StudioConfig = z.infer<typeof studioConfigSchema>;

/** "1-20, 25" -> Set{1..20, 25} */
export function parsePageRanges(spec: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`Invalid page range "${part}"`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a || b - a > 500) throw new Error(`Invalid page range "${part}"`);
    for (let p = a; p <= b; p++) out.add(p);
  }
  return out;
}

export const pad3 = (n: number) => String(n).padStart(3, "0");

export async function loadStudioConfig(repo: RepoSource): Promise<StudioConfig> {
  const text = await repo.readText(CONFIG_PATH);
  if (!text) throw new Error(`${CONFIG_PATH} is missing from the repository.`);
  return studioConfigSchema.parse(JSON.parse(text));
}

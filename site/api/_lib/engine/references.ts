import type { CharacterRecord } from "../content/characters.js";
import { type ResolvedSheet, resolveCharacter } from "../content/characters.js";
import type { LoadedPrompt } from "../content/chapters.js";
import { pad3 } from "../content/config.js";

/**
 * Automatic reference selection for one page.
 *
 * Order (identity always first, so earlier generations can never outrank a
 * canonical sheet):
 *   1. Identity sheets, in the prompt's REFERENCE ORDER. v2 prompts name the
 *      exact sheet file (resolved only inside configured sheet folders and
 *      characters' references/); v1 prompts name a character and get its
 *      canonical "Current Card".
 *   2. Approved outfit references for those characters (uploaded, scoped).
 *   3. Approved location references (uploaded, scoped).
 *   4. Scene continuity pages named by the prompt, in the order mentioned:
 *      repository artwork > approved studio version > QA-passed draft of the
 *      page generated earlier in the same run (marked provisional).
 */
export type ReferenceRole = "identity" | "outfit" | "location" | "scene";

export interface ReferenceManifestEntry {
  slot: number;
  role: ReferenceRole;
  label: string;
  source: "repo" | "studio" | "upload";
  path: string;
  characterId?: string;
  page?: number;
  provisional?: boolean;
  sha256?: string;
}

export interface SceneImageCandidate {
  page: number;
  source: "repo" | "studio";
  path: string;
  provisional: boolean;
  label: string;
}

export interface UploadedReference {
  id: string;
  characterId: string | null;
  kind: "outfit" | "location" | "experimental";
  status: "approved" | "experimental";
  label: string;
  blobPath: string;
  chapterId: string | null;
  pages: number[] | null;
}

export interface ReferencePlan {
  entries: ReferenceManifestEntry[];
  blockers: string[];
  warnings: string[];
}

export function planReferences(opts: {
  chapterId: string;
  prompt: LoadedPrompt;
  characters: CharacterRecord[];
  uploads: UploadedReference[];
  findScenePage: (page: number) => SceneImageCandidate | null;
  maxSceneReferences: number;
  maxTotal?: number;
  /** v2: sheet files named in the prompt, already resolved to repository paths. */
  sheetFiles?: Map<string, ResolvedSheet | null>;
}): ReferencePlan {
  const { prompt } = opts;
  const entries: ReferenceManifestEntry[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const maxTotal = Math.min(opts.maxTotal ?? 16, 16);
  const add = (e: Omit<ReferenceManifestEntry, "slot">) => {
    if (entries.length >= maxTotal) {
      warnings.push(`Skipped ${e.label}: the request already has ${maxTotal} images.`);
      return;
    }
    entries.push({ ...e, slot: entries.length + 1 });
  };

  if (prompt.referenceOrder.length === 0) blockers.push("The prompt has no REFERENCE ORDER, so identity sheets cannot be chosen safely.");
  const pageCharacters: CharacterRecord[] = [];
  for (const slot of prompt.referenceOrder) {
    if (slot.file) {
      const sheet = opts.sheetFiles?.get(slot.file) ?? null;
      if (!sheet) {
        blockers.push(`The identity sheet "${slot.file}" named in the reference order was not found in the character sheet folders.`);
        continue;
      }
      const owner = sheet.characterId ? opts.characters.find((ch) => ch.id === sheet.characterId) ?? null : resolveCharacter(opts.characters, slot.name);
      if (owner && !pageCharacters.includes(owner)) pageCharacters.push(owner);
      add({
        role: "identity",
        label: `${owner?.displayName ?? slot.name} identity sheet (${slot.file.split("/").pop()})`,
        source: "repo",
        path: sheet.path,
        ...(owner ? { characterId: owner.id } : {}),
      });
      continue;
    }
    const c = resolveCharacter(opts.characters, slot.name);
    if (!c) {
      blockers.push(`"${slot.name}" in the reference order does not match a character profile.`);
      continue;
    }
    if (!c.canonicalSheet) {
      blockers.push(`${c.displayName} has no canonical reference sheet (no "Current Card" in references/index.md).`);
      continue;
    }
    if (slot.index !== entries.length + 1) {
      warnings.push(`Reference order lists image ${slot.index} for ${slot.name}; attaching it as image ${entries.length + 1}.`);
    }
    pageCharacters.push(c);
    add({ role: "identity", label: `${c.displayName} canonical identity sheet`, source: "repo", path: c.canonicalSheet, characterId: c.id });
  }

  const scoped = (u: UploadedReference) =>
    u.status === "approved" && (u.chapterId == null || u.chapterId === opts.chapterId) && (u.pages == null || u.pages.includes(prompt.page));
  for (const c of pageCharacters) {
    const outfit = opts.uploads.find((u) => u.kind === "outfit" && u.characterId === c.id && scoped(u));
    if (outfit) add({ role: "outfit", label: `${c.displayName} approved outfit: ${outfit.label}`, source: "upload", path: outfit.blobPath, characterId: c.id });
  }
  for (const loc of opts.uploads.filter((u) => u.kind === "location" && scoped(u)).slice(0, 2)) {
    add({ role: "location", label: `Approved location: ${loc.label}`, source: "upload", path: loc.blobPath });
  }

  let sceneCount = 0;
  for (const ref of prompt.sceneReferences) {
    if (ref.page >= prompt.page) {
      warnings.push(`Ignored scene reference to page ${pad3(ref.page)}: only earlier pages can be used.`);
      continue;
    }
    if (sceneCount >= opts.maxSceneReferences) {
      warnings.push(`Skipped scene reference page ${pad3(ref.page)}: limit of ${opts.maxSceneReferences} scene pages.`);
      continue;
    }
    const found = opts.findScenePage(ref.page);
    if (!found) {
      if (ref.optional) warnings.push(`Optional scene reference page ${pad3(ref.page)} is not available; not attached.`);
      else warnings.push(`Scene reference page ${pad3(ref.page)} has no usable image yet; generating without it. Review continuity closely.`);
      continue;
    }
    sceneCount++;
    add({ role: "scene", label: found.label, source: found.source, path: found.path, page: ref.page, provisional: found.provisional });
  }
  return { entries, blockers, warnings };
}

/**
 * Appends an attachment manifest to the verbatim prompt so the model knows what
 * each image is, including scene pages that were not available.
 */
export function buildFinalPrompt(prompt: LoadedPrompt, plan: ReferencePlan): string {
  const lines = plan.entries.map((e) => {
    const extra = e.role === "scene" ? ` (scene continuity only${e.provisional ? "; working draft" : ""}; never overrides the identity sheets)` : "";
    return `image ${e.slot} = ${e.label}${extra}`;
  });
  const missing = prompt.sceneReferences.filter((r) => r.page < prompt.page && !plan.entries.some((e) => e.page === r.page)).map((r) => `page ${pad3(r.page)}`);
  const note = missing.length ? `\nNot attached: ${missing.join(", ")}. Do not assume those images exist.` : "";
  return `${prompt.text.trimEnd()}\n\nATTACHED IMAGES (added by the production studio, in attachment order):\n${lines.join("\n")}${note}\n`;
}

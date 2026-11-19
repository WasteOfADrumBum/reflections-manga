import type { RepoEntry, RepoSource } from "../repo/source.js";

/**
 * Character library built from everything under characters/.
 *
 * Characters live in cast folders (characters/main/<id>, characters/family/
 * <family>/<id>, characters/friends/<id>); the folder name is the character id.
 * Every image in a character's references/ and outfits/ (including
 * outfits/_review) is one of their sheets, and characters/asset-manifest.json
 * says which one is the main reference, each outfit's category, and the
 * retired file names that used to point at it. Family copies in
 * characters/_reference-sheets/** count as the same sheet as their original.
 * The default sheet is the "Current Card" if a references/index.md names one,
 * else the manifest's main reference, else the "-reference-main" file. A
 * character is only "missing a sheet" when no image exists for them at all.
 *
 * Uploaded references (stored in Blob) can only add outfit or location
 * references; they never replace a repository sheet.
 */
export interface CharacterSheet {
  path: string;
  file: string;
  label: string;
  version: number | null;
  source: "references" | "outfits" | "family";
  /** Other repository paths holding a copy of the same sheet: family copies and retired file names. */
  aliases: string[];
  isDefault: boolean;
  /** Outfit category from the asset manifest or file name (casual, formal, sleepwear, ...). */
  category: string | null;
  /** Sheets in outfits/_review whose category the owner has not chosen yet. */
  needsReview: boolean;
  reviewNote: string | null;
  size?: number;
}

/** Kept for older callers: the default sheet is "canonical", the rest are outfits. */
export interface CharacterReferenceFile {
  path: string;
  name: string;
  status: "canonical" | "outfit";
  size?: number;
}

export interface CharacterRecord {
  id: string;
  displayName: string;
  firstName: string;
  aliases: string[];
  profilePath: string;
  /** Folder holding the character, e.g. characters/main/ethan-walker. */
  dir: string;
  /** Cast group from the asset manifest, e.g. "Main Cast". */
  group: string | null;
  /** The default sheet (called the canonical sheet in older code). */
  canonicalSheet: string | null;
  sheets: CharacterSheet[];
  references: CharacterReferenceFile[];
  portrait: string | null;
  sheetThumb: string | null;
}

const IMAGE = /\.(png|webp|jpe?g)$/i;
export const FAMILY_DIR = "characters/_reference-sheets";
export const MANIFEST_PATH = "characters/asset-manifest.json";
export const OUTFIT_CATEGORIES = ["casual", "sleepwear", "swimwear", "activewear", "formal", "workwear", "outerwear", "seasonal", "lingerie"];

/** The relevant part of characters/asset-manifest.json. */
export interface AssetManifest {
  categories?: string[];
  characterGroups?: Record<string, { label: string; characterIds: string[] }>;
  assets: {
    path: string;
    characterId: string;
    role: "main" | "outfit" | string;
    category: string | null;
    review: string | null;
    originalPath?: string | null;
    legacyAliases?: string[];
    characterPath?: string;
  }[];
}

export function parseManifest(text: string | null): AssetManifest | null {
  if (!text) return null;
  try {
    const m = JSON.parse(text) as AssetManifest;
    return Array.isArray(m.assets) ? m : null;
  } catch {
    return null;
  }
}

/**
 * "morgan-hayes-formal-wedding-lace-blouse-pink-skirt.png" -> formal, "Wedding lace blouse pink skirt";
 * "morgan-hayes-review-plaid-bra-shorts.png" -> review; "...-reference-main.png" -> main.
 */
export function describeSheetFile(id: string, file: string, categories = OUTFIT_CATEGORIES): { kind: "main" | "outfit" | "review" | "legacy"; category: string | null; descriptor: string | null } {
  const stem = file.replace(/\.(png|webp|jpe?g)$/i, "");
  const rest = stem.startsWith(`${id}-`) ? stem.slice(id.length + 1) : stem;
  if (/^reference-main(?:-v\d+)?$/.test(rest)) return { kind: "main", category: null, descriptor: null };
  const words = (t: string) => {
    const w = t.replace(/-v\d+$/, "").replace(/-/g, " ").trim();
    return w ? w.charAt(0).toUpperCase() + w.slice(1) : null;
  };
  if (rest.startsWith("review-")) return { kind: "review", category: null, descriptor: words(rest.slice(7)) };
  const cat = categories.find((c) => rest.startsWith(`${c}-`));
  if (cat) return { kind: "outfit", category: cat, descriptor: words(rest.slice(cat.length + 1)) };
  return { kind: "legacy", category: null, descriptor: null };
}

export function parseCurrentCard(indexMd: string): string | null {
  const lines = indexMd.split("\n");
  let inCard = false;
  for (const line of lines) {
    if (/^##\s+Current Card/i.test(line)) {
      inCard = true;
      continue;
    }
    if (inCard && /^##\s/.test(line)) break;
    if (inCard) {
      const m = /\]\(([^)]+\.(?:png|webp|jpe?g))\)/i.exec(line);
      if (m) return m[1] ?? null;
    }
  }
  return null;
}

function cleanDisplayName(heading: string): string {
  return heading.replace(/^#\s*/, "").trim();
}

function aliasesFor(id: string, displayName: string): string[] {
  const names = new Set<string>();
  const plain = displayName.replace(/["“”]/g, "");
  names.add(plain);
  const first = plain.split(/\s+/)[0];
  if (first) names.add(first);
  const nick = /["“]([^"”]+)["”]/.exec(displayName)?.[1];
  if (nick) names.add(nick);
  names.add(id);
  return [...names];
}

export function sheetVersion(file: string): number | null {
  const m = /-v(\d+)\.(?:png|webp|jpe?g)$/i.exec(file);
  return m ? Number(m[1]) : null;
}

/** Resolves a markdown link target relative to the folder of the file that contains it. */
export function resolveRelative(fromDir: string, target: string): string | null {
  if (/^[a-z]+:/i.test(target) || target.startsWith("/")) return null;
  const parts = fromDir.split("/").filter(Boolean);
  for (const seg of target.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/** Every `[text](target.png)` link in a markdown file, with the target resolved to a repository path. */
export function imageLinks(markdown: string, fromDir: string): { text: string; path: string }[] {
  const out: { text: string; path: string }[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+\.(?:png|webp|jpe?g))\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    let target = m[2]!;
    try {
      target = decodeURI(target);
    } catch {
      // keep the raw target
    }
    const path = resolveRelative(fromDir, target);
    if (path) out.push({ text: m[1]!.trim(), path });
  }
  return out;
}

const GENERIC_LABELS = /^(sheet|identity (input|reference|sheet)|reference|original|copy|notes?)$/i;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * "Morgan's wedding outfit v7" -> "Wedding outfit". Returns null when the link
 * text only names the character or says nothing about the outfit.
 */
export function outfitLabelFromLinkText(text: string, c: { firstName: string; displayName: string }): string | null {
  let t = text.replace(/[*_`]/g, "").trim();
  if (/reference sheet|character sheet|reference card/i.test(t)) return "Main sheet";
  for (const n of [c.displayName.replace(/["“”]/g, ""), c.firstName].filter(Boolean)) {
    t = t.replace(new RegExp(`^${escapeRe(n)}(?:['’]s)?\\s*`, "i"), "");
  }
  t = t
    .replace(/\(?\bv\d+\)?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || GENERIC_LABELS.test(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Family copy file name -> original path, from characters/_reference-sheets/index.md. */
export function parseFamilyIndex(indexMd: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of indexMd.split("\n")) {
    if (!line.startsWith("|")) continue;
    const links = imageLinks(line, FAMILY_DIR);
    if (links.length < 2) continue;
    out.set(links[0]!.path.split("/").pop()!, links[1]!.path);
  }
  return out;
}

export interface LoadCharactersOptions {
  /** Extra markdown files whose image links name outfits (e.g. chapter page guides). */
  labelDocs?: string[];
}

export async function loadCharacters(repo: RepoSource, opts: LoadCharactersOptions = {}): Promise<CharacterRecord[]> {
  const [tree, siteImages, manifestText] = await Promise.all([repo.walk("characters"), repo.list("site/images/characters"), repo.readText(MANIFEST_PATH)]);
  const manifest = parseManifest(manifestText);
  const site = new Set(siteImages.map((e) => e.name));
  const isSheet = (p: string) => IMAGE.test(p);

  // A character is a folder with an index.md and its own references/ or outfits/
  // (any depth: characters/main/ethan-walker, characters/family/hayes/diane-hayes,
  // or the older flat characters/ethan-walker). Group folders and _-prefixed folders are not characters.
  const manifestDirs = new Set((manifest?.assets ?? []).map((a) => a.characterPath).filter((d): d is string => !!d));
  const dirs = tree
    .filter((e) => e.name === "index.md")
    .map((e) => e.path.slice(0, -"/index.md".length))
    .filter((d) => d.startsWith("characters/") && !d.split("/").slice(1).some((seg) => seg.startsWith("_")) && !/\/(references|outfits|prompts)$/.test(d))
    .filter((d) => manifestDirs.has(d) || tree.some((e) => e.path.startsWith(`${d}/references/`) || e.path.startsWith(`${d}/outfits/`)))
    .sort();
  const familyFiles = tree.filter((e) => e.path.startsWith(`${FAMILY_DIR}/`) && isSheet(e.name));
  const assetByPath = new Map((manifest?.assets ?? []).map((a) => [a.path, a]));
  const groupOf = new Map<string, string>();
  for (const g of Object.values(manifest?.characterGroups ?? {})) for (const id of g.characterIds) groupOf.set(id, g.label);
  const categories = manifest?.categories?.length ? manifest.categories : OUTFIT_CATEGORIES;

  // All reads run in parallel: on GitHub each one is a network request.
  const [familyIndex, labelDocs, perCharacter] = await Promise.all([
    repo.readText(`${FAMILY_DIR}/index.md`),
    Promise.all((opts.labelDocs ?? []).map(async (p) => ({ path: p, text: (await repo.readText(p)) ?? "" }))),
    Promise.all(
      dirs.map(async (dir) => {
        const [index, refIndex] = await Promise.all([repo.readText(`${dir}/index.md`), repo.readText(`${dir}/references/index.md`)]);
        return { dir, id: dir.split("/").pop()!, index: index ?? "", refIndex: refIndex ?? "" };
      }),
    ),
  ]);
  const copyToOriginal = parseFamilyIndex(familyIndex ?? "");

  // Link text from every document that names a sheet, keyed by repository path.
  const linkTexts = new Map<string, string[]>();
  const noteLinks = (markdown: string, fromDir: string) => {
    for (const l of imageLinks(markdown, fromDir)) linkTexts.set(l.path, [...(linkTexts.get(l.path) ?? []), l.text]);
  };
  for (const d of labelDocs) noteLinks(d.text, d.path.split("/").slice(0, -1).join("/"));

  const seenIds = new Set<string>();
  const records: CharacterRecord[] = [];
  for (const { dir, id, index, refIndex } of perCharacter) {
    if (seenIds.has(id)) continue; // directory basenames are stable character ids
    seenIds.add(id);
    const heading = index.split("\n").find((l) => l.startsWith("# ")) ?? id;
    const displayName = cleanDisplayName(heading);
    noteLinks(refIndex, `${dir}/references`);
    const files = tree.filter((e) => (e.path.startsWith(`${dir}/references/`) || e.path.startsWith(`${dir}/outfits/`)) && isSheet(e.name));
    const sheets: CharacterSheet[] = files.map((f) => {
      const asset = assetByPath.get(f.path);
      const described = describeSheetFile(id, f.name, categories);
      const inReview = f.path.includes("/outfits/_review/") || described.kind === "review";
      return {
        path: f.path,
        file: f.name,
        label: "",
        version: sheetVersion(f.name),
        source: f.path.startsWith(`${dir}/outfits/`) ? "outfits" : "references",
        aliases: [...new Set([...(asset?.legacyAliases ?? []), ...(asset?.originalPath ? [asset.originalPath] : [])])].filter((p) => p !== f.path),
        isDefault: false,
        category: asset?.category ?? described.category,
        needsReview: asset ? asset.category == null && inReview : inReview,
        reviewNote: asset?.review ?? null,
        size: f.size,
      };
    });
    const card = parseCurrentCard(refIndex);
    const cardPath = card ? resolveRelative(`${dir}/references`, card) : null;
    const manifestMain = (manifest?.assets ?? []).find((a) => a.characterId === id && a.role === "main")?.path;
    const main = [cardPath, manifestMain].find((p) => p && sheets.some((s) => s.path === p)) ?? sheets.find((s) => describeSheetFile(id, s.file, categories).kind === "main")?.path ?? null;
    records.push({
      id,
      displayName,
      firstName: displayName.replace(/["“”]/g, "").split(/\s+/)[0] ?? id,
      aliases: aliasesFor(id, displayName),
      profilePath: `${dir}/index.md`,
      dir,
      group: groupOf.get(id) ?? null,
      canonicalSheet: main,
      sheets,
      references: [],
      portrait: site.has(`${id}-portrait.webp`) ? `/images/characters/${id}-portrait.webp` : null,
      sheetThumb: site.has(`${id}-sheet-thumb.webp`) ? `/images/characters/${id}-sheet-thumb.webp` : null,
    });
  }

  // Family sheets: an alias of the original when the index says it is a copy,
  // otherwise a sheet of their own.
  for (const f of familyFiles) {
    const original = copyToOriginal.get(f.name);
    const owner = (original ? records.find((r) => original.startsWith(`${r.dir}/`)) : null) ?? characterForSheetName(records, f.name);
    if (!owner) continue;
    const target = original ? owner.sheets.find((s) => s.path === original || s.aliases.includes(original)) : undefined;
    if (target) target.aliases.push(f.path);
    else owner.sheets.push({ path: f.path, file: f.name, label: "", version: null, source: "family", aliases: [], isDefault: false, category: null, needsReview: false, reviewNote: null, size: f.size });
  }

  for (const r of records) finishSheets(r, linkTexts, categories);
  return records.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function finishSheets(r: CharacterRecord, linkTexts: Map<string, string[]>, categories: string[]) {
  const rank = (x: CharacterSheet) => (x.path === r.canonicalSheet ? 0 : x.needsReview ? 3 : x.source === "family" ? 4 : x.category ? 1 : 2);
  r.sheets.sort((a, b) => rank(a) - rank(b) || (a.category ?? "").localeCompare(b.category ?? "") || (a.version ?? 0) - (b.version ?? 0) || a.file.localeCompare(b.file, undefined, { numeric: true }));
  const card = r.canonicalSheet ? r.sheets.find((s) => s.path === r.canonicalSheet) : undefined;
  const def = card ?? r.sheets.find((s) => s.aliases.some((a) => a.startsWith(`${FAMILY_DIR}/`))) ?? r.sheets.find((s) => s.source === "family") ?? r.sheets.find((s) => s.version === 1) ?? r.sheets.find((s) => !s.needsReview) ?? r.sheets[0] ?? null;
  for (const s of r.sheets) {
    s.isDefault = s === def;
    const described = describeSheetFile(r.id, s.file, categories);
    let base: string;
    if (described.kind === "main" || (s.isDefault && described.kind !== "outfit")) base = "Main sheet";
    else if (described.kind === "outfit" && described.descriptor) base = described.descriptor;
    else if (described.kind === "review" && described.descriptor) base = `Needs review: ${described.descriptor.charAt(0).toLowerCase()}${described.descriptor.slice(1)}`;
    else {
      const named = [s.path, ...s.aliases]
        .flatMap((p) => linkTexts.get(p) ?? [])
        .map((t) => outfitLabelFromLinkText(t, r))
        .filter((t): t is string => !!t && t !== "Main sheet")
        .sort((a, b) => b.length - a.length);
      base = named[0] ?? (s.isDefault ? "Main sheet" : s.source === "family" ? "Family sheet" : "Outfit");
    }
    s.label = s.version != null ? `${base} (v${s.version})` : base;
  }
  // Two sheets with the same label get their file name added so the picker stays unambiguous.
  const seen = new Map<string, number>();
  for (const s of r.sheets) seen.set(s.label, (seen.get(s.label) ?? 0) + 1);
  for (const s of r.sheets) if ((seen.get(s.label) ?? 0) > 1) s.label = `${s.label}, ${s.file}`;
  r.canonicalSheet = def?.path ?? null;
  r.references = r.sheets.map((s) => ({ path: s.path, name: s.file, status: s.isDefault ? "canonical" : "outfit", size: s.size }));
}

/** Applies names the owner gave sheets in the studio (stored in the database). */
export function applySheetLabels(characters: CharacterRecord[], labels: Map<string, string>): CharacterRecord[] {
  if (!labels.size) return characters;
  return characters.map((c) => ({ ...c, sheets: c.sheets.map((s) => (labels.has(s.path) ? { ...s, label: labels.get(s.path)! } : s)) }));
}

/** Finds the sheet (and its owner) for a repository path, including family copies. */
export function findSheet(characters: CharacterRecord[], path: string): { character: CharacterRecord; sheet: CharacterSheet } | null {
  for (const c of characters) {
    const sheet = c.sheets.find((s) => s.path === path || s.aliases.includes(path));
    if (sheet) return { character: c, sheet };
  }
  return null;
}

/** Resolves a name used in a prompt ("Morgan", "Ruby") to a character. */
export function resolveCharacter(characters: CharacterRecord[], name: string): CharacterRecord | null {
  const n = name.trim().toLowerCase();
  const exact = characters.find((c) => c.aliases.some((a) => a.toLowerCase() === n));
  if (exact) return exact;
  const matches = characters.filter((c) => c.firstName.toLowerCase() === n);
  return matches.length === 1 ? matches[0]! : null;
}

export interface ResolvedSheet {
  path: string;
  characterId: string | null;
}

/**
 * v2 prompts name the exact sheet to attach ("walker-ethan.png",
 * "children/walker-riley.png", "morgan-hayes-reference-sheet-v7.png").
 * Files are looked up only inside the configured identity-sheet folders and
 * among the characters' own references/ sheets, never anywhere else.
 */
export async function resolveSheetFiles(
  repo: RepoSource,
  characters: CharacterRecord[],
  dirs: string[],
  files: string[],
): Promise<Map<string, ResolvedSheet | null>> {
  const out = new Map<string, ResolvedSheet | null>();
  const listings = new Map<string, Promise<RepoEntry[]>>();
  const listDir = (dir: string) => {
    let p = listings.get(dir);
    if (!p) {
      p = repo.list(dir);
      listings.set(dir, p);
    }
    return p;
  };
  for (const file of files) {
    if (out.has(file)) continue;
    if (file.includes("..") || file.startsWith("/") || !IMAGE.test(file)) {
      out.set(file, null);
      continue;
    }
    const base = file.split("/").pop() ?? file;
    let found: ResolvedSheet | null = null;
    for (const c of characters) {
      // Current file names first, then retired names from the asset manifest
      // (an older prompt may still name "morgan-hayes-reference-sheet-v7.png").
      const s = c.sheets.find((x) => x.source !== "family" && x.file === base) ?? c.sheets.find((x) => x.source !== "family" && x.aliases.some((a) => !a.startsWith(`${FAMILY_DIR}/`) && a.split("/").pop() === base));
      if (s) {
        found = { path: s.path, characterId: c.id };
        break;
      }
    }
    if (!found) {
      for (const dir of dirs) {
        const sub = file.includes("/") ? `${dir}/${file.split("/").slice(0, -1).join("/")}` : dir;
        if ((await listDir(sub)).some((e) => e.type === "file" && e.name === base)) {
          const path = `${sub}/${base}`;
          found = { path, characterId: findSheet(characters, path)?.character.id ?? characterForSheetName(characters, base)?.id ?? null };
          break;
        }
      }
    }
    out.set(file, found);
  }
  return out;
}

/** "walker-ethan.png" -> Ethan Walker; "bennett-walker-avery.png" -> Avery Bennett-Walker. */
export function characterForSheetName<T extends Pick<CharacterRecord, "id" | "firstName">>(characters: T[], file: string): T | null {
  const tokens = file.replace(/\.(png|webp|jpe?g)$/i, "").toLowerCase().split("-").filter(Boolean);
  const first = tokens.at(-1);
  if (!first) return null;
  const byFirst = characters.filter((c) => c.firstName.toLowerCase() === first);
  if (byFirst.length === 1) return byFirst[0]!;
  const rest = tokens.slice(0, -1);
  const strict = byFirst.filter((c) => rest.every((t) => c.id.split("-").includes(t)));
  return strict.length === 1 ? strict[0]! : null;
}

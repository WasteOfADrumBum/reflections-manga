import type { RepoSource } from "../repo/source.ts";

/**
 * Character library built from characters/<id>/. The canonical identity sheet
 * is the image linked under "## Current Card" in references/index.md. Every
 * other image in references/ is shown as experimental and is never attached
 * automatically. Uploaded references (stored in Blob) can only add outfit or
 * location references; they never replace a canonical sheet.
 */
export interface CharacterReferenceFile {
  path: string;
  name: string;
  status: "canonical" | "experimental";
  size?: number;
}

export interface CharacterRecord {
  id: string;
  displayName: string;
  firstName: string;
  aliases: string[];
  profilePath: string;
  canonicalSheet: string | null;
  references: CharacterReferenceFile[];
  portrait: string | null;
  sheetThumb: string | null;
  appearance: string | null;
}

const IMAGE = /\.(png|webp|jpe?g)$/i;

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

export async function loadCharacters(repo: RepoSource): Promise<CharacterRecord[]> {
  const dirs = (await repo.list("characters")).filter((e) => e.type === "dir" && !e.name.startsWith("_"));
  const site = new Set((await repo.list("site/images/characters")).map((e) => e.name));
  const records: CharacterRecord[] = [];
  for (const dir of dirs) {
    const index = await repo.readText(`${dir.path}/index.md`);
    if (!index) continue;
    const heading = index.split("\n").find((l) => l.startsWith("# ")) ?? dir.name;
    const displayName = cleanDisplayName(heading);
    const refIndex = (await repo.readText(`${dir.path}/references/index.md`)) ?? "";
    const card = parseCurrentCard(refIndex);
    const canonicalSheet = card ? `${dir.path}/references/${card.replace(/^\.\//, "")}` : null;
    const files = (await repo.list(`${dir.path}/references`)).filter((e) => e.type === "file" && IMAGE.test(e.name));
    const references: CharacterReferenceFile[] = files.map((f) => ({
      path: f.path,
      name: f.name,
      status: f.path === canonicalSheet ? "canonical" : "experimental",
      size: f.size,
    }));
    references.sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.status === "canonical" ? -1 : 1));
    const appearance = await repo.readText(`${dir.path}/appearance.md`);
    records.push({
      id: dir.name,
      displayName,
      firstName: displayName.replace(/["“”]/g, "").split(/\s+/)[0] ?? dir.name,
      aliases: aliasesFor(dir.name, displayName),
      profilePath: `${dir.path}/index.md`,
      canonicalSheet: canonicalSheet && references.some((r) => r.path === canonicalSheet) ? canonicalSheet : null,
      references,
      portrait: site.has(`${dir.name}-portrait.webp`) ? `/images/characters/${dir.name}-portrait.webp` : null,
      sheetThumb: site.has(`${dir.name}-sheet-thumb.webp`) ? `/images/characters/${dir.name}-sheet-thumb.webp` : null,
      appearance: appearance ? appearance.slice(0, 4000) : null,
    });
  }
  return records.sort((a, b) => a.displayName.localeCompare(b.displayName));
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
 * the characters' own references/ folders, never anywhere else.
 */
export async function resolveSheetFiles(
  repo: RepoSource,
  characters: CharacterRecord[],
  dirs: string[],
  files: string[],
): Promise<Map<string, ResolvedSheet | null>> {
  const out = new Map<string, ResolvedSheet | null>();
  const listings = new Map<string, Set<string>>();
  const listDir = async (dir: string) => {
    let names = listings.get(dir);
    if (!names) {
      names = new Set((await repo.list(dir)).filter((e) => e.type === "file").map((e) => e.name));
      listings.set(dir, names);
    }
    return names;
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
      const ref = c.references.find((r) => r.name === base);
      if (ref) {
        found = { path: ref.path, characterId: c.id };
        break;
      }
    }
    if (!found) {
      for (const dir of dirs) {
        const sub = file.includes("/") ? `${dir}/${file.split("/").slice(0, -1).join("/")}` : dir;
        if ((await listDir(sub)).has(base)) {
          found = { path: `${sub}/${base}`, characterId: characterForSheetName(characters, base)?.id ?? null };
          break;
        }
      }
    }
    out.set(file, found);
  }
  return out;
}

/** "walker-ethan.png" -> Ethan Walker; "bennett-walker-avery.png" -> Avery Bennett-Walker. */
export function characterForSheetName(characters: CharacterRecord[], file: string): CharacterRecord | null {
  const tokens = file.replace(/\.(png|webp|jpe?g)$/i, "").toLowerCase().split("-").filter(Boolean);
  const first = tokens.at(-1);
  if (!first) return null;
  const byFirst = characters.filter((c) => c.firstName.toLowerCase() === first);
  if (byFirst.length === 1) return byFirst[0]!;
  const rest = tokens.slice(0, -1);
  const strict = byFirst.filter((c) => rest.every((t) => c.id.split("-").includes(t)));
  return strict.length === 1 ? strict[0]! : null;
}

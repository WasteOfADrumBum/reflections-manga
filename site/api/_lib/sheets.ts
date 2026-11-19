import { z } from "zod";
import type { Session } from "./auth/auth.js";
import type { StudioDeps } from "./context.js";
import { describeSheetFile, MANIFEST_PATH, OUTFIT_CATEGORIES, parseManifest } from "./content/characters.js";
import { badRequest, notFound } from "./errors.js";
import { json, readJson, type Router } from "./http.js";
import { needPublisher, slug, stamp } from "./library.js";
import type { PublishFile } from "./publish/publisher.js";
import { studioCharacters } from "./engine/worker.js";

/**
 * Changing an outfit sheet's category. Outfit files are named
 * <id>-<category>-<descriptor>.png, and sheets without a category wait in
 * outfits/_review/, so a new category means moving the file. The pull request
 * moves the image (same bytes), updates its entry in
 * characters/asset-manifest.json, and rewrites every Markdown or text link to
 * the old path, so tools/validate-character-assets.py keeps passing.
 */
type RequireAdmin = (req: Request) => Promise<Session>;

/** Folders whose text files can link to character sheets. */
const TEXT_ROOTS = ["characters", "production", "continuity", "assets", "stories", "prompts", "series", "world", "docs"];
const TEXT_FILE = /\.(md|txt)$/i;

function dirOf(p: string) {
  return p.split("/").slice(0, -1).join("/");
}

function relative(fromDir: string, to: string): string {
  const a = fromDir ? fromDir.split("/") : [];
  const b = to.split("/");
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill(".."), ...b.slice(i)].join("/");
}

function resolve(fromDir: string, target: string): string {
  const parts = fromDir ? fromDir.split("/") : [];
  for (const seg of target.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Rewrites references to a moved file inside one text file. A reference is the
 * old file name with whatever path is written in front of it: a relative link
 * ("_review/x.png", "../../characters/.../x.png"), a repository path
 * ("characters/main/.../x.png") or the bare file name (as prompts use).
 * Only references that point at the old path are changed.
 */
export function rewriteReferences(text: string, filePath: string, oldPath: string, newPath: string): string {
  const oldBase = oldPath.split("/").pop()!;
  const newBase = newPath.split("/").pop()!;
  const fromDir = dirOf(filePath);
  const re = new RegExp(`([\\w./%-]*?)${oldBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "g");
  return text.replace(re, (whole, prefix: string) => {
    if (!prefix) return newBase;
    if (prefix.startsWith("characters/") && `${prefix}${oldBase}` === oldPath) return newPath;
    if (resolve(fromDir, `${prefix}${oldBase}`) === oldPath) return relative(fromDir, newPath);
    return whole;
  });
}

/** Marks the outfit library row for the moved sheet with its new category. */
export function updateLibraryRow(indexMd: string, newFile: string, category: string, user: string): string {
  const stem = newFile.replace(/\.(png|webp|jpe?g)$/i, "");
  return indexMd
    .split("\n")
    .map((line) => {
      if (!line.startsWith("|") || !line.includes(`(${newFile})`)) return line;
      const cells = line.split("|");
      // ["", " Category ", " [link](file) ", " Review ", ""]
      if (cells.length < 5) return line;
      cells[1] = ` ${category} `;
      cells[2] = ` [${stem}](${newFile}) `;
      cells[3] = ` Category set in Reflections Studio by ${user}. `;
      return cells.join("|");
    })
    .join("\n");
}

export function registerSheetRoutes(r: Router, deps: StudioDeps, requireAdmin: RequireAdmin) {
  r.add("POST", "/characters/:id/sheets/category", async ({ req, params }) => {
    const s = await requireAdmin(req);
    const publisher = needPublisher(deps);
    const id = z.string().regex(/^[a-z0-9-]+$/).parse(params.id);
    const ch = (await studioCharacters(deps)).find((c) => c.id === id);
    if (!ch) throw notFound("Unknown character.");
    const manifestText = await publisher.readFile(MANIFEST_PATH);
    const manifest = parseManifest(manifestText);
    const categories = manifest?.categories?.length ? manifest.categories : OUTFIT_CATEGORIES;
    const body = z.object({ path: z.string().max(300), category: z.string().max(40) }).safeParse(await readJson(req, 4096));
    if (!body.success) throw badRequest("Choose an outfit sheet and a category.");
    if (!categories.includes(body.data.category)) throw badRequest("Choose one of the listed categories.");
    const sheet = ch.sheets.find((x) => x.path === body.data.path);
    if (!sheet) throw notFound("That sheet is not one of this character's sheets.");
    const described = describeSheetFile(id, sheet.file, categories);
    if (described.kind === "main" || sheet.isDefault) throw badRequest("The main reference sheet has no outfit category.");
    if (!sheet.needsReview && sheet.category === body.data.category) throw badRequest(`It is already in ${body.data.category}.`);

    const ext = /\.(png|webp|jpe?g)$/i.exec(sheet.file)?.[0]?.toLowerCase() ?? ".png";
    const descriptor = slug(described.descriptor ?? sheet.label) || "outfit";
    let file = `${id}-${body.data.category}-${descriptor}${ext}`;
    for (let n = 2; ch.sheets.some((x) => x.file === file && x.path !== sheet.path); n++) file = `${id}-${body.data.category}-${descriptor}-v${n}${ext}`;
    const newPath = `${ch.dir}/outfits/${file}`;
    if (newPath === sheet.path) throw badRequest("Nothing to change.");
    const data = await deps.repo.readBinary(sheet.path);
    if (!data) throw notFound("The sheet image could not be read from the repository.");

    const files: PublishFile[] = [{ path: newPath, content: data }];
    if (manifest && manifestText) {
      const m = JSON.parse(manifestText) as { assets: Record<string, unknown>[] };
      const asset = m.assets.find((a) => a.path === sheet.path);
      if (asset) {
        asset.path = newPath;
        asset.category = body.data.category;
        asset.review = null;
        asset.evidence = `${String(asset.evidence ?? "").trim()} Category set to ${body.data.category} in Reflections Studio by ${s.user}.`.trim();
      }
      files.push({ path: MANIFEST_PATH, content: Buffer.from(`${JSON.stringify(m, null, 2)}\n`) });
    }

    // Rewrite every link to the old path. Only files that mention the old file name are read in full.
    const oldBase = sheet.file;
    const candidates = (await Promise.all(TEXT_ROOTS.map((root) => deps.repo.walk(root).catch(() => [])))).flat().filter((e) => e.type === "file" && TEXT_FILE.test(e.name));
    const indexPath = `${ch.dir}/outfits/index.md`;
    const queue = [...candidates];
    const workers = Array.from({ length: 8 }, async () => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        const text = await publisher.readFile(e.path);
        if (!text || !text.includes(oldBase)) continue;
        let next = rewriteReferences(text, e.path, sheet.path, newPath);
        if (e.path === indexPath) next = updateLibraryRow(next, file, body.data.category, s.user);
        if (next !== text) files.push({ path: e.path, content: Buffer.from(next) });
      }
    });
    await Promise.all(workers);

    const res = await publisher.openPullRequest({
      branch: `studio/outfit-category-${id}-${stamp(deps)}`,
      title: `Move ${ch.firstName}'s ${sheet.label} sheet to ${body.data.category}`,
      commitMessage: `Set ${ch.displayName} outfit category: ${sheet.label} -> ${body.data.category}\n\nChanged in Reflections Studio.`,
      body: [
        `Changed in Reflections Studio by ${s.user}.`,
        ``,
        `- Moves \`${sheet.path}\` to \`${newPath}\` (same image).`,
        manifest ? `- Updates its entry in \`${MANIFEST_PATH}\` (category ${body.data.category}${sheet.needsReview ? ", review note cleared" : ""}).` : null,
        `- Updates links to it in ${files.length - (manifest ? 2 : 1)} document(s).`,
      ]
        .filter(Boolean)
        .join("\n"),
      files,
      mustNotExist: [newPath],
      deletePaths: [sheet.path],
    });
    // Keep the name the owner gave this sheet once the move merges.
    await deps.db.query(`INSERT INTO sheet_labels (path, label, updated_at) SELECT $2, label, $3 FROM sheet_labels WHERE path = $1 ON CONFLICT (path) DO NOTHING`, [sheet.path, newPath, deps.clock.now()]);
    return json({ prUrl: res.prUrl, path: newPath }, 201);
  });
}

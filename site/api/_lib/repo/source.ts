import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Read-only access to the manga repository: scripts, prompts, character
 * sheets, continuity and existing artwork. GitHub stays the source of truth;
 * production reads the configured branch through the GitHub API, local
 * development and tests read the working tree.
 */
export interface RepoEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface RepoSource {
  readText(repoPath: string): Promise<string | null>;
  readBinary(repoPath: string): Promise<Buffer | null>;
  list(repoDir: string): Promise<RepoEntry[]>;
  /** Every file under a folder, at any depth (one request on GitHub). */
  walk(repoDir: string): Promise<RepoEntry[]>;
  exists(repoPath: string): Promise<boolean>;
}

/** Shared helper so every source walks the same way when it has no faster path. */
export async function walkByListing(source: Pick<RepoSource, "list">, dir: string, depth = 8): Promise<RepoEntry[]> {
  const out: RepoEntry[] = [];
  const entries = await source.list(dir);
  for (const e of entries) {
    if (e.type === "file") out.push(e);
    else if (depth > 0) out.push(...(await walkByListing(source, e.path, depth - 1)));
  }
  return out;
}

export function assertRepoPath(repoPath: string): string {
  const clean = repoPath.replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\") || clean.startsWith(".git")) {
    throw new Error("Unsafe repository path");
  }
  return clean;
}

export class LocalRepoSource implements RepoSource {
  constructor(private readonly root: string) {}
  private resolve(p: string) {
    const full = path.resolve(this.root, assertRepoPath(p));
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Path escapes repository");
    return full;
  }
  async readText(p: string) {
    try {
      return await readFile(this.resolve(p), "utf8");
    } catch {
      return null;
    }
  }
  async readBinary(p: string) {
    try {
      return await readFile(this.resolve(p));
    } catch {
      return null;
    }
  }
  async list(dir: string) {
    try {
      const full = this.resolve(dir);
      const entries = await readdir(full, { withFileTypes: true });
      const out: RepoEntry[] = [];
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const rel = `${assertRepoPath(dir).replace(/\/$/, "")}/${e.name}`;
        out.push({ name: e.name, path: rel, type: e.isDirectory() ? "dir" : "file", size: e.isFile() ? (await stat(path.join(full, e.name))).size : undefined });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }
  walk(dir: string) {
    return walkByListing(this, dir);
  }
  async exists(p: string) {
    try {
      await stat(this.resolve(p));
      return true;
    } catch {
      return false;
    }
  }
}

type FetchLike = typeof fetch;

/** Reads the private repository through the GitHub REST API. */
export class GitHubRepoSource implements RepoSource {
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();
  constructor(
    private readonly opts: { token: string; repository: string; ref: string; fetchImpl?: FetchLike; ttlMs?: number },
  ) {}

  private url(p: string) {
    const enc = assertRepoPath(p).split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${this.opts.repository}/contents/${enc}?ref=${encodeURIComponent(this.opts.ref)}`;
  }

  private async request(p: string, accept: string): Promise<Response | null> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(this.url(p), {
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "reflections-studio",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read failed (${res.status}) for ${assertRepoPath(p)}`);
    return res;
  }

  /** Per-instance cache; entries expire so merged changes on GitHub show up within a minute. */
  private memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < (this.opts.ttlMs ?? 60_000)) return hit.value as Promise<T>;
    const value = fn().catch((e) => {
      this.cache.delete(key);
      throw e;
    });
    this.cache.set(key, { at: now, value });
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    return value;
  }

  readText(p: string) {
    return this.memo(`t:${p}`, async () => {
      const res = await this.request(p, "application/vnd.github.raw+json");
      return res ? await res.text() : null;
    });
  }

  readBinary(p: string) {
    return this.memo(`b:${p}`, async () => {
      // The raw media type serves files up to 100 MB.
      const res = await this.request(p, "application/vnd.github.raw+json");
      return res ? Buffer.from(await res.arrayBuffer()) : null;
    });
  }

  /**
   * The whole repository tree in one request. Listing folders one by one cost
   * dozens of API calls per page view and made the admin slow; the recursive
   * tree answers every list() and walk() from a single cached response.
   */
  private tree() {
    return this.memo("tree", async () => {
      const f = this.opts.fetchImpl ?? fetch;
      const res = await f(`https://api.github.com/repos/${this.opts.repository}/git/trees/${encodeURIComponent(this.opts.ref)}?recursive=1`, {
        headers: { Authorization: `Bearer ${this.opts.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "reflections-studio" },
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { truncated?: boolean; tree?: { path: string; type: string; size?: number }[] };
      if (body.truncated || !Array.isArray(body.tree)) return null;
      return body.tree
        .filter((e) => e.type === "blob" || e.type === "tree")
        .map((e) => ({ name: e.path.split("/").pop() ?? e.path, path: e.path, type: e.type === "tree" ? ("dir" as const) : ("file" as const), size: e.size }));
    });
  }

  async list(dir: string) {
    const clean = assertRepoPath(dir).replace(/\/$/, "");
    const tree = await this.tree().catch(() => null);
    if (tree) {
      const prefix = `${clean}/`;
      return tree
        .filter((e) => e.path.startsWith(prefix) && !e.path.slice(prefix.length).includes("/") && !e.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return this.listByContents(clean);
  }

  async walk(dir: string) {
    const clean = assertRepoPath(dir).replace(/\/$/, "");
    const tree = await this.tree().catch(() => null);
    if (!tree) return walkByListing({ list: (d) => this.listByContents(d) }, clean);
    const prefix = `${clean}/`;
    return tree.filter((e) => e.type === "file" && e.path.startsWith(prefix) && !e.path.split("/").some((part) => part.startsWith("."))).sort((a, b) => a.path.localeCompare(b.path));
  }

  private listByContents(dir: string) {
    return this.memo(`l:${dir}`, async () => {
      const res = await this.request(dir, "application/vnd.github+json");
      if (!res) return [];
      const body = (await res.json()) as unknown;
      if (!Array.isArray(body)) return [];
      return body
        .map((e: { name: string; path: string; type: string; size?: number }) => ({
          name: e.name,
          path: e.path,
          type: e.type === "dir" ? ("dir" as const) : ("file" as const),
          size: e.size,
        }))
        .filter((e) => !e.name.startsWith("."))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async exists(p: string) {
    const parent = p.split("/").slice(0, -1).join("/");
    const name = p.split("/").pop();
    const entries = await this.list(parent);
    return entries.some((e) => e.name === name);
  }
}

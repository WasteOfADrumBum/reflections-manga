/**
 * Publishing goes through GitHub so the repository stays the source of truth
 * and Vercel redeploys the reader from main. Writing to a function's filesystem
 * would not change the deployed site, so the studio never does that.
 */
export interface PublishFile {
  path: string;
  content: Buffer;
}

export interface PublishRequest {
  branch: string;
  title: string;
  body: string;
  commitMessage: string;
  files: PublishFile[];
  /** Paths that must NOT already exist on the base branch (no overwrites of artwork). */
  mustNotExist: string[];
  /** Paths removed in the same commit, used only to move a file (its content is re-added under a new path in `files`). */
  deletePaths?: string[];
}

export interface PublishResult {
  branch: string;
  prUrl: string;
  prNumber: number;
  commitSha: string;
}

export interface Publisher {
  readFile(path: string): Promise<string | null>;
  exists(path: string): Promise<boolean>;
  openPullRequest(req: PublishRequest): Promise<PublishResult>;
}

type FetchLike = typeof fetch;

export class GitHubPublisher implements Publisher {
  constructor(private readonly opts: { token: string; repository: string; base: string; fetchImpl?: FetchLike }) {}

  private async gh<T>(method: string, path: string, body?: unknown, okStatuses: number[] = [200, 201]): Promise<{ status: number; data: T }> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`https://api.github.com/repos/${this.opts.repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "reflections-studio",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = (text ? JSON.parse(text) : {}) as T;
    if (!okStatuses.includes(res.status)) {
      const msg = (data as { message?: string })?.message ?? res.statusText;
      throw Object.assign(new Error(`GitHub ${method} ${path.split("?")[0]} failed (${res.status}): ${msg}`), { status: res.status });
    }
    return { status: res.status, data };
  }

  async readFile(path: string): Promise<string | null> {
    const f = this.opts.fetchImpl ?? fetch;
    const res = await f(`https://api.github.com/repos/${this.opts.repository}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(this.opts.base)}`, {
      headers: { Authorization: `Bearer ${this.opts.token}`, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "reflections-studio" },
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    return res.text();
  }

  async exists(path: string): Promise<boolean> {
    const r = await this.gh<unknown>("GET", `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(this.opts.base)}`, undefined, [200, 404]);
    return r.status === 200;
  }

  async openPullRequest(req: PublishRequest): Promise<PublishResult> {
    for (const p of req.mustNotExist) {
      if (await this.exists(p)) throw Object.assign(new Error(`Refusing to publish: ${p} already exists on ${this.opts.base}. Existing artwork is never overwritten.`), { status: 409 });
    }
    const ref = await this.gh<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodeURIComponent(this.opts.base)}`);
    const baseSha = ref.data.object.sha;
    const baseCommit = await this.gh<{ tree: { sha: string } }>("GET", `/git/commits/${baseSha}`);
    const tree = [];
    for (const file of req.files) {
      const blob = await this.gh<{ sha: string }>("POST", `/git/blobs`, { content: file.content.toString("base64"), encoding: "base64" });
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.data.sha });
    }
    for (const path of req.deletePaths ?? []) tree.push({ path, mode: "100644", type: "blob", sha: null as unknown as string });
    const newTree = await this.gh<{ sha: string }>("POST", `/git/trees`, { base_tree: baseCommit.data.tree.sha, tree });
    const commit = await this.gh<{ sha: string }>("POST", `/git/commits`, { message: req.commitMessage, tree: newTree.data.sha, parents: [baseSha] });
    await this.gh("POST", `/git/refs`, { ref: `refs/heads/${req.branch}`, sha: commit.data.sha });
    const pr = await this.gh<{ html_url: string; number: number }>("POST", `/pulls`, { title: req.title, head: req.branch, base: this.opts.base, body: req.body, draft: false });
    return { branch: req.branch, prUrl: pr.data.html_url, prNumber: pr.data.number, commitSha: commit.data.sha };
  }
}

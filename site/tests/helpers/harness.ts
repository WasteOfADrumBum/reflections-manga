import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { createApp } from "../../api/_lib/app.ts";
import { hashPassword } from "../../api/_lib/auth/auth.ts";
import type { Clock, StudioDeps } from "../../api/_lib/context.ts";
import type { Db } from "../../api/_lib/db/client.ts";
import { resetMigrationCache } from "../../api/_lib/db/schema.ts";
import { silentLogger } from "../../api/_lib/log.ts";
import type { ImageProvider, ImageRequest, QaProvider, QaRequest, VisionQaResult } from "../../api/_lib/openai/providers.ts";
import type { Publisher, PublishRequest } from "../../api/_lib/publish/publisher.ts";
import { findChapterBlock, matchBracket } from "../../api/_lib/content/chapters.ts";
import { LocalRepoSource, type RepoEntry, type RepoSource } from "../../api/_lib/repo/source.ts";
import { MemoryBlobStore } from "../../api/_lib/storage/blobs.ts";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const PASSWORD = "correct horse battery staple";
export const SESSION_SECRET = "test-session-secret-0123456789abcdef";
export const CRON_SECRET = "test-cron-secret-0123456789abcdef";

/**
 * The repository as the studio sees it after the version 2 reader change
 * (PR 32): chapter 001 shows only the v2 page 001, and the v1 reader files
 * live in site/pages/chapter-001/version_1/. Tests use this view so they do
 * not depend on whether that change has been merged yet.
 */
export class V2ReaderRepo implements RepoSource {
  private chaptersJs: Promise<string | null> | undefined;
  constructor(private readonly base: RepoSource) {}
  private static hidden(p: string) {
    const m = /^site\/pages\/chapter-001\/(\d{3})\.webp$/.exec(p);
    return m != null && Number(m[1]) > 1;
  }
  private readerJs() {
    this.chaptersJs ??= this.base.readText("site/js/chapters.js").then((js) => {
      if (!js) return js;
      const block = findChapterBlock(js, "001");
      if (!block) return js;
      const open = js.indexOf("pages: [", block.start);
      const close = matchBracket(js, open + "pages: ".length, "[", "]");
      const entry = `{ src: "/pages/chapter-001/001.webp", alt: "Version 2 page 001.", width: 1024, height: 1536 }`;
      return `${js.slice(0, open)}pages: [\n      ${entry}\n    ]${js.slice(close + 1)}`;
    });
    return this.chaptersJs;
  }
  readText(p: string) {
    if (p === "site/js/chapters.js") return this.readerJs();
    return V2ReaderRepo.hidden(p) ? Promise.resolve(null) : this.base.readText(p);
  }
  readBinary(p: string) {
    return V2ReaderRepo.hidden(p) ? Promise.resolve(null) : this.base.readBinary(p);
  }
  async list(dir: string): Promise<RepoEntry[]> {
    return (await this.base.list(dir)).filter((e) => !V2ReaderRepo.hidden(e.path));
  }
  exists(p: string) {
    return V2ReaderRepo.hidden(p) ? Promise.resolve(false) : this.base.exists(p);
  }
}

export function testRepo(): RepoSource {
  return new V2ReaderRepo(new LocalRepoSource(REPO_ROOT));
}

let cachedHash: string | undefined;
async function passwordHash() {
  cachedHash ??= await hashPassword(PASSWORD, { N: 2 ** 14, r: 8, p: 1 });
  return cachedHash;
}

/** Postgres semantics without a server: PGlite runs the real engine in WASM. */
export async function createTestDb(): Promise<Db & { pg: PGlite }> {
  const pg = await PGlite.create();
  const wrap = (q: { query: PGlite["query"] }): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const res = await q.query<T>(sql, params as unknown[]);
      return res.rows;
    },
    tx: (fn) => (q === pg ? pg.transaction((tx) => fn(wrap(tx as unknown as { query: PGlite["query"] }))) : fn(wrap(q))),
  });
  const db = wrap(pg);
  return Object.assign(db, { pg, close: () => pg.close() });
}

export class TestClock implements Clock {
  constructor(public t = new Date("2026-11-20T12:00:00Z").getTime()) {}
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t += ms;
  }
}

export async function fakePage(label: string, width = 1024, height = 1536): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#f6f3ec"/><rect x="40" y="40" width="${width - 80}" height="${height / 3}" fill="#c9b8a0"/><text x="80" y="${height / 2}" font-size="96" fill="#16161a">${label}</text></svg>`;
  // Add noise so the PNG has realistic size (> 50 KB) for the "image data" check.
  const noise = randomBytes(width * height * 3);
  const base = await sharp(noise, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return sharp(base).composite([{ input: Buffer.from(svg), blend: "over" }]).png().toBuffer();
}

export class MockImageProvider implements ImageProvider {
  readonly name = "mock";
  calls: ImageRequest[] = [];
  /** Queue of behaviours, consumed per call: "ok" | Error-like | function. */
  script: (("ok" | { status?: number; code?: string; message: string; headers?: Record<string, string> } | ((req: ImageRequest) => Promise<Buffer>)))[] = [];
  size = { width: 1024, height: 1536 };
  async generatePage(req: ImageRequest) {
    this.calls.push(req);
    const next = this.script.shift() ?? "ok";
    if (typeof next === "function") return { image: await next(req), format: "png" as const, usage: null, model: req.model };
    if (next !== "ok") throw Object.assign(new Error(next.message), next);
    const page = /\bPage (\d+)\./.exec(req.prompt)?.[1] ?? "?";
    return {
      image: await fakePage(`P${page}`, this.size.width, this.size.height),
      format: "png" as const,
      usage: { input_tokens: 9000, output_tokens: 6500, input_tokens_details: { image_tokens: 6500, text_tokens: 2500 } },
      model: req.model,
    };
  }
}

export class MockQaProvider implements QaProvider {
  calls: QaRequest[] = [];
  /** Override per call; default is a clean pass built from the instructions. */
  script: (Partial<VisionQaResult> | Error)[] = [];
  async evaluate(req: QaRequest) {
    this.calls.push(req);
    const override = this.script.shift();
    if (override instanceof Error) throw override;
    const expectedPanels = Number(/Expected panels: exactly (\d+)/.exec(req.instructions)?.[1] ?? 4);
    const cast = (/Only these characters may appear: ([^.]+)\./.exec(req.instructions)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const lettering = [...req.instructions.matchAll(/panel (\d+): [a-z]+(?: \([^)]*\))?: "(.*)"/g)].map((m) => ({ panel: Number(m[1]), text: m[2] ?? "", kind: "speech" }));
    const result: VisionQaResult = {
      panelCount: expectedPanels,
      readingOrderLeftToRight: true,
      charactersPresent: cast.map((name) => ({ name, confidence: 0.95 })),
      unexpectedPeople: [],
      likeness: cast.map((name) => ({ name, score: 0.9, notes: "" })),
      clothingMatches: cast.map((name) => ({ name, matches: true, notes: "" })),
      transcribedText: lettering,
      artifacts: [],
      continuityIssues: [],
      layoutMatches: true,
      overallConfidence: 0.92,
      summary: "Mock QA: matches the specification.",
      ...override,
    };
    return { result, usage: { input_tokens: 4000, output_tokens: 600 } };
  }
}

export class MockPublisher implements Publisher {
  requests: PublishRequest[] = [];
  constructor(private readonly repo: RepoSource, public existing = new Set<string>()) {}
  readFile(p: string) {
    return this.repo.readText(p);
  }
  async exists(p: string) {
    return this.existing.has(p) || (await this.repo.exists(p));
  }
  async openPullRequest(req: PublishRequest) {
    for (const p of req.mustNotExist) if (await this.exists(p)) throw Object.assign(new Error(`Refusing to publish: ${p} already exists`), { status: 409 });
    this.requests.push(req);
    return { branch: req.branch, prUrl: `https://github.com/example/repo/pull/${this.requests.length}`, prNumber: this.requests.length, commitSha: "abc123" };
  }
}

export interface Harness {
  deps: StudioDeps;
  db: Db & { pg: PGlite };
  clock: TestClock;
  images: MockImageProvider;
  qa: MockQaProvider;
  blobs: MemoryBlobStore;
  publisher: MockPublisher;
  kicks: string[];
  handle: (req: Request) => Promise<Response>;
  repo: RepoSource;
}

export async function createHarness(overrides: Partial<StudioDeps> = {}, opts: { db?: Db & { pg: PGlite }; blobs?: MemoryBlobStore; workerId?: string } = {}): Promise<Harness> {
  resetMigrationCache();
  const db = opts.db ?? (await createTestDb());
  const clock = new TestClock();
  const images = new MockImageProvider();
  const qa = new MockQaProvider();
  const blobs = opts.blobs ?? new MemoryBlobStore();
  const repo = testRepo();
  const publisher = new MockPublisher(repo);
  const kicks: string[] = [];
  const deps: StudioDeps = {
    db,
    blobs,
    repo,
    images,
    qa,
    publisher,
    clock,
    logger: silentLogger,
    auth: { username: "owner", passwordHash: await passwordHash(), sessionSecret: SESSION_SECRET, sessionTtlHours: 12 },
    cronSecret: CRON_SECRET,
    generationEnabled: true,
    kick: (reason) => kicks.push(reason),
    workerId: opts.workerId ?? "worker-a",
    leaseMs: 290_000,
    newId: () => randomUUID(),
    safetyIdentifier: "test-safety-id",
    missingConfig: [],
    ...overrides,
  };
  const handle = createApp(deps);
  return { deps, db, clock, images, qa, blobs, publisher, kicks, handle, repo };
}

export const BASE = "https://studio.test";

export async function login(h: Harness): Promise<string> {
  const res = await h.handle(
    new Request(`${BASE}/api/studio/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-studio-request": "1", origin: BASE, host: "studio.test" },
      body: JSON.stringify({ username: "owner", password: PASSWORD }),
    }),
  );
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${await res.text()}`);
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0] ?? "";
}

export function api(h: Harness, cookie: string) {
  return async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await h.handle(
      new Request(`${BASE}/api/studio${p}`, {
        method,
        headers: { cookie, "x-studio-request": "1", origin: BASE, host: "studio.test", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data: data as any, headers: res.headers }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
}

/** Runs worker steps until nothing is runnable, advancing the clock past retry waits. */
export async function drain(h: Harness, maxSteps = 200) {
  const { runWorkerStep } = await import("../../api/_lib/engine/worker.ts");
  const outcomes: string[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const r = await runWorkerStep(h.deps);
    if (r.worked) {
      outcomes.push(`${r.page}:${r.outcome}`);
      continue;
    }
    if (r.outcome === "waiting") {
      h.clock.advance(200_000);
      continue;
    }
    break;
  }
  return outcomes;
}

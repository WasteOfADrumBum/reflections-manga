/**
 * Local development and end-to-end test server. NOT deployed (scripts/ is in
 * .vercelignore). Serves the static site with Vercel-style clean URLs and runs
 * the studio API in-process with:
 *   - PGlite (real Postgres in WASM) instead of a hosted database,
 *   - an in-memory blob store,
 *   - the local working tree as the repository source,
 *   - MOCKED OpenAI and GitHub publishing unless you opt in to real OpenAI with
 *     STUDIO_DEV_REAL_OPENAI=1 and OPENAI_API_KEY (paid; never used by tests).
 *
 * Usage: npm run dev  (sign in as "owner" with STUDIO_DEV_PASSWORD or the printed default)
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp, runWorkerLoop } from "../api/_lib/app.ts";
import { OpenAIImageProvider, OpenAIQaProvider } from "../api/_lib/openai/openai-adapters.ts";
import { createHarness } from "../tests/helpers/harness.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, "..");
const PORT = Number(process.env.PORT ?? 8137);
const realOpenAI = process.env.STUDIO_DEV_REAL_OPENAI === "1" && !!process.env.OPENAI_API_KEY;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
};

const h = await createHarness({
  generationEnabled: true,
  ...(realOpenAI ? { images: new OpenAIImageProvider(process.env.OPENAI_API_KEY!), qa: new OpenAIQaProvider(process.env.OPENAI_API_KEY!) } : {}),
});
h.clock.now = () => new Date();
let working = false;
h.deps.kick = () => {
  if (working) return;
  working = true;
  setTimeout(async () => {
    try {
      await runWorkerLoop(h.deps, { budgetMs: 30_000 });
    } finally {
      working = false;
    }
    // Keep draining in the background like chained invocations would.
    const pending = await h.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM job_pages jp JOIN jobs j ON j.id = jp.job_id WHERE j.status IN ('queued','running') AND jp.status IN ('queued','retry_wait')`);
    if ((pending[0]?.n ?? 0) > 0) setTimeout(() => h.deps.kick("dev-loop"), 500);
  }, 50);
};
if (process.env.STUDIO_DEV_VERIFIED === "1") {
  const { setStudioSetting } = await import("../api/_lib/engine/jobs.ts");
  await setStudioSetting(h.deps, "real_generation_verified", true);
}
const handle = createApp(h.deps);

async function staticFile(urlPath: string): Promise<{ body: Buffer; type: string } | null> {
  const clean = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  if (clean.includes("..")) return null;
  const candidates = clean.endsWith("/") ? [`${clean}index.html`] : [clean, `${clean}.html`, `${clean}/index.html`];
  for (const c of candidates) {
    const full = path.join(SITE, c);
    if (!full.startsWith(SITE) || /[\\/](api|node_modules|tests|scripts)[\\/]/.test(full.slice(SITE.length))) continue;
    try {
      if ((await stat(full)).isFile()) return { body: await readFile(full), type: TYPES[path.extname(full)] ?? "application/octet-stream" };
    } catch {
      /* next */
    }
  }
  return null;
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/studio")) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const response = await handle(new Request(url, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : body }));
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = await staticFile(url.pathname);
    if (!file) {
      const nf = await staticFile("/404.html");
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(nf?.body ?? "Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": file.type, "X-Content-Type-Options": "nosniff" });
    res.end(file.body);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end("error");
  }
}).listen(PORT, () => {
  console.log(`Reflections dev server on http://localhost:${PORT}  (studio: /admin, user "owner", password "correct horse battery staple")`);
  console.log(realOpenAI ? "WARNING: real, paid OpenAI requests are enabled." : "OpenAI and GitHub publishing are mocked.");
});

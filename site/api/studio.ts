import { createHash } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { createApp } from "./_lib/app.ts";
import { constantTimeEqual } from "./_lib/auth/auth.ts";
import { defaultIds, type StudioDeps, systemClock } from "./_lib/context.ts";
import { createPgDb } from "./_lib/db/client.ts";
import { EnvError, missingConfiguration, parseEnv, publicBaseUrl } from "./_lib/env.ts";
import { json } from "./_lib/http.ts";
import { createLogger } from "./_lib/log.ts";
import { OpenAIImageProvider, OpenAIQaProvider } from "./_lib/openai/openai-adapters.ts";
import { GitHubPublisher } from "./_lib/publish/publisher.ts";
import { GitHubRepoSource } from "./_lib/repo/source.ts";
import { VercelBlobStore } from "./_lib/storage/blobs.ts";

/**
 * Single Vercel Function for the studio API (all routes under /api/studio/*,
 * rewritten here by vercel.json). Secrets stay server-side.
 */
const logger = createLogger({ svc: "reflections-studio" });
let handler: ((req: Request) => Promise<Response>) | undefined;
let configError: EnvError | undefined;

function build(): ((req: Request) => Promise<Response>) | undefined {
  if (handler || configError) return handler;
  try {
    const env = parseEnv(process.env);
    const ids = defaultIds();
    const base = publicBaseUrl(env);
    const kick = (reason: string) => {
      // Fire-and-forget: start another worker invocation. The callee answers
      // when its step is done; we only need the request to be sent.
      const p = fetch(`${base}/api/studio/worker/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.CRON_SECRET}`, "X-Kick-Reason": reason },
        signal: AbortSignal.timeout(4000),
      })
        .then(() => undefined)
        .catch(() => undefined);
      waitUntil(p);
      if (env.GITHUB_DISPATCH_WORKFLOW && (reason === "job-created" || reason === "job-resumed")) {
        waitUntil(
          fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/${encodeURIComponent(env.GITHUB_DISPATCH_WORKFLOW)}/dispatches`, {
            method: "POST",
            headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "reflections-studio" },
            body: JSON.stringify({ ref: env.GITHUB_BRANCH }),
          })
            .then((r) => {
              if (!r.ok) logger.warn("heartbeat workflow dispatch failed", { status: r.status });
            })
            .catch(() => undefined),
        );
      }
    };
    const deps: StudioDeps = {
      db: createPgDb(env.DATABASE_URL),
      blobs: new VercelBlobStore(),
      repo: new GitHubRepoSource({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, ref: env.GITHUB_BRANCH }),
      images: env.OPENAI_API_KEY ? new OpenAIImageProvider(env.OPENAI_API_KEY) : null,
      qa: env.OPENAI_API_KEY ? new OpenAIQaProvider(env.OPENAI_API_KEY) : null,
      publisher: new GitHubPublisher({ token: env.GITHUB_TOKEN, repository: env.GITHUB_REPOSITORY, base: env.GITHUB_BRANCH }),
      clock: systemClock,
      logger,
      auth: { username: env.ADMIN_USERNAME, passwordHash: env.ADMIN_PASSWORD_HASH, sessionSecret: env.SESSION_SECRET, sessionTtlHours: env.SESSION_TTL_HOURS },
      cronSecret: env.CRON_SECRET,
      generationEnabled: env.STUDIO_GENERATION_ENABLED,
      kick,
      workerId: ids.workerId,
      leaseMs: 290_000,
      newId: ids.newId,
      safetyIdentifier: createHash("sha256").update(`reflections-studio:${env.SESSION_SECRET}`).digest("hex").slice(0, 32),
      missingConfig: missingConfiguration(process.env),
    };
    handler = createApp(deps);
    return handler;
  } catch (err) {
    if (err instanceof EnvError) {
      configError = err;
      logger.error("studio configuration incomplete", { issues: err.issues });
      return undefined;
    }
    throw err;
  }
}

/** vercel.json rewrites /api/studio/<path> to /api/studio?__path=<path>; restore the original path. */
function restorePath(req: Request): Request {
  const url = new URL(req.url);
  const p = url.searchParams.get("__path");
  if (p == null) return req;
  url.searchParams.delete("__path");
  url.pathname = `/api/studio/${p.replace(/^\/+/, "")}`;
  const init: RequestInit & { duplex?: string } = { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body, duplex: "half" };
  return new Request(url, init);
}

export default async function studio(incoming: Request): Promise<Response> {
  const req = restorePath(incoming);
  const h = build();
  if (!h) {
    const path = new URL(req.url).pathname;
    if (path.endsWith("/health")) return json({ ok: true, ready: false });
    return json({ error: { code: "not_configured", message: "The studio is not configured yet. See docs/studio/SETUP.md for the required environment variables." } }, 503);
  }
  const url = new URL(req.url);
  // Worker requests answer immediately and run the step in the background, so
  // the caller (another invocation, Vercel Cron, or GitHub Actions) never waits.
  if (url.pathname.endsWith("/worker/run") && req.method === "POST") {
    const auth = req.headers.get("authorization");
    const probe = new Request(req.url, { method: "POST", headers: auth ? { authorization: auth } : {} });
    const ok = !!auth && !!process.env.CRON_SECRET && constantTimeEqual(auth, `Bearer ${process.env.CRON_SECRET}`);
    if (!ok) return h(probe);
    waitUntil(h(probe).catch((err) => logger.error("worker failed", { error: err })));
    return json({ accepted: true }, 202);
  }
  return h(req);
}

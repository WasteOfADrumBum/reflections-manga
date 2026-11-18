import { HttpError } from "./errors.js";
import type { Logger } from "./log.js";

export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "same-origin",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v)), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

export function errorResponse(err: unknown, logger: Logger): Response {
  if (err instanceof HttpError) return json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status);
  logger.error("unhandled error", { error: err });
  return json({ error: { code: "internal", message: "Something went wrong on the server. Details are in the function log." } }, 500);
}

export async function readJson<T = unknown>(req: Request, maxBytes = 256 * 1024): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new HttpError(413, "Request body too large.", "too_large");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body too large.", "too_large");
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON.", "bad_json");
  }
}

export type Handler = (ctx: { req: Request; params: Record<string, string>; url: URL }) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];
  add(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${path.replace(/\//g, "\\/").replace(/:(\w+)/g, (_m, k: string) => {
        keys.push(k);
        return "([^/]+)";
      })}$`,
    );
    this.routes.push({ method, pattern, keys, handler });
    return this;
  }
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | "method" | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? "")));
      return { handler: r.handler, params };
    }
    return pathMatched ? "method" : null;
  }
}

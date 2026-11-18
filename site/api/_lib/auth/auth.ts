import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Db } from "../db/client.js";
import { one } from "../db/client.js";
import { forbidden, tooMany, unauthorized } from "../errors.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string, params = { N: 2 ** 15, r: 8, p: 1 }): Promise<string> {
  if (password.length < 12) throw new Error("Use a password of at least 12 characters.");
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, { ...params, maxmem: 128 * params.N * params.r * 2 });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64");
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  if (!Number.isInteger(N) || N < 2 ** 14 || N > 2 ** 20) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface Session {
  user: string;
  exp: number;
  /** Rotating per-session value; bumping session_epoch in settings signs everyone out. */
  epoch: number;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSessionToken(token: string | undefined, secret: string, nowMs: number): Session | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, secret));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (typeof s.user !== "string" || typeof s.exp !== "number" || s.exp < nowMs) return null;
    return s;
  } catch {
    return null;
  }
}

export function cookieName(secure: boolean) {
  return secure ? "__Host-rs_session" : "rs_session";
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  return [`${cookieName(secure)}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`, secure ? "Secure" : ""].filter(Boolean).join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [`${cookieName(secure)}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0", secure ? "Secure" : ""].filter(Boolean).join("; ");
}

export function isSecureRequest(req: Request): boolean {
  return new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}

/**
 * CSRF defence for state-changing requests: SameSite=Strict cookie, a custom
 * header a cross-site form cannot send, and a same-origin check.
 */
export function assertSameOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  if (req.headers.get("x-studio-request") !== "1") throw forbidden("Missing request header.");
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  if (origin && new URL(origin).host !== host) throw forbidden("Cross-origin request refused.");
}

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

/** Per-client and global login throttling, stored in Postgres so it survives cold starts. */
export async function checkLoginAllowed(db: Db, keys: string[], now: Date) {
  for (const key of keys) {
    const row = await one<{ locked_until: Date | null }>(db, `SELECT locked_until FROM login_attempts WHERE key = $1`, [key]);
    if (row?.locked_until && new Date(row.locked_until) > now) throw tooMany("Too many sign-in attempts. Try again in 15 minutes.");
  }
}

export async function recordLoginFailure(db: Db, keys: string[], now: Date, limits = { perKey: MAX_FAILURES }) {
  for (const key of keys) {
    const max = key === "global" ? limits.perKey * 6 : limits.perKey;
    await db.query(
      `INSERT INTO login_attempts (key, failures, window_started_at) VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET
         failures = CASE WHEN login_attempts.window_started_at < $3 THEN 1 ELSE login_attempts.failures + 1 END,
         window_started_at = CASE WHEN login_attempts.window_started_at < $3 THEN $2 ELSE login_attempts.window_started_at END`,
      [key, now, new Date(now.getTime() - WINDOW_MS)],
    );
    await db.query(`UPDATE login_attempts SET locked_until = $3 WHERE key = $1 AND failures >= $2`, [key, max, new Date(now.getTime() + LOCK_MS)]);
  }
}

export async function clearLoginFailures(db: Db, keys: string[]) {
  await db.query(`DELETE FROM login_attempts WHERE key = ANY($1::text[])`, [keys]);
}

export function clientKey(req: Request, secret: string): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  // Store a keyed hash, not the IP address.
  return `ip:${createHmac("sha256", secret).update(ip).digest("hex").slice(0, 32)}`;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function requireBearer(req: Request, secret: string) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !constantTimeEqual(token, secret)) throw unauthorized("Invalid worker credentials.");
}

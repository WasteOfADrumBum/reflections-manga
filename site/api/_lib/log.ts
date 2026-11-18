/**
 * Structured JSON logging with secret redaction. Logs go to the function log
 * (stdout/stderr) and, for job events, to the event_log table.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const SECRET_KEY = /^(authorization|cookie|set-cookie|token|access_token|refresh_token|b64_json|base64|image_data)$|password|secret|api[_-]?key/i;
const SECRET_VALUE = [
  /sk-[A-Za-z0-9_-]{10,}/g, // OpenAI keys
  /gh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /vercel_blob_rw_[A-Za-z0-9_]+/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /postgres(ql)?:\/\/[^\s"']+/gi,
  /data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{20,}/gi,
];

export function redactString(value: string): string {
  let out = value;
  for (const re of SECRET_VALUE) out = out.replace(re, "[redacted]");
  return out.length > 2000 ? `${out.slice(0, 2000)}…[truncated]` : out;
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), status: (value as { status?: number }).status };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[${value.byteLength} bytes]`;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : sanitize(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export interface Logger {
  log(level: LogLevel, message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(base: Record<string, unknown> = {}, sink?: (line: string, level: LogLevel) => void): Logger {
  const write =
    sink ??
    ((line: string, level: LogLevel) => {
      if (level === "error" || level === "warn") console.error(line);
      else process.stdout.write(`${line}\n`);
    });
  const log = (level: LogLevel, message: string, data?: Record<string, unknown>) => {
    write(JSON.stringify({ t: new Date().toISOString(), level, msg: redactString(message), ...(sanitize({ ...base, ...data }) as object) }), level);
  };
  return {
    log,
    info: (m, d) => log("info", m, d),
    warn: (m, d) => log("warn", m, d),
    error: (m, d) => log("error", m, d),
  };
}

export const silentLogger: Logger = { log() {}, info() {}, warn() {}, error() {} };

/** Errors that map to HTTP responses with a safe, user-facing message. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "error",
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, "bad_request", details);
export const unauthorized = (msg = "Sign in required.") => new HttpError(401, msg, "unauthorized");
export const forbidden = (msg = "Not allowed.") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Not found.") => new HttpError(404, msg, "not_found");
export const conflict = (msg: string, details?: unknown) => new HttpError(409, msg, "conflict", details);
export const tooMany = (msg: string) => new HttpError(429, msg, "rate_limited");

/** Raised when a page or file is protected from automated changes. */
export class ProtectedPageError extends HttpError {
  constructor(page: number, reason: string) {
    super(409, `Page ${String(page).padStart(3, "0")} is protected: ${reason}`, "protected_page");
  }
}

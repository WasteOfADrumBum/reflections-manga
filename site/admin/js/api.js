// Fetch wrapper for the studio API. Every request is same-origin and carries the
// custom header the server requires for state-changing calls (CSRF defence).

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

export async function api(method, path, body, extraHeaders = {}) {
  const headers = { "X-Studio-Request": "1", ...extraHeaders };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api/studio${path}`, { method, headers, body: payload, credentials: "same-origin" });
  if (res.status === 401 && !path.startsWith("/auth/")) {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.hash || "#/dashboard")}`);
    throw new ApiError(401, { error: { message: "Signed out." } });
  }
  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export const get = (p) => api("GET", p);
export const post = (p, b, h) => api("POST", p, b ?? {}, h);
export const put = (p, b) => api("PUT", p, b);

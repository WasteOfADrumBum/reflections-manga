import { describe, expect, it } from "vitest";
import { GET, POST, restorePath } from "../../api/studio.js";

describe("Vercel function entry", () => {
  it("exports Web-standard method handlers", () => {
    expect(typeof GET).toBe("function");
    expect(GET).toBe(POST);
  });

  it("restores the original path from the rewrite and keeps real query parameters", () => {
    const req = restorePath(new Request("https://studio.test/api/studio?__path=repo-image&studioPath=repo-image&path=characters%2Fx.png"));
    const url = new URL(req.url);
    expect(url.pathname).toBe("/api/studio/repo-image");
    expect(url.searchParams.get("path")).toBe("characters/x.png");
    expect(url.searchParams.has("__path")).toBe(false);
    expect(url.searchParams.has("studioPath")).toBe(false);
  });

  it("answers health without configuration instead of crashing", async () => {
    const res = await GET(new Request("https://studio.test/api/studio?__path=health&studioPath=health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ready: false });
  });
});

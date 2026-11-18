import { describe, expect, it } from "vitest";
import { createSessionToken, hashPassword, readSessionToken, verifyPassword } from "../../api/_lib/auth/auth.js";
import { parseEnv, EnvError, missingConfiguration } from "../../api/_lib/env.js";
import { normalizeToTarget } from "../../api/_lib/images.js";
import { createLogger, redactString, sanitize } from "../../api/_lib/log.js";
import { OpenAIImageProvider } from "../../api/_lib/openai/openai-adapters.js";
import { addPagesToChaptersJs, updateChapterNote } from "../../api/_lib/publish/chapters-js.js";
import { altTextFromScript } from "../../api/_lib/publish/alt-text.js";
import { assertRepoPath, GitHubRepoSource } from "../../api/_lib/repo/source.js";
import { assertSafePathname } from "../../api/_lib/storage/blobs.js";
import { createZip } from "../../api/_lib/zip.js";
import { fakePage } from "../helpers/harness.js";
import sharp from "sharp";

describe("passwords and sessions", () => {
  it("hashes and verifies with scrypt", async () => {
    const h = await hashPassword("a long enough password", { N: 2 ** 14, r: 8, p: 1 });
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword("a long enough password", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    await expect(hashPassword("short")).rejects.toThrow(/12 characters/);
  });

  it("signs sessions and rejects tampering", () => {
    const secret = "s".repeat(40);
    const t = createSessionToken({ user: "owner", exp: 2000, epoch: 1 }, secret);
    expect(readSessionToken(t, secret, 1000)).toMatchObject({ user: "owner" });
    expect(readSessionToken(t, secret, 3000)).toBeNull();
    const [payload, mac] = t.split(".");
    const evil = Buffer.from(JSON.stringify({ user: "admin", exp: 9e12, epoch: 1 })).toString("base64url");
    expect(readSessionToken(`${evil}.${mac}`, secret, 1000)).toBeNull();
    expect(readSessionToken(`${payload}.x`, secret, 1000)).toBeNull();
  });
});

describe("environment validation", () => {
  const good = {
    ADMIN_PASSWORD_HASH: "scrypt$16384$8$1$abc$def",
    SESSION_SECRET: "x".repeat(40),
    CRON_SECRET: "y".repeat(30),
    DATABASE_URL: "postgres://u:p@db.example.com/db",
    GITHUB_TOKEN: "github_pat_xxxxxxxxxxxx",
  };
  it("accepts a complete configuration with safe defaults", () => {
    const env = parseEnv(good);
    expect(env.STUDIO_GENERATION_ENABLED).toBe(false);
    expect(env.GITHUB_REPOSITORY).toBe("WasteOfADrumBum/reflections-manga");
  });
  it("names missing variables without echoing values", () => {
    try {
      parseEnv({ ...good, SESSION_SECRET: "short-secret-value" });
      throw new Error("expected failure");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      expect((err as Error).message).toMatch(/SESSION_SECRET/);
      expect((err as Error).message).not.toMatch(/short-secret-value/);
    }
    expect(missingConfiguration(good)).toEqual(["OPENAI_API_KEY", "BLOB_STORE_ID (connect a private Blob store)"]);
  });
});

describe("logging redaction", () => {
  it("removes secrets from strings and objects", () => {
    expect(redactString("key sk-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuv")).toBe("key [redacted] and [redacted]");
    expect(redactString("postgres://user:pw@host/db")).toBe("[redacted]");
    expect(sanitize({ authorization: "Bearer x", nested: { apiKey: "1", output_tokens: 5 }, data: Buffer.alloc(3) })).toEqual({
      authorization: "[redacted]",
      nested: { apiKey: "[redacted]", output_tokens: 5 },
      data: "[3 bytes]",
    });
    const lines: string[] = [];
    createLogger({}, (l) => lines.push(l)).error("failed with sk-abcdefghijklmnopq", { password: "hunter2" });
    expect(lines[0]).not.toMatch(/sk-abc|hunter2/);
  });
});

describe("paths", () => {
  it("rejects traversal", () => {
    expect(() => assertRepoPath("../etc/passwd")).toThrow();
    expect(() => assertRepoPath(".git/config")).toThrow();
    expect(assertRepoPath("/characters/x.png")).toBe("characters/x.png");
    expect(() => assertSafePathname("studio/../x")).toThrow();
    expect(() => assertSafePathname("studio/drafts/001/p021/a.png")).not.toThrow();
  });
});

describe("GitHub repository source", () => {
  it("reads raw files from the configured branch with a bearer token", async () => {
    const calls: { url: string; auth: string | null; accept: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      calls.push({ url, auth: h.get("authorization"), accept: h.get("accept") });
      if (url.includes("missing")) return new Response("", { status: 404 });
      return new Response("hello");
    }) as typeof fetch;
    const src = new GitHubRepoSource({ token: "tkn", repository: "o/r", ref: "main", fetchImpl });
    expect(await src.readText("stories/a b.md")).toBe("hello");
    expect(await src.readText("missing.md")).toBeNull();
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/contents/stories/a%20b.md?ref=main");
    expect(calls[0]!.auth).toBe("Bearer tkn");
    expect(calls[0]!.accept).toBe("application/vnd.github.raw+json");
  });
});

describe("OpenAI image adapter", () => {
  it("sends the actual reference images to /v1/images/edits with verified parameters", async () => {
    let captured: { url: string; form: FormData } | null = null;
    const png = await fakePage("X");
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      captured = { url: String(url), form: await new Response(init!.body as BodyInit, { headers: init!.headers as HeadersInit }).formData() };
      return new Response(JSON.stringify({ created: 1, data: [{ b64_json: png.toString("base64") }], output_format: "png", usage: { input_tokens: 10, output_tokens: 20, input_tokens_details: { image_tokens: 5, text_tokens: 5 } } }), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const provider = new OpenAIImageProvider("sk-test-key-not-real", { fetch: fetchImpl });
    const res = await provider.generatePage({
      model: "gpt-image-2.5-sunburst",
      prompt: "page",
      images: [
        { label: "a", filename: "ref-1.png", mime: "image/png", data: png },
        { label: "b", filename: "ref-2.png", mime: "image/png", data: png },
      ],
      size: "1024x1536",
      quality: "high",
      outputFormat: "png",
      safetyIdentifier: "abc",
    });
    expect(captured!.url).toBe("https://api.openai.com/v1/images/edits");
    const form = captured!.form;
    expect(form.get("model")).toBe("gpt-image-2.5-sunburst");
    expect(form.get("size")).toBe("1024x1536");
    expect(form.get("quality")).toBe("high");
    expect(form.get("n")).toBe("1");
    expect(form.get("input_fidelity")).toBeNull(); // not sent to models that do not support it
    const files = [...form.entries()].filter(([, v]) => v instanceof File);
    expect(files).toHaveLength(2);
    expect(res.image.equals(png)).toBe(true);
    expect(res.usage?.output_tokens).toBe(20);
  });
});

describe("images", () => {
  it("keeps the target size and letterboxes other ratios instead of stretching", async () => {
    const exact = await fakePage("A");
    expect((await normalizeToTarget(exact)).changed).toBe(false);
    const square = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#000" } }).png().toBuffer();
    const out = await normalizeToTarget(square);
    const meta = await sharp(out.data).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 1536]);
    expect(out.note).toMatch(/Letterboxed/);
  });
});

describe("chapters.js publishing patch", () => {
  const js = `window.REFLECTIONS_CHAPTERS = [
  {
    id: "001",
    note: "The first fifteen pages are up.",
    pages: [
      { src: "/pages/chapter-001/001.webp", alt: "One, with a } brace", width: 1024, height: 1536 },
      { src: "/pages/chapter-001/003.webp", alt: "Three", width: 1024, height: 1536 }
    ]
  },
  {
    id: "002",
    pages: []
  }
];`;
  it("inserts entries in page order and leaves existing ones untouched", () => {
    const out = addPagesToChaptersJs(js, "001", [{ page: 2, src: "/pages/chapter-001/002.webp", alt: 'Two "quoted"', width: 1024, height: 1536 }]);
    const srcs = [...out.matchAll(/src: "([^"]+)"/g)].map((m) => m[1]);
    expect(srcs).toEqual(["/pages/chapter-001/001.webp", "/pages/chapter-001/002.webp", "/pages/chapter-001/003.webp"]);
    expect(out).toContain(`alt: "Two \\"quoted\\""`);
    expect(out).toContain(`alt: "One, with a } brace"`);
    expect(out).toMatch(/id: "002",\n {4}pages: \[\]/);
  });
  it("refuses duplicates", () => {
    expect(() => addPagesToChaptersJs(js, "001", [{ page: 3, src: "/pages/chapter-001/003.webp", alt: "x", width: 1, height: 1 }])).toThrow(/already listed/);
  });
  it("updates the chapter note", () => {
    expect(updateChapterNote(js, "001", 3, 32)).toContain('note: "The first 3 of 32 pages are up as an early look.');
  });
  it("builds alt text from the script", () => {
    const alt = altTextFromScript({
      page: 1,
      title: "t",
      plot: null,
      visibleCast: null,
      timeLocation: null,
      layout: null,
      panels: [{ number: 1, visual: "Ethan at the sink", lines: [{ id: "a", panel: 1, order: 1, kind: "speech", speaker: "Ruby", text: "Hi." }] }],
    });
    expect(alt).toBe('Ethan at the sink. Ruby: "Hi."');
  });
});

describe("zip", () => {
  it("writes a valid archive", () => {
    const zip = createZip([{ name: "a.txt", data: Buffer.from("hello") }]);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(zip.includes(Buffer.from("hello"))).toBe(true);
  });
});

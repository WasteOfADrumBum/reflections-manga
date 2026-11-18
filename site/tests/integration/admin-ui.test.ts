// @vitest-environment jsdom
/**
 * Drives the real admin UI modules (admin/js/*.js) in jsdom against the real
 * API handler with mocked OpenAI. Runs everywhere, including machines without a
 * browser. Full-browser checks (colour contrast, real keyboard focus) run in
 * Playwright: tests/e2e/studio.spec.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import axe from "axe-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASE, createHarness, drain, type Harness, login, REPO_ROOT } from "../helpers/harness.ts";

let h: Harness;

async function settle(predicate: () => boolean, ms = 15_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const view = document.getElementById("view");
    if (view?.getAttribute("aria-busy") === "false" && predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`UI did not settle. Current view: ${document.getElementById("view")?.textContent?.slice(0, 300)}`);
}

async function go(hash: string, predicate: () => boolean) {
  window.location.hash = hash;
  await settle(predicate);
}

const heading = () => document.querySelector("#view h1")?.textContent ?? "";

async function a11y() {
  const result = await axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    rules: { "color-contrast": { enabled: false } }, // not computable in jsdom; checked in Playwright
  });
  if (result.passes.length < 5) throw new Error("axe ran too few rules; the check is not meaningful");
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

function clickConfirm() {
  const dialog = document.getElementById("confirm-dialog") as HTMLDialogElement;
  dialog.returnValue = "ok";
  dialog.dispatchEvent(new Event("close"));
}

beforeAll(async () => {
  h = await createHarness();
  const cookie = await login(h);
  // Route the UI's fetch calls to the API handler, as the browser would.
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), BASE);
    const headers = new Headers(init.headers);
    headers.set("cookie", cookie);
    headers.set("origin", BASE);
    headers.set("host", "studio.test");
    return h.handle(new Request(url, { method: init.method ?? "GET", headers, body: init.body as BodyInit | undefined }));
  }) as typeof fetch;
  // jsdom does not implement modal dialogs.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  const html = readFileSync(path.join(REPO_ROOT, "site/admin/index.html"), "utf8");
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]*>/g, "");
  document.documentElement.setAttribute("lang", "en");
  window.location.hash = "#/dashboard";
  await import("../../admin/js/app.js");
  await settle(() => heading() === "Production dashboard");
});

afterAll(async () => h.db.close?.());

describe("admin interface", () => {
  it("renders the dashboard with landmarks, a skip link and an accessible structure", async () => {
    expect(document.querySelector("a.skip-link")?.getAttribute("href")).toBe("#main");
    expect(document.querySelector("nav[aria-label=Studio] a[aria-current=page]")?.textContent).toBe("Dashboard");
    expect(document.getElementById("announcer")?.getAttribute("aria-live")).toBe("polite");
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.getElementById("view")!.textContent).toMatch(/Run one test page first/);
    expect(await a11y()).toEqual([]);
  });

  it("shows the character library with canonical sheets and an accessible upload form", async () => {
    await go("#/characters", () => heading() === "Character library");
    const ethan = [...document.querySelectorAll("article.char-card")].find((a) => a.textContent?.includes("Ethan Walker"))!;
    expect(ethan.querySelector("img")?.getAttribute("alt")).toBe("Ethan Walker canonical reference sheet");
    for (const input of document.querySelectorAll("#upload-form input, #upload-form select")) {
      expect(document.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    }
    expect(await a11y()).toEqual([]);
  });

  it("lists chapter pages with locked, ready and unprepared statuses", async () => {
    await go("#/chapters/001", () => heading().startsWith("Chapter 001"));
    const tiles = [...document.querySelectorAll(".page-tile")].map((t) => t.textContent ?? "");
    expect(tiles[0]).toMatch(/Page 001.*Published/);
    expect(tiles[19]).toMatch(/Page 020.*Locked/);
    expect(tiles[20]).toMatch(/Page 021.*Ready to generate/);
    expect(tiles[31]).toMatch(/Page 032.*Not prepared/);
    expect(await a11y()).toEqual([]);
  });

  it("shows a page's script, references and prompt", async () => {
    await go("#/chapters/001/pages/23", () => heading().startsWith("Page 023"));
    const text = document.getElementById("view")!.textContent!;
    expect(text).toMatch(/Ethan Walker canonical identity sheet/);
    expect(text).toMatch(/What's wrong with you today\?/);
    expect(await a11y()).toEqual([]);
  });

  it("generates a test page in one click, then unlocks the full chapter", async () => {
    await go("#/studio/001", () => heading() === "Generate pages" && !!document.querySelector(".stat"));
    const box = (n: number) => [...document.querySelectorAll<HTMLInputElement>(".check-grid input")].find((i) => i.value === String(n))!;
    expect(box(5).disabled).toBe(true);
    expect(box(21).disabled).toBe(false);
    expect(box(21).checked).toBe(true);
    expect(box(31).disabled).toBe(true);
    expect(await a11y()).toEqual([]);
    const start = [...document.querySelectorAll("button")].find((b) => b.textContent === "Run one test page")!;
    start.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById("confirm-dialog")!.hasAttribute("open")).toBe(true);
    clickConfirm();
    await settle(() => window.location.hash.startsWith("#/jobs/") && heading() === "Chapter 001 job");
    expect(await a11y()).toEqual([]);
    await drain(h);
    expect(h.images.calls).toHaveLength(1);

    await go("#/review/001", () => heading() === "Review and publish" && !!document.querySelector(".version"));
    const approve = [...document.querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
    approve.click();
    await settle(() => !!document.querySelector("form.card h2") && document.getElementById("view")!.textContent!.includes("Publish page 021"));
    expect(await a11y()).toEqual([]);

    await go("#/studio/001", () => heading() === "Generate pages" && !!document.querySelector(".stat"));
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Generate chapter")).toBe(true);
  });
});

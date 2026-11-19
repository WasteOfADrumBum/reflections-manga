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
import { BASE, createHarness, drain, type Harness, login, REPO_ROOT } from "../helpers/harness.js";

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
  await settle(() => heading() === "Dashboard");
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

  it("walks arcs, then chapters, with the story text from the repository", async () => {
    await go("#/story", () => heading() === "Story");
    const text = document.getElementById("view")!.textContent!;
    expect(text).toMatch(/Three Become One/);
    expect(text).toMatch(/Introduce the marriage, personalities, affection, and unmet needs\./);
    expect(document.querySelector("nav[aria-label=Studio] a[aria-current=page]")?.textContent).toBe("Story");
    expect(await a11y()).toEqual([]);
    await go("#/story/arc-01", () => heading().startsWith("Arc 1"));
    expect(document.getElementById("view")!.textContent).toMatch(/Ethan moves between the different roles/);
    expect(document.querySelector('a[href="#/chapters/001"]')).not.toBeNull();
    expect(await a11y()).toEqual([]);
  });

  it("shows every character's outfits with a picker that swaps the preview", async () => {
    await go("#/characters", () => heading() === "Characters");
    const ethan = [...document.querySelectorAll("li.char-card")].find((a) => a.textContent?.includes("Ethan Walker"))!;
    const img = ethan.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("Ethan Walker, Main sheet");
    const select = ethan.querySelector("select")!;
    expect(select.options.length).toBeGreaterThanOrEqual(8);
    expect([...select.querySelectorAll("optgroup")].map((g) => g.label)).toContain("Formal");
    expect([...select.options].map((o) => o.textContent)).toContain("Wedding suit");
    select.value = [...select.options].find((o) => o.textContent === "Wedding suit")!.value;
    select.dispatchEvent(new Event("change"));
    expect(img.getAttribute("src")).toMatch(/ethan-walker-formal-wedding-suit\.png/);
    expect(img.getAttribute("alt")).toBe("Ethan Walker, Wedding suit");
    // Studio sections never use the public site's tilted comic-panel class.
    expect(document.querySelector("#view .panel")).toBeNull();
    // Labels are names, never file names; a revealing sheet is blurred behind an eye button.
    const ruby = [...document.querySelectorAll("li.char-card")].find((a) => a.querySelector("h2")?.textContent === "Ruby Bennett-Walker")!;
    const rubySelect = ruby.querySelector("select")!;
    expect([...rubySelect.options].some((o) => /\.png/.test(o.textContent ?? ""))).toBe(false);
    rubySelect.value = [...rubySelect.options].find((o) => o.value.endsWith("lingerie-blue.png"))!.value;
    rubySelect.dispatchEvent(new Event("change"));
    expect(ruby.querySelector(".veil")!.classList.contains("is-veiled")).toBe(true);
    expect(ruby.querySelector<HTMLButtonElement>(".veil-btn")!.hidden).toBe(false);
    expect(ruby.querySelector(".outfit-preview figcaption")!.textContent).toMatch(/Blue.*Lingerie.*18\+/);
    // Outfits can change category; the main sheet cannot.
    expect(ruby.querySelector<HTMLElement>(".cat-form")!.hidden).toBe(false);
    rubySelect.value = rubySelect.options[0]!.value;
    rubySelect.dispatchEvent(new Event("change"));
    expect(ruby.querySelector<HTMLElement>(".cat-form")!.hidden).toBe(true);
    // Cass, added on main, is in the library with her outfits.
    const cass = [...document.querySelectorAll("li.char-card")].find((a) => a.querySelector("h2")?.textContent?.startsWith("Cass"))!;
    expect(cass.querySelector("select")!.options.length).toBeGreaterThan(5);
    // No character with a sheet image is reported as missing one.
    expect(document.getElementById("view")!.textContent).not.toMatch(/blocked until/);
    expect(document.querySelector("details:not([open]) .ref-list")).toBeNull();
    for (const input of document.querySelectorAll("#upload-form input, #upload-form select, #new-character input, #new-character select, #new-character textarea")) {
      expect(document.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    }
    expect(await a11y()).toEqual([]);
  });

  it("lists chapter pages with published, has-art and ready statuses", async () => {
    await go("#/chapters/001", () => heading().startsWith("Chapter 001"));
    const tiles = [...document.querySelectorAll(".page-tile")].map((t) => t.textContent ?? "");
    expect(tiles).toHaveLength(30);
    expect(tiles[0]).toMatch(/Page 001.*Published/);
    expect(tiles[1]).toMatch(/Page 002.*Has art/);
    for (let n = 3; n <= 30; n++) {
      const hasArt = await h.repo.exists(`stories/arc-01/chapter-001/pages/A01-C001-P${String(n).padStart(3, "0")}.png`);
      const label = String(n).padStart(3, "0");
      expect(tiles[n - 1]).toMatch(hasArt ? new RegExp(`Page ${label}.*Has art`) : new RegExp(`Page ${label}.*Ready`));
    }
    expect(await a11y()).toEqual([]);
  });

  it("shows a page's synopsis, outfit pickers, an editable prompt and the cost in plain words", async () => {
    await go("#/chapters/001/pages/23", () => heading().startsWith("Page 023") && !!document.querySelector(".check-result .explain"));
    const text = document.getElementById("view")!.textContent!;
    expect(text).toMatch(/Ruby Bennett-Walker identity sheet \(ruby-bennett-walker-reference-main\.png\)/);
    expect(text).toMatch(/You missed two murders\./);
    expect(text).toMatch(/separate from ChatGPT Plus/);
    expect(text).toMatch(/gpt-image-2\.5-sunburst/);
    expect(document.querySelectorAll(".pick select").length).toBeGreaterThan(0);
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt-edit")!;
    expect(prompt.value).toMatch(/REFERENCE ORDER/);
    expect(document.querySelector("#upload-version input[type=file]")).not.toBeNull();
    expect(await a11y()).toEqual([]);
  });

  it("lets a page that already has art get a new version", async () => {
    await go("#/chapters/001/pages/2", () => heading().startsWith("Page 002") && !!document.querySelector(".check-result .explain"));
    const text = document.getElementById("view")!.textContent!;
    expect(text).toMatch(/already has art\. New versions don't touch it/);
    expect(text).not.toMatch(/Locked\./);
    // Art in the repository but not in the reader can be published from here.
    expect(text).toMatch(/In the repository, not in the public reader yet/);
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Publish to the reader")).toBe(true);
    expect(text).not.toMatch(/\bnull\b/);
    expect(await a11y()).toEqual([]);
  });

  it("explains an empty review queue instead of showing nothing", async () => {
    await go("#/review", () => heading() === "Review");
    expect(document.getElementById("view")!.textContent).toMatch(/Nothing to review yet/);
    expect(document.getElementById("view")!.textContent).toMatch(/Art in the repository, not in the reader yet/);
    expect(document.querySelectorAll(".repo-art-row")).toHaveLength(5);
    expect(await a11y()).toEqual([]);
  });

  it("shows spending with an accessible chart and table", async () => {
    await go("#/spending", () => heading() === "Spending");
    const svg = document.querySelector("svg.chart")!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.querySelector("title")?.textContent).toBe("API spending by month");
    expect(document.querySelectorAll("table tbody tr")).toHaveLength(12);
    expect(await a11y()).toEqual([]);
  });

  it("lists site images with show/hide controls", async () => {
    await go("#/site", () => heading() === "Site images");
    expect(document.querySelectorAll(".vis-toggle input").length).toBeGreaterThan(10);
    // Sheets not on the site yet are listed unticked; revealing ones start blurred.
    const blueAdd = document.getElementById("add-characters-main-ruby-bennett-walker-outfits-ruby-bennett-walker-lingerie-blue-png") as HTMLInputElement;
    expect(blueAdd.checked).toBe(false);
    expect((document.getElementById("addblur-characters-main-ruby-bennett-walker-outfits-ruby-bennett-walker-lingerie-blue-png") as HTMLInputElement).checked).toBe(true);
    // The album can be reordered with buttons (drag and drop has this single-pointer alternative) and captions edited.
    const items = () => [...document.querySelectorAll<HTMLElement>(".album-item")];
    const first = items()[0]!.dataset.href;
    const down = items()[0]!.querySelector<HTMLButtonElement>(".move-down")!;
    down.click();
    expect(items()[1]!.dataset.href).toBe(first);
    const caption = items()[1]!.querySelector<HTMLInputElement>("input[type=text]")!;
    caption.value = "All six of us";
    caption.dispatchEvent(new Event("input"));
    expect(items()[1]!.querySelector<HTMLButtonElement>(".changed-note")!.hidden).toBe(false);
    const reset = [...items()[1]!.querySelectorAll("button")].find((b) => b.textContent === "Reset to default")!;
    reset.click();
    expect(caption.value).not.toBe("All six of us");
    for (const input of document.querySelectorAll("#album-upload input, #album-upload textarea")) {
      expect(document.querySelector(`label[for="${input.id}"]`), input.id).not.toBeNull();
    }
    expect(await a11y()).toEqual([]);
  });

  it("generates a test page in one click, then unlocks multi-page runs", async () => {
    await go("#/studio/001", () => heading() === "Generate pages" && !!document.querySelector(".stat"));
    const boxes = () => [...document.querySelectorAll<HTMLInputElement>(".check-grid input")];
    const box = (n: number) => boxes().find((i) => i.value === String(n))!;
    // Page 002 has art: it can be chosen for a new version, but is not selected by default.
    expect(box(2).disabled).toBe(false);
    expect(box(2).checked).toBe(false);
    const firstReady = boxes().find((i) => !i.disabled && i.checked)!;
    expect(Number(firstReady.value)).toBeGreaterThan(2);
    expect(box(31)).toBeUndefined();
    expect(document.getElementById("view")!.textContent).toMatch(/separate from ChatGPT Plus/);
    expect(await a11y()).toEqual([]);
    const start = [...document.querySelectorAll("button")].find((b) => b.textContent === "Run one test page")!;
    start.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById("confirm-dialog")!.hasAttribute("open")).toBe(true);
    clickConfirm();
    await settle(() => window.location.hash.startsWith("#/jobs/") && heading() === "Chapter 001 run");
    expect(await a11y()).toEqual([]);
    await drain(h);
    expect(h.images.calls).toHaveLength(1);

    await go("#/review/001", () => heading() === "Review" && !!document.querySelector(".version"));
    const approve = [...document.querySelectorAll("button")].find((b) => b.textContent === "Approve")!;
    approve.click();
    const published = `Page ${firstReady.value.padStart(3, "0")}`;
    await settle(() => [...document.querySelectorAll(".publish-row")].some((r) => r.textContent!.includes(published)));
    expect(await a11y()).toEqual([]);

    await go("#/studio/001", () => heading() === "Generate pages" && !!document.querySelector(".stat"));
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === "Generate selected pages")).toBe(true);
  });
});

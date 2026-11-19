// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../helpers/harness.js";

/** The public script that applies show/hide choices made in the studio. */
const script = readFileSync(path.join(REPO_ROOT, "site/js/visibility.js"), "utf8");

function load(page: string, data: unknown) {
  const html = readFileSync(path.join(REPO_ROOT, `site/${page}`), "utf8");
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/g, "");
  (window as unknown as { REFLECTIONS_VISIBILITY: unknown }).REFLECTIONS_VISIBILITY = data;
  new Function(script)();
}

describe("site visibility script", () => {
  it("hides a gallery image for one character only and fixes the count", () => {
    load("characters.html", { hidden: { characters: { "ethan-walker": ["/images/family/family-1536.webp"] }, album: [] }, albumAdditions: [] });
    const ethan = document.getElementById("ethan-walker")!;
    expect(ethan.querySelector('a[href="/images/family/family-1536.webp"]')).toBeNull();
    const n = ethan.querySelectorAll(".gal-strip li").length;
    expect(ethan.querySelector(".gal-count")!.textContent).toBe(`${n} images`);
    expect(document.getElementById("morgan-hayes")!.querySelector('a[href="/images/family/family-1536.webp"]')).not.toBeNull();
  });

  it("hides album photos, adds new ones and renumbers pages for screen readers", () => {
    load("memories.html", {
      hidden: { characters: {}, album: ["/images/family/family-1536.webp"] },
      albumAdditions: [{ src: "/images/memories/porch-800.webp", full: "/images/moments/porch-full.webp", w: 1536, h: 1024, title: "Porch swing", alt: "Ethan, Morgan and Ruby on the porch swing." }],
    });
    const book = document.querySelector("#album .album-book")!;
    expect(book.querySelector('a[href="/images/family/family-1536.webp"]')).toBeNull();
    const added = book.querySelector<HTMLAnchorElement>('a[href="/images/moments/porch-full.webp"]')!;
    expect(added.querySelector("img")!.getAttribute("alt")).toBe("Ethan, Morgan and Ruby on the porch swing.");
    const leaves = [...book.querySelectorAll(".album-leaf")];
    leaves.forEach((l, i) => expect(l.getAttribute("aria-label")).toBe(`Album page ${i + 1} of ${leaves.length}`));
    expect(leaves.every((l) => l.querySelector("figure"))).toBe(true);
  });

  it("applies the album order and edited captions, and keeps a tall photo on its own page", () => {
    load("memories.html", {
      hidden: { characters: {}, album: [] },
      album: {
        order: ["/images/moments/ethan-cal-motorcycle-ride-1672.webp", "/images/moments/ruby-autumn-sisters-1024.webp", "/images/family/family-1536.webp"],
        captions: { "/images/family/family-1536.webp": { title: "The six of us", alt: "Everyone together on a sunny afternoon, smiling at the camera." } },
      },
      albumAdditions: [],
    });
    const book = document.querySelector("#album .album-book")!;
    const hrefs = [...book.querySelectorAll(".snap-link")].map((a) => a.getAttribute("href"));
    expect(hrefs.slice(0, 3)).toEqual(["/images/moments/ethan-cal-motorcycle-ride-1672.webp", "/images/moments/ruby-autumn-sisters-1024.webp", "/images/family/family-1536.webp"]);
    const tall = book.querySelector('a[href="/images/moments/ruby-autumn-sisters-1024.webp"]')!.closest(".album-leaf")!;
    expect(tall.querySelectorAll("figure")).toHaveLength(1);
    const fam = book.querySelector<HTMLAnchorElement>('a[href="/images/family/family-1536.webp"]')!;
    expect(fam.getAttribute("data-title")).toBe("The six of us");
    expect(fam.closest("figure")!.querySelector("figcaption")!.textContent).toBe("The six of us");
    expect(fam.querySelector("img")!.alt).toBe("Everyone together on a sunny afternoon, smiling at the camera.");
    // Every photo is still there, two to a page except the tall one.
    expect(hrefs).toHaveLength(document.querySelectorAll("#album figure").length);
    for (const leaf of book.querySelectorAll(".album-leaf")) expect(leaf.querySelectorAll("figure").length).toBeLessThanOrEqual(2);
  });

  it("adds a repository sheet to a gallery and blurs sensitive images until 18+ is confirmed", () => {
    localStorage.clear();
    const full = "/images/characters/refs/ruby-bennett-walker-lingerie-blue.webp";
    load("characters.html", {
      hidden: { characters: {}, album: [] },
      sensitive: [full],
      characterAdditions: { "ruby-bennett-walker": [{ src: "/images/characters/refs/ruby-bennett-walker-lingerie-blue-thumb.webp", full, w: 1536, h: 1024, label: "Blue", alt: "Ruby Bennett-Walker lingerie sheet, Blue." }] },
      albumAdditions: [],
    });
    const ruby = document.getElementById("ruby-bennett-walker")!;
    const link = ruby.querySelector<HTMLAnchorElement>(`a[href="${full}"]`)!;
    expect(link).not.toBeNull();
    const wrap = link.closest(".veil")!;
    expect(wrap.classList.contains("is-veiled")).toBe(true);
    expect(link.getAttribute("tabindex")).toBe("-1");
    const btn = wrap.querySelector<HTMLButtonElement>(".veil-btn")!;
    expect(btn.getAttribute("aria-label")).toMatch(/Sensitive image hidden.*18 or older/);
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
    // Clicking the image itself never opens it while veiled.
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    // Confirming age reveals it and remembers the answer.
    btn.click();
    document.querySelector<HTMLButtonElement>("[data-veil-yes]")!.click();
    expect(wrap.classList.contains("is-veiled")).toBe(false);
    expect(localStorage.getItem("reflections:age-confirmed:v1")).not.toBeNull();
    expect(ruby.querySelector(".gal-count")!.textContent).toBe(`${ruby.querySelectorAll(".gal-strip li").length} images`);
  });

  it("does nothing without data", () => {
    load("memories.html", undefined);
    expect(document.querySelectorAll("#album .snap-link").length).toBeGreaterThan(5);
  });
});

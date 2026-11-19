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

  it("does nothing without data", () => {
    load("memories.html", undefined);
    expect(document.querySelectorAll("#album .snap-link").length).toBeGreaterThan(5);
  });
});

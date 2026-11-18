# Reflections website

Static site for the Reflections manga. Plain HTML, CSS and JavaScript with no build step.
Everything outside this `site/` folder is the manga's working material and is not touched by the site.

## Pages

- `index.html`: landing page with the series overview
- `series.html`: chapter reader and the planned reading order
- `characters.html`: reader's guide with a bio for each character

## Publishing chapter pages

1. Export finished pages as `.webp` (about 1200 px wide) into `site/pages/chapter-001/`.
2. List them in `site/js/chapters.js` with descriptive `alt` text for each page (what happens and what is said).
3. Merge to `main`. Vercel deploys automatically.

Chapter 001 is being redrawn as version 2. `site/pages/chapter-001/` holds the current (v2) pages;
the earlier version 1 pages are in `site/pages/chapter-001/version_1/`, hidden from the reader. Their
reader entries (with alt text) are kept in `version_1/index.json`, which the site never loads.

## Age gate (18+)

`series.html` and any future chapter page ask readers to confirm they are 18 or older before content shows.
The home, characters and memories pages stay open. The answer is saved in the browser (localStorage, falling
back to sessionStorage, then memory for that page if storage is blocked).

To gate a new page: add `data-age-gate` to `<html>`, `data-age-gated` to `<main>`, and load
`<script src="/js/age-gate.js"></script>` in `<head>` without `defer`, before other scripts. Copy the
`<noscript>` notice from `series.html`. Scripts that load content can wait with
`window.ReflectionsAgeGate.whenConfirmed(fn)`.

This is a courtesy check in the browser, not access control: image files are still reachable by direct URL.

## Character relationships

Each bio's Relationships list comes from `site/js/relationships.js`. Add one line per relationship,
for example `{ type: "Friend", people: ["Jordan"], note: "(Ruby's friend from ballet)" }`.
Character ids become links to that bio; any other name shows as plain text.

## Character images

`images/characters/` holds web-sized copies of the reference sheets in `characters/*/references/`.
If a reference sheet changes, re-export the copy here.

## Local preview

```
cd site
python3 -m http.server 8000
```

Then open http://localhost:8000. (Clean URLs such as `/series` work on Vercel; locally use `/series.html`.)

## Deployment

Vercel project with **Root Directory** set to `site` and framework preset **Other** (no build command).
`vercel.json` enables clean URLs and basic security headers.

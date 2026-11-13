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

# Studio production config

`config.json` tells Reflections Studio which chapters it may work on.

- `promptDir`, `scriptFile`, `revisionLabel`: which revision the studio works from. Chapter 001 uses the
  version 2 retelling: `prompts/version_002/page-NNN-v2.txt`, `script-v2.md`, 30 pages (`plannedPages`).
  The studio never generates past `plannedPages`.
- `identitySheetDirs`: folders searched for the sheet files that v2 prompts name in their reference order
  (for example `walker-ethan.png`, `children/walker-riley.png`). Sheets named like
  `morgan-hayes-formal-wedding-lace-blouse-pink-skirt.png` are found in that character's own `outfits/` folder.
- Pages with finished artwork in `stories/.../pages/` (v2 art; v1 art lives in `pages/version_1/` and is
  ignored) or already in the reader are protected automatically and never overwritten.
- `lockedPages`: extra pages to protect, as ranges like `5, 9-12` (empty for Chapter 001).
- `unpreparedPages`: outlined but not scripted; the studio refuses to generate them (none for Chapter 001).
- `generation`: defaults for model, quality, attempts, budget and QA thresholds. Per-chapter overrides are
  saved in the studio and never change scripts or prompts.

Change this file through a normal reviewed commit. The studio reads it from the `main` branch on GitHub.
See [docs/studio/OPERATIONS.md](../../docs/studio/OPERATIONS.md).

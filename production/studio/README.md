# Studio production config

`config.json` tells Reflections Studio which chapters it may work on.

- `lockedPages`: never generated, regenerated or overwritten (Chapter 001: 001–020 for the current revision).
  Pages with finished artwork in `stories/.../pages/` or already in the reader are locked automatically.
- `unpreparedPages`: outlined but not scripted; the studio refuses to generate them (Chapter 001: 031–032).
- `generation`: defaults for model, quality, attempts, budget and QA thresholds. Per-chapter overrides are
  saved in the studio and never change scripts or prompts.

Change this file through a normal reviewed commit. The studio reads it from the `main` branch on GitHub.
See [docs/studio/OPERATIONS.md](../../docs/studio/OPERATIONS.md).

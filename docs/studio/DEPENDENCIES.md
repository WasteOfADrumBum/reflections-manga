# Reflections Studio: dependencies and verified facts

Checked 2026-11-18. Recheck each item when upgrading.

## Runtime

| Package | Version | Use |
|---|---|---|
| `openai` | 7.59.x | Official SDK: `images.edit`, `responses.parse` |
| `@vercel/blob` | 2.9.x | Private Blob store (needs ≥ 2.3 for private access) |
| `@vercel/functions` | 3.11.x | `waitUntil` for background steps |
| `pg` | 8.23.x | Postgres client (works with Neon and any Postgres) |
| `sharp` | 0.35.x | Image inspection, WebP export, upload sanitising |
| `zod` | 4.6.x | Request, config and environment validation |

## Development

`typescript` is pinned to the 6.0.x line, not 7.x: `typescript-eslint` 8.73
supports TypeScript below 6.1, and Vercel's Node builder relies on the
TypeScript compiler API that TypeScript 7 (native port) does not provide yet.
Recheck when typescript-eslint and Vercel announce TypeScript 7 support.

`npm audit` reports a high-severity advisory in `picomatch` (ReDoS on crafted
glob patterns) through `vitest`, `vite` and `typescript-eslint`. It is
development-only, the globs are ours, and no patched release exists yet
(4.0.7 is the latest). Recheck monthly and update when a fix ships.

Relative imports in `site/api`, `site/tests` and `site/scripts` end in `.js`
(the NodeNext convention), never `.ts`. Vercel compiles each `.ts` file to
`.js` without rewriting import paths, so a `.ts` path crashes the function at
start-up. `npm run check:bundle` compiles the function file by file and loads it
with plain Node to catch this. Local scripts (`npm run dev`, `npm run
hash-password`) run through `tsx`, which maps those `.js` paths to the `.ts`
sources.

Tests use PGlite (real Postgres engine in WASM), jsdom with axe-core, and
Playwright with `@axe-core/playwright` in CI.

## OpenAI facts used (official documentation)

* Image model default `gpt-image-2.5-sunburst` ("most capable model for image
  generation and editing", recommended where editing precision matters).
  `gpt-image-1` was shut down on 2026-10-23.
  https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
* `POST /v1/images/edits`: up to 16 input images (PNG, WebP or JPG under 50 MB
  each), prompt up to 32,000 characters, sizes include `1024x1536`, quality
  `low|medium|high|xhigh|max|auto` (xhigh and max on 2.5 models), output
  `png|webp|jpeg`, `n` 1–10. `input_fidelity` only for `gpt-image-1.5` (omit
  for newer models). Responses include token `usage`.
  https://developers.openai.com/api/reference/resources/images/methods/edit
* Pricing for `gpt-image-2.5-sunburst` (Standard): text input $5.00/1M, image
  input $8.00/1M, image output $30.00/1M. The general pricing page also lists a
  lower table ($2.50 / $4.00 / $15.00) without naming its tier; the studio uses
  the higher figures so budgets stop early. No per-image token counts are
  published for 2.5, so per-page output tokens are labelled assumptions.
  https://developers.openai.com/api/docs/pricing
* QA model default `gpt-6-luna`: accepts images, supports structured outputs,
  $0.10/1M input and $0.50/1M output.
  https://developers.openai.com/api/docs/models/gpt-6-luna
* GPT Image models may require API organization verification.

## Vercel facts used

* Hobby functions: 300 s maximum duration with Fluid compute, 4.5 MB request
  body limit, `waitUntil` supported. https://vercel.com/docs/functions/limitations
* Hobby cron: once a day at most, hourly precision.
  https://vercel.com/docs/cron-jobs/usage-and-pricing
* Blob: private stores, no overwrite by default, Hobby includes 1 GB storage,
  10,000 simple and 2,000 advanced operations a month; Hobby is never billed,
  access pauses if limits are exceeded. https://vercel.com/docs/vercel-blob

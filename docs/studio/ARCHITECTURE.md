# Reflections Studio: architecture

## Shape

```
site/                     Vercel root directory (unchanged deployment)
  *.html, css/, js/       Public site and reader (untouched, plus one footer link)
  admin/                  Studio UI: static HTML + vanilla JS modules, WCAG 2.2 AA
  api/studio.ts           One Node function; vercel.json rewrites /api/studio/* to it
  api/_lib/               TypeScript services (not deployed as separate functions)
    content/              Repo readers: config, prompts, scripts, characters, chapters
    engine/               Jobs, worker, reference planning, continuity, overview
    openai/               Official SDK adapters, pricing, error classification
    qa/                   Deterministic checks, dialogue comparison, QA combination
    publish/              chapters.js patching, alt text, GitHub pull requests
    auth/, db/, storage/  Sessions, Postgres + migrations, private Blob store
production/studio/config.json   Chapters, locked/unprepared pages, generation defaults
```

Dependencies are deliberately few: `openai`, `@vercel/blob`, `@vercel/functions`,
`pg`, `sharp`, `zod`. No framework migration; the public site keeps no build step.

## Data flow for one page

1. **Plan (free).** Load the chapter's prompt for the page from its configured
   `promptDir` (Chapter 001: `prompts/version_002/page-NNN-v2.txt`, latest
   version) and its `scriptFile` (`script-v2.md`). Check the prompt's exact
   lettering against the script word for word; any drift blocks the page (a
   canon decision).
2. **References.** Identity sheets in the prompt's `REFERENCE ORDER`. Version 2
   prompts name each sheet file (`walker-ethan.png`, `children/walker-riley.png`,
   `ruby-bennett-walker-formal-wedding-dress.png`); the studio finds them only in
   the configured sheet folders and the characters' own `references/`, `outfits/`, and `outfits/_review/` folders and
   attaches them in exactly that order. Older v1 prompts name a character and get
   the image under "Current Card" in its `references/index.md`. Then approved
   outfit and location uploads scoped to the chapter/page, then scene pages the
   prompt names: repository artwork, else an approved studio version, else a
   QA-passed draft from this run (marked provisional). Identity always comes
   first, so an earlier generation can never outrank a canonical sheet.
3. **Generate.** `POST /v1/images/edits` with the actual images as files, the
   prompt **verbatim** plus a short attachment manifest, `size=1024x1536`
   (native for the model), one image per request.
4. **Store.** The PNG goes to the private Blob store at a path derived from the
   attempt id; metadata (model, references with hashes, settings, prompt hash,
   cost estimate and reported usage) goes to Postgres.
5. **Validate.** Deterministic checks (dimensions, ratio, data) plus a vision
   model with structured output (panel count, cast, extra people, likeness,
   clothing, full transcription, artifacts, continuity). Clear failures retry
   automatically within limits; uncertain results are flagged for review.
6. **Continuity.** A structured record (scene, time, location, outfits, props,
   lighting, relationships, previous approved page, emotional beats from the
   script) is written from the page's explicit instructions after it passes.
7. **Review and publish.** Only an explicit approval plus an explicit publish
   action opens a pull request that adds new files and appends reader entries.

## Durable job engine

* **Queue and state** live in Postgres (`jobs`, `job_pages`, `generation_attempts`,
  `page_versions`, `continuity_states`, `event_log`). No in-memory queue.
* **One step per claim.** A worker claims one page phase (`generate` or
  `validate`) under a lease (`lease_owner`, `lease_until`) with
  `FOR UPDATE SKIP LOCKED` and a transaction-scoped advisory lock. All updates
  are fenced on `lease_owner`, so a stale worker cannot overwrite progress.
* **Sequential pages.** A page runs only when every earlier page in the job is
  finished (approved-ready, failed or blocked). One paid request runs at a time.
* **Idempotency.** A unique index allows one unfinished job per chapter;
  `Idempotency-Key` makes the Generate button safe to double-click; blobs are
  never overwritten; an image saved before a crash is adopted on recovery
  instead of paying again. If a worker dies before saving, the attempt is marked
  abandoned and its estimated cost stays counted (it may have been billed).
* **Retries.** Server errors and timeouts back off exponentially (30 s, 60 s,
  capped at 3 min, with jitter). Rate limits honour `Retry-After` and do not use
  an attempt. Safety rejections fail the page without retrying. Authentication,
  quota and parameter errors pause the whole job (`blocked`) for you to fix.
* **Budget.** Each attempt reserves its estimate before the request. The job
  stops (`budget_exceeded`) before any request that would pass the budget.
* **Background execution on Vercel Hobby.** The worker endpoint answers `202` at
  once and runs the step in `waitUntil` (max 300 s). After a step it starts the
  next invocation itself. Short retry waits happen inside an invocation. Stalls
  are recovered by the next nudge: dashboard visit, daily Vercel Cron, or the
  optional GitHub Actions heartbeat.
* **Restarts and deploys.** Nothing depends on process memory; a fresh instance
  continues from the database. Tested with simulated restarts and crashes.

## Security

* Server-side `OPENAI_API_KEY`, `GITHUB_TOKEN` and secrets only; structured logs
  and the job log redact keys, tokens, connection strings and image data.
* Single owner account: scrypt password hash, HMAC-signed `__Host-` cookie
  (`HttpOnly`, `Secure`, `SameSite=Strict`, 12 h), sign-out-everywhere epoch,
  Postgres-backed login throttling, CSRF header plus origin check on every write.
* Every studio route authorizes on the server. Generated images are served only
  through the authenticated asset route from a private store.
* Uploads: PNG/JPEG/WebP magic-byte check, size and pixel limits, re-encoded by
  sharp (strips metadata and payloads), stored under generated names.
* Strict CSP and `noindex` on `/admin`; `robots.txt` disallows `/admin` and `/api/`.

## Lettering

The initial mode is the existing successful workflow: the model letters the page
from the prompt's exact quoted text. Accuracy is enforced by the pre-flight
script check, the QA transcription comparison (missing, altered, duplicated,
extra or reordered text), and your review. Deterministic SVG lettering needs
known balloon positions, which full-page generation does not provide without
duplicating text, so it belongs to the future panel mode below rather than being
forced onto full pages.

## Future: panel-by-panel mode

The engine is page-oriented but the pieces are separable: `planReferences`
already works per request, `ImageProvider.generatePage` takes any prompt and
reference set, and `page_versions` stores any assembled output. A panel mode
would add a `panels` phase between `generate` and `validate` (one request per
panel, textless), a deterministic layout and SVG lettering compositor using the
script's panel/line structure, and the same QA. It is intentionally not
required for the first release to avoid multiplying image costs.

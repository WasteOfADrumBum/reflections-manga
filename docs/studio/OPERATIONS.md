# Reflections Studio: operations

## Generating a chapter

1. **Generate** → choose the chapter. Ready pages are selected; pages that
   already have artwork cannot be selected. Chapter 001 works from the version 2
   retelling (30 pages): v2 pages 001 and 002 already have art, so 003–030 are
   ready. Nothing past page 030 is generated.
2. Check the estimate: expected cost with retries and the worst case if every
   page uses all attempts. Set the job budget.
3. Press **Generate chapter** and confirm. You can close the tab.
4. The job page shows progress, retries and a sanitized activity log.
   **Pause** stops after the current step, **Resume** continues, **Cancel**
   stops waiting pages and keeps finished ones.

Generation never publishes anything.

## Reviewing

**Review** shows the latest versions per page with automatic QA results.
"Needs a closer look" means the checks were not confident; read the reasons
before approving. Approving a page that failed checks asks you to confirm.
You can regenerate a single page from its page screen or keep comparing
versions. Only one version per page can be approved.

## Publishing

On **Review**, approved pages appear under "Publish approved pages". Check the
alt text (built from the script with every line of dialogue), then publish.
The studio opens a GitHub pull request that:

* adds `site/pages/<chapter>/NNN.webp` (1024 x 1536 WebP),
* adds the original PNG and a `.studio.json` provenance record next to the
  manuscript pages in `stories/.../pages/`,
* appends entries to `site/js/chapters.js` in page order, before the end card,
  without touching existing entries, covers, end cards or other chapters.

It refuses if any target file already exists. Merging the pull request deploys
the pages. Chapter 001's reader shows only v2 page 001; v2 page 002 is in the
repository but not in the reader yet, so publishing later pages first asks you
to confirm the gap.

## Costs

Estimates use OpenAI's published per-token prices (higher Standard figures,
checked 2026-11-18) and **assumed** token counts, because OpenAI does not
publish per-image figures for GPT-Image-2.5. When the API reports usage, the
studio also shows a cost calculated from it. Neither is an invoice; the OpenAI
billing page is authoritative. Update `site/api/_lib/openai/pricing.ts` when
prices change (the studio refuses models without verified pricing).

## Recovery

| Situation | What happens | What you do |
|---|---|---|
| Browser closed | Worker continues on the server | Nothing |
| Function timed out or crashed mid-page | Lease expires; next nudge recovers. A saved image is adopted; otherwise the attempt counts and the page retries | Open the dashboard if you want it to resume immediately |
| Deploy during a job | New instances continue from Postgres | Nothing |
| Rate limit | Waits for `Retry-After`, attempt not used | Nothing |
| Job `blocked` | Key, quota, verification or parameter problem | Fix it, then **Resume** |
| Job `budget_exceeded` | Stopped before passing the budget | Raise the budget, then **Resume** |
| Page `blocked` | Prompt/script mismatch, missing canonical sheet, or page became locked | Fix the repository content; regenerate |
| Page `failed` | Attempts used up or safety rejection | Compare versions, approve one manually, or edit the prompt and regenerate |

The daily Vercel Cron (`/api/studio/worker/cron`) is a last-resort nudge.

## Paid-generation switch

`STUDIO_GENERATION_ENABLED=true` must be set for any paid request. Remove it to
stop all new paid work immediately (running steps finish; nothing new starts).

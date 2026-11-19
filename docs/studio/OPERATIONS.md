# Reflections Studio: operations

## Where things are

| Screen | What it is for |
|---|---|
| **Dashboard** | Each chapter's progress, this month's API spend, anything that needs you, recent runs |
| **Story** | Arcs → chapters → pages, with the arc focus (`stories/arc-NN/index.md`), chapter logline (`outline.md`) and page beat (page guide) from the repository. Add arcs and chapters here |
| **Characters** | Each cast group (Main Cast, the families, Friends) with every outfit sheet as a version, grouped by category in a picker that swaps the preview. Name outfits, change an outfit's category, add outfit sheets, add characters |
| **Generate** | Queue several pages at once |
| **Review** | Every version waiting for a decision, across chapters, and publishing |
| **Site images** | Show or hide gallery and album images, add any character sheet to its gallery, blur revealing images behind an 18+ check, reorder the Memories album and edit its captions; add album photos |
| **Spending** | Monthly API dollars and tokens, pages generated vs kept, attempts per kept page, pages that needed too many tries |

## What it costs, and who pays

* Generating in the studio calls the **OpenAI API** (image model
  `gpt-image-2.5-sunburst`, plus a small `gpt-6-luna` quality check). It is
  billed to your **OpenAI API account's prepaid credit**. That is separate
  from **ChatGPT Plus**: it does not use your Plus limits, and Plus does not
  cover it.
* **Quality** (low to max) is the image model's render setting, not a
  different model. The page and Generate screens show the estimated price per
  image for each quality.
* **Budget** is a dollar cap for one run, in API dollars. The run stops before
  any request that would pass it.
* **No-cost option:** make the page in ChatGPT and use **Upload a version** on
  the page screen. Uploads skip the automatic checks and go through the same
  review and publishing.
* Nothing can spend money until `STUDIO_GENERATION_ENABLED=true` is set in
  Vercel. Uploading, reviewing, publishing and every other screen work without it.

Estimates use OpenAI's published per-token prices (higher Standard figures,
checked 2026-11-18) and **assumed** token counts, because OpenAI does not
publish per-image figures for GPT-Image-2.5. When the API reports usage, the
studio records it (tokens in and out) and a cost calculated from it; the
Spending screen shows both. Neither is an invoice; the OpenAI billing page is
authoritative. Update `site/api/_lib/openai/pricing.ts` when prices change (the
studio refuses models without verified pricing).

## Making a new version of one page

1. **Story** → arc → chapter → page.
2. Read the page's beat, plot and panels, and see its current art if it has any.
3. **Outfits:** each character in the page's reference order has a picker
   with a preview. The prompt's own sheet is marked "(prompt's choice)". A pick
   applies to this run only.
4. **Prompt:** the page prompt from the repository is in an editable box.
   Edits apply to this run only and are never saved to the repository. If an
   edit changes dialogue, the script check blocks it unless you tick "My edit
   changes dialogue on purpose".
5. The panel shows the images that will be attached, any problems, and the cost.
   Press **Generate a new version** and confirm.

Pages that already have art can get new versions. The art stays as it is until
you approve a new version and publish it as a replacement. Only pages listed in
`lockedPages` in `production/studio/config.json` are locked.

## Generating several pages

**Generate** → choose the chapter. Pages without art are selected; pages with
art can be added. Check the estimate, set the budget, press **Generate selected
pages** and confirm. You can close the tab. The run page shows progress,
retries and an activity log; **Pause**, **Resume** and **Cancel** work at any
time. Outfit picks and prompt edits are on the single-page screen.

The first paid run is a single test page; approving it unlocks multi-page runs.

## Reviewing

**Review** lists every page with versions waiting for a decision. Generated
versions show the automatic quality checks; uploads say they were not checked.
Approving a version that failed or skipped checks asks you to confirm. Only one
version per page can be approved; approving another replaces the choice.

## Publishing

Approved pages appear under "Ready to publish", grouped by chapter. Check the
alt text (built from the script with every line of dialogue), then publish. The
studio opens a GitHub pull request that:

* adds `site/pages/<chapter>/NNN.webp` (1024 x 1536 WebP),
* adds the PNG and a provenance record next to the manuscript pages in
  `stories/.../pages/`,
* adds entries to `site/js/chapters.js` in page order without touching other
  entries, covers, end cards or other chapters.

**Replacing art.** If a page already has art, publishing asks you to confirm
the replacement. The pull request then overwrites only the reader WebP and that
page's reader entry. The original manuscript PNG is never overwritten; the
studio version is saved beside it as `A01-C001-PNNN.studio-<id>.png` with a
`.json` provenance record.

Merging the pull request deploys the pages.

**Art already in the repository.** Pages whose PNG is already committed under
the chapter's `pages/` folder (for example made in ChatGPT) but are not in the
reader appear in Review under "Art in the repository, not in the reader yet",
and on their page screen under Current art. **Publish repository art** opens a
pull request that adds the reader WebP and the reader entry only; the PNG is
not touched, and a page already in the reader is never overwritten this way
(replace reader art by uploading a version and publishing it from Review).

## Adding characters, outfits, arcs and chapters

All of these open a pull request; nothing changes until you merge it.

* **Character** (Characters → Add a character): `characters/<group>/<id>/`
  from the character template with its main reference sheet
  (`<id>-reference-main.png`), added to that cast group in
  `characters/asset-manifest.json`. A main sheet is required, because every
  character in the manifest has exactly one.
* **Outfit sheet** (a character's card → Add an outfit sheet): pick a category;
  the file is saved as `outfits/<id>-<category>-<name>.png`, listed in the
  outfit library table and registered in the asset manifest, so
  `tools/validate-character-assets.py` still passes.
* **Outfit category** (a character's card → pick the outfit → Category →
  Change category): moves the sheet to `outfits/<id>-<category>-<name>.png`
  (out of `outfits/_review/` if it was waiting there), updates the asset
  manifest and rewrites every link to it, in one pull request. The main
  reference sheet has no category.
* **Outfit names** (a character's card → Name this outfit) are saved in the
  studio database, not the repository.
* **Arc** (Story → Add an arc): `stories/arc-NN/index.md` with its focus.
* **Chapter** (an arc → Add a chapter): the chapter folder from
  `stories/_chapter-template/` and an entry in `production/studio/config.json`.
  Write its script and page prompts there before generating.

## Site images

**Site images** works on the public Characters page (`site/characters.html`)
and the Memories album (`site/memories.html`). Everything goes out as one pull
request (**Publish site image changes**) that rewrites `site/js/visibility-data.js`
and adds any new image files. Nothing is ever deleted.

* **Show:** untick to hide an image. A photo hidden in one character's gallery
  stays in the others.
* **Sheets not on the site:** each character lists the repository sheets that
  are not in their public gallery yet, unticked. Tick Show to add one; the pull
  request copies it to `site/images/characters/refs/` and records its source in
  `production/studio/site-sheet-sources.json`.
* **Blur (18+):** the image shows blurred with an eye button. Readers must
  confirm they are 18 or older before it shows, and a blurred image never opens
  in the photo viewer until revealed. Lingerie sheets, and sheets whose name
  says they show underwear, start blurred; tick or untick it for any image.
  The studio blurs the same sheets and asks once per browser.
* **Memories album:** drag a photo to move it, or use Move up and Move down.
  Edit its caption and screen-reader description in place; **Reset to
  default** brings back the original, and **Reset album order** restores the
  order in the HTML. Photos in the repository can be hidden but not deleted;
  a photo added in the studio can be removed until it is published.
* **New album photos:** add a photo with a caption and a description; it goes
  at the end of the album when you publish, and can be moved after.

`site/js/visibility.js` applies all of this before the gallery and album
scripts run. Without JavaScript every image in the HTML stays visible.

## Recovery

| Situation | What happens | What you do |
|---|---|---|
| Browser closed | Worker continues on the server | Nothing |
| Function timed out or crashed mid-page | Lease expires; next nudge recovers. A saved image is adopted; otherwise the attempt counts and the page retries | Open the dashboard if you want it to resume immediately |
| Deploy during a run | New instances continue from Postgres | Nothing |
| Rate limit | Waits for `Retry-After`, attempt not used | Nothing |
| Run `blocked` | Key, quota, verification or parameter problem | Fix it, then **Resume** |
| Run `budget_exceeded` | Stopped before passing the budget | Raise the budget, then **Resume** |
| Page `blocked` | Prompt/script mismatch, missing sheet, or page added to `lockedPages` | Fix the repository content or the prompt edit; generate again |
| Page `failed` | Attempts used up or safety rejection | Compare versions, approve one manually, or edit the prompt and generate again |
| Page flagged on Spending | It needed many attempts | Revise the prompt or outfit picks before trying again |

The daily Vercel Cron (`/api/studio/worker/cron`) is a last-resort nudge.

## Paid-generation switch

`STUDIO_GENERATION_ENABLED=true` must be set for any paid request. Remove it to
stop all new paid work immediately (running steps finish; nothing new starts).

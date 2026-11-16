# Reflections: From Story Idea to Finished Manga

Updated: 2026-11-12.
Status: Production guide and recommendations. No new story, format, or canon approved.

## The Practical Approach

Plan the series broadly, write one chapter, then produce that chapter one page
at a time. For tighter character control, generate individual panel art and
assemble it into editable, lettered pages. Export finished pages as a chapter
PDF after review. A PDF is a delivery format, not the working source.

You do not need to supply a finished script. A rough paragraph describing the
situation, cast, conflict, and intended ending is enough to start development.
The assistant turns it into an outline, exact dialogue, page/panel script,
storyboard, reference inputs, art, lettering, and release records in stages.

Creating a whole series means repeating this chapter cycle with shared records.
It does not mean generating every episode, image, and conversation in one call.
Image consistency and readable pacing require review and revision.

## Prompt Batches and Quick Page Summaries

User preference recorded 2026-11-13: prepare scripts/prompts in TEN-PAGE BATCHES.
Each page entry must have a direct copyable prompt link, the character-reference
images in attachment order, and ONE high-level plot sentence so the user can
track the story without opening the prompt. Keep that overview beside the links.
Continue to generate one page per request, in sequence, with the original
identity sheets and a suitable prior page for scene continuity. Ten-page packs
do not mean a ten-page composite image. A final remainder may be shorter:
Story 001's 32-page working plan uses 011–020, then 021–030, then 031–032.
See its [quick page guide](../stories/arc-01/chapter-001/page-guide.md).

## What Each Directory Does

| Location | Purpose | When it is used |
|---|---|---|
| series/bible.md | Premise, themes, narrative boundaries, major setup | Before outlining and whenever the series direction changes |
| series/art-direction.md | Drawing style and approved page/lettering standards | Before storyboards, art, page assembly, and exports |
| series/production-rules.md | Workflow, approval states, revision and release rules | Every chapter |
| characters/ | Identity, behavior, clothes, reference cards, character prompts | Whenever a character appears in writing or art |
| world/ | Relationships, timeline, settings, recurring props | Before scenes and when new world facts are approved |
| stories/index.md | Chapter list and production stage | At chapter creation and stage changes |
| stories/arc-01/ | Shared arc planning and its chapter folders | When planning a connected group of chapters |
| stories/arc-01/chapter-001/ | This chapter's brief, outline, script, storyboard, continuity, artwork, pages, and exports | Actual chapter work |
| continuity/canon-log.md | Approved facts and events that future chapters must respect | Read before drafting; update after explicit approval |
| continuity/change-log.md | What changed in the project and why, including superseded decisions | Update as work is edited |
| continuity/open-threads.md | Unresolved story threads and development decisions | During planning and after chapters introduce or resolve threads |
| production/ | Backlog, overall status, QA checklist, release index, this guide | Planning, review, and closeout |
| prompts/ | Copyable requests and production templates | To start or resume a stage |
| assets/ | Reusable locations, backgrounds, covers, and style material | When a scene needs shared visual assets |
| sources/ | Private unpublished development material, excluded from Git | Never use as public story content without approved fictionalization |

Canon is what is true in the fictional story. The change log is what changed
while making it. A draft event does not become canon merely because a file
was saved or an image was generated. Document approval separately from file existence.

## Start Here: A Story Brief

Use [the story brief prompt](../prompts/workflow/00-story-brief.md).
Include whatever you know:

- Chapter or new story ID, or ask for the next available one.
- Cast and rough situation.
- What each character wants and what creates conflict.
- Beginning, important moments, intended ending, or permission to propose an ending.
- Emotional tone and what the reader should feel.
- Must-include dialogue and things to avoid.
- Scope: standalone, chapter of an arc, or a series proposal.
- Rough length or permission to propose page count.
- Current request: outline only, writing/storyboard, or an authorized art batch.

Missing details can remain open or become labeled proposals. The assistant
should resolve routine choices independently and ask about important creative
decisions or real production blockers. It must not import private real people,
journals, transcripts, or events into public material.

## Stage 1: Series and Arc Planning

If the idea is larger than a chapter, first map its direction: premise,
long-term character goals, broad ending, major turning points, and an arc list.
Give each arc a purpose and propose a chapter list. Keep unapproved future
events separate from canon; an ending plan is not an event that already happened.

Use [series/arc planning](../prompts/workflow/01-series-and-arc-plan.md).
Do not fully illustrate the whole series before testing a short chapter.
For Reflections, a proposed 6-8-page pilot is a practical first production test,
not an approved chapter-length standard.

## Stage 2: Chapter Outline

Create the next chapter folder using the chapter template. Preserve existing
work. Save the brief and outline, list scenes in order, establish motivations,
and propose a rough page budget and emotional payoff. Compare with canon and
flag significant proposed changes. The user reviews the direction before it
becomes an approved chapter plan.

Use [chapter outlining](../prompts/workflow/02-chapter-outline.md).

## Stage 3: Exact Script and Dialogue

Write the chapter as pages and panels, not just prose. Each panel needs one
clear visible beat, cast, setting/time, action, expression, and camera framing.
Record dialogue exactly with speaker, order, and a stable line ID. Separate
speech, thought, narration, and sound effects. A silent panel must say it is silent.

Consider pacing, pauses, page turns, and space for balloons while writing.
Several actions in sequence usually need several panels. If the dialogue
cannot fit legibly, revise the dialogue or panel allocation before final art.
No fixed word count substitutes for checking actual page-size readability.

Use [page/panel scripting](../prompts/workflow/03-script-and-dialogue.md).
The script is the source of truth for wording. The image generator must not
invent or paraphrase the dialogue.

## Stage 4: Storyboard and Format Lock

Turn the script into a page layout plan: panel rectangles, reading order,
shots, character positions, gaze, background geography, and balloon locations.
Create rough thumbnails when useful. Test flow before producing polished art.

Before final art, select and record:

- Color or monochrome treatment.
- Left-to-right or right-to-left reading direction.
- Page aspect ratio, physical trim size if printing, and pixel dimensions.
- Margins, gutters, safe lettering area, and bleed only if required.
- Dialogue font/style, balloon rules, and output target.

These values are currently unresolved. The 1536 x 1024 reference sheets are
not manga page specifications. A digital-first pilot with one consistent
portrait page format and editable lettering is a recommendation, not a locked choice.
Do not claim print readiness before confirming the intended printer's specifications.

Use [storyboarding and format selection](../prompts/workflow/04-storyboard-and-format.md).

## Stage 5: Artwork

Work through an authorized page or small batch. For each panel, inspect and
supply actual character-sheet images, relevant setting/outfit references, and
approved previous-panel context. Paths written in a text prompt alone do not
attach images to the generator. Use [the reference workflow](../prompts/reference-workflow.md).

Freeze identity and scene outfits. Describe the action, framing, lighting,
and reference mapping. Generate image art with space reserved for lettering.
For this workflow, add speech balloons and text during page assembly rather
than relying on generated text. A full-page generated preview can be useful
as an experiment, but individual panels are easier to correct and reletter.

Review each panel against references and continuity. Repair drift using the
original character sheet and the panel to correct, not by repeatedly redesigning
the cast. No tool can guarantee perfect identity from prompting alone.

Use [art batch production](../prompts/workflow/05-panel-art.md) and the
[detailed panel/correction template](../prompts/scenes/manga-panel-template.md).

If generated art exists only in chat, import the actual files into the chapter
before page assembly. If a transfer is blocked, report it clearly. Never use
an empty placeholder or claim an image has been saved when it has not.

## Stage 6: Assemble and Letter Pages

Place panel art into the selected page layout. Add balloons, captions,
thoughts, and sound effects using exact script wording and stable line IDs.
Check balloon order, tails, text size, safe margins, and contrast.

Keep an editable page source, such as SVG with text and image elements, plus
the individual artwork and lettering record. Keep sources self-contained or
include their image/font dependencies. Export a flattened page PNG for review.
Keep a plain-text chapter transcript with the reading order and visual descriptions.
Do not call a flattened image-only PDF accessible just because it has a transcript.

Use [page assembly and lettering](../prompts/workflow/06-page-assembly-and-lettering.md).

## Stage 7: QA and Approval

Review the complete chapter, not just isolated pretty images. Check story
logic, dialogue, behavior, faces, hair, freckles, proportions, outfits,
accessories, props, lighting, page turns, and reading flow. Compare lettering
against the script and render pages at the intended reading size.

Classify problems, fix reversible execution errors, and rerender changed pages.
Present important creative changes for approval. No failed or unreviewed panel
may be silently marked approved. The user can review stages in sensible batches;
there is no need to seek new permission for every routine correction already in scope.

Use [chapter QA](../prompts/workflow/07-chapter-qa.md).

## Stage 8: Export a Chapter PDF

Yes, the finished result can be a PDF containing every composed, lettered page
in order, with cover/title material if selected. Save both editable sources
and final page images, then assemble the PDF and inspect rendered output.
Check page count/order, clipping, resolution, margins, fonts, and legibility.

Use [PDF export](../prompts/workflow/08-pdf-export.md). A review PDF may be
generated before approval but must be labeled as a draft. Exporting a PDF does
not approve story events or publish anything. Print and digital exports can
be different deliverables.

After several chapters are approved, combine their approved pages into a
volume PDF while retaining separate chapter sources and version history.

## Stage 9: Approve, Record Canon, and Push

Once the user approves the completed story and QA passes, record only its
established events in canon and timeline, update open threads and the chapter
registry, record the released version, and inspect the exact Git diff. Commit
approved story files and push to the configured remote under the standing agreement.
Do not include private sources or unrelated work. Do not claim a push succeeded
without verifying it. No new approval is required for a push already authorized
by the working agreement after creative approval and QA are complete.

Use [chapter closeout](../prompts/workflow/09-approve-and-release.md).
GitHub is version control and delivery to the repository. It does not itself
publish the manga to a reader website or distributor.

## Recommended Chapter Files

| Path within a chapter | Contents |
|---|---|
| brief.md | User's fictional story brief and approved scope |
| outline.md | Scenes, emotional arc, and page budget |
| script.md | Exact page/panel script and ordered dialogue |
| storyboard.md | Layouts, shot plans, reading order, balloon reservations |
| continuity.md | Reference versions, scene state, outfits, props, and approved developments |
| art/page-001/panel-001-v1.png | Individual panel artwork and revisions |
| generation/page-001-panel-001.md | Actual prompt, reference mapping, selected output, and review notes |
| lettering.md | Text IDs, exact wording, speaker, balloon order and placement |
| pages/source/page-001.svg | Proposed editable page source format |
| pages/page-001.png | Composed, lettered review/final page image |
| qa.md | Review issues, corrections, and approval evidence |
| transcript.md | Readable dialogue order and visual descriptions |
| exports/chapter-001-v1-review.pdf | Draft proof, if needed |
| exports/chapter-001-v1.pdf | Final approved delivery PDF |
| handoff.md | Current stage, approved items, open decisions, next safe action |

The files above are a proposed organization for future chapter work. This guide
does not create final images, SVGs, PDFs, or chapter events. Actual file names,
dependencies, and status should be recorded as they are produced.

## How to Break Up Conversations

Use one conversation for series direction, then one production conversation
per chapter. Inside that chapter conversation, request stages in order rather
than restarting for every panel. A long chapter can have a separate art session.

If a conversation becomes unwieldy or ends, save a handoff and resume from the
project files. A new chat does not automatically contain every prior message
or reference image. It needs access to this directory, and the assistant must
read the saved records and supply the real reference images again.

Use [resume and handoff](../prompts/workflow/10-resume-and-handoff.md).
The numbered prompts are stage launchers, not commands that must all be pasted
at once. Each should build on saved outputs from the previous stage.

## The First Actual Step for Reflections

Submit the first fictional story idea using prompt 00. Develop an outline and
propose the pilot's format and page count. Do not generate final pages until
the story direction and required format decisions are ready.

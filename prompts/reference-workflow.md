# Character Reference Workflow

Updated: 2026-11-12.
Purpose: Preserve the same fictional cast across panels, chapters, and the series.

## Current Reference Images

All six user-saved PNG files are present, 1536 x 1024 pixels each.
They are selected for reuse as reference images. File registration does not
silently approve every incidental detail or override established written facts.

| Character | Image to supply to the generator |
|---|---|
| Ethan | [Sheet](../characters/ethan-walker/references/ethan-walker-reference-sheet-v1.png) |
| Morgan | [Sheet](../characters/morgan-hayes/references/morgan-hayes-reference-sheet-v1.png) |
| Ruby | [Sheet](../characters/ruby-bennett/references/ruby-bennett-reference-sheet-v1.png) |
| Rowan | [Sheet](../characters/rowan-hayes-walker/references/rowan-hayes-walker-reference-sheet-v1.png) |
| Riley | [Sheet](../characters/riley-hayes-walker/references/riley-hayes-walker-reference-sheet-v1.png) |
| Avery | [Sheet](../characters/avery-bennett-walker/references/avery-bennett-walker-reference-sheet-v1.png) |

## What a Reference Actually Requires

Use the image bytes as reference inputs, not just the character's name, a
Markdown link, or a path typed inside a text prompt. When working in this local
project, the assistant should inspect the relevant files and supply them to
the image tool through its reference-image input. For the available image tool,
that is referenced_image_paths when every required image has a local path.
Inspect the images before editing or reusing them. A copied prompt in another
chat or tool does not attach images; upload the relevant sheets there.

Attach sheets for the cast actually present in the panel. Label the mapping
explicitly: which input image depicts which person. An approved recent panel
can also provide scene continuity, but the original character sheets remain
the identity anchors. Do not rely only on the most recent generated panel.

## Separate Stable Identity from Scene State

| Stable identity | Scene-specific state |
|---|---|
| Face, age, build, height | Pose, gaze, expression, camera angle |
| Hair color and established cut | Temporary arrangement consistent with that cut |
| Eye color and freckles | Lighting and shadows |
| Established permanent accessories and ring rules | Approved outfit, jacket position, props, temporary dirt or damage |

Wardrobe can change between scenes without redesigning the face or body.
Within a continuous scene, keep the selected outfit and accessories consistent.
Do not make a graphic, incidental detail, or model error permanent by accident.

## Per-Scene Production

1. Read the profiles, reference records, current chapter continuity, and script.
2. Confirm the cast and collect their actual reference image files.
3. Fill the [scene/panel prompt template](scenes/manga-panel-template.md).
4. Record scene ID, time, location, lighting, exact outfits, props and positions,
   emotional state, entry/exit direction, and relevant previous-panel state.
5. Before a final page, establish page dimensions, reading direction, panel
   layout, and lettering. The 3:2 character sheets do not define manga page size.
6. For tighter control, produce and review one panel at a time. Assemble panels
   into the approved page layout; keep dialogue and lettering editable.
7. Compare each result directly with its supplied sheets and the previous scene
   state. Check face, haircut, eyes, freckles, build, height, outfit, rings,
   hands, props, positions, and reading flow before approving it.
8. If a character drifts, request a focused correction with the original sheet
   and failed panel attached. Recheck the whole panel after correction.
9. Save approved panels and update chapter continuity. Preserve the reference
   version used and the generation prompt. Complete QA and approval before
   committing and pushing a finished story.

An image generator does not guarantee identical identity across independent
outputs. Strong references, specific continuity records, and review/correction
are the working controls. Repeating a name or prompt alone is insufficient.

## Explicit Continuity Rules for This Family

- Rowan 130 cm, Avery 126 cm, Riley 110 cm. Rowan and Avery differ by only 4 cm.
- Morgan has no wedding ring; Ruby wears hers. A missing or unclear ring in a
  reference image does not remove that written requirement. Ring design/hand
  remain unfinalized until selected; do not silently establish them from an error.
- Ethan's ring practice remains open.
- Riley has a chestnut pixie; Ruby has a copper-red pixie; Avery has long auburn hair.
- Rowan has no visible freckles; Riley has light nose freckles; Avery has noticeable freckles.
- Avery's autism is not a physical appearance marker. Follow her communication
  preferences without forcing a specific gesture system or expression.
- Individual sheet framing is not a reliable comparative-height chart. Use the
  written measurements for a shared scene.

## Reference Changes

Keep the supplied v1 images intact. Save deliberate revisions as new versions,
record exactly what changed, and get approval before replacing an approved
master. When a new version is selected, update each character's reference
record, the related prompt, and the chapter's image manifest.

If an approved image and approved written profile genuinely conflict, surface
that specific conflict rather than choosing a new permanent trait silently.

## Next Useful Visual Reference

When requested, create a separate full-family height lineup from the six
individual sheets. Use one floor plane, one camera setup, and the written
heights. Treat it as a draft until reviewed; no lineup is created by this guide.

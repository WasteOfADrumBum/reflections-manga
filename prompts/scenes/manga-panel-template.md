# Manga Panel Prompt Template

Status: Reusable template. No scene, page standard, or new story event approved.
Updated: 2026-11-12.

Before generation: inspect the actual sheets, fill all required fields, attach
the named images, and resolve missing scene details. The file paths below are
an input manifest, not a substitute for attaching images to the generator.

## Reference Input Manifest

| Input | Character or purpose | Actual local image path | Version/status |
|---|---|---|---|
| Image 1 | [Character] | [Existing reference PNG] | [Selected version] |
| Image 2, if needed | [Character] | [Existing reference PNG] | [Selected version] |
| Additional inputs, if needed | [Other cast or scene continuity] | [Existing PNG] | [Version or panel ID] |

Use only needed references. Clearly distinguish identity sheets, outfit
references, location references, and previous panels. Do not confuse cast identities.

## Copyable Prompt

```text
Create ONE manga panel for the fictional series Reflections.

REFERENCE MAPPING
[List the actual attached images and the character shown in each.]
[If a previous panel is attached, identify it as scene continuity, not a new identity.]

IDENTITY
Depict only these named characters: [CAST].
Use the supplied character sheets as visual identity anchors. Preserve facial
structure, age, build, hair color and cut, eye color, freckles, and established
identifying traits. Do not blend faces, exchange hairstyles, or redesign anyone.
[Include the short approved appearance description for each present character.]
[Include any explicit written correction to an unclear reference detail.]

PROPORTIONS
[Actual heights and relative placement for the cast in this panel.]
Use perspective consistently. Preserve age-appropriate anatomy and body types.
Do not infer relative heights from the separate character-sheet framing.

SCENE
Chapter: [ID]. Scene: [ID]. Page: [ID]. Panel: [ID].
Location: [APPROVED LOCATION]. Time: [TIME].
Action and emotional beat: [ONE CLEAR BEAT FROM THE SCRIPT].
Characters' positions, facing directions, and gaze: [DETAILS].
Camera framing and angle: [DETAILS].
Background, lighting, and mood: [DETAILS].

WARDROBE AND PROPS
[Exact scene outfit for each character; attach an approved outfit reference if available.]
[Rings and other established accessories applicable to this cast.]
[Props, hands holding them, and their current positions.]
Keep these details consistent with the previous panel. Do not add unrequested props.

PREVIOUS-PANEL CONTINUITY
[Where each person and prop was; camera geography; unchanged scene details.]
[Any deliberate scripted change. Use "not applicable" only for a new scene.]

ART DIRECTION
Use the established contemporary Japanese seinen-inspired manga treatment,
clean expressive linework, semi-realistic age-appropriate proportions, natural
body language, and controlled shading. Match the approved scene's color or
monochrome treatment: [TREATMENT]. Keep identity readable under the lighting.

OUTPUT
Panel aspect ratio and pixel dimensions: [SELECTED PANEL SPECIFICATIONS].
Composition must fit [PANEL POSITION AND READING DIRECTION].
Leave clear space at [LOCATION] for later editable lettering.
Do not render dialogue, captions, sound effects, watermarks, or logos unless
the production plan explicitly requires a separate lettering pass here.
Do not create a character sheet, extra panel, or additional cast member.
```

## Focused Correction Template

Attach the failed panel and original identity sheet(s), then use:

```text
Correct the attached panel for Reflections.
Panel image: [WHICH INPUT]. Character reference: [WHICH INPUT AND CHARACTER].
Specific mismatch: [OBSERVABLE FEATURE].
Required correction: [APPROVED FEATURE].
Preserve the panel composition, cast, action, outfit, lighting, background,
and other characters except where the requested correction requires a change.
Keep the corrected character consistent with the original identity sheet.
```

Recheck the whole corrected image. No generation or correction is automatically
approved; record the selected output in chapter continuity after review.

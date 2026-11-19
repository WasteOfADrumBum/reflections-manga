# Global Character Rules

## Identity

Each character has a canonical:
- Name and age
- Height and general proportions
- Face and eye characteristics
- Hairstyle and hair color
- Personality profile
- Signature wardrobe
- Recognizable accessories

## Reusable Character Model

Place each character in `main/`, `friends/`, or one established family side:
`family/bennett/`, `family/hayes/`, or `family/walker/`. Use the registry's
established relationships, not surname matching. Keep the character ID stable
when changing navigation groups. Group indexes and `asset-manifest.json` must
reflect the actual paths.

Each character directory contains:

- `index.md`: Identity and canonical traits
- `appearance.md`: Physical appearance
- `personality.md`: Behavioral characteristics
- `wardrobe.md`: Outfit definitions
- `references/`: One named main reference sheet and its approval/continuity record
- `outfits/`: Descriptive outfit sheets and a linked catalog; uncertain classifications in `_review/`
- `prompts/`: Versioned text prompts; prompt files do not approve generated artwork
- `kit/` (optional): Character kit for anime, film and game work: bible, visual sheets, voice, motion and 3D notes. It links to the files above and approves nothing. Copy it from [the kit template](_template/kit/README.md).

Use [the asset manifest](asset-manifest.json) and each character's outfit catalog
to locate clothing by category: casual, sleepwear, swimwear, activewear, formal,
workwear, outerwear, seasonal, or lingerie. Different outfits get descriptive
names. Use `-v2`, `-v3` only for documented revisions of the same named sheet.
A main reference is a navigation/identity anchor; master-model approval remains
separate. See the [organization record](../production/character-asset-organization.md).

## Continuity

Written specifications can be approved before artwork exists. Track these
states separately: completed questionnaire, approved written profile,
approved model sheet, and approved chapter art. Do not infer one from another.

For Rowan, Avery, and Riley, consult [approved questionnaire answers](questionnaire-answers.md)
and their individual appearance, personality, and wardrobe files. Keep
unasked details open. Child profile directories retain stable legacy identifiers after the approved
2026-11-13 name revision:
rowan-hayes-walker, avery-bennett-walker, and riley-hayes-walker.

Diane Hayes, Thomas "Tom" Bennett, Richard "Rick" Walker, and Linda Walker
have approved written profiles recorded 2026-11-13. Written approval does not
approve a model sheet, relatives' provisional visuals, or suggested childhood
influences. Family history approved 2026-11-13: Morgan's father had alcoholism
and left the family when Morgan was 13; Ruby's mother died when Ruby was 6.
Keep their names, Morgan's father's current status, Ruby's mother's cause of
death, and other unprovided circumstances open. Do not extend Ruby's maternal
history to Autumn without approval of a shared mother.

Nathan "Nate" Hayes and Adrian Hayes were added as Morgan's older brothers
and Diane's sons on 2026-11-13; Nate is oldest, Adrian middle, Morgan youngest.
Their ages of 41 and 38, designs, detailed family responses, occupations, and
Adrian's gender questioning and possible autistic traits remain proposals.
Use the [Hayes family-history approval limits](hayes-family-history.md).
Do not infer a diagnosis, final identity label, causal explanation of withdrawal,
or new canonical visual traits from a proposal or an inspiration image.

Ellie and Owen Greene are supporting children added 2026-11-13. Their prior
appearance, personality, and wardrobe suggestions remain provisional; no
questionnaire or model sheet is approved for them. Same-age comparisons do not
transfer another child's measurements or selected traits.

Physical identity stays consistent between panels.
Temporary expressions and outfits may change.
Permanent design changes require approval.

## Randomization

Prompt variants may alter poses, lighting, and clothing.

Do not randomize facial identity, age, height,
canonical hairstyle, or other permanent traits.

## Reference Priority

1. Approved canonical model sheet
2. Approved character profile
3. Approved scene references
4. Chapter script
5. Experimental prompts

## Quality Checklist

- Correct eye and hair colors
- Correct character proportions
- Correct clothing for the scene
- Correct accessories
- Consistent body language
- Consistent relative height

## Cass Continuity: 2026-11-19

[Cassidy "Cass" Bennett](friends/cassidy-bennett/index.md) is 40 and Australian.
Preserve Bennett and infer no kinship with Ruby from it. Use the actual supplied
fictional sheet for facial identity and tattoos; never invent missing details.
Exact height and household details remain open. Check
[reference availability](friends/cassidy-bennett/references/index.md) before artwork.

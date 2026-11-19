# Walker Extended Family Portrait

Date: 2026-11-13. Status: generated draft awaiting user review.

[Portrait v1](walker-extended-family-portrait-v1.png)

## Scope and Continuity

The user supplied thirteen characters for an extended-family portrait:
Morgan H. Walker, Richard Walker, Riley Walker, Rowan Walker, Autumn Bennett,
Thomas Bennett, Ruby Bennett-Walker, Adrian Hayes, Diane Hayes, Nathan Hayes,
Avery Bennett Walker, Ethan Walker, and Linda Walker.
All thirteen appear once. The portrait title does not assign everyone the Walker
surname. Family roles and unresolved details retain their existing status.
The garden, grouping, smiles, and gestures are proposed artwork rather than
approved chronology, a residence, or established reactions to the shared marriage.
Nathan and Adrian's proposed ages, heights, and designs remain provisional.

## Reference Boards

The five-input limit required stacking the supplied sheets without rescaling
or changing the individual images. Each band is one original 1536 x 1024 sheet.
Original character sheets remain unchanged.

- [Central adults](walker-extended-central-input.png): top Morgan, middle Ethan, bottom Ruby.
- [Children](walker-extended-children-input.png): top Rowan, middle Avery, bottom Riley.
- [Walker grandparents](walker-extended-grandparents-input.png): top Richard, bottom Linda.
- [Hayes relatives](hayes-family-relatives-input.png): top Nathan, middle Adrian, bottom Diane.
- [Bennett relatives](walker-extended-bennett-input.png): top Autumn, bottom Thomas.

Sources: the thirteen user-supplied PNGs, now each character's main reference sheet
(see the [character asset manifest](../../characters/asset-manifest.json)).

## Visual Review

Ten adults and three children visible, all faces and shoes within frame.
Distinct grooming, reference outfits, child proportions, and older generations'
age cues retained. Height targets were supplied; exact scaling and hand details
remain subject to user review. No text or additional figures.
No artwork approval, canon change, completed story, commit, or push established.

## Exact Generation Prompt

```text
Create the Walker EXTENDED FAMILY portrait for the fictional manga Reflections. EXACTLY THIRTEEN DISTINCT PEOPLE: ten adults and three children. Include every named person once, with no duplicates or omissions. This is a single cohesive warm family-photo illustration, not a collage or model sheet. Use a wide panoramic landscape composition, approximately 2:1, ideally 3072 by 1536, with all heads and shoes inside frame and generous edge margins.

STYLE: contemporary Japanese seinen-inspired manga, clean expressive linework, semi-realistic natural anatomy, subtle cel shading, readable individual faces, realistic fabric folds, rich but gentle natural colors. Match supplied reference artwork. Everyone wears their exact casual outfit from their sheet, fully clothed.

INPUT MAPPING: All five inputs are reference contact boards. Each horizontal band is a model sheet of ONE distinct person shown from multiple angles. Do not count the multiple angles as separate people.
Input 1: top Morgan, middle Ethan, bottom Ruby.
Input 2: top Rowan, middle Avery, bottom Riley.
Input 3: top Richard/Rick, bottom Linda.
Input 4: top Nathan/Nate, middle Adrian, bottom Diane.
Input 5: top Autumn, bottom Thomas/Tom.
Thirteen unique subjects total. Preserve each reference's face, hairstyle, build, age, eye color, freckles, grooming, and outfit.

ADULT ROSTER:
Morgan,34,170cm: athletic woman, chestnut layered hair below shoulders, hazel eyes, light freckles, olive field jacket over black top, dark jeans, brown boots.
Ethan,38,178cm: solid realistic dad bod with softly rounded belly, brown high fade textured top, full brown beard, brown eyes, olive T-shirt, black jeans, brown boots. Full beard must remain brown.
Ruby,28,152cm: petite adult woman, copper-red pixie, green eyes, freckles, ivory cable knit top, dusty pink long cardigan, charcoal pleated knee-length skirt, dark ballet flats. She is an ADULT, not a child.
Richard "Rick",65,180cm: Ethan's father, square face, brown eyes, thick brows, short brown hair with gray temples, neatly trimmed gray-brown beard, broad shoulders and rounded belly, charcoal short-sleeve polo, blue jeans, brown belt, brown boots. Clearly older than Ethan, distinct from Thomas.
Linda,62,165cm: Ethan's mother, soft rounded face, warm hazel eyes, softly waved medium-brown hair with silver highlights, medium build, burgundy long cardigan over ivory floral blouse, brown trousers, dark brown ballet flats. Distinct from Diane.
Nathan "Nate", adult early forties design,183cm: stocky broad shoulders, short dark chestnut hair, thick dark mustache with jaw stubble, heavy brow and square weathered face; charcoal rolled-sleeve button work shirt, faded jeans, brown work boots. Distinct dark mustache, not Ethan's full beard.
Adrian,adult late thirties design,180cm: thin lanky build, messy medium-brown hair, rectangular dark glasses, light stubble, gentle features; dark charcoal hoodie with ochre mountain/sunset graphic, olive cargo trousers, dark canvas sneakers.
Diane,58,173cm: sturdy relatively lean woman, chestnut shoulder-length hair with prominent silver front streak, hazel-green eyes, freckles and mature cheekbones; blue denim jacket over olive button shirt, blue jeans, brown ankle boots.
Autumn,adult approximately34,152cm: Ruby's older sister, SAME petite HEIGHT as Ruby but fuller adult build, long wavy strawberry-blonde hair, green eyes, freckles, loose olive-brown blouse, wide-leg blue jeans, brown ankle boots. Do not make Autumn taller than Ruby.
Thomas "Tom",60,175cm: faded auburn hair graying at temples, green eyes, freckled mature face, short salt-and-pepper beard, slightly stocky build; brown canvas work jacket with corduroy collar, muted brown-blue plaid shirt, faded jeans, brown boots. He is Ruby and Autumn's father.

CHILDREN:
Rowan,9-year-old boy,130cm: slender child proportions, chestnut short textured hair, brown-leaning hazel eyes, no freckles, blue and orange raglan hoodie, blue jeans, blue-orange sneakers.
Avery,7-year-old girl,126cm: sturdy child proportions, auburn ponytail, hazel eyes, prominent freckles, lavender sun/mountain/river graphic T-shirt, pastel pink/mint/lavender geometric leggings, pastel sneakers.
Riley,approximately6-year-old girl,110cm: slender young child, short chestnut pixie, green-leaning hazel eyes, light freckles, purple zip hoodie layered over teal hoodie and striped shirt, teal patterned tiered skirt, purple leggings, lavender leg warmers, brown lace-up boots.
Rowan is only slightly taller than Avery (4cm); Riley is noticeably shorter (16-20cm). Never make children teens or toddlers.

COMPOSITION: warm relaxed traditional extended-family photograph. Ten adults stand in a wide shallow arc on essentially the SAME level garden path. Left to right adults: NATHAN, ADRIAN, DIANE, RICHARD, MORGAN, ETHAN, RUBY, LINDA, THOMAS, AUTUMN. This clear order helps ensure all ten adults appear. Ethan at the heart of the group between Morgan and Ruby. Three children stand a small step in front of the central parents: Rowan left, Avery middle, Riley right; don't block any adult face. Natural shoulders slightly touching, a few gentle hands on shoulders, simple relaxed hand placement, no tangled arms. Soft natural smiles toward camera; small shy smiles on Ruby and Adrian, easy bright smile on Autumn, warm mature smiles on grandparents. All faces unobscured. Maintain distinct identities rather than generic repeated faces. Full-length composition, all feet and hair visible, no one cropped at edge.
HEIGHT ACCURACY: adult men range175-183cm, not giants. Richard is only2cm taller than Ethan. Diane173 a little taller than Morgan170. Linda165 a little shorter than Morgan. Ruby and Autumn BOTH152, much shorter than Ethan178; keep them recognizably adult. No forced perspective distorting sizes.
SETTING: softly detailed leafy garden with a broad path and warm diffused afternoon light, understated flowers and trees, no identifiable location or assigned family home. Affectionate ordinary family keepsake, relaxed and welcoming. No additional people, animals, labels, names, dialogue, watermark or logos. Final subject count THIRTEEN: TEN adults + THREE children.
```

# Character Asset Organization — 2026-11-19

Organized the existing `characters/<id>/references/` library (there is no `assets/characters/` in this checkout). No artwork was edited or deleted. Main-sheet selection is distinct from master-model approval. Existing site WebP exports and historical study inputs keep their original bytes and paths.

## Naming and Layout

- Main: `characters/<group>/<id>/references/<id>-reference-main.png`.
- Outfit: `characters/<group>/<id>/outfits/<id>-<category>-<description>.png`.
- Unresolved category or revision lineage: `outfits/_review/<id>-review-<visible-description>.png`.
- Categories: `casual`, `sleepwear`, `swimwear`, `activewear`, `formal`, `workwear`, `outerwear`, `seasonal`, `lingerie`. Unused categories need no empty folders.
- True revisions: append `-v2`, `-v3` to the SAME named sheet only when revision intent/order is documented. No revision lineage was established by this cleanup.
- Existing consolidated reference copies remain a historical snapshot; original sheet links and relocated copy links are repaired.

## Summary

- 85 images preserved, 18 main sheets, 67 alternate sheets.
- Ruby’s 11 already-renamed tracked sheets were matched to their former filenames using exact Git-blob SHA-256 hashes. Existing descriptive outfit choices were retained.
- Cass’s white-top/red-shorts main selection was explicitly confirmed by the user during this session.
- Main selections do not add new `Current Card` approvals for supporting characters.

## Unresolved Decisions

- [autumn-bennett-review-blue-printed-bra-shorts.png](../characters/family/bennett/autumn-bennett/outfits/_review/autumn-bennett-review-blue-printed-bra-shorts.png): Bra/shorts set is visible, but intended activewear, sleepwear, or lingerie use is not established. Category awaits user selection.
- [cassidy-bennett-review-blue-red-printed-bra-shorts.png](../characters/friends/cassidy-bennett/outfits/_review/cassidy-bennett-review-blue-red-printed-bra-shorts.png): Bra/shorts set is visible, but intended activewear, sleepwear, or lingerie use is not established. Category awaits user selection.
- [morgan-hayes-review-plaid-bra-shorts.png](../characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-plaid-bra-shorts.png): Bra/shorts set is visible, but intended activewear, sleepwear, or lingerie use is not established. Category awaits user selection.
- [morgan-hayes-review-black-top-olive-shorts-study-b.png](../characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-black-top-olive-shorts-study-b.png): Same visible outfit as study-a, but different bytes. Revision order and intended sleepwear/activewear use are unverified; neither supersedes the other.
- [morgan-hayes-review-black-bra-olive-shorts.png](../characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-black-bra-olive-shorts.png): Bra/shorts set is visible, but intended activewear, sleepwear, or lingerie use is not established. Category awaits user selection.
- [morgan-hayes-review-black-top-olive-shorts-study-a.png](../characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-black-top-olive-shorts-study-a.png): Same visible outfit as study-b, but different bytes. Revision order and intended sleepwear/activewear use are unverified; neither supersedes the other.
- [natalie-greene-review-green-printed-bra-shorts.png](../characters/friends/natalie-greene/outfits/_review/natalie-greene-review-green-printed-bra-shorts.png): Bra/shorts set is visible, but intended activewear, sleepwear, or lingerie use is not established. Category awaits user selection.

Firefighter and motorcycle labels describe garments only; they do not establish occupations, affiliations, or hobbies. Lingerie includes Ethan’s underwear because the requested taxonomy has no separate underwear category. Ruby’s supplied activewear names are preserved even where garment use could overlap loungewear.

## Complete Rename Mapping

Paths below are relative to each character directory. Legacy aliases are pre-session names recovered by hash. The manifest records checksums and exact dimensions for every row.

### adrian-hayes

| Before | After | Category / role |
|---|---|---|
| `references/adrian-hayes-reference-character-sheet-v1.png` | [references/adrian-hayes-reference-main.png](../characters/family/hayes/adrian-hayes/references/adrian-hayes-reference-main.png) | main / casual |

### autumn-bennett

| Before | After | Category / role |
|---|---|---|
| `references/autumn-bennett-reference-sheet-v1.png` | [references/autumn-bennett-reference-main.png](../characters/family/bennett/autumn-bennett/references/autumn-bennett-reference-main.png) | main / casual |
| `references/autumn-bennett-reference-sheet-v2.png` | [outfits/autumn-bennett-sleepwear-cardigan-plaid-shorts.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-sleepwear-cardigan-plaid-shorts.png) | outfit / sleepwear |
| `references/autumn-bennett-reference-sheet-v3.png` | [outfits/autumn-bennett-swimwear-patterned-one-piece.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-swimwear-patterned-one-piece.png) | outfit / swimwear |
| `references/image copy 2.png` | [outfits/autumn-bennett-casual-black-blouse-brown-trousers.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-casual-black-blouse-brown-trousers.png) | outfit / casual |
| `references/image copy 3.png` | [outfits/autumn-bennett-casual-cream-top-brown-ruffle-skirt.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-casual-cream-top-brown-ruffle-skirt.png) | outfit / casual |
| `references/image copy 4.png` | [outfits/autumn-bennett-casual-gray-knit-top-brown-shorts.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-casual-gray-knit-top-brown-shorts.png) | outfit / casual |
| `references/image copy 5.png` | [outfits/autumn-bennett-casual-striped-top-denim-skirt.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-casual-striped-top-denim-skirt.png) | outfit / casual |
| `references/image copy 6.png` | [outfits/_review/autumn-bennett-review-blue-printed-bra-shorts.png](../characters/family/bennett/autumn-bennett/outfits/_review/autumn-bennett-review-blue-printed-bra-shorts.png) | outfit / pending |
| `references/image copy 7.png` | [outfits/autumn-bennett-sleepwear-pink-graphic-hoodie-briefs.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-sleepwear-pink-graphic-hoodie-briefs.png) | outfit / sleepwear |
| `references/image copy.png` | [outfits/autumn-bennett-casual-gray-tee-white-shorts.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-casual-gray-tee-white-shorts.png) | outfit / casual |
| `references/image.png` | [outfits/autumn-bennett-sleepwear-blue-white-graphic-top-shorts.png](../characters/family/bennett/autumn-bennett/outfits/autumn-bennett-sleepwear-blue-white-graphic-top-shorts.png) | outfit / sleepwear |

### avery-bennett-walker

| Before | After | Category / role |
|---|---|---|
| `references/avery-bennett-walker-reference-sheet-v1.png` | [references/avery-bennett-walker-reference-main.png](../characters/main/avery-bennett-walker/references/avery-bennett-walker-reference-main.png) | main / casual |

### caleb-mercer

| Before | After | Category / role |
|---|---|---|
| `references/caleb-mercer-reference-sheet-v1.png` | [references/caleb-mercer-reference-main.png](../characters/friends/caleb-mercer/references/caleb-mercer-reference-main.png) | main / casual |
| `references/caleb-mercer-reference-sheet-v2.png` | [outfits/caleb-mercer-outerwear-motorcycle-leather-jacket.png](../characters/friends/caleb-mercer/outfits/caleb-mercer-outerwear-motorcycle-leather-jacket.png) | outfit / outerwear |

### cassidy-bennett

| Before | After | Category / role |
|---|---|---|
| `references/image copy 10.png` | [outfits/cassidy-bennett-swimwear-black-red-bikini.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-swimwear-black-red-bikini.png) | outfit / swimwear |
| `references/image copy 2.png` | [outfits/cassidy-bennett-sleepwear-pink-graphic-tee-pants.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-sleepwear-pink-graphic-tee-pants.png) | outfit / sleepwear |
| `references/image copy 3.png` | [outfits/cassidy-bennett-activewear-gray-romper.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-activewear-gray-romper.png) | outfit / activewear |
| `references/image copy 4.png` | [outfits/cassidy-bennett-activewear-olive-top-shorts.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-activewear-olive-top-shorts.png) | outfit / activewear |
| `references/image copy 5.png` | [outfits/cassidy-bennett-lingerie-gray-bra-briefs.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-lingerie-gray-bra-briefs.png) | outfit / lingerie |
| `references/image copy 6.png` | [outfits/cassidy-bennett-casual-white-top-gray-sweatpants.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-casual-white-top-gray-sweatpants.png) | outfit / casual |
| `references/image copy 7.png` | [outfits/_review/cassidy-bennett-review-blue-red-printed-bra-shorts.png](../characters/friends/cassidy-bennett/outfits/_review/cassidy-bennett-review-blue-red-printed-bra-shorts.png) | outfit / pending |
| `references/image copy 8.png` | [outfits/cassidy-bennett-formal-black-off-shoulder-dress.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-formal-black-off-shoulder-dress.png) | outfit / formal |
| `references/image copy 9.png` | [references/cassidy-bennett-reference-main.png](../characters/friends/cassidy-bennett/references/cassidy-bennett-reference-main.png) | main / casual |
| `references/image copy.png` | [outfits/cassidy-bennett-sleepwear-blue-graphic-top-shorts.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-sleepwear-blue-graphic-top-shorts.png) | outfit / sleepwear |
| `references/image.png` | [outfits/cassidy-bennett-sleepwear-yellow-graphic-hoodie-briefs.png](../characters/friends/cassidy-bennett/outfits/cassidy-bennett-sleepwear-yellow-graphic-hoodie-briefs.png) | outfit / sleepwear |

### diane-hayes

| Before | After | Category / role |
|---|---|---|
| `references/diane-hayes-reference-sheet-v1.png` | [references/diane-hayes-reference-main.png](../characters/family/hayes/diane-hayes/references/diane-hayes-reference-main.png) | main / casual |

### ellie-greene

| Before | After | Category / role |
|---|---|---|
| `references/ellie-greene-reference-sheet-v1.png` | [references/ellie-greene-reference-main.png](../characters/friends/ellie-greene/references/ellie-greene-reference-main.png) | main / casual |

### ethan-walker

| Before | After | Category / role |
|---|---|---|
| `references/ethan-walker-reference-sheet-v1.png` | [references/ethan-walker-reference-main.png](../characters/main/ethan-walker/references/ethan-walker-reference-main.png) | main / casual |
| `references/ethan-walker-reference-sheet-v2.png` | [outfits/ethan-walker-lingerie-black-boxer-briefs.png](../characters/main/ethan-walker/outfits/ethan-walker-lingerie-black-boxer-briefs.png) | outfit / lingerie |
| `references/ethan-walker-reference-sheet-v3.png` | [outfits/ethan-walker-activewear-black-tank-gray-joggers.png](../characters/main/ethan-walker/outfits/ethan-walker-activewear-black-tank-gray-joggers.png) | outfit / activewear |
| `references/ethan-walker-reference-sheet-v4.png` | [outfits/ethan-walker-casual-black-henley.png](../characters/main/ethan-walker/outfits/ethan-walker-casual-black-henley.png) | outfit / casual |
| `references/ethan-walker-reference-sheet-v5.png` | [outfits/ethan-walker-formal-wedding-suit.png](../characters/main/ethan-walker/outfits/ethan-walker-formal-wedding-suit.png) | outfit / formal |
| `references/ethan-walker-reference-sheet-v6.png` | [outfits/ethan-walker-swimwear-striped-board-shorts.png](../characters/main/ethan-walker/outfits/ethan-walker-swimwear-striped-board-shorts.png) | outfit / swimwear |
| `references/ethan-walker-reference-sheet-v7.png` | [outfits/ethan-walker-workwear-firefighter-gear.png](../characters/main/ethan-walker/outfits/ethan-walker-workwear-firefighter-gear.png) | outfit / workwear |
| `references/ethan-walker-reference-sheet-v8.png` | [outfits/ethan-walker-outerwear-motorcycle-vest-hoodie.png](../characters/main/ethan-walker/outfits/ethan-walker-outerwear-motorcycle-vest-hoodie.png) | outfit / outerwear |

### linda-walker

| Before | After | Category / role |
|---|---|---|
| `references/linda-walker-reference-sheet-v1.png` | [references/linda-walker-reference-main.png](../characters/family/walker/linda-walker/references/linda-walker-reference-main.png) | main / casual |

### morgan-hayes

| Before | After | Category / role |
|---|---|---|
| `references/image copy 2.png` | [outfits/morgan-hayes-sleepwear-black-graphic-tank-pants.png](../characters/main/morgan-hayes/outfits/morgan-hayes-sleepwear-black-graphic-tank-pants.png) | outfit / sleepwear |
| `references/image copy 3.png` | [outfits/morgan-hayes-formal-brown-blouse-black-trousers.png](../characters/main/morgan-hayes/outfits/morgan-hayes-formal-brown-blouse-black-trousers.png) | outfit / formal |
| `references/image copy 4.png` | [outfits/_review/morgan-hayes-review-plaid-bra-shorts.png](../characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-plaid-bra-shorts.png) | outfit / pending |
| `references/image copy 5.png` | [outfits/morgan-hayes-sleepwear-purple-graphic-hoodie-briefs.png](../characters/main/morgan-hayes/outfits/morgan-hayes-sleepwear-purple-graphic-hoodie-briefs.png) | outfit / sleepwear |
| `references/image copy.png` | [outfits/morgan-hayes-sleepwear-black-graphic-top-shorts.png](../characters/main/morgan-hayes/outfits/morgan-hayes-sleepwear-black-graphic-top-shorts.png) | outfit / sleepwear |
| `references/image.png` | [outfits/morgan-hayes-workwear-gray-shirt-trousers.png](../characters/main/morgan-hayes/outfits/morgan-hayes-workwear-gray-shirt-trousers.png) | outfit / workwear |
| `references/morgan-hayes-reference-sheet-v1.png` | [references/morgan-hayes-reference-main.png](../characters/main/morgan-hayes/references/morgan-hayes-reference-main.png) | main / casual |
| `references/morgan-hayes-reference-sheet-v10.png` | [outfits/_review/morgan-hayes-review-black-top-olive-shorts-study-b.png](../characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-black-top-olive-shorts-study-b.png) | outfit / pending |
| `references/morgan-hayes-reference-sheet-v11.png` | [outfits/_review/morgan-hayes-review-black-bra-olive-shorts.png](../characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-black-bra-olive-shorts.png) | outfit / pending |
| `references/morgan-hayes-reference-sheet-v12.png` | [outfits/morgan-hayes-lingerie-black-vest-bodysuit.png](../characters/main/morgan-hayes/outfits/morgan-hayes-lingerie-black-vest-bodysuit.png) | outfit / lingerie |
| `references/morgan-hayes-reference-sheet-v2.png` | [outfits/morgan-hayes-lingerie-black-lace-corset.png](../characters/main/morgan-hayes/outfits/morgan-hayes-lingerie-black-lace-corset.png) | outfit / lingerie |
| `references/morgan-hayes-reference-sheet-v3.png` | [outfits/morgan-hayes-sleepwear-burgundy-camisole-shorts.png](../characters/main/morgan-hayes/outfits/morgan-hayes-sleepwear-burgundy-camisole-shorts.png) | outfit / sleepwear |
| `references/morgan-hayes-reference-sheet-v4.png` | [outfits/morgan-hayes-sleepwear-black-camisole-shorts.png](../characters/main/morgan-hayes/outfits/morgan-hayes-sleepwear-black-camisole-shorts.png) | outfit / sleepwear |
| `references/morgan-hayes-reference-sheet-v5.png` | [outfits/morgan-hayes-casual-black-top-gray-joggers.png](../characters/main/morgan-hayes/outfits/morgan-hayes-casual-black-top-gray-joggers.png) | outfit / casual |
| `references/morgan-hayes-reference-sheet-v6.png` | [outfits/morgan-hayes-casual-western-hat-maxi-skirt.png](../characters/main/morgan-hayes/outfits/morgan-hayes-casual-western-hat-maxi-skirt.png) | outfit / casual |
| `references/morgan-hayes-reference-sheet-v7.png` | [outfits/morgan-hayes-formal-wedding-lace-blouse-pink-skirt.png](../characters/main/morgan-hayes/outfits/morgan-hayes-formal-wedding-lace-blouse-pink-skirt.png) | outfit / formal |
| `references/morgan-hayes-reference-sheet-v8.png` | [outfits/morgan-hayes-swimwear-black-long-sleeve-one-piece.png](../characters/main/morgan-hayes/outfits/morgan-hayes-swimwear-black-long-sleeve-one-piece.png) | outfit / swimwear |
| `references/morgan-hayes-reference-sheet-v9.png` | [outfits/_review/morgan-hayes-review-black-top-olive-shorts-study-a.png](../characters/main/morgan-hayes/outfits/_review/morgan-hayes-review-black-top-olive-shorts-study-a.png) | outfit / pending |

### natalie-greene

| Before | After | Category / role |
|---|---|---|
| `references/image copy 2.png` | [outfits/natalie-greene-casual-cream-blouse-brown-skirt.png](../characters/friends/natalie-greene/outfits/natalie-greene-casual-cream-blouse-brown-skirt.png) | outfit / casual |
| `references/image copy 3.png` | [outfits/_review/natalie-greene-review-green-printed-bra-shorts.png](../characters/friends/natalie-greene/outfits/_review/natalie-greene-review-green-printed-bra-shorts.png) | outfit / pending |
| `references/image copy 4.png` | [outfits/natalie-greene-sleepwear-yellow-graphic-hoodie-briefs.png](../characters/friends/natalie-greene/outfits/natalie-greene-sleepwear-yellow-graphic-hoodie-briefs.png) | outfit / sleepwear |
| `references/image copy.png` | [outfits/natalie-greene-workwear-overalls-tank.png](../characters/friends/natalie-greene/outfits/natalie-greene-workwear-overalls-tank.png) | outfit / workwear |
| `references/image.png` | [outfits/natalie-greene-workwear-overalls-straw-hat.png](../characters/friends/natalie-greene/outfits/natalie-greene-workwear-overalls-straw-hat.png) | outfit / workwear |
| `references/natalie-greene-reference-sheet-v1.png` | [references/natalie-greene-reference-main.png](../characters/friends/natalie-greene/references/natalie-greene-reference-main.png) | main / casual |
| `references/natalie-greene-reference-sheet-v2.png` | [outfits/natalie-greene-sleepwear-patterned-hooded-onesie.png](../characters/friends/natalie-greene/outfits/natalie-greene-sleepwear-patterned-hooded-onesie.png) | outfit / sleepwear |
| `references/natalie-greene-reference-sheet-v3.png` | [outfits/natalie-greene-swimwear-olive-two-piece-straw-hat.png](../characters/friends/natalie-greene/outfits/natalie-greene-swimwear-olive-two-piece-straw-hat.png) | outfit / swimwear |

### nathan-hayes

| Before | After | Category / role |
|---|---|---|
| `references/nathan-hayes-reference-character-sheet-v1.png` | [references/nathan-hayes-reference-main.png](../characters/family/hayes/nathan-hayes/references/nathan-hayes-reference-main.png) | main / casual |

### owen-greene

| Before | After | Category / role |
|---|---|---|
| `references/owen-greene-reference-sheet-v1.png` | [references/owen-greene-reference-main.png](../characters/friends/owen-greene/references/owen-greene-reference-main.png) | main / casual |

### richard-walker

| Before | After | Category / role |
|---|---|---|
| `references/richard-walker-reference-character-sheet-v1.png` | [references/richard-walker-reference-main.png](../characters/family/walker/richard-walker/references/richard-walker-reference-main.png) | main / casual |

### riley-hayes-walker

| Before | After | Category / role |
|---|---|---|
| `references/riley-hayes-walker-reference-sheet-v1.png` | [references/riley-hayes-walker-reference-main.png](../characters/main/riley-hayes-walker/references/riley-hayes-walker-reference-main.png) | main / casual |

### rowan-hayes-walker

| Before | After | Category / role |
|---|---|---|
| `references/rowan-hayes-walker-reference-sheet-v1.png` | [references/rowan-hayes-walker-reference-main.png](../characters/main/rowan-hayes-walker/references/rowan-hayes-walker-reference-main.png) | main / casual |

### ruby-bennett-walker

| Before | After | Category / role |
|---|---|---|
| `references/ruby-activewear-hoodie-yoga-pants.png`; legacy: ruby-bennett-walker-reference-sheet-v4.png | [outfits/ruby-bennett-walker-activewear-hoodie-yoga-pants.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-activewear-hoodie-yoga-pants.png) | outfit / activewear |
| `references/ruby-activewear-woxers.png` | [outfits/ruby-bennett-walker-activewear-woxers.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-activewear-woxers.png) | outfit / activewear |
| `references/ruby-casual-default.png`; legacy: ruby-bennett-walker-reference-sheet-v1.png | [references/ruby-bennett-walker-reference-main.png](../characters/main/ruby-bennett-walker/references/ruby-bennett-walker-reference-main.png) | main / casual |
| `references/ruby-casual-hat-jeans.png` | [outfits/ruby-bennett-walker-casual-hat-jeans.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-casual-hat-jeans.png) | outfit / casual |
| `references/ruby-casual-polo-skirt.png` | [outfits/ruby-bennett-walker-casual-polo-skirt.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-casual-polo-skirt.png) | outfit / casual |
| `references/ruby-formal-date-night.png`; legacy: ruby-bennett-walker-reference-sheet-v5.png | [outfits/ruby-bennett-walker-formal-date-night.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-formal-date-night.png) | outfit / formal |
| `references/ruby-formal-wedding-dress.png`; legacy: ruby-bennett-walker-reference-sheet-v11.png | [outfits/ruby-bennett-walker-formal-wedding-dress.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-formal-wedding-dress.png) | outfit / formal |
| `references/ruby-lingerie-babydoll.png`; legacy: ruby-bennett-walker-reference-sheet-v2.png | [outfits/ruby-bennett-walker-lingerie-babydoll.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-lingerie-babydoll.png) | outfit / lingerie |
| `references/ruby-lingerie-blue.png`; legacy: ruby-bennett-walker-reference-sheet-v9.png | [outfits/ruby-bennett-walker-lingerie-blue.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-lingerie-blue.png) | outfit / lingerie |
| `references/ruby-lingerie-red.png`; legacy: ruby-bennett-walker-reference-sheet-v8.png | [outfits/ruby-bennett-walker-lingerie-red.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-lingerie-red.png) | outfit / lingerie |
| `references/ruby-lingerie-school-girl.png`; legacy: ruby-bennett-walker-reference-sheet-v10.png | [outfits/ruby-bennett-walker-lingerie-school-girl.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-lingerie-school-girl.png) | outfit / lingerie |
| `references/ruby-sleepwear-blue.png`; legacy: ruby-bennett-walker-reference-sheet-v3.png | [outfits/ruby-bennett-walker-sleepwear-blue.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-sleepwear-blue.png) | outfit / sleepwear |
| `references/ruby-sleepwear-pokemon-sweatshirt-shorts.png` | [outfits/ruby-bennett-walker-sleepwear-pokemon-sweatshirt-shorts.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-sleepwear-pokemon-sweatshirt-shorts.png) | outfit / sleepwear |
| `references/ruby-sleepwear-pokemon-sweatshirt.png` | [outfits/ruby-bennett-walker-sleepwear-pokemon-sweatshirt.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-sleepwear-pokemon-sweatshirt.png) | outfit / sleepwear |
| `references/ruby-swimwear-one-piece-coverup.png`; legacy: ruby-bennett-walker-reference-sheet-v6.png | [outfits/ruby-bennett-walker-swimwear-one-piece-coverup.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-swimwear-one-piece-coverup.png) | outfit / swimwear |
| `references/ruby-swimwear-one-piece.png`; legacy: ruby-bennett-walker-reference-sheet-v7.png | [outfits/ruby-bennett-walker-swimwear-one-piece.png](../characters/main/ruby-bennett-walker/outfits/ruby-bennett-walker-swimwear-one-piece.png) | outfit / swimwear |

### thomas-bennett

| Before | After | Category / role |
|---|---|---|
| `references/thomas-bennet-reference-sheet-v1.png` | [references/thomas-bennett-reference-main.png](../characters/family/bennett/thomas-bennett/references/thomas-bennett-reference-main.png) | main / casual |

## Cast Folder Organization

The user requested actual folder grouping and registry navigation during this session. Stable character IDs and all existing approval limits are retained. `Main Cast` contains the six household members. Family is split by the established Bennett, Hayes, and Walker sides. Cal, Nat, Ellie, Owen, and Cass are under Friends & Neighbors; no new kinship or child friendship is inferred.

| Before directory | Final directory |
|---|---|
| `characters/ethan-walker` | [characters/main/ethan-walker](../characters/main/ethan-walker/index.md) |
| `characters/morgan-hayes` | [characters/main/morgan-hayes](../characters/main/morgan-hayes/index.md) |
| `characters/ruby-bennett-walker` | [characters/main/ruby-bennett-walker](../characters/main/ruby-bennett-walker/index.md) |
| `characters/rowan-hayes-walker` | [characters/main/rowan-hayes-walker](../characters/main/rowan-hayes-walker/index.md) |
| `characters/riley-hayes-walker` | [characters/main/riley-hayes-walker](../characters/main/riley-hayes-walker/index.md) |
| `characters/avery-bennett-walker` | [characters/main/avery-bennett-walker](../characters/main/avery-bennett-walker/index.md) |
| `characters/autumn-bennett` | [characters/family/bennett/autumn-bennett](../characters/family/bennett/autumn-bennett/index.md) |
| `characters/thomas-bennett` | [characters/family/bennett/thomas-bennett](../characters/family/bennett/thomas-bennett/index.md) |
| `characters/diane-hayes` | [characters/family/hayes/diane-hayes](../characters/family/hayes/diane-hayes/index.md) |
| `characters/nathan-hayes` | [characters/family/hayes/nathan-hayes](../characters/family/hayes/nathan-hayes/index.md) |
| `characters/adrian-hayes` | [characters/family/hayes/adrian-hayes](../characters/family/hayes/adrian-hayes/index.md) |
| `characters/richard-walker` | [characters/family/walker/richard-walker](../characters/family/walker/richard-walker/index.md) |
| `characters/linda-walker` | [characters/family/walker/linda-walker](../characters/family/walker/linda-walker/index.md) |
| `characters/caleb-mercer` | [characters/friends/caleb-mercer](../characters/friends/caleb-mercer/index.md) |
| `characters/natalie-greene` | [characters/friends/natalie-greene](../characters/friends/natalie-greene/index.md) |
| `characters/ellie-greene` | [characters/friends/ellie-greene](../characters/friends/ellie-greene/index.md) |
| `characters/owen-greene` | [characters/friends/owen-greene](../characters/friends/owen-greene/index.md) |
| `characters/cassidy-bennett` | [characters/friends/cassidy-bennett](../characters/friends/cassidy-bennett/index.md) |

## Validation Results

- All 85 image SHA-256 hashes, file sizes, and PNG dimensions match the pre-change inventory. All removed tracked paths have preserved destinations; no image was edited or deleted.
- Exactly 18 main sheets, 67 alternate sheets, and 7 pending-category sheets. Each character belongs to exactly one cast group, with a linked profile and outfit catalog.
- No broken character links or newly broken local Markdown links. Repaired 41 pre-existing broken-link entries. The 66 remaining broken local links were already present and point to old Chapter 001 prompt/page locations across six chapter documents, outside this asset cleanup.
- Studio lint, TypeScript checks, and production bundle validation pass. Tests: 148 pass; 2 pre-existing failures expect an older Page 022 thought line. The chapter script and its dialogue were not changed by this session. New character discovery, descriptive filename parsing, exact outfit resolution, and image-access checks pass.
- Windows still holds the empty former `characters/ethan-walker/references/` and `characters/ruby-bennett-walker/references/` directories open in another process. Their files have all moved successfully; the two empty parent folders therefore also remain locally. No process was terminated. These empty directories contain no tracked files and are not part of the Git changes.
- No commit, push, release, production deployment, or story-canon approval was performed.

Repeat the character asset audit with `python tools/validate-character-assets.py`.

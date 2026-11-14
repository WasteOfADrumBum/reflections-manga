# Reflections Cover Artwork

Selected by the user on 2026-11-13 for the manga and four arc openings. All originals are 1024 × 1536. Website copies use WebP at the same dimensions, without cropping.

| Artwork | Original | Website copy | Placement |
|---|---|---|---|
| Reflections | [reflections-cover.png](reflections-cover.png) | [WebP](../../site/images/covers/reflections-cover.webp) | First image in Chapter 001 |
| Arc 1: Three Become One | [arc-01-three-become-one.png](arc-01-three-become-one.png) | [WebP](../../site/images/covers/arc-01-three-become-one.webp) | Second image in Chapter 001, before story page 001 |
| Arc 2: The Invisible Weight | [arc-02-the-invisible-weight.png](arc-02-the-invisible-weight.png) | [WebP](../../site/images/covers/arc-02-the-invisible-weight.webp) | First image in the first chapter of Arc 2 |
| Arc 3: Fractured Reflections | [arc-03-fractured-reflections.png](arc-03-fractured-reflections.png) | [WebP](../../site/images/covers/arc-03-fractured-reflections.webp) | First image in the first chapter of Arc 3 |
| Arc 4: The Choice | [arc-04-the-choice.png](arc-04-the-choice.png) | [WebP](../../site/images/covers/arc-04-the-choice.webp) | First image in the first chapter of Arc 4 |

## Reader placement

Chapter 001 opens with the manga cover, then Arc 1, then its existing numbered story pages. Covers are front matter; story filenames and production page numbers stay unchanged.

Future arcs do not have assigned chapter IDs yet. In `site/js/chapters.js`, set `arc: 2` (or 3 or 4) and `opensArc: true` on that arc's first chapter. The reader prepends its registered cover automatically. Do not put `opensArc` on later chapters in the same arc. All four arc covers also appear beside the reading order now, without publishing unfinished chapters.

These cover selections do not approve unproduced story pages or establish new narrative events.

# Review and Correct a Chapter

Status: Reusable prompt template, not authorization to execute every stage now.
Updated: 2026-11-12.
Replace bracketed fields; skip optional fields you do not know.

```text
Work in the Reflections Manga project. Keep relevant project records updated.

Run a complete QA pass on Reflections [CHAPTER ID] using production/review-checklist.md,
its approved script/storyboard, actual reference sheets, and current continuity.

Check plot and emotional continuity, character behavior and appearance,
ages/heights, wardrobe and rings, props, lighting, geography, anatomy,
reading order, exact dialogue, balloon order, lettering, and page dimensions.
Review the whole chapter and inspect rendered pages at normal reading size.
Do not infer a passed visual check from files merely existing.

Save qa.md with affected page/panel IDs, severity, evidence, and corrections.
Fix reversible execution errors already within scope, rerender changed pages,
and recheck their dependencies. Present significant creative changes for review.
Update handoff with remaining issues and the next safe action. Do not mark
failed checks or unapproved pages approved. Do not release a chapter with
unresolved blocking defects.
```

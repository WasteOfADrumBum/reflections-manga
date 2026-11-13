# Close Out and Push an Approved Story

Status: Reusable prompt template, not authorization to execute every stage now.
Updated: 2026-11-12.
Replace bracketed fields; skip optional fields you do not know.

```text
Work in the Reflections Manga project. Keep relevant project records updated.

Close out Reflections [CHAPTER ID], version [VERSION]. My approval applies to:
[Identify the exact chapter/page/output version being approved.]

Verify that the approval matches the actual files and that QA has no blocking
failures. Preserve earlier versions. Record only approved established events
in canon and timeline; update open threads, chapter continuity, story registry,
production status, release index, and the change log. Planned future events
must stay separate from canon.

Inspect the Git diff and stage only this approved story and its related
references and records. Exclude private sources and unrelated work. Follow
the standing agreement to commit and push completed approved stories to the
configured GitHub remote without requesting duplicate push permission.

Verify the push result and report the commit/version and remaining limitations.
If prerequisites or pushing fail, report the blocker and keep the status accurate.
Do not publish to a separate website or distributor without a separate instruction.
```

# Reflections Studio: testing

All automated tests mock OpenAI and GitHub. None makes a paid request.

Tests read the real repository content, with the reader seen as it is after the
version 2 reader change (only v2 page 001 published), so they pass whether or not
that change has been merged. A page that already has a finished file in
`stories/.../pages/` is locked; tests follow whichever of those files are present.

```
cd site
npm run verify     # lint + types + unit/integration tests + bundle check
npm run test:e2e   # Playwright browser tests (needs `npx playwright install chromium`)
```

GitHub Actions runs both on every pull request (`.github/workflows/studio-ci.yml`).

| Requirement | Where |
|---|---|
| Complete simulated job with mocked OpenAI (Chapter 001 v2, pages 021–030) | `tests/integration/chapter-job.test.ts` |
| Page selection and strict ordering | `chapter-job.test.ts` |
| Canonical reference selection and order | `chapter-job.test.ts`, `tests/unit/engine.test.ts` |
| Continuity-state transitions | `chapter-job.test.ts`, `engine.test.ts` |
| Retries, backoff, rate limits, QA retries, failures, budget, pause/resume/cancel | `tests/integration/recovery.test.ts` |
| Persistence across simulated restarts and crashes | `recovery.test.ts` ("persistence across restarts") |
| Existing pages cannot be overwritten | `tests/integration/security.test.ts`, `publish.test.ts` |
| Unpublished assets never reach the public reader | `security.test.ts` |
| Authentication, authorization, CSRF, lockout, worker secret | `security.test.ts` |
| Export of a finished job | `security.test.ts` ("export") |
| All 30 v2 prompts match `script-v2.md` word for word; v1 prompts still parse | `tests/unit/content.test.ts` |
| OpenAI request shape (real image files, verified parameters) | `tests/unit/infra.test.ts` |
| Admin UI flows + axe WCAG 2.2 AA scan (jsdom) | `tests/integration/admin-ui.test.ts` |
| Full browser flow, keyboard focus, colour contrast, reduced motion | `tests/e2e/studio.spec.ts` |

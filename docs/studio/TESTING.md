# Reflections Studio: testing

All automated tests mock OpenAI and GitHub. None makes a paid request.

```
cd site
npm run verify     # lint + types + unit/integration tests + bundle check
npm run test:e2e   # Playwright browser tests (needs `npx playwright install chromium`)
```

GitHub Actions runs both on every pull request (`.github/workflows/studio-ci.yml`).

| Requirement | Where |
|---|---|
| Complete simulated job with mocked OpenAI (Chapter 001, pages 021–030) | `tests/integration/chapter-job.test.ts` |
| Page selection and strict ordering | `chapter-job.test.ts` |
| Canonical reference selection and order | `chapter-job.test.ts`, `tests/unit/engine.test.ts` |
| Continuity-state transitions | `chapter-job.test.ts`, `engine.test.ts` |
| Retries, backoff, rate limits, QA retries, failures, budget, pause/resume/cancel | `tests/integration/recovery.test.ts` |
| Persistence across simulated restarts and crashes | `recovery.test.ts` ("persistence across restarts") |
| Existing pages cannot be overwritten | `tests/integration/security.test.ts`, `publish.test.ts` |
| Unpublished assets never reach the public reader | `security.test.ts` |
| Authentication, authorization, CSRF, lockout, worker secret | `security.test.ts` |
| Export of a finished job | `security.test.ts` ("export") |
| Prompts 021–030 match the script word for word | `tests/unit/content.test.ts` |
| OpenAI request shape (real image files, verified parameters) | `tests/unit/infra.test.ts` |
| Admin UI flows + axe WCAG 2.2 AA scan (jsdom) | `tests/integration/admin-ui.test.ts` |
| Full browser flow, keyboard focus, colour contrast, reduced motion | `tests/e2e/studio.spec.ts` |

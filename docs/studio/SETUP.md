# Reflections Studio: setup

Reflections Studio is the private production studio at `/admin` on the existing
Vercel site. It turns the chapter prompts and character sheets already in this
repository into finished pages with OpenAI, checks them, and publishes approved
pages to the reader through a GitHub pull request.

Everything below uses free tiers. Nothing in the studio spends money until you
switch paid generation on **and** confirm a job in the studio.

> **API billing is separate from ChatGPT.** A ChatGPT Plus or Pro subscription
> does not include API usage. Image generation is billed to the OpenAI API
> organization that owns `OPENAI_API_KEY`, at API prices, from prepaid API credit.

## 1. Services (all free tiers)

| Need | Service | Why |
|---|---|---|
| Job queue and metadata | Postgres (Neon free plan through the Vercel Marketplace) | Durable job state, leases, checkpoints, approvals |
| Generated images | Vercel Blob, **private** store (Hobby includes 1 GB, 2,000 writes and 10,000 reads a month) | Binaries never live in Git or a public URL |
| Prompts, sheets, scripts, publishing | This GitHub repository | Source of truth; publishing opens a pull request |
| Artwork | OpenAI API | The only image provider |

### Create the database (Neon, free)

1. Open the Vercel project: https://vercel.com/dashboard → your Reflections project → **Storage**.
2. Choose **Create Database** → **Neon** → the **Free** plan. Connect it to the project for Production (and Preview if you want).
3. Vercel adds `DATABASE_URL`. The studio creates its tables automatically on the first request.

### Create the private Blob store

1. Same **Storage** tab → **Create** → **Blob**.
2. Set access to **Private** (this cannot be changed later) and connect it to the project.
3. Vercel adds `BLOB_STORE_ID` and authenticates with OIDC automatically. No token to copy.

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)

| Variable | Required | Value |
|---|---|---|
| `ADMIN_USERNAME` | no (default `admin`) | The sign-in name you want |
| `ADMIN_PASSWORD_HASH` | yes | Output of `npm run hash-password` (run inside `site/`). Never store the plain password. |
| `SESSION_SECRET` | yes | 32+ random characters. Generate with `openssl rand -base64 48`. |
| `CRON_SECRET` | yes | 24+ random characters (`openssl rand -base64 32`). Vercel Cron sends it automatically; the worker requires it. |
| `DATABASE_URL` | yes | Added by the Neon integration |
| `BLOB_STORE_ID` | yes | Added when you connect the private Blob store |
| `GITHUB_TOKEN` | yes | Fine-grained token for this repository only: **Contents: read and write**, **Pull requests: read and write**, and **Actions: read and write** if you use the heartbeat workflow |
| `GITHUB_REPOSITORY` | no | Defaults to `WasteOfADrumBum/reflections-manga` |
| `GITHUB_BRANCH` | no | Defaults to `main` |
| `OPENAI_API_KEY` | for generation | API key from https://platform.openai.com/api-keys |
| `STUDIO_GENERATION_ENABLED` | for generation | `true` to allow paid requests. Leave unset (off) until you are ready. |
| `GITHUB_DISPATCH_WORKFLOW` | optional | `studio-worker-heartbeat.yml` to start the heartbeat workflow when a job starts |
| `STUDIO_PUBLIC_URL` | optional | Only if the site is served from a custom domain and you want the worker to call that domain |

Create the fine-grained GitHub token at https://github.com/settings/personal-access-tokens/new
(Repository access: only `reflections-manga`). OpenAI may require
organization verification before GPT Image models work:
https://platform.openai.com/settings/organization/general

After adding variables, redeploy (Vercel → Deployments → ⋯ → Redeploy).

## 3. Optional heartbeat (recommended for unattended runs)

The worker chains its own invocations, so a job continues after you close the
browser. If an invocation is ever killed mid-step, the next nudge recovers it.
Nudges come from: the next worker step, opening the dashboard, the daily Vercel
Cron (Hobby allows one run a day), and this optional workflow, which nudges once
a minute only while a job is running.

1. Repository → Settings → Secrets and variables → Actions:
   - Variable `STUDIO_URL` = your site URL, for example `https://reflections.vercel.app`
   - Secret `STUDIO_CRON_SECRET` = the same value as `CRON_SECRET`
2. In Vercel set `GITHUB_DISPATCH_WORKFLOW=studio-worker-heartbeat.yml`.

It uses GitHub Actions minutes only while a job runs (private repositories get
2,000 free minutes a month; a 10-page chapter takes roughly 20 to 40 minutes).

## 4. First run

1. Sign in at `/admin` (also linked as "Creator studio" in the home page footer).
2. The dashboard lists anything still missing.
3. Go to **Generate**, keep the first ready page selected and press **Run one test page**.
   This is the single controlled real request. Nothing paid happens before you confirm it.
4. Review the page under **Review**. Approving a page from the test job unlocks
   unattended multi-page jobs.
5. Press **Generate chapter** to queue every ready page (v2 pages 003–030 for Chapter 001).
   Check the estimate and set the job budget on that screen; the default $10 cap stops the
   job early if the whole chapter would cost more.

## Local development

```
cd site
npm install
npm run dev        # http://localhost:8137 ; studio at /admin (owner / correct horse battery staple)
```

The dev server uses an in-process Postgres (PGlite), an in-memory blob store and
**mocked** OpenAI and GitHub. Real OpenAI calls require both
`STUDIO_DEV_REAL_OPENAI=1` and `OPENAI_API_KEY`, and are never used by tests.

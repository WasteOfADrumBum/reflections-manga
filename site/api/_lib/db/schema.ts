import type { Db } from "./client.js";

/**
 * Ordered, append-only migrations. Applied automatically and idempotently on
 * the first request after a deploy, inside an advisory lock. Never edit an
 * applied migration; add a new one.
 */
export const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "initial studio schema",
    sql: `
CREATE TABLE IF NOT EXISTS studio_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL,
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  chapter_id text NOT NULL,
  status text NOT NULL,
  page_numbers integer[] NOT NULL,
  settings jsonb NOT NULL,
  budget_usd double precision NOT NULL,
  spent_estimate_usd double precision NOT NULL DEFAULT 0,
  spent_reported_usd double precision NOT NULL DEFAULT 0,
  is_test boolean NOT NULL DEFAULT false,
  idempotency_key text UNIQUE,
  error text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  finished_at timestamptz
);
-- Only one unfinished job per chapter: prevents duplicate paid work.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_per_chapter
  ON jobs (chapter_id) WHERE status IN ('queued', 'running', 'paused');

CREATE TABLE IF NOT EXISTS job_pages (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  chapter_id text NOT NULL,
  page integer NOT NULL,
  position integer NOT NULL,
  status text NOT NULL,
  phase text NOT NULL DEFAULT 'generate',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  next_attempt_at timestamptz,
  lease_owner text,
  lease_until timestamptz,
  current_version_id uuid,
  last_error text,
  updated_at timestamptz NOT NULL,
  UNIQUE (job_id, page)
);
CREATE INDEX IF NOT EXISTS job_pages_ready ON job_pages (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS generation_attempts (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  job_page_id uuid NOT NULL REFERENCES job_pages(id) ON DELETE CASCADE,
  chapter_id text NOT NULL,
  page integer NOT NULL,
  attempt_no integer NOT NULL,
  kind text NOT NULL DEFAULT 'image',
  status text NOT NULL,
  model text NOT NULL,
  settings jsonb NOT NULL,
  prompt_path text NOT NULL,
  prompt_sha256 text NOT NULL,
  request_hash text NOT NULL,
  reference_manifest jsonb NOT NULL,
  blob_path text NOT NULL,
  cost_estimate_usd double precision NOT NULL,
  cost_reported_usd double precision,
  usage jsonb,
  error jsonb,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  UNIQUE (job_page_id, attempt_no, kind)
);

CREATE TABLE IF NOT EXISTS page_versions (
  id uuid PRIMARY KEY,
  chapter_id text NOT NULL,
  page integer NOT NULL,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES generation_attempts(id) ON DELETE SET NULL,
  source text NOT NULL,
  blob_path text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  format text NOT NULL,
  bytes integer NOT NULL,
  prompt_path text,
  prompt_sha256 text,
  model text,
  reference_manifest jsonb NOT NULL DEFAULT '[]',
  settings jsonb NOT NULL DEFAULT '{}',
  qa jsonb,
  qa_status text NOT NULL DEFAULT 'pending',
  qa_confidence double precision,
  retry_count integer NOT NULL DEFAULT 0,
  cost_estimate_usd double precision NOT NULL DEFAULT 0,
  review_status text NOT NULL DEFAULT 'awaiting_review',
  publication_status text NOT NULL DEFAULT 'unpublished',
  publication_id uuid,
  alt_text text,
  review_note text,
  created_at timestamptz NOT NULL,
  reviewed_at timestamptz
);
CREATE INDEX IF NOT EXISTS page_versions_by_page ON page_versions (chapter_id, page, created_at DESC);
-- At most one approved version per page.
CREATE UNIQUE INDEX IF NOT EXISTS page_versions_one_approved
  ON page_versions (chapter_id, page) WHERE review_status = 'approved';

CREATE TABLE IF NOT EXISTS continuity_states (
  chapter_id text NOT NULL,
  page integer NOT NULL,
  version_id uuid,
  state jsonb NOT NULL,
  source text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (chapter_id, page)
);

CREATE TABLE IF NOT EXISTS chapter_settings (
  chapter_id text PRIMARY KEY,
  settings jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_assets (
  id uuid PRIMARY KEY,
  character_id text,
  chapter_id text,
  pages integer[],
  label text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  blob_path text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS publications (
  id uuid PRIMARY KEY,
  chapter_id text NOT NULL,
  version_ids uuid[] NOT NULL,
  status text NOT NULL,
  branch text,
  pr_url text,
  error text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS event_log (
  id bigserial PRIMARY KEY,
  job_id uuid,
  chapter_id text,
  page integer,
  level text NOT NULL,
  message text NOT NULL,
  data jsonb,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS event_log_by_job ON event_log (job_id, id DESC);
`,
  },
  {
    id: 2,
    name: "per-page run options, uploads, sheet names",
    sql: `
-- Per-run choices for one page: outfit sheet per character and a one-off prompt edit.
ALTER TABLE job_pages ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}';
ALTER TABLE page_versions ADD COLUMN IF NOT EXISTS prompt_edited boolean NOT NULL DEFAULT false;
ALTER TABLE page_versions ADD COLUMN IF NOT EXISTS uploaded_by text;
ALTER TABLE page_versions ADD COLUMN IF NOT EXISTS replaces_art boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS sheet_labels (
  path text PRIMARY KEY,
  label text NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS generation_attempts_by_month ON generation_attempts (started_at);
`,
  },
];

export async function migrate(db: Db): Promise<number[]> {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied: number[] = [];
  await db.tx(async (tx) => {
    // Serialise concurrent cold starts. Transaction-scoped, released on commit.
    await tx.query(`SELECT pg_advisory_xact_lock(814201)`);
    const done = new Set((await tx.query<{ id: number }>(`SELECT id FROM schema_migrations`)).map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      for (const statement of splitSql(m.sql)) await tx.query(statement);
      await tx.query(`INSERT INTO schema_migrations (id, name) VALUES ($1, $2)`, [m.id, m.name]);
      applied.push(m.id);
    }
  });
  return applied;
}

function splitSql(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

let migrated: Promise<unknown> | undefined;
export function ensureMigrated(db: Db): Promise<unknown> {
  migrated ??= migrate(db).catch((err) => {
    migrated = undefined;
    throw err;
  });
  return migrated;
}
export function resetMigrationCache() {
  migrated = undefined;
}

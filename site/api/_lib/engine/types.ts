import type { GenerationSettings } from "../content/config.js";

export const ACTIVE_JOB_STATUSES = ["queued", "running", "paused"] as const;
export type JobStatus = "queued" | "running" | "paused" | "completed" | "completed_with_issues" | "cancelled" | "budget_exceeded" | "blocked";
export type JobPageStatus =
  | "queued"
  | "generating"
  | "validating"
  | "retry_wait"
  | "awaiting_review"
  | "failed"
  | "blocked"
  | "skipped"
  | "cancelled";

export const TERMINAL_PAGE_STATUSES: JobPageStatus[] = ["awaiting_review", "failed", "blocked", "skipped", "cancelled"];

export interface JobRow {
  id: string;
  chapter_id: string;
  status: JobStatus;
  page_numbers: number[];
  settings: GenerationSettings;
  budget_usd: number;
  spent_estimate_usd: number;
  spent_reported_usd: number;
  is_test: boolean;
  idempotency_key: string | null;
  error: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface JobPageRow {
  id: string;
  job_id: string;
  chapter_id: string;
  page: number;
  position: number;
  status: JobPageStatus;
  phase: "generate" | "validate";
  attempts: number;
  max_attempts: number;
  next_attempt_at: Date | null;
  lease_owner: string | null;
  lease_until: Date | null;
  current_version_id: string | null;
  last_error: string | null;
  updated_at: Date;
  options?: PageRunOptions;
}

/** Choices made on the Generate screen for one page, used for that run only. */
export interface PageRunOptions {
  /** characterId -> repository path of the sheet to attach instead of the prompt's default. */
  sheets?: Record<string, string>;
  /** Edited prompt text for this run. Never written back to the repository. */
  promptOverride?: string;
  /** Owner confirmed the edited prompt may differ from the script's dialogue. */
  allowScriptDrift?: boolean;
}

export interface AttemptRow {
  id: string;
  job_id: string;
  job_page_id: string;
  chapter_id: string;
  page: number;
  attempt_no: number;
  kind: "image" | "qa";
  status: "in_flight" | "succeeded" | "failed" | "abandoned";
  model: string;
  blob_path: string;
  cost_estimate_usd: number;
  cost_reported_usd: number | null;
  reference_manifest: unknown;
  started_at: Date;
  finished_at: Date | null;
}

export interface VersionRow {
  id: string;
  chapter_id: string;
  page: number;
  job_id: string | null;
  attempt_id: string | null;
  source: "generated" | "upload";
  blob_path: string;
  sha256: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  prompt_path: string | null;
  prompt_sha256: string | null;
  model: string | null;
  reference_manifest: unknown;
  settings: unknown;
  qa: unknown;
  qa_status: "pending" | "pass" | "uncertain" | "fail";
  qa_confidence: number | null;
  retry_count: number;
  cost_estimate_usd: number;
  review_status: "awaiting_review" | "approved" | "rejected" | "auto_rejected" | "superseded";
  publication_status: "unpublished" | "pr_open" | "published";
  publication_id: string | null;
  alt_text: string | null;
  review_note: string | null;
  created_at: Date;
  reviewed_at: Date | null;
  prompt_edited?: boolean;
  uploaded_by?: string | null;
  replaces_art?: boolean;
}

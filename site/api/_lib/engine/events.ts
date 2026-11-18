import type { Db } from "../db/client.js";
import type { LogLevel } from "../log.js";
import { redactString, sanitize } from "../log.js";

/** Sanitised, queryable job log shown in the studio. */
export async function logEvent(
  db: Db,
  at: Date,
  e: { jobId?: string | null; chapterId?: string | null; page?: number | null; level: LogLevel; message: string; data?: Record<string, unknown> },
) {
  await db.query(`INSERT INTO event_log (job_id, chapter_id, page, level, message, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
    e.jobId ?? null,
    e.chapterId ?? null,
    e.page ?? null,
    e.level,
    redactString(e.message),
    e.data ? JSON.stringify(sanitize(e.data)) : null,
    at,
  ]);
}

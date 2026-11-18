import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setStudioSetting } from "../../api/_lib/engine/jobs.ts";
import { runWorkerStep } from "../../api/_lib/engine/worker.ts";
import { api, createHarness, drain, fakePage, type Harness, login } from "../helpers/harness.ts";

async function setup() {
  const h = await createHarness();
  const call = api(h, await login(h));
  await setStudioSetting(h.deps, "real_generation_verified", true);
  return { h, call };
}

describe("retries, failures and recovery", () => {
  let h: Harness;
  let call: ReturnType<typeof api>;
  beforeEach(async () => ({ h, call } = await setup()));
  afterEach(async () => h.db.close?.());

  it("retries a server error with backoff and succeeds on the next attempt", async () => {
    h.images.script = [{ status: 500, message: "upstream exploded" }, "ok"];
    const job = await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true });
    const first = await runWorkerStep(h.deps);
    expect(first.outcome).toBe("retry");
    const jp = (await h.db.query<{ status: string; next_attempt_at: Date }>(`SELECT status, next_attempt_at FROM job_pages`))[0]!;
    expect(jp.status).toBe("retry_wait");
    expect(new Date(jp.next_attempt_at).getTime()).toBeGreaterThan(h.clock.now().getTime());
    // Not runnable until the backoff passes.
    expect((await runWorkerStep(h.deps)).worked).toBe(false);
    await drain(h);
    const d = await call("GET", `/jobs/${job.data.job.id}`);
    expect(d.data.job.status).toBe("completed");
    expect(d.data.pages[0].attempts).toBe(2);
    // The failed request was answered by OpenAI, so its reserved estimate was released.
    const attempts = await h.db.query<{ status: string }>(`SELECT status FROM generation_attempts ORDER BY attempt_no`);
    expect(attempts.map((a) => a.status)).toEqual(["failed", "succeeded"]);
  });

  it("does not spend an attempt on rate limits and honours Retry-After", async () => {
    h.images.script = [{ status: 429, message: "slow down", headers: { "retry-after": "40" } }, "ok"];
    await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true });
    expect((await runWorkerStep(h.deps)).outcome).toBe("rate_limited");
    const jp = (await h.db.query<{ attempts: number; next_attempt_at: Date }>(`SELECT attempts, next_attempt_at FROM job_pages`))[0]!;
    expect(jp.attempts).toBe(0);
    expect(new Date(jp.next_attempt_at).getTime() - h.clock.now().getTime()).toBeGreaterThanOrEqual(40_000);
    await drain(h);
    expect(h.images.calls).toHaveLength(2);
  });

  it("regenerates automatically when QA finds a clear failure, then passes", async () => {
    h.qa.script = [{ panelCount: 3, unexpectedPeople: ["a stranger by the window"] }];
    const job = await call("POST", "/jobs", { chapterId: "001", pages: [22], confirmPaid: true });
    const outcomes = await drain(h);
    expect(outcomes).toEqual(["22:generated", "22:qa_retry", "22:generated", "22:pass"]);
    const versions = await h.db.query<{ qa_status: string; review_status: string }>(`SELECT qa_status, review_status FROM page_versions ORDER BY created_at`);
    expect(versions.map((v) => `${v.qa_status}/${v.review_status}`)).toEqual(["fail/auto_rejected", "pass/awaiting_review"]);
    const failedQa = (await h.db.query<{ qa: { reasons: string[] } }>(`SELECT qa FROM page_versions WHERE qa_status = 'fail'`))[0]!;
    expect(failedQa.qa.reasons.join(" ")).toMatch(/panel count/);
    expect(failedQa.qa.reasons.join(" ")).toMatch(/stranger/);
    expect((await call("GET", `/jobs/${job.data.job.id}`)).data.job.status).toBe("completed");
  });

  it("flags uncertain results for review instead of claiming success", async () => {
    h.qa.script = [{ likeness: [{ name: "Ethan", score: 0.55, notes: "beard shorter" }, { name: "Ruby", score: 0.9, notes: "" }], overallConfidence: 0.6 }];
    await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true });
    await drain(h);
    const v = (await h.db.query<{ qa_status: string; qa: { disclaimer: string } }>(`SELECT qa_status, qa FROM page_versions`))[0]!;
    expect(v.qa_status).toBe("uncertain");
    expect(v.qa.disclaimer).toMatch(/approximate/);
    const page = await call("GET", "/chapters/001");
    expect(page.data.pages.find((p: { page: number }) => p.page === 21).status).toBe("needs_attention");
  });

  it("keeps going after one page fails for good, without restarting the chapter", async () => {
    h.images.script = [{ status: 400, code: "moderation_blocked", message: "Request rejected by the safety system" }];
    const job = await call("POST", "/jobs", { chapterId: "001", pages: [21, 22], confirmPaid: true });
    await drain(h);
    const d = await call("GET", `/jobs/${job.data.job.id}`);
    expect(d.data.pages.map((p: { status: string }) => p.status)).toEqual(["failed", "awaiting_review"]);
    expect(d.data.job.status).toBe("completed_with_issues");
    expect(h.images.calls).toHaveLength(2); // page 21 was not retried after a safety rejection
  });

  it("stops at the attempt limit", async () => {
    h.images.script = [{ status: 503, message: "a" }, { status: 503, message: "b" }, { status: 503, message: "c" }];
    await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true, settings: { maxAttemptsPerPage: 3 } });
    await drain(h);
    const jp = (await h.db.query<{ status: string; attempts: number }>(`SELECT status, attempts FROM job_pages`))[0]!;
    expect(jp).toMatchObject({ status: "failed", attempts: 3 });
    expect(h.images.calls).toHaveLength(3);
  });

  it("pauses the whole job on an authentication error so nothing else is attempted", async () => {
    h.images.script = [{ status: 401, message: "Incorrect API key" }];
    const job = await call("POST", "/jobs", { chapterId: "001", pages: [21, 22], confirmPaid: true });
    await drain(h);
    const d = await call("GET", `/jobs/${job.data.job.id}`);
    expect(d.data.job.status).toBe("blocked");
    expect(d.data.job.error).toMatch(/API key/);
    expect(d.data.pages[0].attempts).toBe(0);
    expect(h.images.calls).toHaveLength(1);
    const resumed = await call("POST", `/jobs/${job.data.job.id}/resume`);
    expect(resumed.status).toBe(200);
    await drain(h);
    expect((await call("GET", `/jobs/${job.data.job.id}`)).data.job.status).toBe("completed");
  });

  it("stops automatically before passing the job budget", async () => {
    const job = await call("POST", "/jobs", { chapterId: "001", pages: [21, 22, 23, 24], confirmPaid: true, budgetUsd: 0.6 });
    await drain(h);
    const d = await call("GET", `/jobs/${job.data.job.id}`);
    expect(d.data.job.status).toBe("budget_exceeded");
    expect(d.data.job.spent_estimate_usd).toBeLessThanOrEqual(0.6);
    expect(h.images.calls.length).toBeLessThan(4);
    const resume = await call("POST", `/jobs/${job.data.job.id}/resume`);
    expect(resume.status).toBe(409);
    expect((await call("POST", `/jobs/${job.data.job.id}/budget`, { budgetUsd: 3 })).status).toBe(200);
    expect((await call("POST", `/jobs/${job.data.job.id}/resume`)).status).toBe(200);
    await drain(h);
    expect((await call("GET", `/jobs/${job.data.job.id}`)).data.job.status).toBe("completed");
  });

  it("supports pause, resume and cancel", async () => {
    const job = await call("POST", "/jobs", { chapterId: "001", pages: [21, 22, 23], confirmPaid: true });
    const id = job.data.job.id;
    await runWorkerStep(h.deps); // page 21 generated
    expect((await call("POST", `/jobs/${id}/pause`)).status).toBe(200);
    expect((await runWorkerStep(h.deps)).worked).toBe(false);
    expect((await call("POST", `/jobs/${id}/resume`)).status).toBe(200);
    await runWorkerStep(h.deps); // page 21 validated
    expect((await call("POST", `/jobs/${id}/cancel`)).status).toBe(200);
    expect((await runWorkerStep(h.deps)).worked).toBe(false);
    const d = await call("GET", `/jobs/${id}`);
    expect(d.data.job.status).toBe("cancelled");
    expect(d.data.pages.map((p: { status: string }) => p.status)).toEqual(["awaiting_review", "cancelled", "cancelled"]);
  });

  it("prevents duplicate jobs and honours idempotency keys", async () => {
    const a = await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true }, { "idempotency-key": "click-0001-abcdef" });
    const again = await call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true }, { "idempotency-key": "click-0001-abcdef" });
    expect(again.status).toBe(200);
    expect(again.data.job.id).toBe(a.data.job.id);
    const dup = await call("POST", "/jobs", { chapterId: "001", pages: [22], confirmPaid: true });
    expect(dup.status).toBe(409);
    expect(dup.data.error.details.code).toBe("duplicate_job");
  });

  it("regenerates a single page inside the active job", async () => {
    const job = await call("POST", "/jobs", { chapterId: "001", pages: [21, 22], confirmPaid: true });
    await drain(h);
    expect(h.images.calls).toHaveLength(2);
    const res = await call("POST", "/chapters/001/pages/21/regenerate", { confirmPaid: true });
    expect(res.status).toBe(202);
    await drain(h);
    expect(h.images.calls).toHaveLength(3);
    const versions = await h.db.query(`SELECT id FROM page_versions WHERE page = 21`);
    expect(versions).toHaveLength(2);
    expect(res.data.jobId).not.toBe(job.data.job.id); // finished job -> new single-page job
  });
});

describe("persistence across restarts", () => {
  it("resumes a queued job with a fresh process and the same database", async () => {
    const a = await setup();
    const job = await a.call("POST", "/jobs", { chapterId: "001", pages: [21, 22, 23], confirmPaid: true });
    await runWorkerStep(a.h.deps); // 21 generated
    await runWorkerStep(a.h.deps); // 21 validated
    // "Deploy": new app instance, new worker id, new providers; same Postgres and Blob store.
    const b = await createHarness({}, { db: a.h.db, blobs: a.h.blobs, workerId: "worker-b" });
    b.clock.t = a.h.clock.t;
    await drain(b);
    const call = api(b, await login(b));
    const d = await call("GET", `/jobs/${job.data.job.id}`);
    expect(d.data.job.status).toBe("completed");
    expect(a.h.images.calls).toHaveLength(1);
    expect(b.images.calls).toHaveLength(2);
    await a.h.db.close?.();
  });

  it("recovers a worker that died before saving the image (attempt counted, page retried)", async () => {
    const a = await setup();
    a.h.images.script = [() => new Promise<Buffer>(() => undefined)]; // hangs forever: process "dies"
    await a.call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true });
    void runWorkerStep(a.h.deps);
    await new Promise((r) => setTimeout(r, 1500));
    const b = await createHarness({}, { db: a.h.db, blobs: a.h.blobs, workerId: "worker-b" });
    b.clock.t = a.h.clock.t + 300_000; // lease expired
    await drain(b);
    const attempts = await a.h.db.query<{ status: string }>(`SELECT status FROM generation_attempts ORDER BY attempt_no`);
    expect(attempts.map((x) => x.status)).toEqual(["abandoned", "succeeded"]);
    const jp = (await a.h.db.query<{ status: string; attempts: number }>(`SELECT status, attempts FROM job_pages`))[0]!;
    expect(jp).toMatchObject({ status: "awaiting_review", attempts: 2 });
    await a.h.db.close?.();
  });

  it("adopts an image saved just before a crash instead of paying for it again", async () => {
    const a = await setup();
    a.h.images.script = [
      async () => {
        const row = (await a.h.db.query<{ blob_path: string }>(`SELECT blob_path FROM generation_attempts WHERE status = 'in_flight'`))[0]!;
        await a.h.blobs.put(row.blob_path, await fakePage("P21"), "image/png");
        return new Promise<Buffer>(() => undefined); // dies after the upload
      },
    ];
    await a.call("POST", "/jobs", { chapterId: "001", pages: [21], confirmPaid: true });
    void runWorkerStep(a.h.deps);
    await new Promise((r) => setTimeout(r, 2500));
    const b = await createHarness({}, { db: a.h.db, blobs: a.h.blobs, workerId: "worker-b" });
    b.clock.t = a.h.clock.t + 300_000;
    await drain(b);
    expect(b.images.calls).toHaveLength(0);
    const v = await a.h.db.query<{ qa_status: string }>(`SELECT qa_status FROM page_versions`);
    expect(v).toHaveLength(1);
    expect(v[0]!.qa_status).toBe("pass");
    await a.h.db.close?.();
  });
});

// Dashboard, batch generation and the job monitor.
import { get, post } from "../api.js";
import { act, announceOnce, costExplainer, crumbs, errorBox, head, poll, redraw, render, section, stopPolling } from "../shared.js";
import { alertMessage, badge, clear, confirmDialog, field, h, label, notice, pad3, progress, usd, when } from "../ui.js";

export async function dashboardView() {
  const [d, spend] = await Promise.all([get("/dashboard"), get("/spending").catch(() => null)]);
  const warnings = [];
  if (d.missingConfig?.length) warnings.push(notice("error", h("p", {}, h("strong", {}, "Setup needed. "), `Missing: ${d.missingConfig.join(", ")}. See docs/studio/SETUP.md.`)));
  if (!d.generationEnabled)
    warnings.push(
      notice(
        "warn",
        h("p", {}, h("strong", {}, "Paid generation is off. "), "Nothing here can spend money until STUDIO_GENERATION_ENABLED is set to true in Vercel. Generating uses OpenAI API credit, which is separate from ChatGPT Plus. Uploading pages you made in ChatGPT works either way."),
      ),
    );
  if (d.generationEnabled && !d.realGenerationVerified) warnings.push(notice("info", h("p", {}, "Run one test page first. After you approve it, multi-page runs unlock.")));
  const thisMonth = spend?.byMonth?.at(-1);
  render(
    head("Dashboard", "Where every chapter stands, what it has cost, and what needs you."),
    ...warnings,
    h(
      "ul",
      { class: "card-list", "aria-label": "Chapters" },
      ...d.chapters.map((c) =>
        h(
          "li",
          { class: "card" },
          h("p", { class: "eyebrow" }, c.arcTitle ? `Arc: ${c.arcTitle}` : "Chapter"),
          h("h2", {}, h("a", { href: `#/chapters/${c.id}` }, `Chapter ${c.id}: ${c.title}`)),
          progress(c.doneCount, c.plannedPages, `${c.doneCount} of ${c.plannedPages} pages have art`),
          h("p", { class: "small" }, `${c.counts.awaiting_review + c.counts.needs_attention} to review, ${c.counts.failed + c.counts.blocked} need attention, ${c.counts.ready} without art.`),
        ),
      ),
      h(
        "li",
        { class: "card" },
        h("p", { class: "eyebrow" }, "API spending"),
        h("h2", {}, h("a", { href: "#/spending" }, thisMonth ? `This month: ${usd(thisMonth.reportedUsd || thisMonth.estimateUsd)}` : "Spending")),
        thisMonth ? h("p", { class: "small" }, `${thisMonth.imageAttempts} image request(s), ${thisMonth.pagesUsed} of ${thisMonth.pagesGenerated} generated pages kept.`) : null,
        spend?.flags?.length ? h("p", { class: "small" }, `${spend.flags.length} page(s) took many tries. `, h("a", { href: "#/spending" }, "See which")) : null,
      ),
    ),
    section(
      "Needs attention",
      "attention-title",
      d.attention.length || d.blockedJobs.length
        ? h(
            "ul",
            { class: "log" },
            ...d.blockedJobs.map((j) => h("li", {}, badge(j.status), " ", h("a", { href: `#/jobs/${j.id}` }, `Chapter ${j.chapter_id} run`), `: ${j.error ?? ""}`)),
            ...d.attention.map((a) => h("li", {}, badge(a.status), " ", h("a", { href: `#/chapters/${a.chapter_id}/pages/${a.page}` }, `Chapter ${a.chapter_id}, page ${pad3(a.page)}`), a.last_error ? `: ${a.last_error}` : "")),
          )
        : h("p", { class: "muted" }, "Nothing needs you right now."),
    ),
    section("Recent runs", "jobs-title", jobsTable(d.jobs)),
  );
}

function jobsTable(jobs) {
  if (!jobs.length) return h("p", { class: "muted" }, "No runs yet.");
  return h(
    "div",
    { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Recent runs" },
    h(
      "table",
      {},
      h("caption", { class: "visually-hidden" }, "Recent generation runs"),
      h("thead", {}, h("tr", {}, ["Started", "Chapter", "Pages", "Status", "Progress", "Spent (est.)"].map((t) => h("th", { scope: "col" }, t)))),
      h(
        "tbody",
        {},
        ...jobs.map((j) =>
          h(
            "tr",
            {},
            h("td", {}, h("a", { href: `#/jobs/${j.id}` }, when(j.created_at))),
            h("td", {}, j.chapter_id),
            h("td", {}, j.page_numbers.map(pad3).join(", "), j.is_test ? " (test)" : ""),
            h("td", {}, badge(j.status)),
            h("td", {}, `${j.done} of ${j.total}`),
            h("td", {}, `${usd(j.spent_estimate_usd)} of ${usd(j.budget_usd)}`),
          ),
        ),
      ),
    ),
  );
}

export async function studioView(chapterId) {
  const { chapters } = await get("/chapters");
  const id = chapterId || chapters[0]?.id;
  if (!id) return render(head("Generate", "No chapters configured."));
  const c = await get(`/chapters/${id}`);
  if (c.latestJob && ["queued", "running", "paused", "blocked", "budget_exceeded"].includes(c.latestJob.status)) {
    window.location.replace(`#/jobs/${c.latestJob.id}`);
    return;
  }
  const selectable = (p) => p.prepared && !p.locked && !["queued", "generating", "checking", "retrying"].includes(p.status);
  const select = h("select", { id: "chapter-select" }, ...chapters.map((ch) => h("option", { value: ch.id, selected: ch.id === id }, `${ch.id}: ${ch.title}`)));
  select.addEventListener("change", () => (window.location.hash = `#/studio/${select.value}`));
  const boxes = c.pages.map((p) => {
    const ok = selectable(p);
    const input = h("input", { type: "checkbox", value: String(p.page), checked: ok && p.status === "ready", disabled: !ok, id: `pg-${p.page}` });
    const note = !ok ? (p.locked ? "locked" : !p.prepared ? "not prepared" : p.statusLabel.toLowerCase()) : p.status !== "ready" ? p.statusLabel.toLowerCase() : null;
    return { input, p, el: h("label", { for: `pg-${p.page}` }, input, h("span", {}, `Page ${p.label}`), note ? h("span", { class: "small muted" }, ` (${note})`) : null) };
  });
  const quality = h("select", { id: "gen-quality" }, ...["low", "medium", "high", "xhigh", "max"].map((q) => h("option", { value: q, selected: (c.settings.overrides.quality ?? c.settings.defaults.quality) === q }, q)));
  const budget = h("input", { type: "number", min: "0.5", max: "200", step: "0.5", value: String(c.settings.overrides.budgetUsdPerJob ?? c.settings.defaults.budgetUsdPerJob) });
  const estimateBox = h("div", { class: "panel", "aria-live": "polite" }, h("p", {}, "Choose pages to see the estimate."));
  const testMode = !c.realGenerationVerified;
  const start = h("button", { class: "btn btn-primary", type: "button" }, testMode ? "Run one test page" : "Generate selected pages");
  const selected = () => boxes.filter((b) => b.input.checked).map((b) => Number(b.input.value));

  let estimateTimer;
  const refreshEstimate = () => {
    window.clearTimeout(estimateTimer);
    estimateTimer = window.setTimeout(async () => {
      const pages = testMode ? selected().slice(0, 1) : selected();
      if (!pages.length) return clear(estimateBox).append(h("p", {}, "Choose at least one page."));
      try {
        const e = await post("/estimate", { chapterId: id, pages, settings: { quality: quality.value } });
        clear(estimateBox).append(
          h("h2", {}, "Estimated cost"),
          h("p", { class: "stat" }, usd(e.estimate.expectedUsd)),
          h("p", {}, `For ${e.estimate.pages} page(s) with ${e.settings.imageModel} at ${e.settings.quality} quality, allowing for some retries. If every page used all ${e.settings.maxAttemptsPerPage} attempts: ${usd(e.estimate.worstCaseUsd)}. The run stops at your budget.`),
          costExplainer(e.cost),
          h("details", {}, h("summary", {}, "How this is estimated"), h("ul", { class: "small" }, ...e.estimate.assumptions.map((a) => h("li", {}, a)))),
          e.eligibility.some((x) => !x.eligible) ? notice("warn", h("ul", {}, ...e.eligibility.filter((x) => !x.eligible).map((x) => h("li", {}, `Page ${pad3(x.page)}: ${x.reason}`)))) : null,
        );
      } catch (err) {
        clear(estimateBox).append(notice("error", h("p", {}, err.message)));
      }
    }, 300);
  };
  boxes.forEach((b) => b.input.addEventListener("change", refreshEstimate));
  quality.addEventListener("change", refreshEstimate);

  start.addEventListener("click", async () => {
    let pages = selected();
    if (testMode) pages = pages.slice(0, 1);
    if (!pages.length) return alertMessage("Choose at least one page.");
    const replacing = pages.filter((n) => boxes.find((b) => b.p.page === n)?.p.hasArt);
    const ok = await confirmDialog({
      title: testMode ? `Run a test on page ${pad3(pages[0])}?` : `Generate ${pages.length} page(s)?`,
      body: h(
        "div",
        {},
        h("p", {}, `This starts paid OpenAI requests for page(s) ${pages.map(pad3).join(", ")}, billed to your API credit (not ChatGPT Plus), with a budget of ${usd(Number(budget.value))}.`),
        replacing.length ? h("p", {}, `Pages ${replacing.map(pad3).join(", ")} already have art. That art stays unless you choose a new version later.`) : null,
        h("p", {}, "It keeps running after you close this tab. Nothing is published until you approve and publish pages."),
      ),
      confirmLabel: "Start paid generation",
    });
    if (!ok) return;
    const key = `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await act(start, () => post("/jobs", { chapterId: id, pages, settings: { quality: quality.value }, budgetUsd: Number(budget.value), test: testMode, confirmPaid: true }, { "Idempotency-Key": key }), "Run started.").catch(() => null);
    if (res) window.location.hash = `#/jobs/${res.job.id}`;
  });

  render(
    head("Generate pages", "Queue several pages at once. To pick outfits or edit a prompt, open the page from its chapter instead."),
    !c.generationEnabled ? notice("warn", h("p", {}, "Paid generation is switched off on the server (STUDIO_GENERATION_ENABLED), so starting a run will be refused. Estimates still work.")) : null,
    testMode ? notice("info", h("p", {}, h("strong", {}, "Test first. "), "The first run generates only the first selected page. Approve it on Review to unlock multi-page runs.")) : null,
    errorBox(),
    h("div", { class: "field narrow" }, h("label", { for: "chapter-select" }, "Chapter"), select),
    h(
      "fieldset",
      {},
      h("legend", {}, "Pages"),
      h("p", { class: "small muted" }, "Pages without art are selected. Pages that already have art can be added for a new version. Pages run in order, one at a time."),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn btn-small", type: "button", onclick: () => { boxes.forEach((b) => (b.input.checked = !b.input.disabled && b.p.status === "ready")); refreshEstimate(); } }, "Select pages without art"),
        h("button", { class: "btn btn-small", type: "button", onclick: () => { boxes.forEach((b) => (b.input.checked = false)); refreshEstimate(); } }, "Clear"),
      ),
      h("div", { class: "check-grid" }, ...boxes.map((b) => b.el)),
    ),
    h("div", { class: "form-grid" }, field({ id: "gen-quality", label: "Quality", input: quality, hint: "The image model's render quality. Higher costs more." }), field({ id: "gen-budget", label: "Budget for this run (USD, API credit)", input: budget, hint: "The run stops before any request that would pass this amount." })),
    estimateBox,
    h("div", { class: "btn-row" }, start),
  );
  refreshEstimate();
}

export async function jobView(jobId) {
  const draw = async (first) => {
    const d = await get(`/jobs/${jobId}`);
    const j = d.job;
    const done = d.pages.filter((p) => ["awaiting_review", "failed", "blocked", "skipped", "cancelled"].includes(p.status)).length;
    const pause = h("button", { class: "btn", type: "button", id: "job-pause" }, "Pause");
    const resume = h("button", { class: "btn btn-primary", type: "button", id: "job-resume" }, "Resume");
    const cancel = h("button", { class: "btn btn-danger", type: "button", id: "job-cancel" }, "Cancel run");
    pause.addEventListener("click", () => act(pause, () => post(`/jobs/${jobId}/pause`), "Paused.").then(() => draw()).catch(() => undefined));
    resume.addEventListener("click", () => act(resume, () => post(`/jobs/${jobId}/resume`), "Resumed.").then(() => draw()).catch(() => undefined));
    cancel.addEventListener("click", async () => {
      if (await confirmDialog({ title: "Cancel this run?", body: h("p", {}, "Pages still waiting are cancelled. Finished pages stay available for review."), confirmLabel: "Cancel run", danger: true })) {
        act(cancel, () => post(`/jobs/${jobId}/cancel`), "Cancelled.").then(() => draw()).catch(() => undefined);
      }
    });
    const budgetInput = h("input", { type: "number", min: String(j.budget_usd + 0.5), max: "200", step: "0.5", value: String(Math.min(200, j.budget_usd * 2)) });
    const raise = h("button", { class: "btn", type: "button" }, "Raise budget");
    raise.addEventListener("click", () => act(raise, () => post(`/jobs/${jobId}/budget`, { budgetUsd: Number(budgetInput.value) }), "Budget raised.").then(() => draw()).catch(() => undefined));
    const active = ["queued", "running"].includes(j.status);
    const statusLine = `Run ${label(j.status)}: ${done} of ${d.pages.length} pages finished.`;
    const content = [
      crumbs(["Generate", `#/studio/${j.chapter_id}`], ["Run"]),
      head(`Chapter ${j.chapter_id} run`, `Started ${when(j.created_at)}${j.is_test ? " · single test page" : ""} · ${j.settings.imageModel}, ${j.settings.quality} quality`, active ? pause : null, ["paused", "blocked", "budget_exceeded"].includes(j.status) ? resume : null, ["queued", "running", "paused", "blocked", "budget_exceeded"].includes(j.status) ? cancel : null),
      errorBox(),
      h("p", {}, badge(j.status), " ", statusLine),
      j.error ? notice(j.status === "blocked" ? "error" : "warn", h("p", {}, j.error)) : null,
      j.status === "budget_exceeded" ? h("div", { class: "inline-form" }, field({ id: "raise-budget", label: "New budget (USD)", input: budgetInput }), raise) : null,
      progress(done, d.pages.length),
      h("p", { class: "small" }, `Spent so far: ${usd(j.spent_estimate_usd)} estimated of a ${usd(j.budget_usd)} budget. From reported usage: ${j.spent_reported_usd ? usd(j.spent_reported_usd) : "not reported yet"}.`),
      h(
        "div",
        { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Page progress" },
        h(
          "table",
          {},
          h("caption", { class: "visually-hidden" }, "Pages in this run"),
          h("thead", {}, h("tr", {}, ["Page", "Status", "Attempts", "Notes"].map((t) => h("th", { scope: "col" }, t)))),
          h(
            "tbody",
            {},
            ...d.pages.map((p) =>
              h(
                "tr",
                {},
                h("th", { scope: "row" }, h("a", { href: `#/chapters/${j.chapter_id}/pages/${p.page}` }, `Page ${pad3(p.page)}`)),
                h("td", {}, badge(p.status === "queued" && p.phase === "validate" ? "checking" : p.status, p.status === "queued" && p.phase === "validate" ? "Checking" : label(p.status))),
                h("td", {}, `${p.attempts} of ${p.max_attempts}`),
                h("td", { class: "small" }, p.last_error ?? ""),
              ),
            ),
          ),
        ),
      ),
      h("div", { class: "btn-row" }, h("a", { class: "btn", href: `#/review/${j.chapter_id}` }, "Review pages"), done ? h("a", { class: "btn", href: `/api/studio/jobs/${jobId}/export`, download: "" }, "Export pages (ZIP)") : null),
      section(
        "Activity",
        "activity-title",
        h("ol", { class: "log", tabindex: "0", "aria-label": "Run activity, newest first" }, ...d.events.map((e) => h("li", {}, h("time", { datetime: new Date(e.created_at).toISOString() }, when(e.created_at)), e.level === "error" ? badge("failed", "Error") : e.level === "warn" ? badge("uncertain", "Note") : null, " ", e.message))),
      ),
    ];
    if (first) render(...content);
    else redraw(...content);
    announceOnce(statusLine);
    const finished = ["completed", "completed_with_issues", "cancelled"].includes(j.status);
    if (finished) stopPolling();
    return !finished;
  };
  const live = await draw(true);
  if (live) poll(() => draw(false));
}

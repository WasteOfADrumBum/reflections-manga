import { ApiError, get, post, put } from "./api.js";
import { alertMessage, announce, badge, clear, confirmDialog, field, h, label, notice, pad3, progress, usd, when } from "./ui.js";

const view = document.getElementById("view");
let pollTimer = null;
let lastAnnounced = "";

// ---------- routing ----------
const routes = [
  [/^#\/dashboard$/, dashboardView],
  [/^#\/characters$/, charactersView],
  [/^#\/chapters$/, chaptersView],
  [/^#\/chapters\/(\d{3})$/, chapterView],
  [/^#\/chapters\/(\d{3})\/pages\/(\d{1,3})$/, pageView],
  [/^#\/studio(?:\/(\d{3}))?$/, studioView],
  [/^#\/jobs\/([0-9a-f-]{36})$/, jobView],
  [/^#\/review(?:\/(\d{3}))?$/, reviewView],
];

async function route() {
  window.clearInterval(pollTimer);
  pollTimer = null;
  const hash = window.location.hash || "#/dashboard";
  const match = routes.map(([re, fn]) => [hash.match(re), fn]).find(([m]) => m);
  const section = hash.split("/")[1] || "dashboard";
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === (section === "jobs" ? "studio" : section)) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  view.setAttribute("aria-busy", "true");
  try {
    if (!match) {
      render(h("h1", { tabindex: "-1" }, "Page not found"), h("p", {}, h("a", { href: "#/dashboard" }, "Go to the dashboard")));
    } else {
      const [m, fn] = match;
      await fn(...m.slice(1));
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    render(h("h1", { tabindex: "-1" }, "Something went wrong"), notice("error", h("p", {}, err.message || String(err))), h("p", {}, h("button", { class: "btn", type: "button", onclick: route }, "Try again")));
    alertMessage(err.message || "Something went wrong");
  } finally {
    view.setAttribute("aria-busy", "false");
  }
}

function render(...nodes) {
  clear(view).append(...nodes.flat().filter(Boolean));
  const heading = view.querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    document.title = `${heading.textContent} | Reflections Studio`;
    heading.focus({ preventScroll: false });
  }
}

function head(title, intro, ...actions) {
  return h("div", { class: "view-head" }, h("div", {}, h("h1", {}, title), intro ? h("p", {}, intro) : null), actions.length ? h("div", { class: "btn-row" }, ...actions) : null);
}

function crumbs(...items) {
  return h("nav", { class: "breadcrumbs", "aria-label": "Breadcrumb" }, h("ol", {}, items.map(([text, href]) => h("li", {}, href ? h("a", { href }, text) : h("span", { "aria-current": "page" }, text)))));
}

function poll(fn, ms = 5000) {
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") fn().catch(() => undefined);
  }, ms);
}

function announceOnce(message) {
  if (message && message !== lastAnnounced) {
    lastAnnounced = message;
    announce(message);
  }
}

async function act(button, fn, success) {
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const out = await fn();
    if (success) announce(typeof success === "function" ? success(out) : success);
    return out;
  } catch (err) {
    alertMessage(err.message);
    const box = document.getElementById("action-error");
    if (box) {
      box.hidden = false;
      box.textContent = err.message;
    }
    throw err;
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = original;
  }
}

const errorBox = () => h("div", { id: "action-error", class: "notice notice-error", role: "alert", hidden: true });

// ---------- dashboard ----------
async function dashboardView() {
  const d = await get("/dashboard");
  const warnings = [];
  if (d.missingConfig?.length) warnings.push(notice("error", h("p", {}, h("strong", {}, "Setup needed. "), `Missing: ${d.missingConfig.join(", ")}. See docs/studio/SETUP.md.`)));
  if (!d.generationEnabled) warnings.push(notice("warn", h("p", {}, h("strong", {}, "Paid generation is off. "), "Set STUDIO_GENERATION_ENABLED=true in the Vercel project when you are ready to spend API credit.")));
  if (d.generationEnabled && !d.realGenerationVerified) warnings.push(notice("info", h("p", {}, "Run one test page first. After you approve it, full-chapter jobs unlock.")));
  const usage = d.usage || {};
  render(
    head("Production dashboard", "Chapters, jobs, spending and anything that needs you."),
    ...warnings,
    h(
      "div",
      { class: "cards" },
      ...d.chapters.map((c) =>
        h(
          "section",
          { class: "card", "aria-labelledby": `ch-${c.id}` },
          h("h2", { id: `ch-${c.id}` }, `Chapter ${c.id}: ${c.title}`),
          h("p", { class: "muted small" }, c.arcTitle ? `Arc: ${c.arcTitle}` : ""),
          progress(c.counts.published + c.counts.locked + c.counts.approved, c.plannedPages, `${c.completionPercent}% complete (${c.plannedPages} pages planned)`),
          h("p", { class: "small" }, `${c.counts.ready} ready to generate, ${c.counts.awaiting_review + c.counts.needs_attention} awaiting review, ${c.counts.failed + c.counts.blocked} need attention.`),
          h("div", { class: "btn-row" }, h("a", { class: "btn btn-small btn-primary", href: `#/studio/${c.id}` }, "Generate"), h("a", { class: "btn btn-small", href: `#/chapters/${c.id}` }, "Open chapter")),
        ),
      ),
      h(
        "section",
        { class: "card", "aria-labelledby": "usage-title" },
        h("h2", { id: "usage-title" }, `API spending, ${usage.month}`),
        h("p", { class: "stat" }, usd(usage.estimate)),
        h("p", { class: "small" }, `Estimated from ${usage.attempts} image request(s). Calculated from usage OpenAI reported: ${usage.reported_count ? usd(usage.reported) : "none yet"}.`),
        h("p", { class: "small muted" }, "These are estimates, not invoice amounts. Your OpenAI billing page is authoritative."),
      ),
    ),
    h("h2", {}, "Jobs"),
    jobsTable(d.jobs),
    h("h2", {}, "Needs attention"),
    d.attention.length || d.blockedJobs.length
      ? h(
          "ul",
          { class: "log" },
          ...d.blockedJobs.map((j) => h("li", {}, badge(j.status), " ", h("a", { href: `#/jobs/${j.id}` }, `Chapter ${j.chapter_id} job`), `: ${j.error ?? ""}`)),
          ...d.attention.map((a) => h("li", {}, badge(a.status), " ", h("a", { href: `#/chapters/${a.chapter_id}/pages/${a.page}` }, `Chapter ${a.chapter_id}, page ${pad3(a.page)}`), a.last_error ? `: ${a.last_error}` : "")),
        )
      : h("p", {}, "Nothing needs you right now."),
  );
}

function jobsTable(jobs) {
  if (!jobs.length) return h("p", {}, "No jobs yet. ", h("a", { href: "#/studio" }, "Start one."));
  return h(
    "div",
    { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Jobs" },
    h(
      "table",
      {},
      h("caption", { class: "visually-hidden" }, "Recent generation jobs"),
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

// ---------- characters ----------
async function charactersView() {
  const { characters, uploads } = await get("/characters");
  const chapters = (await get("/chapters")).chapters;
  const form = h(
    "form",
    { class: "card form-card", id: "upload-form" },
    h("h2", {}, "Add a reference"),
    h("p", { class: "small" }, "Uploads start as experimental. Approve an outfit or location reference to attach it automatically to matching pages. Canonical identity sheets come only from the repository and are never replaced by uploads."),
    h(
      "div",
      { class: "form-grid" },
      field({ id: "ref-file", label: "Image (PNG, JPEG or WebP, under 4 MB)", input: h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: true }) }),
      field({ id: "ref-label", label: "Label", input: h("input", { type: "text", name: "label", required: true, minlength: "3", maxlength: "120" }), hint: "For example: Ruby, pale lavender cardigan (day two)" }),
      field({
        id: "ref-kind",
        label: "Type",
        input: h("select", { name: "kind" }, h("option", { value: "outfit" }, "Outfit"), h("option", { value: "location" }, "Location"), h("option", { value: "experimental" }, "Experimental (never attached)")),
      }),
      field({ id: "ref-character", label: "Character", input: h("select", { name: "characterId" }, h("option", { value: "" }, "None (locations)"), ...characters.map((c) => h("option", { value: c.id }, c.displayName))) }),
      field({ id: "ref-chapter", label: "Limit to chapter", input: h("select", { name: "chapterId" }, h("option", { value: "" }, "All chapters"), ...chapters.map((c) => h("option", { value: c.id }, `${c.id}: ${c.title}`))) }),
      field({ id: "ref-pages", label: "Limit to pages", input: h("input", { type: "text", name: "pages", inputmode: "numeric", placeholder: "e.g. 28-30" }), hint: "Leave empty for every page." }),
    ),
    errorBox(),
    h("button", { class: "btn btn-primary", type: "submit" }, "Upload reference"),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");
    await act(btn, () => post("/references", new FormData(form)), "Reference uploaded as experimental.").then(() => charactersView()).catch(() => undefined);
  });

  render(
    head("Character library", "Discovered from characters/ in the repository. The canonical card is the image listed under “Current Card” in each references index."),
    h(
      "div",
      { class: "char-grid" },
      ...characters.map((c) =>
        h(
          "article",
          { class: "card char-card", "aria-labelledby": `c-${c.id}` },
          h("h2", { id: `c-${c.id}` }, c.displayName),
          c.canonicalSheet
            ? h("figure", {}, h("img", { src: `/api/studio/repo-image?thumb=1&path=${encodeURIComponent(c.canonicalSheet)}`, alt: `${c.displayName} canonical reference sheet`, loading: "lazy", width: "480", height: "320" }), h("figcaption", { class: "small" }, badge("approved", "Canonical"), " used first for every page this character appears on"))
            : notice("warn", h("p", {}, "No canonical sheet. Pages with this character are blocked until a “Current Card” is registered.")),
          h("p", { class: "small muted" }, `Profile: ${c.profilePath}`),
          c.references.length > 1
            ? h(
                "details",
                {},
                h("summary", {}, `Other sheets (${c.references.length - 1}, experimental)`),
                h(
                  "ul",
                  { class: "ref-list" },
                  ...c.references
                    .filter((r) => r.status !== "canonical")
                    .map((r) => h("li", {}, h("a", { href: `/api/studio/repo-image?path=${encodeURIComponent(r.path)}`, target: "_blank", rel: "noopener" }, r.name, h("span", { class: "visually-hidden" }, " (opens in a new tab)")), badge("pending", "Experimental"))),
                ),
              )
            : null,
        ),
      ),
    ),
    form,
    h("h2", {}, "Uploaded references"),
    uploads.length
      ? h(
          "div",
          { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Uploaded references" },
          h(
            "table",
            {},
            h("thead", {}, h("tr", {}, ["Image", "Label", "Type", "Scope", "Status", "Action"].map((t) => h("th", { scope: "col" }, t)))),
            h(
              "tbody",
              {},
              ...uploads.map((u) => {
                const next = u.status === "approved" ? "experimental" : "approved";
                const btn = h("button", { class: "btn btn-small", type: "button", disabled: u.kind === "experimental" && next === "approved" }, next === "approved" ? "Approve" : "Mark experimental");
                btn.addEventListener("click", () => act(btn, () => post(`/references/${u.id}/status`, { status: next }), `Reference marked ${next}.`).then(charactersView).catch(() => undefined));
                return h(
                  "tr",
                  {},
                  h("td", {}, h("img", { src: `/api/studio/references/${u.id}/image?thumb=1`, alt: u.label, width: "96", loading: "lazy" })),
                  h("td", {}, u.label),
                  h("td", {}, label(u.kind)),
                  h("td", {}, [u.character_id, u.chapter_id ? `chapter ${u.chapter_id}` : "all chapters", u.pages ? `pages ${u.pages.join(", ")}` : "all pages"].filter(Boolean).join(", ")),
                  h("td", {}, badge(u.status === "approved" ? "approved" : "pending", label(u.status))),
                  h("td", {}, btn),
                );
              }),
            ),
          ),
        )
      : h("p", {}, "None yet."),
  );
}

// ---------- chapters ----------
async function chaptersView() {
  const { chapters } = await get("/chapters");
  render(
    head("Chapters", "Arcs and chapters configured in production/studio/config.json."),
    h(
      "div",
      { class: "cards" },
      ...chapters.map((c) =>
        h(
          "article",
          { class: "card" },
          h("p", { class: "eyebrow" }, `Arc ${c.arcNumber}${c.arcTitle ? `: ${c.arcTitle}` : ""}`),
          h("h2", {}, h("a", { href: `#/chapters/${c.id}` }, `Chapter ${c.id}: ${c.title}`)),
          progress(c.counts.published + c.counts.locked + c.counts.approved, c.plannedPages, `${c.completionPercent}% complete`),
        ),
      ),
    ),
  );
}

function pageTile(chapterId, p) {
  const thumb = p.latestVersionId ? `/api/studio/assets/${p.latestVersionId}?thumb=1` : p.sourceImagePath ? `/api/studio/repo-image?thumb=1&path=${encodeURIComponent(p.sourceImagePath)}` : p.publishedSrc;
  return h(
    "li",
    { class: "page-tile" },
    h("a", { href: `#/chapters/${chapterId}/pages/${p.page}` }, `Page ${p.label}`),
    thumb ? h("img", { src: thumb, alt: "", loading: "lazy", width: "180", height: "270" }) : null,
    badge(p.status, p.statusLabel),
    p.scriptTitle ? h("span", { class: "small" }, p.scriptTitle) : null,
  );
}

async function chapterView(id) {
  const c = await get(`/chapters/${id}`);
  const overrides = c.settings.overrides || {};
  const defaults = c.settings.defaults;
  const quality = h("select", { name: "quality" }, ...["low", "medium", "high", "xhigh", "max"].map((q) => h("option", { value: q, selected: (overrides.quality ?? defaults.quality) === q }, q)));
  const attempts = h("input", { type: "number", name: "maxAttemptsPerPage", min: "1", max: "6", value: String(overrides.maxAttemptsPerPage ?? defaults.maxAttemptsPerPage) });
  const budget = h("input", { type: "number", name: "budgetUsdPerJob", min: "0.5", max: "200", step: "0.5", value: String(overrides.budgetUsdPerJob ?? defaults.budgetUsdPerJob) });
  const scene = h("input", { type: "number", name: "maxSceneReferences", min: "0", max: "4", value: String(overrides.maxSceneReferences ?? defaults.maxSceneReferences) });
  const form = h(
    "form",
    { class: "card form-card" },
    h("h2", {}, "Generation settings for this chapter"),
    h("p", { class: "small" }, "These change how pages are generated. They never change the script or prompts."),
    h(
      "div",
      { class: "form-grid" },
      field({ id: "set-quality", label: "Image quality", input: quality, hint: "Higher quality costs more per page." }),
      field({ id: "set-attempts", label: "Attempts per page", input: attempts }),
      field({ id: "set-budget", label: "Default budget per job (USD)", input: budget }),
      field({ id: "set-scene", label: "Scene reference pages", input: scene, hint: "Earlier pages attached for continuity, after the identity sheets." }),
    ),
    errorBox(),
    h("button", { class: "btn", type: "submit" }, "Save settings"),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const body = { quality: quality.value, maxAttemptsPerPage: Number(attempts.value), budgetUsdPerJob: Number(budget.value), maxSceneReferences: Number(scene.value) };
    act(form.querySelector("button"), () => put(`/chapters/${id}/settings`, body), "Settings saved.").catch(() => undefined);
  });
  render(
    crumbs(["Chapters", "#/chapters"], [`Chapter ${id}`]),
    head(`Chapter ${id}: ${c.title}`, `${c.completionPercent}% complete. Script: ${c.scriptPath}`, h("a", { class: "btn btn-primary", href: `#/studio/${id}` }, "Generate pages"), h("a", { class: "btn", href: `#/review/${id}` }, "Review and publish")),
    h("h2", {}, "Pages"),
    h("ul", { class: "page-grid", "aria-label": `Pages of chapter ${id}` }, ...c.pages.map((p) => pageTile(id, p))),
    form,
  );
}

// ---------- page detail ----------
function qaList(qa) {
  if (!qa || !qa.checks) return h("p", { class: "small muted" }, "Not checked yet.");
  return h(
    "div",
    {},
    h("ul", { class: "qa-list" }, ...qa.checks.map((c) => h("li", {}, badge(c.status === "pass" ? "pass" : c.status === "fail" ? "fail" : "uncertain", label(c.status)), h("strong", {}, c.name), h("span", { class: "small" }, c.detail)))),
    qa.visionSummary ? h("p", { class: "small" }, `Vision model: ${qa.visionSummary}`) : null,
    h("p", { class: "small muted" }, qa.disclaimer),
  );
}

function versionCard(v, { onChange, showActions = true, pageLocked = false }) {
  const alt = h("textarea", { name: "alt", rows: "4", maxlength: "1500" }, v.altText ?? "");
  const approveBtn = h("button", { class: "btn btn-small btn-primary", type: "button" }, "Approve");
  const rejectBtn = h("button", { class: "btn btn-small btn-danger", type: "button" }, "Reject");
  approveBtn.addEventListener("click", async () => {
    if (v.qaStatus !== "pass") {
      const ok = await confirmDialog({ title: "Approve anyway?", body: h("p", {}, `Automatic checks said “${label(v.qaStatus)}”. Approve only if you checked the page yourself.`), confirmLabel: "Approve" });
      if (!ok) return;
    }
    await act(approveBtn, () => post(`/versions/${v.id}/approve`, { altText: alt.value.trim() || undefined }), `Page ${pad3(v.page)} approved.`).then(onChange).catch(() => undefined);
  });
  rejectBtn.addEventListener("click", () => act(rejectBtn, () => post(`/versions/${v.id}/reject`, {}), `Version rejected.`).then(onChange).catch(() => undefined));
  return h(
    "article",
    { class: "version", "aria-label": `Version from ${when(v.createdAt)}` },
    h("a", { href: `/api/studio/assets/${v.id}`, target: "_blank", rel: "noopener" }, h("img", { src: `/api/studio/assets/${v.id}?thumb=1`, alt: v.altText || `Generated page ${pad3(v.page)}, version from ${when(v.createdAt)}`, loading: "lazy", width: "360", height: "540" }), h("span", { class: "visually-hidden" }, " (full size, opens in a new tab)")),
    h("h3", {}, when(v.createdAt)),
    h("p", {}, badge(v.reviewStatus), " ", badge(v.qaStatus, `QA: ${label(v.qaStatus)}${v.qaConfidence != null ? ` (${Math.round(v.qaConfidence * 100)}%)` : ""}`), v.publicationStatus !== "unpublished" ? [" ", badge(v.publicationStatus)] : null),
    h("p", { class: "small muted" }, `${v.model ?? "upload"} · ${v.width}x${v.height} · retry ${v.retryCount} · est. ${usd(v.costEstimateUsd)}`),
    h("details", {}, h("summary", {}, "Quality checks"), qaList(v.qa)),
    h("details", {}, h("summary", {}, "References used"), h("ol", { class: "small" }, ...(v.references || []).map((r) => h("li", {}, `${label(r.role)}: ${r.label}${r.provisional ? " (draft)" : ""}`)))),
    showActions && !pageLocked && ["awaiting_review", "auto_rejected", "rejected", "superseded"].includes(v.reviewStatus)
      ? h("div", {}, field({ id: `alt-${v.id}`, label: "Alt text for the reader", input: alt, hint: "Describe what happens and include the dialogue. Leave empty to use the script-based text." }), h("div", { class: "btn-row" }, approveBtn, rejectBtn))
      : null,
    h("p", { class: "small" }, h("a", { href: `/api/studio/assets/${v.id}?download=webp`, download: "" }, "Download WebP")),
  );
}

async function pageView(id, pageStr) {
  const page = Number(pageStr);
  const d = await get(`/chapters/${id}/pages/${page}`);
  const locked = d.info?.locked;
  const regen = h("button", { class: "btn btn-primary", type: "button", disabled: locked || !d.info?.prepared || d.blockers.length > 0 }, d.versions.length ? "Regenerate this page" : "Generate this page");
  regen.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: `Generate page ${pad3(page)}?`, body: h("p", {}, "This sends one paid request to OpenAI (plus a small quality check). It may retry automatically within the page's attempt limit and the job budget."), confirmLabel: "Start paid generation" });
    if (!ok) return;
    const res = await act(regen, () => post(`/chapters/${id}/pages/${page}/regenerate`, { confirmPaid: true }), "Generation queued.").catch(() => null);
    if (res) window.location.hash = `#/jobs/${res.jobId}`;
  });
  const script = d.script;
  render(
    crumbs(["Chapters", "#/chapters"], [`Chapter ${id}`, `#/chapters/${id}`], [`Page ${pad3(page)}`]),
    head(`Page ${pad3(page)}${script?.title ? `: ${script.title}` : ""}`, script?.plot ?? "", regen),
    errorBox(),
    locked ? notice("info", h("p", {}, h("strong", {}, "Locked. "), d.info.lockReason)) : null,
    !d.info?.prepared ? notice("warn", h("p", {}, d.info?.unpreparedReason ?? "Not prepared.")) : null,
    d.blockers.length ? notice("error", h("p", {}, h("strong", {}, "Cannot generate yet:")), h("ul", {}, ...d.blockers.map((b) => h("li", {}, b)))) : null,
    d.warnings.length ? notice("warn", h("p", {}, h("strong", {}, "Notes:")), h("ul", {}, ...d.warnings.map((b) => h("li", {}, b)))) : null,
    d.info?.sourceImagePath ? h("figure", { class: "version" }, h("img", { src: `/api/studio/repo-image?path=${encodeURIComponent(d.info.sourceImagePath)}`, alt: `Existing artwork for page ${pad3(page)}`, width: "512", height: "768" }), h("figcaption", { class: "small" }, `Repository artwork: ${d.info.sourceImagePath}`)) : null,
    h(
      "div",
      { class: "split" },
      h(
        "section",
        { "aria-labelledby": "script-title" },
        h("h2", { id: "script-title" }, "Script"),
        script
          ? h("ol", {}, ...script.panels.map((p) => h("li", {}, h("p", {}, h("strong", {}, `Panel ${p.number}. `), p.visual), p.lines.length ? h("ul", {}, ...p.lines.map((l) => h("li", {}, `${l.kind === "thought" ? `${l.speaker} (thought)` : l.kind === "time" ? "Time caption" : l.speaker}: “${l.text}”`))) : h("p", { class: "small muted" }, "Silent panel."))))
          : h("p", {}, "No script entry."),
      ),
      h(
        "section",
        { "aria-labelledby": "refs-title" },
        h("h2", { id: "refs-title" }, "References chosen automatically"),
        d.references.length ? h("ol", {}, ...d.references.map((r) => h("li", {}, badge(r.role === "identity" ? "approved" : "pending", label(r.role)), " ", r.label, h("span", { class: "small muted" }, ` (${r.path})`)))) : h("p", {}, "None."),
        d.prompt ? h("details", {}, h("summary", {}, `Page prompt (${d.prompt.path}, sent verbatim)`), h("pre", { class: "prompt", tabindex: "0" }, d.prompt.text)) : null,
        d.finalPrompt ? h("details", {}, h("summary", {}, "Full request text, including the attachment list"), h("pre", { class: "prompt", tabindex: "0" }, d.finalPrompt)) : null,
        d.continuity ? h("details", {}, h("summary", {}, "Continuity record"), h("pre", { class: "prompt", tabindex: "0" }, JSON.stringify(d.continuity.state, null, 2))) : null,
      ),
    ),
    h("h2", {}, `Versions (${d.versions.length})`),
    d.versions.length ? h("div", { class: "compare" }, ...d.versions.map((v) => versionCard(v, { onChange: () => pageView(id, pageStr), pageLocked: locked }))) : h("p", {}, "No generated versions yet."),
  );
}

// ---------- generation studio ----------
async function studioView(chapterId) {
  const { chapters } = await get("/chapters");
  const id = chapterId || chapters[0]?.id;
  if (!id) return render(head("Generate", "No chapters configured."));
  const c = await get(`/chapters/${id}`);
  if (c.latestJob && ["queued", "running", "paused", "blocked", "budget_exceeded"].includes(c.latestJob.status)) {
    window.location.replace(`#/jobs/${c.latestJob.id}`);
    return;
  }
  const ready = c.pages.filter((p) => ["ready", "failed", "needs_attention", "awaiting_review", "blocked"].includes(p.status) && p.prepared && !p.locked);
  const select = h("select", {}, ...chapters.map((ch) => h("option", { value: ch.id, selected: ch.id === id }, `${ch.id}: ${ch.title}`)));
  select.addEventListener("change", () => (window.location.hash = `#/studio/${select.value}`));
  const boxes = c.pages.map((p) => {
    const eligible = ready.includes(p);
    const input = h("input", { type: "checkbox", value: String(p.page), checked: eligible && p.status === "ready", disabled: !eligible });
    const reason = !eligible ? (p.locked ? "locked" : !p.prepared ? "not prepared" : p.statusLabel.toLowerCase()) : p.status !== "ready" ? p.statusLabel.toLowerCase() : null;
    return { input, el: h("label", {}, input, `Page ${p.label}`, reason ? h("span", { class: "small muted" }, ` (${reason})`) : null) };
  });
  const quality = h("select", {}, ...["low", "medium", "high", "xhigh", "max"].map((q) => h("option", { value: q, selected: (c.settings.overrides.quality ?? c.settings.defaults.quality) === q }, q)));
  const budget = h("input", { type: "number", min: "0.5", max: "200", step: "0.5", value: String(c.settings.overrides.budgetUsdPerJob ?? c.settings.defaults.budgetUsdPerJob) });
  const estimateBox = h("div", { class: "card", "aria-live": "polite" }, h("p", {}, "Choose pages to see the estimate."));
  const testMode = !c.realGenerationVerified;
  const start = h("button", { class: "btn btn-primary", type: "button" }, testMode ? "Run one test page" : "Generate chapter");
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
          h("p", {}, `For ${e.estimate.pages} page(s), expecting some retries. Worst case if every page uses all attempts: ${usd(e.estimate.worstCaseUsd)}. The job stops automatically at your budget.`),
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
    const ok = await confirmDialog({
      title: testMode ? `Run a test on page ${pad3(pages[0])}?` : `Generate ${pages.length} page(s)?`,
      body: h(
        "div",
        {},
        h("p", {}, `This starts paid OpenAI requests for page(s) ${pages.map(pad3).join(", ")} with a budget of ${usd(Number(budget.value))}.`),
        h("p", {}, "It keeps running after you close this tab. Nothing is published until you approve and publish pages."),
      ),
      confirmLabel: "Start paid generation",
    });
    if (!ok) return;
    const key = `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await act(start, () => post("/jobs", { chapterId: id, pages, settings: { quality: quality.value }, budgetUsd: Number(budget.value), test: testMode, confirmPaid: true }, { "Idempotency-Key": key }), "Job started.").catch(() => null);
    if (res) window.location.hash = `#/jobs/${res.job.id}`;
  });

  render(
    head("Generate pages", "One click queues the selected pages. Generation continues on the server when you leave."),
    !c.generationEnabled ? notice("warn", h("p", {}, "Paid generation is switched off on the server (STUDIO_GENERATION_ENABLED). You can still preview requests and estimates.")) : null,
    testMode ? notice("info", h("p", {}, h("strong", {}, "Test first. "), "The first run generates only the first selected page. Approve it on the Review screen to unlock unattended full-chapter jobs.")) : null,
    errorBox(),
    h("div", { class: "field" }, h("label", { for: "chapter-select" }, "Chapter"), Object.assign(select, { id: "chapter-select" })),
    h(
      "fieldset",
      {},
      h("legend", {}, "Pages"),
      h("p", { class: "small" }, "Locked and unprepared pages cannot be selected. Pages generate in order, one at a time, to keep continuity."),
      h("div", { class: "btn-row" }, h("button", { class: "btn btn-small", type: "button", onclick: () => { boxes.forEach((b) => (b.input.checked = !b.input.disabled && ready.find((p) => p.page === Number(b.input.value))?.status === "ready")); refreshEstimate(); } }, "Select all ready pages"), h("button", { class: "btn btn-small", type: "button", onclick: () => { boxes.forEach((b) => (b.input.checked = false)); refreshEstimate(); } }, "Clear")),
      h("div", { class: "check-grid" }, ...boxes.map((b) => b.el)),
    ),
    h("div", { class: "form-grid" }, field({ id: "gen-quality", label: "Quality", input: quality }), field({ id: "gen-budget", label: "Budget for this job (USD)", input: budget, hint: "The job stops before any request that would pass this amount." })),
    estimateBox,
    h("div", { class: "btn-row" }, start),
  );
  refreshEstimate();
}

// ---------- job monitor ----------
async function jobView(jobId) {
  const draw = async (first) => {
    const d = await get(`/jobs/${jobId}`);
    const j = d.job;
    const done = d.pages.filter((p) => ["awaiting_review", "failed", "blocked", "skipped", "cancelled"].includes(p.status)).length;
    const pause = h("button", { class: "btn", type: "button" }, "Pause");
    const resume = h("button", { class: "btn btn-primary", type: "button" }, "Resume");
    const cancel = h("button", { class: "btn btn-danger", type: "button" }, "Cancel job");
    pause.addEventListener("click", () => act(pause, () => post(`/jobs/${jobId}/pause`), "Job paused.").then(() => draw()).catch(() => undefined));
    resume.addEventListener("click", () => act(resume, () => post(`/jobs/${jobId}/resume`), "Job resumed.").then(() => draw()).catch(() => undefined));
    cancel.addEventListener("click", async () => {
      if (await confirmDialog({ title: "Cancel this job?", body: h("p", {}, "Pages still waiting are cancelled. Finished pages stay available for review."), confirmLabel: "Cancel job", danger: true })) {
        act(cancel, () => post(`/jobs/${jobId}/cancel`), "Job cancelled.").then(() => draw()).catch(() => undefined);
      }
    });
    const budgetInput = h("input", { type: "number", min: String(j.budget_usd + 0.5), max: "200", step: "0.5", value: String(Math.min(200, j.budget_usd * 2)) });
    const raise = h("button", { class: "btn", type: "button" }, "Raise budget");
    raise.addEventListener("click", () => act(raise, () => post(`/jobs/${jobId}/budget`, { budgetUsd: Number(budgetInput.value) }), "Budget raised.").then(() => draw()).catch(() => undefined));
    const active = ["queued", "running"].includes(j.status);
    const statusLine = `Job ${label(j.status)}: ${done} of ${d.pages.length} pages finished.`;
    const content = [
      crumbs(["Generate", `#/studio/${j.chapter_id}`], ["Job"]),
      head(`Chapter ${j.chapter_id} job`, `Started ${when(j.created_at)}${j.is_test ? " · single test page" : ""}`, active ? pause : null, ["paused", "blocked", "budget_exceeded"].includes(j.status) ? resume : null, ["queued", "running", "paused", "blocked", "budget_exceeded"].includes(j.status) ? cancel : null),
      errorBox(),
      h("p", {}, badge(j.status), " ", statusLine),
      j.error ? notice(j.status === "blocked" ? "error" : "warn", h("p", {}, j.error)) : null,
      j.status === "budget_exceeded" ? h("div", { class: "form-grid" }, field({ id: "raise-budget", label: "New budget (USD)", input: budgetInput }), h("div", { class: "btn-row" }, raise)) : null,
      progress(done, d.pages.length),
      h("p", { class: "small" }, `Spent so far: ${usd(j.spent_estimate_usd)} estimated (budget ${usd(j.budget_usd)}). Calculated from reported usage: ${j.spent_reported_usd ? usd(j.spent_reported_usd) : "not reported yet"}.`),
      h(
        "div",
        { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Page progress" },
        h(
          "table",
          {},
          h("caption", { class: "visually-hidden" }, "Pages in this job"),
          h("thead", {}, h("tr", {}, ["Page", "Status", "Attempts", "Notes"].map((t) => h("th", { scope: "col" }, t)))),
          h(
            "tbody",
            {},
            ...d.pages.map((p) =>
              h(
                "tr",
                {},
                h("th", { scope: "row" }, h("a", { href: `#/chapters/${j.chapter_id}/pages/${p.page}` }, `Page ${pad3(p.page)}`)),
                h("td", {}, badge(p.status === "queued" && p.phase === "validate" ? "checking" : p.status, p.status === "queued" && p.phase === "validate" ? "Checking quality" : label(p.status))),
                h("td", {}, `${p.attempts} of ${p.max_attempts}`),
                h("td", { class: "small" }, p.last_error ?? ""),
              ),
            ),
          ),
        ),
      ),
      h("div", { class: "btn-row" }, h("a", { class: "btn", href: `#/review/${j.chapter_id}` }, "Review pages"), done ? h("a", { class: "btn", href: `/api/studio/jobs/${jobId}/export`, download: "" }, "Export pages (ZIP)") : null),
      h("h2", {}, "Activity"),
      h("ol", { class: "log", tabindex: "0", "aria-label": "Job activity, newest first" }, ...d.events.map((e) => h("li", {}, h("time", { datetime: new Date(e.created_at).toISOString() }, when(e.created_at)), e.level === "error" ? badge("failed", "Error") : e.level === "warn" ? badge("uncertain", "Note") : null, " ", e.message))),
    ];
    if (first) render(...content);
    else {
      const focused = document.activeElement?.id;
      clear(view).append(...content.filter(Boolean));
      if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
    }
    announceOnce(statusLine);
    const finished = ["completed", "completed_with_issues", "cancelled"].includes(j.status);
    if (finished && pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    return !finished;
  };
  const live = await draw(true);
  if (live) poll(() => draw(false));
}

// ---------- review and publish ----------
async function reviewView(chapterId) {
  const { chapters } = await get("/chapters");
  const id = chapterId || chapters[0]?.id;
  const c = await get(`/chapters/${id}`);
  const reviewable = c.pages.filter((p) => p.latestVersionId && !p.locked);
  const approvedUnpublished = [];
  const sections = [];
  for (const p of reviewable) {
    const d = await get(`/chapters/${id}/pages/${p.page}`);
    const approved = d.versions.find((v) => v.reviewStatus === "approved");
    if (approved && approved.publicationStatus === "unpublished") approvedUnpublished.push({ page: p.page, version: approved, suggested: d.suggestedAltText });
    sections.push(
      h(
        "section",
        { class: "stack", "aria-labelledby": `rv-${p.page}` },
        h("h2", { id: `rv-${p.page}` }, h("a", { href: `#/chapters/${id}/pages/${p.page}` }, `Page ${pad3(p.page)}`), " ", badge(p.status, p.statusLabel)),
        h("div", { class: "compare" }, ...d.versions.slice(0, 3).map((v) => versionCard(v, { onChange: () => reviewView(id), pageLocked: p.locked }))),
        d.versions.length > 3 ? h("p", {}, h("a", { href: `#/chapters/${id}/pages/${p.page}` }, `See all ${d.versions.length} versions`)) : null,
      ),
    );
  }
  const select = h("select", { id: "review-chapter" }, ...chapters.map((ch) => h("option", { value: ch.id, selected: ch.id === id }, `${ch.id}: ${ch.title}`)));
  select.addEventListener("change", () => (window.location.hash = `#/review/${select.value}`));

  const publishForm = h("form", { class: "card form-card" });
  if (approvedUnpublished.length) {
    const rows = approvedUnpublished.map((a) => {
      const box = h("input", { type: "checkbox", checked: true, value: a.version.id });
      const alt = h("textarea", { rows: "3", maxlength: "1500" }, a.version.altText || a.suggested || "");
      return { a, box, alt, el: h("div", { class: "field" }, h("label", { class: "field-check" }, box, `Publish page ${pad3(a.page)}`), field({ id: `pub-alt-${a.page}`, label: `Alt text for page ${pad3(a.page)}`, input: alt, hint: "Shown to screen-reader users in the public reader." })) };
    });
    const gap = h("input", { type: "checkbox", id: "allow-gap" });
    const result = h("div", { "aria-live": "polite" });
    const submit = h("button", { class: "btn btn-primary", type: "submit" }, "Publish to the reader");
    publishForm.append(
      h("h2", {}, "Publish approved pages"),
      h("p", { class: "small" }, "Publishing opens a GitHub pull request that adds the WebP pages and reader entries. Merging it deploys the pages. Nothing already in the repository is overwritten."),
      ...rows.map((r) => r.el),
      h("div", { class: "field-check" }, gap, h("label", { for: "allow-gap" }, "Publish even if earlier pages are not in the reader yet")),
      errorBox(),
      submit,
      result,
    );
    publishForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const chosen = rows.filter((r) => r.box.checked);
      if (!chosen.length) return alertMessage("Choose at least one page to publish.");
      const ok = await confirmDialog({ title: `Publish ${chosen.length} page(s)?`, body: h("p", {}, `Pages ${chosen.map((r) => pad3(r.a.page)).join(", ")} will be added to a pull request for the public reader.`), confirmLabel: "Open pull request" });
      if (!ok) return;
      const res = await act(submit, () => post("/publish", { chapterId: id, versionIds: chosen.map((r) => r.a.version.id), altText: Object.fromEntries(chosen.map((r) => [r.a.version.id, r.alt.value.trim()])), allowGap: gap.checked, confirm: true }), "Pull request opened.").catch(() => null);
      if (res) clear(result).append(notice("ok", h("p", {}, "Pull request opened: ", h("a", { href: res.prUrl, target: "_blank", rel: "noopener" }, res.prUrl, h("span", { class: "visually-hidden" }, " (opens in a new tab)")), ". Merge it on GitHub to publish.")));
    });
  } else {
    publishForm.append(h("h2", {}, "Publish approved pages"), h("p", {}, "Approve pages below to publish them."));
  }

  render(
    head("Review and publish", "Compare versions, approve or reject, then publish approved pages to the reader."),
    h("div", { class: "field" }, h("label", { for: "review-chapter" }, "Chapter"), select),
    publishForm,
    ...(sections.length ? sections : [h("p", {}, "No generated pages to review yet.")]),
  );
}

// ---------- boot ----------
document.getElementById("sign-out").addEventListener("click", async () => {
  try {
    await post("/auth/logout");
  } finally {
    window.location.assign("/admin/login");
  }
});

(async function boot() {
  try {
    await get("/auth/me");
  } catch {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.hash || "#/dashboard")}`);
    return;
  }
  window.addEventListener("hashchange", route);
  if (!window.location.hash) window.location.replace("#/dashboard");
  route();
})();

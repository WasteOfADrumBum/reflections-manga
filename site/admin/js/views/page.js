// One page: synopsis, art, outfit picks, one-off prompt edits, generate or upload, and versions.
import { get, post } from "../api.js";
import { act, costExplainer, crumbs, errorBox, head, render, repoImage, section } from "../shared.js";
import { alertMessage, badge, clear, confirmDialog, field, h, label, notice, pad3, sheetOptions, usd, when } from "../ui.js";

function qaList(qa) {
  if (!qa || !qa.checks) return h("p", { class: "small muted" }, "Not checked yet.");
  return h(
    "div",
    {},
    h("ul", { class: "qa-list" }, ...qa.checks.map((c) => h("li", {}, badge(c.status === "pass" ? "pass" : c.status === "fail" ? "fail" : "uncertain", label(c.status)), h("strong", {}, c.name), h("span", { class: "small" }, c.detail)))),
    qa.visionSummary ? h("p", { class: "small" }, `Vision model: ${qa.visionSummary}`) : null,
    qa.disclaimer ? h("p", { class: "small muted" }, qa.disclaimer) : null,
  );
}

/** A version with its review actions. Used on the page screen and on Review. */
export function versionCard(v, { onChange, pageLocked = false, hasArt = false }) {
  const alt = h("textarea", { name: "alt", rows: "4", maxlength: "1500" }, v.altText ?? "");
  const approveBtn = h("button", { class: "btn btn-small btn-primary", type: "button" }, hasArt ? "Use this version" : "Approve");
  const rejectBtn = h("button", { class: "btn btn-small btn-danger", type: "button" }, "Reject");
  approveBtn.addEventListener("click", async () => {
    if (v.qaStatus !== "pass") {
      const ok = await confirmDialog({
        title: "Approve this version?",
        body: h("p", {}, v.source === "upload" ? "Uploads skip the automatic checks. Approve only if you checked the page yourself." : `Automatic checks said “${label(v.qaStatus)}”. Approve only if you checked the page yourself.`),
        confirmLabel: "Approve",
      });
      if (!ok) return;
    }
    await act(approveBtn, () => post(`/versions/${v.id}/approve`, { altText: alt.value.trim() || undefined }), `Page ${pad3(v.page)} approved. Publish it from Review.`)
      .then(onChange)
      .catch(() => undefined);
  });
  rejectBtn.addEventListener("click", () => act(rejectBtn, () => post(`/versions/${v.id}/reject`, {}), "Version rejected.").then(onChange).catch(() => undefined));
  const source = v.source === "upload" ? `Uploaded${v.uploadedBy ? ` by ${v.uploadedBy}` : ""}` : `${v.model ?? "generated"} · retry ${v.retryCount} · est. ${usd(v.costEstimateUsd)}`;
  return h(
    "article",
    { class: "version", "aria-label": `Version from ${when(v.createdAt)}` },
    h(
      "a",
      { href: `/api/studio/assets/${v.id}`, target: "_blank", rel: "noopener" },
      h("img", { src: `/api/studio/assets/${v.id}?thumb=1`, alt: v.altText || `Page ${pad3(v.page)}, version from ${when(v.createdAt)}`, loading: "lazy", width: "360", height: "540" }),
      h("span", { class: "visually-hidden" }, " (full size, opens in a new tab)"),
    ),
    h("h3", {}, when(v.createdAt)),
    h(
      "p",
      { class: "badge-row" },
      badge(v.reviewStatus),
      v.source === "upload" ? badge("pending", "Upload") : badge(v.qaStatus, `QA ${label(v.qaStatus)}${v.qaConfidence != null ? ` ${Math.round(v.qaConfidence * 100)}%` : ""}`),
      v.promptEdited ? badge("uncertain", "Edited prompt") : null,
      v.publicationStatus !== "unpublished" ? badge(v.publicationStatus) : null,
    ),
    h("p", { class: "small muted" }, `${source} · ${v.width}x${v.height}`),
    v.reviewNote ? h("p", { class: "small" }, `Note: ${v.reviewNote}`) : null,
    h("details", {}, h("summary", {}, "Quality checks"), qaList(v.qa)),
    (v.references || []).length ? h("details", {}, h("summary", {}, "References used"), h("ol", { class: "small" }, ...v.references.map((r) => h("li", {}, `${label(r.role)}: ${r.label}${r.provisional ? " (draft)" : ""}`)))) : null,
    !pageLocked && ["awaiting_review", "auto_rejected", "rejected", "superseded"].includes(v.reviewStatus)
      ? h("div", { class: "review-actions" }, field({ id: `alt-${v.id}`, label: "Alt text for the reader", input: alt, hint: "Describe what happens and include the dialogue. Leave empty to use the script." }), h("div", { class: "btn-row" }, approveBtn, rejectBtn))
      : null,
    h("p", { class: "small" }, h("a", { href: `/api/studio/assets/${v.id}?download=webp`, download: "" }, "Download WebP")),
  );
}

function outfitPicker(entry, onChange) {
  const select = h("select", {}, ...sheetOptions(entry.sheets, entry.selectedSheet, (s) => (s.path === entry.promptSheet ? " (prompt's choice)" : "")));
  const current = () => entry.sheets.find((s) => s.path === select.value) ?? entry.sheets[0];
  const img = h("img", { src: repoImage(current().path, 320), alt: `${entry.displayName}, ${current().label}`, width: "320", height: "213", loading: "lazy", decoding: "async" });
  select.addEventListener("change", () => {
    img.src = repoImage(current().path, 320);
    img.alt = `${entry.displayName}, ${current().label}`;
    onChange();
  });
  const id = `pick-${entry.characterId}`;
  return {
    el: h("li", { class: "pick" }, h("figure", {}, img), field({ id, label: entry.displayName, input: select })),
    value: () => select.value,
    entry,
  };
}

export async function pageView(id, pageStr) {
  const page = Number(pageStr);
  const d = await get(`/chapters/${id}/pages/${page}`);
  const info = d.info ?? {};
  const script = d.script;
  const refresh = () => pageView(id, pageStr);

  // ---- new version panel ----
  const picks = d.cast.map((entry) => outfitPicker(entry, () => scheduleCheck()));
  const promptBox = h("textarea", { rows: "16", class: "prompt-edit", spellcheck: "false" }, d.prompt?.text ?? "");
  const resetPrompt = h("button", { class: "btn btn-small", type: "button" }, "Reset to the repository prompt");
  resetPrompt.addEventListener("click", () => {
    promptBox.value = d.prompt?.text ?? "";
    scheduleCheck();
  });
  const drift = h("input", { type: "checkbox", id: "allow-drift" });
  const quality = h("select", {}, ...["low", "medium", "high", "xhigh", "max"].map((q) => h("option", { value: q, selected: q === d.settings.quality }, q)));
  const budget = h("input", { type: "number", min: "0.5", max: "200", step: "0.5", value: String(d.settings.budgetUsdPerJob) });
  const checkBox = h("div", { class: "check-result", "aria-live": "polite" });
  const generate = h("button", { class: "btn btn-primary", type: "button", disabled: info.locked || !info.prepared }, d.realGenerationVerified ? "Generate a new version" : "Generate (first test page)");

  const options = () => {
    const sheets = {};
    for (const p of picks) if (p.value() !== p.entry.promptSheet) sheets[p.entry.characterId] = p.value();
    const o = {};
    if (Object.keys(sheets).length) o.sheets = sheets;
    if (d.prompt && promptBox.value.trim() !== d.prompt.text.trim()) o.promptOverride = promptBox.value;
    if (o.promptOverride && drift.checked) o.allowScriptDrift = true;
    return o;
  };

  let lastPlan = null;
  let timer;
  const scheduleCheck = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, 350);
  };
  async function check() {
    try {
      const plan = await post(`/chapters/${id}/pages/${page}/plan`, { options: options(), quality: quality.value });
      lastPlan = plan;
      clear(checkBox).append(
        plan.blockers.length ? notice("error", h("p", {}, h("strong", {}, "Can't generate yet:")), h("ul", {}, ...plan.blockers.map((b) => h("li", {}, b)))) : notice("ok", h("p", {}, "Ready. Nothing is sent until you press Generate.")),
        plan.warnings.length ? notice("warn", h("ul", {}, ...plan.warnings.map((b) => h("li", {}, b)))) : null,
        h("h3", {}, "Images attached, in order"),
        h("ol", { class: "small" }, ...plan.references.map((r) => h("li", {}, `${label(r.role)}: ${r.label}`))),
        costExplainer(plan.cost),
      );
      generate.disabled = info.locked || !info.prepared || plan.blockers.length > 0;
    } catch (err) {
      clear(checkBox).append(notice("error", h("p", {}, err.message)));
    }
  }
  promptBox.addEventListener("input", scheduleCheck);
  drift.addEventListener("change", scheduleCheck);
  quality.addEventListener("change", scheduleCheck);

  generate.addEventListener("click", async () => {
    if (!lastPlan || lastPlan.blockers.length) return alertMessage("Fix the problems listed above first.");
    const o = options();
    const ok = await confirmDialog({
      title: `Generate page ${pad3(page)}?`,
      body: h(
        "div",
        {},
        h("p", {}, `This sends a paid request to OpenAI (${lastPlan.cost.model}, ${quality.value} quality, about ${usd(lastPlan.cost.perAttemptUsd)} per try), billed to your API credit, not ChatGPT Plus. Budget for this run: ${usd(Number(budget.value))}.`),
        o.promptOverride ? h("p", {}, "It uses your edited prompt for this run only. The repository prompt does not change.") : null,
        o.sheets ? h("p", {}, `Outfits changed for: ${picks.filter((p) => o.sheets[p.entry.characterId]).map((p) => p.entry.displayName).join(", ")}.`) : null,
        info.hasArt ? h("p", {}, "The page's current art stays as it is unless you approve the new version and publish it as a replacement.") : null,
      ),
      confirmLabel: "Start paid generation",
    });
    if (!ok) return;
    const res = await act(generate, () => post(`/chapters/${id}/pages/${page}/regenerate`, { confirmPaid: true, options: o, settings: { quality: quality.value }, budgetUsd: Number(budget.value) }), "Generation queued.").catch(() => null);
    if (res) window.location.hash = `#/jobs/${res.jobId}`;
  });

  // ---- upload ----
  const upFile = h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: true });
  const upNote = h("input", { type: "text", name: "note", maxlength: "300" });
  const upBtn = h("button", { class: "btn", type: "submit", disabled: info.locked }, "Upload for review");
  const upload = h(
    "form",
    { id: "upload-version" },
    h("p", { class: "small muted" }, "Made the page yourself, for example in ChatGPT? Upload it here. It costs nothing and goes through the same review and publishing. Portrait 2:3 (1024 x 1536), under 4 MB."),
    h("div", { class: "form-grid" }, field({ id: "up-file", label: "Page image", input: upFile }), field({ id: "up-note", label: "Note (optional)", input: upNote, hint: "For example: made in ChatGPT, third try" })),
    upBtn,
  );
  upload.addEventListener("submit", async (e) => {
    e.preventDefault();
    await act(upBtn, () => post(`/chapters/${id}/pages/${page}/upload`, new FormData(upload)), "Uploaded. It is waiting for review below.")
      .then(refresh)
      .catch(() => undefined);
  });

  const art = info.sourceImagePath ? repoImage(info.sourceImagePath, 480) : info.publishedSrc;
  render(
    crumbs(["Story", "#/story"], [`Arc ${d.chapter.arcNumber}`, `#/story/${d.chapter.arcId}`], [`Chapter ${id}`, `#/chapters/${id}`], [`Page ${pad3(page)}`]),
    head(`Page ${pad3(page)}${script?.title ? `: ${script.title}` : ""}`, info.beat ?? ""),
    errorBox(),
    info.locked ? notice("info", h("p", {}, h("strong", {}, "Locked. "), info.lockReason ?? "")) : null,
    !info.prepared ? notice("warn", h("p", {}, info.unpreparedReason ?? "Not prepared.")) : null,
    !d.generationEnabled ? notice("warn", h("p", {}, "Paid generation is switched off on the server, so Generate will refuse. You can still check requests and upload versions.")) : null,
    h(
      "div",
      { class: "split" },
      section(
        "About this page",
        "about-title",
        script?.plot ? h("p", {}, script.plot) : null,
        h("p", { class: "small muted" }, `Chapter ${id}: ${d.chapter.title}.${d.chapter.synopsis ? ` ${d.chapter.synopsis}` : ""}`),
        script
          ? h(
              "ol",
              { class: "script-panels" },
              ...script.panels.map((p) =>
                h(
                  "li",
                  {},
                  h("p", {}, h("strong", {}, `Panel ${p.number}. `), p.visual),
                  p.lines.length ? h("ul", {}, ...p.lines.map((l) => h("li", {}, `${l.kind === "thought" ? `${l.speaker} (thought)` : l.kind === "caption" || l.kind === "time" ? "Caption" : l.speaker}: “${l.text}”`))) : h("p", { class: "small muted" }, "Silent panel."),
                ),
              ),
            )
          : h("p", {}, "No script entry."),
      ),
      section(
        "Current art",
        "art-title",
        art ? h("figure", { class: "current-art" }, h("img", { src: art, alt: `Current artwork for page ${pad3(page)}`, width: "480", height: "720", loading: "lazy" }), h("figcaption", { class: "small muted" }, info.publishedSrc ? "In the reader." : "In the repository, not yet in the reader.")) : h("p", { class: "muted" }, "No art yet."),
      ),
    ),
    section(
      "Make a new version",
      "new-title",
      info.hasArt ? h("p", { class: "small muted" }, "This page already has art. New versions don't touch it; you choose which one to use.") : null,
      picks.length ? h("h3", {}, "Outfits") : null,
      picks.length ? h("ul", { class: "pick-grid", "aria-label": "Outfit for each character" }, ...picks.map((p) => p.el)) : h("p", { class: "muted" }, "No characters found in this page's reference order."),
      d.prompt
        ? h(
            "div",
            {},
            h("h3", {}, "Prompt"),
            field({ id: "prompt-edit", label: `Prompt for this run (from ${d.prompt.path})`, input: promptBox, hint: "Edits apply to this run only and are never saved to the repository." }),
            h("div", { class: "btn-row" }, resetPrompt),
            h("div", { class: "field-check" }, drift, h("label", { for: "allow-drift" }, "My edit changes dialogue on purpose (skip the script match check)")),
          )
        : notice("warn", h("p", {}, "This page has no prompt file yet.")),
      h("div", { class: "form-grid" }, field({ id: "gen-quality", label: "Quality", input: quality, hint: "Higher costs more per image." }), field({ id: "gen-budget", label: "Budget for this run (USD, API credit)", input: budget })),
      checkBox,
      h("div", { class: "btn-row" }, generate),
    ),
    section("Upload a version", "upload-title", upload),
    section(
      `Versions (${d.versions.length})`,
      "versions-title",
      d.versions.length ? h("div", { class: "compare" }, ...d.versions.map((v) => versionCard(v, { onChange: refresh, pageLocked: info.locked, hasArt: info.hasArt }))) : h("p", { class: "muted" }, "No versions yet. Generate or upload one above."),
    ),
    d.finalPrompt ? h("details", {}, h("summary", {}, "Full request text sent to OpenAI (with the default outfits)"), h("pre", { class: "prompt", tabindex: "0" }, d.finalPrompt)) : null,
  );
  check();
}

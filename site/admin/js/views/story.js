// Arcs > chapters > pages, with the story text kept in the repository.
import { get, post, put } from "../api.js";
import { act, crumbs, errorBox, head, prLink, render, repoImage, section } from "../shared.js";
import { badge, field, fill, h, notice, progress } from "../ui.js";

export async function arcsView() {
  const { arcs } = await get("/arcs");
  const title = h("input", { type: "text", required: true, minlength: "2", maxlength: "100" });
  const focus = h("textarea", { rows: "3", maxlength: "1500" });
  const result = h("div", { "aria-live": "polite" });
  const form = h(
    "form",
    { class: "box form-card", id: "new-arc" },
    h("h2", {}, "Add an arc"),
    h("p", { class: "small muted" }, "Opens a pull request that adds stories/arc-NN/index.md. It shows up here once you merge it."),
    h("div", { class: "form-grid" }, field({ id: "arc-title", label: "Arc title", input: title }), field({ id: "arc-focus", label: "What the arc is about", input: focus })),
    h("button", { class: "btn", type: "submit" }, "Open pull request"),
    result,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await act(form.querySelector("button"), () => post("/create/arc", { title: title.value.trim(), focus: focus.value.trim() || undefined }), "Pull request opened.").catch(() => null);
    if (res) fill(result, prLink(res.prUrl));
  });
  render(
    head("Story", "Pick an arc to see its chapters. Text comes from the arc and chapter files in the repository."),
    errorBox(),
    h(
      "ul",
      { class: "card-list", "aria-label": "Arcs" },
      ...arcs.map((a) =>
        h(
          "li",
          { class: "card arc-card" },
          h("p", { class: "eyebrow" }, `Arc ${a.number}`),
          h("h2", {}, h("a", { href: `#/story/${a.id}` }, a.title)),
          a.focus ? h("p", {}, a.focus) : h("p", { class: "muted" }, "No focus written yet."),
          h("p", { class: "small muted" }, a.chapters.length ? `${a.chapters.length} chapter${a.chapters.length === 1 ? "" : "s"} in the studio` : "No chapters in the studio yet"),
        ),
      ),
    ),
    form,
  );
}

export async function arcView(arcId) {
  const { arcs } = await get("/arcs");
  const arc = arcs.find((a) => a.id === arcId);
  if (!arc) return render(crumbs(["Story", "#/story"], ["Not found"]), head("Arc not found"), h("p", {}, h("a", { href: "#/story" }, "Back to the story")));
  const title = h("input", { type: "text", required: true, minlength: "2", maxlength: "120" });
  const logline = h("textarea", { rows: "3", maxlength: "1500" });
  const pages = h("input", { type: "number", min: "1", max: "200", value: "30", required: true });
  const result = h("div", { "aria-live": "polite" });
  const form = h(
    "form",
    { class: "box form-card", id: "new-chapter" },
    h("h2", {}, "Add a chapter to this arc"),
    h("p", { class: "small muted" }, "Opens a pull request that adds the chapter folder from the chapter template and registers it in the studio config. Write its script and page prompts there."),
    h("div", { class: "form-grid" }, field({ id: "ch-title", label: "Chapter title", input: title }), field({ id: "ch-pages", label: "Planned pages", input: pages }), field({ id: "ch-logline", label: "Logline (one or two sentences)", input: logline })),
    h("button", { class: "btn", type: "submit" }, "Open pull request"),
    result,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await act(form.querySelector("button"), () => post("/create/chapter", { arcId, title: title.value.trim(), logline: logline.value.trim() || undefined, plannedPages: Number(pages.value) }), "Pull request opened.").catch(() => null);
    if (res) fill(result, prLink(res.prUrl));
  });
  render(
    crumbs(["Story", "#/story"], [`Arc ${arc.number}`]),
    head(`Arc ${arc.number}: ${arc.title}`, arc.focus ?? ""),
    errorBox(),
    arc.chapters.length
      ? h(
          "ul",
          { class: "card-list", "aria-label": `Chapters in arc ${arc.number}` },
          ...arc.chapters.map((c) =>
            h(
              "li",
              { class: "card" },
              h("p", { class: "eyebrow" }, `Chapter ${c.id}${c.revisionLabel ? ` · ${c.revisionLabel}` : ""}`),
              h("h2", {}, h("a", { href: `#/chapters/${c.id}` }, c.title)),
              c.synopsis ? h("p", {}, c.synopsis) : h("p", { class: "muted" }, "No logline in outline.md yet."),
              progress(c.doneCount, c.plannedPages, `${c.doneCount} of ${c.plannedPages} pages have art`),
            ),
          ),
        )
      : notice("info", h("p", {}, "No chapters in the studio for this arc yet.")),
    form,
  );
}

export function pageTile(chapterId, p) {
  const thumb = p.latestVersionId ? `/api/studio/assets/${p.latestVersionId}?thumb=1` : p.sourceImagePath ? repoImage(p.sourceImagePath, 320) : p.publishedSrc;
  const id = `tile-${chapterId}-${p.page}`;
  return h(
    "li",
    { class: "page-tile" },
    h("a", { href: `#/chapters/${chapterId}/pages/${p.page}`, id, class: "tile-link" }, h("span", { class: "tile-num" }, `Page ${p.label}`), p.scriptTitle ? h("span", { class: "tile-title" }, p.scriptTitle) : null),
    thumb ? h("img", { src: thumb, alt: "", loading: "lazy", decoding: "async", width: "160", height: "240" }) : h("div", { class: "tile-empty", "aria-hidden": "true" }, "No art yet"),
    h("div", { class: "tile-foot" }, badge(p.status, p.statusLabel), p.versionCount ? h("span", { class: "small muted" }, `${p.versionCount} version${p.versionCount === 1 ? "" : "s"}`) : null),
  );
}

function settingsForm(id, c) {
  const overrides = c.settings.overrides || {};
  const defaults = c.settings.defaults;
  const quality = h("select", {}, ...["low", "medium", "high", "xhigh", "max"].map((q) => h("option", { value: q, selected: (overrides.quality ?? defaults.quality) === q }, q)));
  const attempts = h("input", { type: "number", min: "1", max: "6", value: String(overrides.maxAttemptsPerPage ?? defaults.maxAttemptsPerPage) });
  const budget = h("input", { type: "number", min: "0.5", max: "200", step: "0.5", value: String(overrides.budgetUsdPerJob ?? defaults.budgetUsdPerJob) });
  const scene = h("input", { type: "number", min: "0", max: "4", value: String(overrides.maxSceneReferences ?? defaults.maxSceneReferences) });
  const form = h(
    "form",
    {},
    h("p", { class: "small muted" }, `Defaults for this chapter's runs. Model: ${defaults.imageModel}. These never change the script or prompts.`),
    h(
      "div",
      { class: "form-grid" },
      field({ id: "set-quality", label: "Image quality", input: quality, hint: "Higher costs more per image." }),
      field({ id: "set-attempts", label: "Attempts per page", input: attempts, hint: "Automatic retries when quality checks fail." }),
      field({ id: "set-budget", label: "Default budget per run (USD)", input: budget }),
      field({ id: "set-scene", label: "Earlier pages to attach", input: scene, hint: "For continuity, after the character sheets." }),
    ),
    h("button", { class: "btn", type: "submit" }, "Save settings"),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    act(form.querySelector("button"), () => put(`/chapters/${id}/settings`, { quality: quality.value, maxAttemptsPerPage: Number(attempts.value), budgetUsdPerJob: Number(budget.value), maxSceneReferences: Number(scene.value) }), "Settings saved.").catch(() => undefined);
  });
  return h("details", { class: "panel-details" }, h("summary", {}, "Generation settings for this chapter"), form);
}

export async function chapterView(id) {
  const c = await get(`/chapters/${id}`);
  render(
    crumbs(["Story", "#/story"], [`Arc ${c.arcNumber}`, `#/story/${c.arcId}`], [`Chapter ${id}`]),
    head(`Chapter ${id}: ${c.title}`, c.synopsis ?? "", h("a", { class: "btn btn-primary", href: `#/studio/${id}` }, "Generate pages"), h("a", { class: "btn", href: `#/review/${id}` }, "Review")),
    h("p", { class: "small muted" }, `${c.doneCount} of ${c.plannedPages} pages have art. Script: ${c.scriptPath}`),
    errorBox(),
    section("Pages", "pages-title", h("p", { class: "small muted" }, "Open a page to read its synopsis, pick outfits, edit the prompt for one run, generate or upload a version."), h("ul", { class: "page-grid", "aria-labelledby": "pages-title" }, ...c.pages.map((p) => pageTile(id, p)))),
    settingsForm(id, c),
  );
}

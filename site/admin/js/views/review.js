// Review and publish: every version waiting for a decision, across chapters, in one request.
import { get, post } from "../api.js";
import { act, errorBox, head, prLink, render, section } from "../shared.js";
import { alertMessage, clear, confirmDialog, field, h, notice, pad3 } from "../ui.js";
import { versionCard } from "./page.js";

export async function reviewView(chapterId) {
  const data = await get("/review");
  const pages = data.pages.filter((p) => !chapterId || p.chapterId === chapterId);
  const waiting = pages.filter((p) => p.versions.some((v) => v.reviewStatus === "awaiting_review"));
  const approved = pages.map((p) => ({ p, v: p.versions.find((v) => v.reviewStatus === "approved" && v.publicationStatus === "unpublished") })).filter((x) => x.v);

  const select = h("select", { id: "review-chapter" }, h("option", { value: "" }, "All chapters"), ...data.chapters.map((c) => h("option", { value: c.id, selected: c.id === chapterId }, `${c.id}: ${c.title}`)));
  select.addEventListener("change", () => (window.location.hash = select.value ? `#/review/${select.value}` : "#/review"));

  const publishBlocks = [];
  const byChapter = new Map();
  for (const a of approved) byChapter.set(a.p.chapterId, [...(byChapter.get(a.p.chapterId) ?? []), a]);
  for (const [cid, list] of byChapter) {
    const rows = list.map(({ p, v }) => {
      const box = h("input", { type: "checkbox", checked: true, id: `pub-${v.id}` });
      const alt = h("textarea", { rows: "3", maxlength: "1500" }, v.altText || p.suggestedAltText || "");
      return {
        p,
        v,
        box,
        alt,
        el: h(
          "div",
          { class: "publish-row" },
          h("div", { class: "field-check" }, box, h("label", { for: `pub-${v.id}` }, `Page ${pad3(p.page)}${p.title ? `: ${p.title}` : ""}`, p.hasArt ? " (replaces the current art)" : "")),
          field({ id: `pub-alt-${v.id}`, label: `Alt text for page ${pad3(p.page)}`, input: alt, hint: "Read by screen readers in the public reader." }),
        ),
      };
    });
    const gap = h("input", { type: "checkbox", id: `gap-${cid}` });
    const result = h("div", { "aria-live": "polite" });
    const submit = h("button", { class: "btn btn-primary", type: "submit", disabled: !data.publisherReady }, "Publish to the reader");
    const form = h(
      "form",
      { class: "form-card" },
      h("h3", {}, `Chapter ${cid}`),
      ...rows.map((r) => r.el),
      h("div", { class: "field-check" }, gap, h("label", { for: `gap-${cid}` }, "Publish even if earlier pages are not in the reader yet")),
      submit,
      result,
    );
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const chosen = rows.filter((r) => r.box.checked);
      if (!chosen.length) return alertMessage("Choose at least one page to publish.");
      const replacing = chosen.filter((r) => r.p.hasArt);
      const ok = await confirmDialog({
        title: `Publish ${chosen.length} page(s)?`,
        body: h(
          "div",
          {},
          h("p", {}, `Opens a pull request for pages ${chosen.map((r) => pad3(r.p.page)).join(", ")}. Merging it updates the public reader.`),
          replacing.length ? h("p", {}, h("strong", {}, "Replaces current art: "), `pages ${replacing.map((r) => pad3(r.p.page)).join(", ")}. The reader shows your new version; the original files stay in the repository.`) : null,
        ),
        confirmLabel: "Open pull request",
      });
      if (!ok) return;
      const res = await act(
        submit,
        () =>
          post("/publish", {
            chapterId: cid,
            versionIds: chosen.map((r) => r.v.id),
            altText: Object.fromEntries(chosen.map((r) => [r.v.id, r.alt.value.trim()])),
            allowGap: gap.checked,
            replacePages: replacing.map((r) => r.p.page),
            confirm: true,
          }),
        "Pull request opened.",
      ).catch(() => null);
      if (res) clear(result).append(prLink(res.prUrl));
    });
    publishBlocks.push(form);
  }

  render(
    head("Review", "Pick the version to use for each page, then publish approved pages to the reader."),
    errorBox(),
    h("div", { class: "field narrow" }, h("label", { for: "review-chapter" }, "Chapter"), select),
    !data.publisherReady ? notice("warn", h("p", {}, "Publishing needs GITHUB_TOKEN on the server. You can still approve and reject.")) : null,
    section("Ready to publish", "publish-title", publishBlocks.length ? publishBlocks : h("p", { class: "muted" }, "Nothing approved yet. Approve a version below and it appears here.")),
    section(
      `Waiting for review (${waiting.length} page${waiting.length === 1 ? "" : "s"})`,
      "waiting-title",
      waiting.length
        ? waiting.map((p) =>
            h(
              "article",
              { class: "review-page", "aria-labelledby": `rv-${p.chapterId}-${p.page}` },
              h("h3", { id: `rv-${p.chapterId}-${p.page}` }, h("a", { href: `#/chapters/${p.chapterId}/pages/${p.page}` }, `Chapter ${p.chapterId}, page ${pad3(p.page)}${p.title ? `: ${p.title}` : ""}`)),
              h(
                "div",
                { class: "compare" },
                ...p.versions.filter((v) => v.reviewStatus === "awaiting_review").map((v) => versionCard(v, { onChange: () => reviewView(chapterId), hasArt: p.hasArt })),
              ),
              p.totalVersions > p.versions.length ? h("p", { class: "small" }, h("a", { href: `#/chapters/${p.chapterId}/pages/${p.page}` }, `See all ${p.totalVersions} versions of this page`)) : null,
            ),
          )
        : notice(
            "info",
            h("p", {}, h("strong", {}, "Nothing to review yet. "), "Versions show up here after you generate a page or upload one. Open a page from ", h("a", { href: "#/story" }, "Story"), " to generate or upload a version."),
          ),
    ),
  );
}

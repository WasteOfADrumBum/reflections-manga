// Character library: every sheet is an outfit; one picker swaps the preview.
import { api, get, post, put } from "../api.js";
import { act, errorBox, head, prLink, render, repoImage, section } from "../shared.js";
import { badge, clear, field, h, label, notice } from "../ui.js";

function outfitCard(c, publisherReady) {
  const sheets = c.sheets;
  const def = sheets.find((s) => s.isDefault) ?? sheets[0];
  if (!def) {
    return h("li", { class: "card char-card" }, h("h2", { id: `c-${c.id}` }, c.displayName), notice("warn", h("p", {}, "No sheet image for this character yet. Add one below.")), addSheetForm(c, publisherReady));
  }
  const img = h("img", { src: repoImage(def.path, 480), alt: `${c.displayName}, ${def.label}`, loading: "lazy", decoding: "async", width: "480", height: "320" });
  const caption = h("figcaption", {}, h("span", { class: "outfit-name" }, def.label), def.isDefault ? badge("approved", "Default") : null);
  const fullLink = h("a", { href: repoImage(def.path), target: "_blank", rel: "noopener", class: "small" }, "Open full size", h("span", { class: "visually-hidden" }, " (opens in a new tab)"));
  const select = h("select", { id: `outfit-${c.id}` }, ...sheets.map((s) => h("option", { value: s.path, selected: s === def }, `${s.label}${s.isDefault ? " (default)" : ""}`)));
  const rename = h("input", { type: "text", maxlength: "80", value: def.label, id: `rename-${c.id}` });
  const renameBtn = h("button", { class: "btn btn-small", type: "button" }, "Save name");
  const show = (path) => {
    const s = sheets.find((x) => x.path === path);
    if (!s) return;
    img.src = repoImage(s.path, 480);
    img.alt = `${c.displayName}, ${s.label}`;
    clear(caption).append(h("span", { class: "outfit-name" }, s.label), s.isDefault ? badge("approved", "Default") : "");
    fullLink.href = repoImage(s.path);
    rename.value = s.label;
  };
  select.addEventListener("change", () => show(select.value));
  renameBtn.addEventListener("click", () =>
    act(renameBtn, () => put("/sheets/label", { path: select.value, label: rename.value.trim() }), "Outfit name saved.")
      .then(() => {
        const s = sheets.find((x) => x.path === select.value);
        if (s) s.label = rename.value.trim() || s.label;
        select.selectedOptions[0].textContent = `${s.label}${s.isDefault ? " (default)" : ""}`;
        show(select.value);
      })
      .catch(() => undefined),
  );
  return h(
    "li",
    { class: "card char-card" },
    h("h2", { id: `c-${c.id}` }, c.displayName),
    h("figure", { class: "outfit-preview" }, img, caption),
    fullLink,
    field({ id: `outfit-${c.id}`, label: `Outfit (${sheets.length})`, input: select }),
    h("div", { class: "inline-form" }, field({ id: `rename-${c.id}`, label: "Name this outfit", input: rename, hint: "Shown in pickers. Saved in the studio, not the repository." }), renameBtn),
    addSheetForm(c, publisherReady),
  );
}

function addSheetForm(c, publisherReady) {
  const file = h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: true });
  const name = h("input", { type: "text", name: "label", required: true, minlength: "2", maxlength: "80" });
  const result = h("div", { "aria-live": "polite" });
  const btn = h("button", { class: "btn btn-small", type: "submit", disabled: !publisherReady }, "Open pull request");
  const form = h(
    "form",
    {},
    h("div", { class: "form-grid" }, field({ id: `sheet-file-${c.id}`, label: "Sheet image (under 4 MB)", input: file }), field({ id: `sheet-name-${c.id}`, label: "Outfit name", input: name, hint: "For example: Winter coat" })),
    btn,
    result,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await act(btn, () => post(`/characters/${c.id}/sheets`, new FormData(form)), "Pull request opened.").catch(() => null);
    if (res) clear(result).append(prLink(res.prUrl));
  });
  return h("details", { class: "add-sheet" }, h("summary", {}, "Add an outfit sheet"), form);
}

function newCharacterForm(publisherReady) {
  const name = h("input", { type: "text", name: "displayName", required: true, minlength: "2", maxlength: "80" });
  const role = h("textarea", { name: "role", rows: "2", maxlength: "400" });
  const file = h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp" });
  const result = h("div", { "aria-live": "polite" });
  const btn = h("button", { class: "btn", type: "submit", disabled: !publisherReady }, "Open pull request");
  const form = h(
    "form",
    { class: "panel form-card", id: "new-character" },
    h("h2", {}, "Add a character"),
    h("p", { class: "small muted" }, "Creates characters/<name>/ from the character template in a pull request. They appear here once you merge it."),
    h("div", { class: "form-grid" }, field({ id: "nc-name", label: "Name", input: name }), field({ id: "nc-role", label: "Role in the story", input: role }), field({ id: "nc-file", label: "First sheet (optional, under 4 MB)", input: file })),
    btn,
    result,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await act(btn, () => api("POST", "/create/character", new FormData(form)), "Pull request opened.").catch(() => null);
    if (res) clear(result).append(prLink(res.prUrl));
  });
  return form;
}

function uploadsSection(characters, chapters, uploads) {
  const form = h(
    "form",
    { class: "form-card", id: "upload-form" },
    h("p", { class: "small muted" }, "Extra outfit or location images stored in the studio (not the repository). Approve one to attach it automatically to matching pages, after the character's sheet."),
    h(
      "div",
      { class: "form-grid" },
      field({ id: "ref-file", label: "Image (PNG, JPEG or WebP, under 4 MB)", input: h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: true }) }),
      field({ id: "ref-label", label: "Label", input: h("input", { type: "text", name: "label", required: true, minlength: "3", maxlength: "120" }), hint: "For example: Ruby, pale lavender cardigan" }),
      field({ id: "ref-kind", label: "Type", input: h("select", { name: "kind" }, h("option", { value: "outfit" }, "Outfit"), h("option", { value: "location" }, "Location"), h("option", { value: "experimental" }, "Keep, never attach")) }),
      field({ id: "ref-character", label: "Character", input: h("select", { name: "characterId" }, h("option", { value: "" }, "None (locations)"), ...characters.map((c) => h("option", { value: c.id }, c.displayName))) }),
      field({ id: "ref-chapter", label: "Limit to chapter", input: h("select", { name: "chapterId" }, h("option", { value: "" }, "All chapters"), ...chapters.map((c) => h("option", { value: c.id }, `${c.id}: ${c.title}`))) }),
      field({ id: "ref-pages", label: "Limit to pages", input: h("input", { type: "text", name: "pages", inputmode: "numeric", placeholder: "e.g. 28-30" }), hint: "Leave empty for every page." }),
    ),
    h("button", { class: "btn", type: "submit" }, "Upload"),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await act(form.querySelector("button[type=submit]"), () => post("/references", new FormData(form)), "Uploaded. Approve it to use it.")
      .then(() => charactersView())
      .catch(() => undefined);
  });
  const table = uploads.length
    ? h(
        "div",
        { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Uploaded references" },
        h(
          "table",
          {},
          h("caption", { class: "visually-hidden" }, "Uploaded references"),
          h("thead", {}, h("tr", {}, ["Image", "Label", "Type", "Used for", "Status", "Action"].map((t) => h("th", { scope: "col" }, t)))),
          h(
            "tbody",
            {},
            ...uploads.map((u) => {
              const next = u.status === "approved" ? "experimental" : "approved";
              const btn = h("button", { class: "btn btn-small", type: "button", disabled: u.kind === "experimental" && next === "approved" }, next === "approved" ? "Approve" : "Stop using");
              btn.addEventListener("click", () => act(btn, () => post(`/references/${u.id}/status`, { status: next }), next === "approved" ? "Approved." : "No longer attached.").then(charactersView).catch(() => undefined));
              return h(
                "tr",
                {},
                h("td", {}, h("img", { src: `/api/studio/references/${u.id}/image?thumb=1`, alt: u.label, width: "96", loading: "lazy" })),
                h("td", {}, u.label),
                h("td", {}, label(u.kind)),
                h("td", {}, [u.character_id, u.chapter_id ? `chapter ${u.chapter_id}` : "all chapters", u.pages ? `pages ${u.pages.join(", ")}` : "all pages"].filter(Boolean).join(", ")),
                h("td", {}, badge(u.status === "approved" ? "approved" : "pending", u.status === "approved" ? "In use" : "Not used")),
                h("td", {}, btn),
              );
            }),
          ),
        ),
      )
    : h("p", { class: "muted" }, "None yet.");
  return h("details", { class: "panel-details" }, h("summary", {}, `Extra reference images (${uploads.length})`), form, table);
}

export async function charactersView() {
  const [{ characters, uploads, publisherReady }, { chapters }] = await Promise.all([get("/characters"), get("/chapters")]);
  render(
    head("Characters", "Every sheet under characters/ counts as an outfit. Pick one to preview it. The default is used unless you choose another outfit for a page."),
    errorBox(),
    !publisherReady ? notice("warn", h("p", {}, "Adding characters or sheets needs GITHUB_TOKEN on the server.")) : null,
    h("ul", { class: "char-grid", "aria-label": "Characters" }, ...characters.map((c) => outfitCard(c, publisherReady))),
    newCharacterForm(publisherReady),
    section("Extra references", "uploads-title", uploadsSection(characters, chapters, uploads)),
  );
}

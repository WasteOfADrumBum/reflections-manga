// Character library: every sheet is an outfit; one picker swaps the preview.
import { api, get, post, put } from "../api.js";
import { act, errorBox, head, prLink, render, repoImage, section } from "../shared.js";
import { badge, confirmDialog, field, fill, h, label, notice, sheetOptions, veil } from "../ui.js";

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");

function outfitCard(c, publisherReady, categories) {
  const sheets = c.sheets;
  const def = sheets.find((s) => s.isDefault) ?? sheets[0];
  if (!def) {
    return h("li", { class: "card char-card" }, h("h2", { id: `c-${c.id}` }, c.displayName), notice("warn", h("p", {}, "No sheet image for this character yet. Add one below.")), addSheetForm(c, publisherReady, categories));
  }
  const img = h("img", { src: repoImage(def.path, 480), alt: `${c.displayName}, ${def.label}`, loading: "lazy", decoding: "async", width: "480", height: "320" });
  const frame = veil(img, def.sensitive, `${c.displayName}, ${def.label}`);
  const name = h("p", { class: "outfit-name" }, def.label);
  const tags = h("span", { class: "badge-row" });
  const fullLink = h("a", { href: repoImage(def.path), target: "_blank", rel: "noopener", class: "small" }, "Open full size", h("span", { class: "visually-hidden" }, " (opens in a new tab)"));
  const select = h("select", { id: `outfit-${c.id}` }, ...sheetOptions(sheets, def.path, (s) => (s.isDefault ? " (default)" : "")));
  const rename = h("input", { type: "text", maxlength: "80", value: def.label, id: `rename-${c.id}` });
  const renameBtn = h("button", { class: "btn btn-small", type: "button" }, "Save name");
  const catSelect = h("select", { id: `cat-${c.id}` }, ...categories.map((k) => h("option", { value: k }, cap(k))));
  const catBtn = h("button", { class: "btn btn-small", type: "button", disabled: !publisherReady }, "Change category");
  const catResult = h("div", { "aria-live": "polite" });
  const catForm = h(
    "div",
    { class: "cat-form" },
    field({ id: `cat-${c.id}`, label: "Category", input: catSelect, hint: "Moves the sheet into its category in a pull request." }),
    catBtn,
  );
  const show = (path) => {
    const s = sheets.find((x) => x.path === path);
    if (!s) return;
    img.src = repoImage(s.path, 480);
    img.alt = `${c.displayName}, ${s.label}`;
    frame.setSensitive(s.sensitive, `${c.displayName}, ${s.label}`);
    name.textContent = s.label;
    fill(
      tags,
      s.isDefault ? badge("approved", "Main sheet") : s.needsReview ? badge("uncertain", "Needs a category") : s.category ? badge("queued", cap(s.category)) : null,
      s.sensitive ? badge("pending", "18+") : null,
    );
    fullLink.href = repoImage(s.path);
    rename.value = s.label;
    catForm.hidden = s.isDefault;
    catSelect.value = s.category ?? categories[0];
    fill(catResult);
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
  catBtn.addEventListener("click", async () => {
    const s = sheets.find((x) => x.path === select.value);
    if (!s) return;
    const ok = await confirmDialog({
      title: `Move "${s.label}" to ${cap(catSelect.value)}?`,
      body: h("p", {}, `Opens a pull request that moves this sheet into ${c.firstName}'s ${catSelect.value} outfits, updates the asset manifest and fixes every link to it. Nothing changes until you merge it.`),
      confirmLabel: "Open pull request",
    });
    if (!ok) return;
    const res = await act(catBtn, () => post(`/characters/${c.id}/sheets/category`, { path: s.path, category: catSelect.value }), "Pull request opened.").catch(() => null);
    if (res) fill(catResult, prLink(res.prUrl));
  });
  show(def.path);
  return h(
    "li",
    { class: "card char-card" },
    h("h2", { id: `c-${c.id}` }, c.displayName),
    c.group ? h("p", { class: "eyebrow" }, c.group) : null,
    h("figure", { class: "outfit-preview" }, frame, h("figcaption", {}, name, tags)),
    fullLink,
    field({ id: `outfit-${c.id}`, label: `Outfit (${sheets.length})`, input: select }),
    h("div", { class: "inline-form" }, field({ id: `rename-${c.id}`, label: "Name this outfit", input: rename, hint: "Shown in pickers. Saved in the studio, not the repository." }), renameBtn),
    catForm,
    catResult,
    addSheetForm(c, publisherReady, categories),
  );
}

function addSheetForm(c, publisherReady, categories) {
  const file = h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: true });
  const name = h("input", { type: "text", name: "label", required: true, minlength: "2", maxlength: "80" });
  const category = h("select", { name: "category", required: true }, ...categories.map((k) => h("option", { value: k }, k.charAt(0).toUpperCase() + k.slice(1))));
  const result = h("div", { "aria-live": "polite" });
  const btn = h("button", { class: "btn btn-small", type: "submit", disabled: !publisherReady }, "Open pull request");
  const form = h(
    "form",
    {},
    h(
      "div",
      { class: "form-grid" },
      field({ id: `sheet-file-${c.id}`, label: "Sheet image (under 4 MB)", input: file }),
      field({ id: `sheet-name-${c.id}`, label: "Outfit name", input: name, hint: "For example: Winter coat" }),
      field({ id: `sheet-cat-${c.id}`, label: "Category", input: category }),
    ),
    btn,
    result,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await act(btn, () => post(`/characters/${c.id}/sheets`, new FormData(form)), "Pull request opened.").catch(() => null);
    if (res) fill(result, prLink(res.prUrl));
  });
  return h("details", { class: "add-sheet" }, h("summary", {}, "Add an outfit sheet"), form);
}

function newCharacterForm(publisherReady, groups) {
  const name = h("input", { type: "text", name: "displayName", required: true, minlength: "2", maxlength: "80" });
  const group = h("select", { name: "group", required: true }, ...(groups.length ? groups : [{ key: "main", label: "Main Cast" }, { key: "friends", label: "Friends" }]).map((g) => h("option", { value: g.key }, g.label)));
  const role = h("textarea", { name: "role", rows: "2", maxlength: "400" });
  const file = h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: true });
  const result = h("div", { "aria-live": "polite" });
  const btn = h("button", { class: "btn", type: "submit", disabled: !publisherReady }, "Open pull request");
  const form = h(
    "form",
    { class: "box form-card", id: "new-character" },
    h("h2", {}, "Add a character"),
    h("p", { class: "small muted" }, "Creates the character's folder in their cast group from the character template, with their main reference sheet, in a pull request. They appear here once you merge it."),
    h(
      "div",
      { class: "form-grid" },
      field({ id: "nc-name", label: "Name", input: name }),
      field({ id: "nc-group", label: "Cast group", input: group }),
      field({ id: "nc-file", label: "Main reference sheet (under 4 MB)", input: file }),
      field({ id: "nc-role", label: "Role in the story", input: role }),
    ),
    btn,
    result,
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await act(btn, () => api("POST", "/create/character", new FormData(form)), "Pull request opened.").catch(() => null);
    if (res) fill(result, prLink(res.prUrl));
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

/** Characters grouped like the cast folders (Main Cast, each family, Friends). */
function castSections(characters, groups, card) {
  const labels = [...groups.map((g) => g.label), ...new Set(characters.map((c) => c.group).filter((g) => g && !groups.some((x) => x.label === g)))];
  const sections = labels
    .map((label) => [label, characters.filter((c) => c.group === label)])
    .filter(([, list]) => list.length)
    .map(([label, list], i) => section(label, `cast-${i}`, h("ul", { class: "char-grid", "aria-label": label }, ...list.map(card))));
  const rest = characters.filter((c) => !c.group || !labels.includes(c.group));
  if (rest.length) sections.push(section(sections.length ? "Other characters" : "Cast", "cast-rest", h("ul", { class: "char-grid", "aria-label": "Characters" }, ...rest.map(card))));
  return sections;
}

export async function charactersView() {
  const [{ characters, uploads, publisherReady, groups = [], categories = [] }, { chapters }] = await Promise.all([get("/characters"), get("/chapters")]);
  render(
    head("Characters", "Every sheet under characters/ counts as an outfit. Pick one to preview it. The default is used unless you choose another outfit for a page."),
    errorBox(),
    !publisherReady ? notice("warn", h("p", {}, "Adding characters or sheets needs GITHUB_TOKEN on the server.")) : null,
    ...castSections(characters, groups, (c) => outfitCard(c, publisherReady, categories)),
    newCharacterForm(publisherReady, groups),
    section("Extra references", "uploads-title", uploadsSection(characters, chapters, uploads)),
  );
}

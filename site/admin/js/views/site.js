// Public site images: show or hide gallery and album photos, add character sheets
// from the repository, blur revealing images behind an 18+ check, and arrange the
// Memories album (order, captions, descriptions). Everything goes out as one pull request.
import { api, get, post } from "../api.js";
import { act, errorBox, head, prLink, render, repoImage, section } from "../shared.js";
import { alertMessage, announce, confirmDialog, field, fill, h, notice, veil } from "../ui.js";

const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");

export async function siteView() {
  const d = await get("/site/images");
  const vis = d.visibility;

  // ---- state ----
  const galleries = d.characters.map((c) => ({
    ...c,
    images: [
      ...c.images.map((img) => ({ href: img.href, thumb: img.thumb, alt: img.alt })),
      ...(vis.characterAdditions[c.id] ?? []).map((a) => ({ href: a.full, thumb: a.src, alt: a.alt })),
    ],
  }));
  const state = {
    characters: Object.fromEntries(galleries.map((c) => [c.id, new Set(vis.hidden.characters[c.id] ?? [])])),
    album: new Set(vis.hidden.album),
    sensitive: new Set(vis.sensitive),
    addSheets: new Map(),
    captions: {},
    add: new Set(),
  };
  for (const [k, v] of Object.entries(vis.album.captions ?? {})) state.captions[k] = { ...v };

  const albumDefaults = [
    ...d.album.map((a) => ({ href: a.href, thumb: a.thumb, title: a.title ?? "", alt: a.alt ?? "", studio: false })),
    ...vis.albumAdditions.map((a) => ({ href: a.full, thumb: a.src, title: a.title ?? "", alt: a.alt ?? "", studio: true })),
  ];
  const defaultOrder = albumDefaults.map((a) => a.href);
  const savedOrder = vis.album.order ?? [];
  const rank = (href) => {
    const i = savedOrder.indexOf(href);
    return i === -1 ? savedOrder.length + defaultOrder.indexOf(href) : i;
  };
  let order = [...defaultOrder].sort((a, b) => rank(a) - rank(b));
  const byHref = new Map(albumDefaults.map((a) => [a.href, a]));

  const safeId = (s) => s.replace(/[^\w-]/g, "-");
  const checkbox = (id, checked, text, srText, onChange) => {
    const box = h("input", { type: "checkbox", id, checked });
    box.addEventListener("change", () => onChange(box.checked));
    return h("label", { class: "vis-toggle", for: id }, box, h("span", {}, text), srText ? h("span", { class: "visually-hidden" }, ` ${srText}`) : null);
  };
  const thumbImg = (src, alt, sensitive, label) => (src ? veil(h("img", { src, alt: alt ?? "", width: "160", height: "107", loading: "lazy", decoding: "async" }), sensitive, label) : null);

  // ---- character galleries ----
  const sheetsById = new Map((d.sheets ?? []).map((c) => [c.id, c]));
  const charSections = galleries.map((c) => {
    const hiddenSet = state.characters[c.id];
    const extra = sheetsById.get(c.id)?.sheets ?? [];
    return h(
      "details",
      { class: "vis-group" },
      h("summary", {}, `${c.name}: ${c.images.length} on the site${extra.length ? `, ${extra.length} more in the repository` : ""}`),
      h(
        "ul",
        { class: "vis-grid", "aria-label": `${c.name}'s gallery` },
        ...c.images.map((img) => {
          const text = img.alt ?? img.href;
          return h(
            "li",
            { class: "vis-item" },
            thumbImg(img.thumb, img.alt, state.sensitive.has(img.href), text),
            h("p", { class: "small" }, text),
            checkbox(`show-${c.id}-${safeId(img.href)}`, !hiddenSet.has(img.href), "Show", `${text} in ${c.name}'s gallery`, (on) => (on ? hiddenSet.delete(img.href) : hiddenSet.add(img.href))),
            checkbox(`blur-${c.id}-${safeId(img.href)}`, state.sensitive.has(img.href), "Blur (18+)", text, (on) => (on ? state.sensitive.add(img.href) : state.sensitive.delete(img.href))),
          );
        }),
      ),
      extra.length
        ? h(
            "div",
            { class: "vis-extra" },
            h("h3", {}, "In the repository, not on the site"),
            h("p", { class: "small muted" }, "Tick Show to add a sheet to the gallery when you publish. Revealing sheets start blurred."),
            h(
              "ul",
              { class: "vis-grid", "aria-label": `${c.name}'s sheets not on the site` },
              ...extra.map((s) => {
                const text = `${s.label}${s.needsReview ? " (needs a category)" : s.category ? ` (${s.category})` : ""}`;
                const pick = { characterId: c.id, path: s.path, sensitive: s.sensitive };
                return h(
                  "li",
                  { class: "vis-item" },
                  thumbImg(repoImage(s.path, 320), `${c.name}, ${s.label}`, s.sensitive, `${c.name}, ${s.label}`),
                  h("p", { class: "small" }, cap(text)),
                  checkbox(`add-${safeId(s.path)}`, false, "Show", `${text} in ${c.name}'s gallery`, (on) => (on ? state.addSheets.set(s.path, pick) : state.addSheets.delete(s.path))),
                  checkbox(`addblur-${safeId(s.path)}`, s.sensitive, "Blur (18+)", text, (on) => (pick.sensitive = on)),
                );
              }),
            ),
          )
        : null,
    );
  });

  // ---- Memories album: order, captions, descriptions ----
  const albumList = h("ol", { class: "album-list", "aria-label": "Memories album, in order" });
  let dragging = null;
  const captionOf = (href) => ({ title: state.captions[href]?.title ?? byHref.get(href).title, alt: state.captions[href]?.alt ?? byHref.get(href).alt });

  function move(href, to, focusClass) {
    const from = order.indexOf(href);
    if (from === -1 || to < 0 || to >= order.length || to === from) return;
    order.splice(from, 1);
    order.splice(to, 0, href);
    drawAlbum();
    announce(`${captionOf(href).title || "Photo"} moved to position ${to + 1} of ${order.length}.`);
    const item = [...albumList.children].find((li) => li.dataset.href === href);
    if (item && focusClass) item.querySelector(`.${focusClass}`)?.focus();
  }

  function albumItem(href, i) {
    const a = byHref.get(href);
    const c = captionOf(href);
    const id = safeId(href);
    const title = h("input", { type: "text", maxlength: "80", value: c.title });
    const alt = h("textarea", { rows: "3", maxlength: "600" }, c.alt);
    const changed = h("p", { class: "changed-note", hidden: !state.captions[href] }, "Changed from the default");
    const reset = h("button", { class: "btn btn-small", type: "button", hidden: !state.captions[href] }, "Reset to default");
    const sync = () => {
      const o = {};
      if (title.value.trim() && title.value.trim() !== a.title) o.title = title.value.trim();
      if (alt.value.trim() && alt.value.trim() !== a.alt) o.alt = alt.value.trim();
      if (o.title || o.alt) state.captions[href] = o;
      else delete state.captions[href];
      changed.hidden = reset.hidden = !state.captions[href];
    };
    title.addEventListener("input", sync);
    alt.addEventListener("input", sync);
    reset.addEventListener("click", () => {
      delete state.captions[href];
      title.value = a.title;
      alt.value = a.alt;
      changed.hidden = reset.hidden = true;
      announce("Caption and description reset to the default.");
      title.focus();
    });
    const up = h("button", { class: "btn btn-small move-up", type: "button", disabled: i === 0, "aria-label": `Move ${c.title || "photo"} up` }, "Move up");
    const down = h("button", { class: "btn btn-small move-down", type: "button", disabled: i === order.length - 1, "aria-label": `Move ${c.title || "photo"} down` }, "Move down");
    up.addEventListener("click", () => move(href, i - 1, i - 1 === 0 ? "move-down" : "move-up"));
    down.addEventListener("click", () => move(href, i + 1, i + 1 === order.length - 1 ? "move-up" : "move-down"));
    const li = h(
      "li",
      { class: `album-item${state.album.has(href) ? " is-hidden" : ""}`, draggable: "true", "data-href": href },
      h("div", { class: "album-head" }, h("strong", {}, `${i + 1} of ${order.length}`), h("span", { class: "drag-handle", "aria-hidden": "true", title: "Drag to reorder" }, "⠿")),
      thumbImg(a.thumb, c.alt, state.sensitive.has(href), c.title),
      field({ id: `cap-${id}`, label: "Caption", input: title }),
      field({ id: `alt-${id}`, label: "Description for screen readers", input: alt }),
      changed,
      reset,
      h("div", { class: "order-btns" }, up, down),
      checkbox(`show-album-${id}`, !state.album.has(href), "Show", `${c.title} in the album`, (on) => {
        if (on) state.album.delete(href);
        else state.album.add(href);
        li.classList.toggle("is-hidden", !on);
      }),
      checkbox(`blur-album-${id}`, state.sensitive.has(href), "Blur (18+)", c.title, (on) => (on ? state.sensitive.add(href) : state.sensitive.delete(href))),
      a.studio ? h("p", { class: "small muted" }, "Added in the studio.") : null,
    );
    li.addEventListener("dragstart", (e) => {
      dragging = href;
      li.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", href);
    });
    li.addEventListener("dragend", () => {
      dragging = null;
      li.classList.remove("is-dragging");
      albumList.querySelectorAll(".drop-before").forEach((x) => x.classList.remove("drop-before"));
    });
    li.addEventListener("dragover", (e) => {
      if (!dragging || dragging === href) return;
      e.preventDefault();
      albumList.querySelectorAll(".drop-before").forEach((x) => x.classList.remove("drop-before"));
      li.classList.add("drop-before");
    });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragging || dragging === href) return;
      const target = order.indexOf(href);
      const from = order.indexOf(dragging);
      move(dragging, from < target ? target - 1 : target);
    });
    // Selecting text in a field should never start a drag.
    for (const input of [title, alt]) {
      input.addEventListener("focus", () => li.setAttribute("draggable", "false"));
      input.addEventListener("blur", () => li.setAttribute("draggable", "true"));
    }
    return li;
  }

  function drawAlbum() {
    fill(albumList, ...order.map((href, i) => albumItem(href, i)));
  }
  drawAlbum();

  const resetOrder = h("button", { class: "btn btn-small", type: "button" }, "Reset album order");
  resetOrder.addEventListener("click", () => {
    order = [...defaultOrder];
    drawAlbum();
    announce("Album order reset to the default.");
  });

  // ---- new album photos ----
  const drafts = d.drafts.filter((x) => x.status === "draft");
  const draftList = drafts.length
    ? h(
        "ul",
        { class: "vis-grid" },
        ...drafts.map((x) => {
          const id = `add-${x.id}`;
          const box = h("input", { type: "checkbox", id, checked: true });
          state.add.add(x.id);
          box.addEventListener("change", () => (box.checked ? state.add.add(x.id) : state.add.delete(x.id)));
          const remove = h("button", { class: "btn btn-small", type: "button" }, "Remove");
          remove.addEventListener("click", () => act(remove, () => api("DELETE", `/site/album-items/${x.id}`), "Photo removed.").then(siteView).catch(() => undefined));
          return h(
            "li",
            { class: "vis-item" },
            h("img", { src: `/api/studio/site/album-items/${x.id}/image`, alt: x.alt, width: "160", height: "107", loading: "lazy" }),
            h("p", { class: "small" }, x.title),
            h("label", { class: "vis-toggle", for: id }, box, h("span", {}, "Add to album")),
            remove,
          );
        }),
      )
    : h("p", { class: "muted" }, "No new photos waiting.");

  const upFile = h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: true });
  const upTitle = h("input", { type: "text", name: "title", required: true, minlength: "2", maxlength: "80" });
  const upAlt = h("textarea", { name: "alt", rows: "3", required: true, minlength: "20", maxlength: "600" });
  const upBtn = h("button", { class: "btn", type: "submit" }, "Add photo");
  const upForm = h(
    "form",
    { id: "album-upload", class: "form-card" },
    h("p", { class: "small muted" }, "Make the photo anywhere (ChatGPT works, at no API cost), then add it here. New photos go at the end of the album when you publish; you can move them afterwards."),
    h("div", { class: "form-grid" }, field({ id: "album-file", label: "Photo (under 4 MB)", input: upFile }), field({ id: "album-title", label: "Caption", input: upTitle }), field({ id: "album-alt", label: "Description for screen readers", input: upAlt, hint: "Who is in it and what is happening." })),
    upBtn,
  );
  upForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await act(upBtn, () => api("POST", "/site/album-items", new FormData(upForm)), "Photo added. Publish to put it in the album.").then(siteView).catch(() => undefined);
  });

  // ---- publish ----
  const result = h("div", { "aria-live": "polite" });
  const publish = h("button", { class: "btn btn-primary", type: "button", disabled: !d.publisherReady }, "Publish site image changes");
  publish.addEventListener("click", async () => {
    const hidden = { characters: Object.fromEntries(Object.entries(state.characters).filter(([, s]) => s.size).map(([k, s]) => [k, [...s]])), album: [...state.album] };
    const sameOrder = order.every((href, i) => href === defaultOrder[i]);
    const addSheets = [...state.addSheets.values()];
    const hiddenCount = Object.values(hidden.characters).reduce((n, l) => n + l.length, 0) + hidden.album.length;
    const captionCount = Object.keys(state.captions).length;
    const ok = await confirmDialog({
      title: "Publish site image changes?",
      body: h(
        "div",
        {},
        h("p", {}, "Opens a pull request. Nothing changes on the site until you merge it."),
        h(
          "ul",
          {},
          h("li", {}, `${hiddenCount} image(s) hidden`),
          h("li", {}, `${state.sensitive.size + addSheets.filter((s) => s.sensitive).length} image(s) blurred until 18+ is confirmed`),
          addSheets.length ? h("li", {}, `${addSheets.length} sheet(s) added to character galleries`) : null,
          state.add.size ? h("li", {}, `${state.add.size} new album photo(s)`) : null,
          captionCount ? h("li", {}, `${captionCount} album caption(s) or description(s) changed`) : null,
          h("li", {}, sameOrder ? "Album order unchanged" : "New album order"),
        ),
        h("p", { class: "small" }, "Nothing is deleted; hidden images stay in the repository and can be shown again."),
      ),
      confirmLabel: "Open pull request",
    });
    if (!ok) return;
    const res = await act(
      publish,
      () =>
        post("/site/publish", {
          hidden,
          sensitive: [...state.sensitive],
          album: { order: sameOrder ? [] : order, captions: state.captions },
          addSheets,
          addAlbumItems: [...state.add],
          confirm: true,
        }),
      "Pull request opened.",
    ).catch(() => null);
    if (res) fill(result, prLink(res.prUrl));
    else alertMessage("The change was not published.");
  });

  render(
    head("Site images", "Choose what the public Characters and Memories pages show, blur revealing images behind an 18+ check, and arrange the album. Changes go out as one pull request."),
    errorBox(),
    !d.publisherReady ? notice("warn", h("p", {}, "Publishing needs GITHUB_TOKEN on the server.")) : null,
    section(
      "Character galleries",
      "vis-chars",
      h("p", { class: "small muted" }, "Untick Show to hide an image from that character's gallery; the same photo can stay in other galleries. Blurred images show an eye button, and readers must confirm they are 18 or older to see them."),
      ...charSections,
    ),
    section(
      "Memories album",
      "vis-album",
      h("p", { class: "small muted" }, "Drag a photo to move it, or use Move up and Move down. Edit a caption or description in place; Reset to default brings back the original. Photos in the repository can be hidden but not deleted."),
      h("div", { class: "btn-row" }, resetOrder),
      albumList,
    ),
    section("New album photos", "vis-new", draftList, upForm),
    h("div", { class: "btn-row sticky-actions" }, publish),
    result,
  );
}

// Public site images: show or hide gallery and album photos, and add album photos.
import { api, get, post } from "../api.js";
import { act, errorBox, head, prLink, render, section } from "../shared.js";
import { alertMessage, clear, confirmDialog, field, h, notice } from "../ui.js";

export async function siteView() {
  const d = await get("/site/images");
  const vis = d.visibility;
  const state = {
    characters: Object.fromEntries(d.characters.map((c) => [c.id, new Set(vis.hidden.characters[c.id] ?? [])])),
    album: new Set(vis.hidden.album),
    add: new Set(),
  };

  const toggle = (scope, key, href, labelText) => {
    const id = `vis-${scope}-${key}-${href}`.replace(/[^\w-]/g, "-");
    const set = scope === "album" ? state.album : state.characters[key];
    const box = h("input", { type: "checkbox", id, checked: !set.has(href) });
    box.addEventListener("change", () => (box.checked ? set.delete(href) : set.add(href)));
    return h("label", { class: "vis-toggle", for: id }, box, h("span", {}, "Show"), h("span", { class: "visually-hidden" }, ` ${labelText}`));
  };

  const thumb = (src, alt) => (src ? h("img", { src, alt: alt ?? "", width: "160", height: "107", loading: "lazy", decoding: "async" }) : null);

  const charSections = d.characters.map((c) =>
    h(
      "details",
      { class: "vis-group" },
      h("summary", {}, `${c.name} (${c.images.length} images)`),
      h(
        "ul",
        { class: "vis-grid" },
        ...c.images.map((img) => h("li", { class: "vis-item" }, thumb(img.thumb, img.alt), h("p", { class: "small" }, img.alt ?? img.href), toggle("char", c.id, img.href, `${img.alt ?? img.href} in ${c.name}'s gallery`))),
      ),
    ),
  );

  const albumList = h(
    "ul",
    { class: "vis-grid" },
    ...d.album.map((img) => h("li", { class: "vis-item" }, thumb(img.thumb, img.alt), h("p", { class: "small" }, img.title ?? img.href), toggle("album", "album", img.href, `${img.title ?? img.href} in the album`))),
    ...vis.albumAdditions.map((img) => h("li", { class: "vis-item" }, thumb(img.src, img.alt), h("p", { class: "small" }, `${img.title} (added in the studio)`), toggle("album", "album", img.full, `${img.title} in the album`))),
  );

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
          return h("li", { class: "vis-item" }, h("img", { src: `/api/studio/site/album-items/${x.id}/image`, alt: x.alt, width: "160", height: "107", loading: "lazy" }), h("p", { class: "small" }, x.title), h("label", { class: "vis-toggle", for: id }, box, h("span", {}, "Add to album")));
        }),
      )
    : h("p", { class: "muted" }, "No new photos waiting.");

  const upFile = h("input", { type: "file", name: "file", accept: "image/png,image/jpeg,image/webp", required: true });
  const upTitle = h("input", { type: "text", name: "title", required: true, minlength: "2", maxlength: "80" });
  const upAlt = h("textarea", { name: "alt", rows: "3", required: true, minlength: "20", maxlength: "600" });
  const upBtn = h("button", { class: "btn", type: "submit" }, "Add photo");
  const upForm = h(
    "form",
    { id: "album-upload" },
    h("p", { class: "small muted" }, "Make the photo anywhere (ChatGPT works, at no API cost), then add it here. New photos go at the end of the album when you publish."),
    h("div", { class: "form-grid" }, field({ id: "album-file", label: "Photo (under 4 MB)", input: upFile }), field({ id: "album-title", label: "Caption", input: upTitle }), field({ id: "album-alt", label: "Description for screen readers", input: upAlt, hint: "Who is in it and what is happening." })),
    upBtn,
  );
  upForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await act(upBtn, () => api("POST", "/site/album-items", new FormData(upForm)), "Photo added. Publish to put it in the album.").then(siteView).catch(() => undefined);
  });

  const result = h("div", { "aria-live": "polite" });
  const publish = h("button", { class: "btn btn-primary", type: "button", disabled: !d.publisherReady }, "Publish site image changes");
  publish.addEventListener("click", async () => {
    const hidden = { characters: Object.fromEntries(Object.entries(state.characters).filter(([, s]) => s.size).map(([k, s]) => [k, [...s]])), album: [...state.album] };
    const count = Object.values(hidden.characters).reduce((n, l) => n + l.length, 0) + hidden.album.length;
    const ok = await confirmDialog({
      title: "Publish site image changes?",
      body: h("p", {}, `Opens a pull request: ${count} image(s) hidden, ${state.add.size} new album photo(s). Nothing is deleted; hidden images stay in the repository and can be shown again.`),
      confirmLabel: "Open pull request",
    });
    if (!ok) return;
    const res = await act(publish, () => post("/site/publish", { hidden, addAlbumItems: [...state.add], confirm: true }), "Pull request opened.").catch(() => null);
    if (res) clear(result).append(prLink(res.prUrl));
    else alertMessage("The change was not published.");
  });

  render(
    head("Site images", "Choose what the public Characters and Memories pages show, and add album photos. Changes go out as one pull request."),
    errorBox(),
    !d.publisherReady ? notice("warn", h("p", {}, "Publishing needs GITHUB_TOKEN on the server.")) : null,
    section("Character galleries", "vis-chars", h("p", { class: "small muted" }, "Untick to hide an image from that character's gallery. The same photo can stay in other galleries."), ...charSections),
    section("Memories album", "vis-album", albumList),
    section("New album photos", "vis-new", draftList, upForm),
    h("div", { class: "btn-row sticky-actions" }, publish),
    result,
  );
}

// Reflections site: navigation toggle and chapter reader. No dependencies.
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  // Mobile navigation
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-open");
        toggle.focus();
      }
    });
  }

  // Chapter reader
  var reader = document.getElementById("reader");
  var chapters = window.REFLECTIONS_CHAPTERS || [];
  if (!reader) return;

  var select = reader.querySelector("#chapter-select");
  var stage = reader.querySelector(".reader-stage");
  var prev = reader.querySelector("[data-reader-prev]");
  var next = reader.querySelector("[data-reader-next]");
  var status = reader.querySelector("[data-reader-status]");
  var state = { chapter: 0, page: 0 };

  function escapeText(str) {
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function renderEmpty(ch) {
    stage.innerHTML =
      '<div class="empty">' +
      '<div class="empty-art" aria-hidden="true"></div>' +
      "<h3>" + escapeText(ch ? "Chapter " + ch.id + " pages are on the way" : "No chapters yet") + "</h3>" +
      "<p>" + escapeText(ch && ch.note ? ch.note : "Pages will appear here as soon as they are finished and approved.") + "</p>" +
      "</div>";
    prev.disabled = true;
    next.disabled = true;
    status.textContent = ch ? "Chapter " + ch.id + ": no pages released yet." : "No chapters released yet.";
  }

  function render(announce) {
    var ch = chapters[state.chapter];
    if (!ch || !ch.pages || ch.pages.length === 0) {
      renderEmpty(ch);
      return;
    }
    var total = ch.pages.length;
    var p = ch.pages[state.page];
    stage.innerHTML =
      '<figure class="reader-page">' +
      '<img src="' + encodeURI(p.src) + '" alt="' + escapeText(p.alt || "") + '" width="' + (p.width || 1200) + '" height="' + (p.height || 1700) + '" decoding="async">' +
      "<figcaption>Page " + (state.page + 1) + " of " + total + "</figcaption>" +
      "</figure>";
    prev.disabled = state.page === 0;
    next.disabled = state.page === total - 1;
    if (announce) status.textContent = "Chapter " + ch.id + ", page " + (state.page + 1) + " of " + total + ".";
  }

  if (chapters.length === 0) {
    select.innerHTML = '<option value="">No chapters yet</option>';
    select.disabled = true;
  } else {
    select.innerHTML = chapters
      .map(function (c, i) {
        var label = "Chapter " + c.id + (c.title ? ": " + c.title : "") + (c.pages && c.pages.length ? "" : " (coming soon)");
        return '<option value="' + i + '">' + escapeText(label) + "</option>";
      })
      .join("");
  }

  // Links such as /series?chapter=001#reader (from a character's "Appears in") open that chapter.
  var wanted = /[?&]chapter=([^&#]+)/.exec(location.search);
  if (wanted) {
    chapters.forEach(function (c, i) {
      if (c.id === decodeURIComponent(wanted[1])) { state.chapter = i; select.value = String(i); }
    });
  }

  select.addEventListener("change", function () {
    state.chapter = Number(select.value) || 0;
    state.page = 0;
    render(true);
  });
  prev.addEventListener("click", function () {
    if (state.page > 0) { state.page -= 1; render(true); }
  });
  next.addEventListener("click", function () {
    var ch = chapters[state.chapter];
    if (ch && state.page < ch.pages.length - 1) { state.page += 1; render(true); }
  });
  reader.addEventListener("keydown", function (e) {
    if (e.target === select) return;
    if (e.key === "ArrowLeft") { prev.click(); }
    if (e.key === "ArrowRight") { next.click(); }
  });

  render(false);
})();

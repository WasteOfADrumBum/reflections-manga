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
  var arcs = window.REFLECTIONS_ARCS || {};
  if (!reader) return;

  var select = reader.querySelector("#chapter-select");
  var stage = reader.querySelector(".reader-stage");
  var prevBtns = Array.prototype.slice.call(reader.querySelectorAll("[data-reader-prev]"));
  var nextBtns = Array.prototype.slice.call(reader.querySelectorAll("[data-reader-next]"));
  var status = reader.querySelector("[data-reader-status]");
  var state = { chapter: 0, page: 0 };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function escapeText(str) {
    var d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  function hasPages(ch) { return ch && ch.pages && ch.pages.length > 0; }

  // A chapter's arc: its own arc number, or that of the nearest earlier chapter that opens an arc.
  function arcOf(i) {
    for (var j = i; j >= 0; j--) if (chapters[j].arc) return chapters[j].arc;
    return null;
  }

  // Where Previous/Next lead from the current page: another page, the next or
  // previous chapter, or the next or previous arc. Null when there is nowhere to go.
  function target(dir) {
    var ch = chapters[state.chapter];
    if (!hasPages(ch)) return null;
    var p = state.page + dir;
    if (p >= 0 && p < ch.pages.length) return { chapter: state.chapter, page: p, kind: "page" };
    for (var i = state.chapter + dir; i >= 0 && i < chapters.length; i += dir) {
      var other = chapters[i];
      if (!hasPages(other)) continue;
      var crossesArc = dir > 0 ? !!other.opensArc : !!ch.opensArc;
      return { chapter: i, page: dir > 0 ? 0 : other.pages.length - 1, kind: crossesArc ? "arc" : "chapter", to: other, arc: arcOf(i) };
    }
    return null;
  }

  // short: the desktop chevron's caption; btn: the phone button text;
  // full: the accessible name, which starts with the visible text.
  function label(dir, t) {
    var word = dir > 0 ? "Next" : "Previous";
    if (!t || t.kind === "page") return { short: word + " page", btn: word + " page", full: word + " page" };
    var num = parseInt(t.to.id, 10);
    var chap = "Chapter " + (isNaN(num) ? t.to.id : num);
    if (t.kind === "arc" && t.arc) {
      var arcName = "Arc " + t.arc;
      return {
        short: word + " arc",
        btn: word + ": " + arcName,
        full: word + ": " + arcName + (arcs[t.arc] ? ", " + arcs[t.arc] : "") + ", " + chap + ", " + t.to.title
      };
    }
    return { short: word + " chapter", btn: word + ": " + chap, full: word + ": " + chap + ", " + t.to.title };
  }

  function paintButtons() {
    [[-1, prevBtns], [1, nextBtns]].forEach(function (pair) {
      var dir = pair[0], t = target(dir), l = label(dir, t);
      pair[1].forEach(function (b) {
        b.disabled = !t;
        var jump = !!t && t.kind !== "page";
        b.classList.toggle("is-jump", jump);
        if (b.classList.contains("reader-side")) {
          b.querySelector(".reader-side-text").textContent = jump ? l.btn : l.full;
          b.setAttribute("aria-label", l.full);
        } else {
          b.innerHTML = dir < 0
            ? '<span aria-hidden="true">&larr; </span>' + escapeText(l.btn)
            : escapeText(l.btn) + '<span aria-hidden="true"> &rarr;</span>';
          if (jump) b.setAttribute("aria-label", l.full); else b.removeAttribute("aria-label");
        }
      });
    });
  }

  function renderEmpty(ch) {
    stage.innerHTML =
      '<div class="empty">' +
      '<div class="empty-art" aria-hidden="true"></div>' +
      "<h3>" + escapeText(ch ? "Chapter " + ch.id + " pages are on the way" : "No chapters yet") + "</h3>" +
      "<p>" + escapeText(ch && ch.note ? ch.note : "Pages will appear here as soon as they are finished and approved.") + "</p>" +
      "</div>";
    paintButtons();
    status.textContent = ch ? "Chapter " + ch.id + ": no pages released yet." : "No chapters released yet.";
  }

  function render(announce) {
    var ch = chapters[state.chapter];
    if (!hasPages(ch)) { renderEmpty(ch); return; }
    var total = ch.pages.length;
    var p = ch.pages[state.page];
    stage.innerHTML =
      (ch.coverOnly ? '<p class="note">' + escapeText(ch.note) + '</p>' : '') +
      '<figure class="reader-page">' +
      '<img src="' + encodeURI(p.src) + '" alt="' + escapeText(p.alt || "") + '" width="' + (p.width || 1200) + '" height="' + (p.height || 1700) + '" decoding="async">' +
      "<figcaption>Page " + (state.page + 1) + " of " + total + "</figcaption>" +
      "</figure>";
    paintButtons();
    var ahead = target(1);
    if (ahead) { var pre = new Image(); pre.src = chapters[ahead.chapter].pages[ahead.page].src; }
    if (announce) status.textContent = "Chapter " + ch.id + (ch.title ? ", " + ch.title : "") + ", page " + (state.page + 1) + " of " + total + ".";
  }

  function go(dir, from) {
    var t = target(dir);
    if (!t) return;
    var changed = t.chapter !== state.chapter;
    state.chapter = t.chapter;
    state.page = t.page;
    if (changed) select.value = String(t.chapter);
    render(true);
    // From the lower buttons or a swipe, bring the top of the new page into view.
    if (from === "bottom" || from === "swipe") {
      var top = reader.querySelector(".reader-nav-top");
      var anchor = top && top.offsetParent !== null ? top : reader;
      anchor.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
      if (from === "bottom" && top && top.offsetParent !== null) {
        var match = (dir > 0 ? nextBtns : prevBtns).filter(function (b) { return b.getAttribute("data-pos") === "top"; })[0];
        if (match && !match.disabled) match.focus({ preventScroll: true });
        else focusAvailable("top");
      }
    }
    if (from && from !== "swipe" && document.activeElement && document.activeElement.disabled) focusAvailable(from);
  }

  // Keep keyboard focus on a control after the one used becomes disabled.
  function focusAvailable(pos) {
    var all = prevBtns.concat(nextBtns).filter(function (b) {
      return b.getAttribute("data-pos") === pos && !b.disabled;
    });
    if (all[0]) all[0].focus({ preventScroll: pos === "top" });
    else select.focus();
  }

  if (chapters.length === 0) {
    select.innerHTML = '<option value="">No chapters yet</option>';
    select.disabled = true;
  } else {
    select.innerHTML = chapters
      .map(function (c, i) {
        var text = "Chapter " + c.id + (c.title ? ": " + c.title : "") + (hasPages(c) ? "" : " (coming soon)");
        return '<option value="' + i + '">' + escapeText(text) + "</option>";
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
  prevBtns.forEach(function (b) { b.addEventListener("click", function () { go(-1, b.getAttribute("data-pos")); }); });
  nextBtns.forEach(function (b) { b.addEventListener("click", function () { go(1, b.getAttribute("data-pos")); }); });
  reader.addEventListener("keydown", function (e) {
    if (e.target === select || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1, "key"); }
    if (e.key === "ArrowRight") { e.preventDefault(); go(1, "key"); }
  });

  // Swipe left for the next page and right for the previous one.
  var touch = null;
  stage.addEventListener("touchstart", function (e) {
    if (e.touches.length !== 1) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  stage.addEventListener("touchend", function (e) {
    if (!touch) return;
    var dx = e.changedTouches[0].clientX - touch.x;
    var dy = e.changedTouches[0].clientY - touch.y;
    var quick = Date.now() - touch.t < 800;
    touch = null;
    if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1, "swipe");
  }, { passive: true });
  stage.addEventListener("touchcancel", function () { touch = null; }, { passive: true });

  render(false);
})();

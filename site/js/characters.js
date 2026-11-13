// Characters page: the family tree opens each bio in the panel below it.
(function () {
  "use strict";
  var panel = document.getElementById("cast-panel");
  if (!panel) return;
  var nodes = Array.prototype.slice.call(document.querySelectorAll("a.ft-node"));
  var articles = Array.prototype.slice.call(panel.querySelectorAll(".char"));
  var order = articles.map(function (a) { return a.id; });
  var placeholder = panel.querySelector(".cast-placeholder");
  var toolbar = panel.querySelector(".cast-toolbar");
  var prevBtn = panel.querySelector("[data-cast-prev]");
  var nextBtn = panel.querySelector("[data-cast-next]");
  var closeBtn = panel.querySelector("[data-cast-close]");
  var current = null;
  var lastTrigger = null;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function nameOf(id) {
    var h = document.getElementById(id + "-name");
    return h ? h.textContent.split(" ")[0] : "";
  }
  function esc(t) {
    var d = document.createElement("span"); d.textContent = t; return d.innerHTML;
  }

  // Tree nodes act as disclosure buttons once JS is running.
  nodes.forEach(function (n) {
    n.setAttribute("role", "button");
    n.setAttribute("aria-expanded", "false");
    n.addEventListener("click", function (e) {
      e.preventDefault();
      lastTrigger = n;
      open(n.getAttribute("data-char"), true);
    });
    n.addEventListener("keydown", function (e) {
      if (e.key === " " || e.key === "Spacebar") { e.preventDefault(); n.click(); }
    });
  });

  // Relationships: rendered from js/relationships.js so new ones are a single data line.
  (function renderRelationships() {
    var data = window.REFLECTIONS_RELATIONSHIPS || {};
    function personHtml(p) {
      var h = document.getElementById(p + "-name");
      if (h) return '<a href="#' + p + '">' + h.textContent.split(" ")[0] + "</a>";
      return esc(p);
    }
    function joinNames(list) {
      if (list.length < 2) return list.join("");
      return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
    }
    function noteText(n) {
      if (!n) return "";
      return (/^[,;]/.test(n) ? "" : " ") + esc(n);
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-rel-for]"), function (dl) {
      var entries = data[dl.getAttribute("data-rel-for")] || [];
      var rows = [], byType = {};
      entries.forEach(function (e) {
        var text = joinNames((e.people || []).map(personHtml)) + noteText(e.note);
        if (!byType[e.type]) { byType[e.type] = []; rows.push(e.type); }
        byType[e.type].push(text);
      });
      dl.innerHTML = rows.map(function (t) {
        return "<div><dt>" + esc(t) + "</dt><dd>" + byType[t].join("; ") + "</dd></div>";
      }).join("");
      if (!rows.length && dl.parentNode) dl.parentNode.hidden = true;
    });
  })();

  // Appears in: rendered from js/chapters.js. A chapter lists its characters in `cast`.
  (function renderAppearances() {
    var chapters = window.REFLECTIONS_CHAPTERS || [];
    Array.prototype.forEach.call(document.querySelectorAll("[data-appears-for]"), function (ul) {
      var id = ul.getAttribute("data-appears-for");
      var hits = chapters.filter(function (c) { return (c.cast || []).indexOf(id) !== -1; });
      if (!hits.length) {
        var p = document.createElement("p");
        p.className = "appears-none";
        p.innerHTML = 'No chapters yet. <a href="/series#order-title">See the reading order</a>.';
        ul.parentNode.replaceChild(p, ul);
        return;
      }
      ul.innerHTML = hits.map(function (c) {
        var released = c.pages && c.pages.length;
        var label = "Chapter " + esc(c.id) + (c.title ? ": " + esc(c.title) : "");
        return '<li><a href="/series?chapter=' + encodeURIComponent(c.id) + '#reader">' + label +
          (released ? "" : " <span>in planning</span>") + "</a></li>";
      }).join("");
    });
  })();

  // Gallery: each strip of thumbnails scrolls sideways; a thumbnail opens the viewer.
  var strips = Array.prototype.slice.call(panel.querySelectorAll(".gal-strip"));
  function updateArrows(strip) {
    var box = strip._arrows;
    if (!box) return;
    var over = strip.scrollWidth - strip.clientWidth;
    box.hidden = over <= 4;
    box.firstChild.disabled = strip.scrollLeft <= 6;
    box.lastChild.disabled = strip.scrollLeft >= over - 6;
  }
  strips.forEach(function (strip) {
    var box = document.createElement("div");
    box.className = "gal-arrows";
    box.hidden = true;
    [["Previous images", "←", -1], ["More images", "→", 1]].forEach(function (d) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "gal-arrow";
      b.setAttribute("aria-label", d[0]);
      b.textContent = d[1];
      b.addEventListener("click", function () {
        strip.scrollBy({ left: d[2] * strip.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
      });
      box.appendChild(b);
    });
    strip.parentNode.appendChild(box);
    strip._arrows = box;
    strip.addEventListener("scroll", function () { updateArrows(strip); });
    strip.addEventListener("load", function () { updateArrows(strip); }, true); // thumbnails load lazily
  });
  window.addEventListener("resize", function () { strips.forEach(updateArrows); });

  (function galleryViewer() {
    var dlg = document.getElementById("sheet-viewer");
    if (!dlg || typeof dlg.showModal !== "function") return; // old browsers keep the plain links
    var img = dlg.querySelector(".sheet-body img");
    var title = dlg.querySelector(".sheet-title");
    var count = dlg.querySelector("[data-sheet-count]");
    var full = dlg.querySelector("[data-sheet-full]");
    var prev = dlg.querySelector("[data-sheet-prev]");
    var next = dlg.querySelector("[data-sheet-next]");
    var links = [], at = 0, opener = null, who = "";

    function show(i) {
      at = (i + links.length) % links.length;
      var a = links[at];
      var cap = a.querySelector("img").getAttribute("alt");
      img.removeAttribute("src");
      img.width = Number(a.getAttribute("data-w")) || 1536;
      img.height = Number(a.getAttribute("data-h")) || 1024;
      img.alt = a.getAttribute("data-alt") || cap;
      img.src = a.getAttribute("href");
      title.textContent = who + ": " + cap;
      count.textContent = (at + 1) + " of " + links.length;
      full.setAttribute("href", a.getAttribute("href"));
      prev.hidden = next.hidden = count.hidden = links.length < 2;
    }
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest(".gal-strip a");
      if (!a) return;
      e.preventDefault();
      var art = a.closest(".char");
      links = Array.prototype.slice.call(a.closest(".gal-strip").querySelectorAll("a"));
      who = art ? nameOf(art.id) : "";
      opener = a;
      show(links.indexOf(a));
      dlg.showModal();
      dlg.querySelector("[data-sheet-close]").focus();
    });
    function shut() { if (dlg.open) dlg.close(); }
    prev.addEventListener("click", function () { show(at - 1); });
    next.addEventListener("click", function () { show(at + 1); });
    dlg.querySelector("[data-sheet-close]").addEventListener("click", shut);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) shut(); });
    dlg.addEventListener("keydown", function (e) {
      if (links.length < 2) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); show(at - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); show(at + 1); }
    });
    dlg.addEventListener("close", function () {
      if (opener) { opener.focus(); opener.scrollIntoView({ block: "nearest", inline: "nearest" }); }
    });
  })();

  articles.forEach(function (a) { a.hidden = true; });

  function open(id, moveFocus) {
    if (order.indexOf(id) === -1) return;
    current = id;
    articles.forEach(function (a) { a.hidden = a.id !== id; });
    nodes.forEach(function (n) { n.setAttribute("aria-expanded", String(n.getAttribute("data-char") === id)); });
    placeholder.hidden = true;
    toolbar.hidden = false;
    var i = order.indexOf(id);
    var p = order[(i - 1 + order.length) % order.length];
    var nx = order[(i + 1) % order.length];
    prevBtn.querySelector(".cast-name").textContent = nameOf(p);
    nextBtn.querySelector(".cast-name").textContent = nameOf(nx);
    prevBtn.setAttribute("data-target", p);
    nextBtn.setAttribute("data-target", nx);
    if (history.replaceState) history.replaceState(null, "", "#" + id);
    var strip = document.getElementById(id).querySelector(".gal-strip");
    if (strip) { strip.scrollLeft = 0; updateArrows(strip); }
    if (moveFocus) {
      var h = document.getElementById(id + "-name");
      if (h) h.focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }

  function close() {
    if (!current) return;
    var node = document.querySelector('a.ft-node[data-char="' + current + '"]');
    var trigger = (lastTrigger && lastTrigger.offsetParent !== null && !panel.contains(lastTrigger)) ? lastTrigger : node;
    current = null;
    articles.forEach(function (a) { a.hidden = true; });
    nodes.forEach(function (n) { n.setAttribute("aria-expanded", "false"); });
    placeholder.hidden = false;
    toolbar.hidden = true;
    if (history.replaceState) history.replaceState(null, "", location.pathname);
    if (trigger) {
      trigger.focus({ preventScroll: true });
      trigger.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }
  }

  prevBtn.addEventListener("click", function () { lastTrigger = null; open(prevBtn.getAttribute("data-target"), true); });
  nextBtn.addEventListener("click", function () { lastTrigger = null; open(nextBtn.getAttribute("data-target"), true); });
  closeBtn.addEventListener("click", close);
  panel.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && current && !(document.getElementById("sheet-viewer") || {}).open) { e.preventDefault(); close(); }
  });

  // In-page links (relationship names, deep links) open the matching bio.
  function fromHash(moveFocus) {
    var id = decodeURIComponent(location.hash.replace("#", ""));
    if (!id) return;
    var match = order.filter(function (o) { return o === id || o.split("-")[0] === id; })[0];
    if (match) open(match, moveFocus);
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.classList.contains("ft-node") || a.classList.contains("skip-link")) return;
    var id = a.getAttribute("href").slice(1);
    if (order.indexOf(id) !== -1) {
      e.preventDefault();
      lastTrigger = a;
      open(id, true);
    }
  });
  window.addEventListener("hashchange", function () { fromHash(true); });
  fromHash(false);
})();

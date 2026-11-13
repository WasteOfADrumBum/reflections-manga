// Characters page: family tree opens each bio in the detail panel.
(function () {
  "use strict";
  var panel = document.getElementById("cast-panel");
  if (!panel) return;
  var nodes = Array.prototype.slice.call(document.querySelectorAll(".ft-node"));
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
      var d = document.createElement("span"); d.textContent = p; return d.innerHTML;
    }
    function joinNames(list) {
      if (list.length < 2) return list.join("");
      return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
    }
    function noteText(n) {
      if (!n) return "";
      var d = document.createElement("span"); d.textContent = n;
      return (/^[,;]/.test(n) ? "" : " ") + d.innerHTML;
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
        var dt = document.createElement("span"); dt.textContent = t;
        return "<div><dt>" + dt.innerHTML + "</dt><dd>" + byType[t].join("; ") + "</dd></div>";
      }).join("");
      if (!rows.length && dl.parentNode) dl.parentNode.hidden = true;
    });
  })();


  // Reference sheet viewer: open sheets in an in-page dialog with Close and Back controls.
  (function sheetViewer() {
    var dlg = document.getElementById("sheet-viewer");
    if (!dlg || typeof dlg.showModal !== "function") return; // old browsers keep the plain link
    var img = dlg.querySelector(".sheet-body img");
    var title = dlg.querySelector(".sheet-title");
    var nameEl = dlg.querySelector("[data-sheet-name]");
    var full = dlg.querySelector("[data-sheet-full]");
    var opener = null;
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('.char-portrait a[href$="-sheet.webp"]');
      if (!a) return;
      e.preventDefault();
      var art = a.closest(".char");
      var h = art && document.getElementById(art.id + "-name");
      var name = h ? h.textContent.split(" ")[0] : "";
      opener = a;
      img.src = a.getAttribute("href");
      img.alt = (h ? h.textContent : name) + " reference sheet: front, three-quarter and back views, plus three facial expressions.";
      title.textContent = name + ": reference sheet";
      nameEl.textContent = name;
      full.setAttribute("href", a.getAttribute("href"));
      dlg.showModal();
      dlg.querySelector("[data-sheet-close]").focus();
    });
    function shut() { if (dlg.open) dlg.close(); }
    dlg.querySelector("[data-sheet-close]").addEventListener("click", shut);
    dlg.querySelector("[data-sheet-back]").addEventListener("click", shut);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) shut(); });
    dlg.addEventListener("close", function () { if (opener) opener.focus(); });
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
    panel.scrollTop = 0;
    if (moveFocus) {
      var h = document.getElementById(id + "-name");
      if (h) {
        h.focus({ preventScroll: true });
        var desktop = window.matchMedia("(min-width: 64rem)").matches;
        if (!desktop) panel.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    }
  }

  function close() {
    if (!current) return;
    var node = document.querySelector('.ft-node[data-char="' + current + '"]');
    var trigger = (lastTrigger && lastTrigger.offsetParent !== null && !panel.contains(lastTrigger)) ? lastTrigger : node;
    current = null;
  
  // Relationships: rendered from js/relationships.js so new ones are a single data line.
  (function renderRelationships() {
    var data = window.REFLECTIONS_RELATIONSHIPS || {};
    function personHtml(p) {
      var h = document.getElementById(p + "-name");
      if (h) return '<a href="#' + p + '">' + h.textContent.split(" ")[0] + "</a>";
      var d = document.createElement("span"); d.textContent = p; return d.innerHTML;
    }
    function joinNames(list) {
      if (list.length < 2) return list.join("");
      return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
    }
    function noteText(n) {
      if (!n) return "";
      var d = document.createElement("span"); d.textContent = n;
      return (/^[,;]/.test(n) ? "" : " ") + d.innerHTML;
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
        var dt = document.createElement("span"); dt.textContent = t;
        return "<div><dt>" + dt.innerHTML + "</dt><dd>" + byType[t].join("; ") + "</dd></div>";
      }).join("");
      if (!rows.length && dl.parentNode) dl.parentNode.hidden = true;
    });
  })();

  articles.forEach(function (a) { a.hidden = true; });
    nodes.forEach(function (n) { n.setAttribute("aria-expanded", "false"); });
    placeholder.hidden = false;
    toolbar.hidden = true;
    if (history.replaceState) history.replaceState(null, "", location.pathname);
    if (trigger) trigger.focus();
  }

  prevBtn.addEventListener("click", function () { lastTrigger = null; open(prevBtn.getAttribute("data-target"), true); });
  nextBtn.addEventListener("click", function () { lastTrigger = null; open(nextBtn.getAttribute("data-target"), true); });
  closeBtn.addEventListener("click", close);
  panel.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && current && !(document.getElementById("sheet-viewer") || {}).open) { e.preventDefault(); close(); }
  });

  // In-page links (cards below the tree, deep links) open the matching bio.
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

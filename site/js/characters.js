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
    var trigger = lastTrigger || document.querySelector('.ft-node[data-char="' + current + '"]');
    current = null;
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
    if (e.key === "Escape" && current) { e.preventDefault(); close(); }
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

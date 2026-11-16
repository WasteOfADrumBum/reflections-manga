/* Memories: photo album pager and photo viewer. Without JavaScript every page shows stacked. */
(function () {
  var album = document.getElementById("album");
  if (!album) return;
  var leaves = Array.prototype.slice.call(album.querySelectorAll(".album-leaf"));
  var prev = album.querySelector("[data-album-prev]");
  var next = album.querySelector("[data-album-next]");
  var count = album.querySelector("[data-album-count]");
  var wide = window.matchMedia("(min-width: 56rem)");
  var first = 0;

  function per() { return wide.matches ? 2 : 1; }

  function render(announce) {
    var p = per();
    first = Math.max(0, Math.min(first - (first % p), leaves.length - 1));
    leaves.forEach(function (leaf, i) {
      var shown = i >= first && i < first + p;
      leaf.hidden = !shown;
      leaf.classList.toggle("album-leaf-right", shown && p === 2 && i === first + 1);
    });
    var last = Math.min(first + p, leaves.length);
    count.setAttribute("aria-live", announce ? "polite" : "off");
    count.textContent = (last - first > 1 ? "Pages " + (first + 1) + " and " + last : "Page " + (first + 1)) + " of " + leaves.length;
    prev.disabled = first === 0;
    next.disabled = last >= leaves.length;
    album.classList.toggle("album-spread", p === 2);
  }

  function turn(dir) {
    var p = per();
    var target = first + dir * p;
    if (target < 0 || target >= leaves.length) return;
    first = target;
    album.classList.remove("turn-next", "turn-prev");
    void album.offsetWidth;
    album.classList.add(dir > 0 ? "turn-next" : "turn-prev");
    render(true);
  }

  prev.addEventListener("click", function () { turn(-1); });

  // Swipe left for the next page and right for the previous one. A tap still opens a photo.
  var book = album.querySelector(".album-book");
  var touch = null;
  book.addEventListener("touchstart", function (e) {
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
  }, { passive: true });
  book.addEventListener("touchend", function (e) {
    if (!touch) return;
    var dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    var quick = Date.now() - touch.t < 800;
    touch = null;
    if (quick && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) turn(dx < 0 ? 1 : -1);
  }, { passive: true });
  book.addEventListener("touchcancel", function () { touch = null; }, { passive: true });
  next.addEventListener("click", function () { turn(1); });
  if (wide.addEventListener) wide.addEventListener("change", function () { render(false); });
  else if (wide.addListener) wide.addListener(function () { render(false); });

  // Photo viewer
  var dlg = document.getElementById("photo-viewer");
  var links = Array.prototype.slice.call(album.querySelectorAll(".snap-link"));
  var cur = 0, opener = null;
  if (dlg && typeof dlg.showModal === "function") {
    var img = dlg.querySelector(".sheet-body img");
    var title = dlg.querySelector("#photo-title");
    var pc = dlg.querySelector("[data-photo-count]");
    var full = dlg.querySelector("[data-photo-full]");
    var pp = dlg.querySelector("[data-photo-prev]");
    var pn = dlg.querySelector("[data-photo-next]");
    var show = function (i) {
      cur = (i + links.length) % links.length;
      var a = links[cur], thumb = a.querySelector("img");
      img.src = a.getAttribute("href");
      img.width = +a.getAttribute("data-w"); img.height = +a.getAttribute("data-h");
      img.alt = thumb.alt;
      title.textContent = a.getAttribute("data-title");
      full.href = a.getAttribute("href");
      pc.textContent = "Photo " + (cur + 1) + " of " + links.length;
    };
    links.forEach(function (a, i) {
      a.addEventListener("click", function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
        e.preventDefault();
        opener = a;
        show(i);
        dlg.showModal();
      });
    });
    pp.addEventListener("click", function () { show(cur - 1); });
    pn.addEventListener("click", function () { show(cur + 1); });
    dlg.querySelector("[data-photo-close]").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () {
      // Keep the album on the page that holds the photo last shown, then return focus.
      var a = links[cur], leaf = a.closest(".album-leaf");
      var idx = leaves.indexOf(leaf);
      if (idx > -1 && leaf.hidden) { first = idx; render(true); }
      (leaf && !leaf.hidden ? a : opener || next).focus();
      img.src = "";
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var open = dlg && dlg.open;
    if (e.key === "ArrowLeft") { e.preventDefault(); open ? show(cur - 1) : turn(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); open ? show(cur + 1) : turn(1); }
  });

  render(false);
})();

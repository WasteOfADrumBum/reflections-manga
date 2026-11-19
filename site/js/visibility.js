// Applies site/js/visibility-data.js before the gallery and album scripts run:
// removes hidden images, keeps counts and page labels right, and adds album
// photos chosen in the studio. Without JavaScript every image stays visible.
(function () {
  "use strict";
  var data = window.REFLECTIONS_VISIBILITY;
  if (!data) return;
  var hidden = data.hidden || {};

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }

  // Character galleries: article.char#<id> ul.gal-strip > li > a[href]
  var byChar = hidden.characters || {};
  Object.keys(byChar).forEach(function (id) {
    var article = document.getElementById(id);
    if (!article) return;
    var hide = byChar[id] || [];
    each(article.querySelectorAll(".gal-strip a[href]"), function (a) {
      if (hide.indexOf(a.getAttribute("href")) !== -1 && a.parentNode) a.parentNode.remove();
    });
    each(article.querySelectorAll(".gal-strip"), function (strip) {
      var count = strip.parentNode ? strip.parentNode.querySelector(".gal-count") : null;
      if (!count) {
        var labelId = strip.getAttribute("aria-labelledby");
        var heading = labelId ? document.getElementById(labelId) : null;
        count = heading ? heading.querySelector(".gal-count") : null;
      }
      var n = strip.querySelectorAll("li").length;
      if (count) count.textContent = n + (n === 1 ? " image" : " images");
    });
  });

  // Memories album: section.album-leaf > figure.snap > a.snap-link[href]
  var book = document.querySelector("#album .album-book");
  if (!book) return;
  var hideAlbum = hidden.album || [];
  each(book.querySelectorAll(".snap-link"), function (a) {
    if (hideAlbum.indexOf(a.getAttribute("href")) !== -1) {
      var fig = a.closest("figure");
      if (fig) fig.remove();
    }
  });

  var additions = data.albumAdditions || [];
  var leaf = null;
  additions.forEach(function (p, i) {
    if (!p || !p.full || !p.src) return;
    if (i % 2 === 0) {
      leaf = document.createElement("section");
      leaf.className = "album-leaf";
      book.appendChild(leaf);
    }
    var fig = document.createElement("figure");
    fig.className = p.wide ? "snap snap-wide" : "snap";
    var a = document.createElement("a");
    a.className = "snap-link";
    a.href = p.full;
    a.setAttribute("data-w", String(p.w || 1536));
    a.setAttribute("data-h", String(p.h || 1024));
    a.setAttribute("data-title", p.title || "");
    var img = document.createElement("img");
    img.src = p.src;
    img.width = p.thumbW || 800;
    img.height = p.thumbH || 533;
    img.loading = "lazy";
    img.decoding = "async";
    img.alt = p.alt || p.title || "";
    a.appendChild(img);
    var cap = document.createElement("figcaption");
    cap.textContent = p.title || "";
    fig.appendChild(a);
    fig.appendChild(cap);
    leaf.appendChild(fig);
  });

  // Drop empty pages, then renumber every page for screen readers.
  each(book.querySelectorAll(".album-leaf"), function (l) {
    if (!l.querySelector("figure")) l.remove();
  });
  var leaves = book.querySelectorAll(".album-leaf");
  each(leaves, function (l, i) {
    l.id = "album-page-" + (i + 1);
    l.setAttribute("aria-label", "Album page " + (i + 1) + " of " + leaves.length);
  });
})();

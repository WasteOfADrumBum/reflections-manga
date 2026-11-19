// Applies site/js/visibility-data.js before the gallery and album scripts run:
// removes hidden images, adds sheets and album photos chosen in the studio,
// applies edited captions and the album order, and blurs sensitive images
// until the reader confirms they are 18 or older. Without JavaScript every
// image in the HTML stays visible and nothing is blurred.
(function () {
  "use strict";
  var data = window.REFLECTIONS_VISIBILITY;
  if (!data) return;
  var hidden = data.hidden || {};
  var sensitive = data.sensitive || [];
  var AGE_KEY = "reflections:age-confirmed:v1";

  function each(list, fn) {
    Array.prototype.forEach.call(list, fn);
  }
  function has(list, value) {
    return list.indexOf(value) !== -1;
  }

  // ---- character galleries: article.char#<id> ul.gal-strip > li > a[href] ----
  var byChar = hidden.characters || {};
  var added = data.characterAdditions || {};
  var charIds = Object.keys(byChar).concat(Object.keys(added));
  charIds.forEach(function (id, i) {
    if (charIds.indexOf(id) !== i) return;
    var article = document.getElementById(id);
    if (!article) return;
    var strip = article.querySelector(".gal-strip");
    if (strip) {
      (added[id] || []).forEach(function (p) {
        if (!p || !p.full || !p.src) return;
        var li = document.createElement("li");
        var a = document.createElement("a");
        a.href = p.full;
        a.setAttribute("data-w", String(p.w || 1536));
        a.setAttribute("data-h", String(p.h || 1024));
        a.setAttribute("data-alt", p.alt || "");
        var img = document.createElement("img");
        img.src = p.src;
        img.width = p.thumbW || 360;
        img.height = p.thumbH || 240;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = p.label ? "Reference sheet: " + p.label : "Reference sheet";
        a.appendChild(img);
        li.appendChild(a);
        strip.appendChild(li);
      });
    }
    var hide = byChar[id] || [];
    each(article.querySelectorAll(".gal-strip a[href]"), function (a) {
      if (has(hide, a.getAttribute("href")) && a.parentNode) a.parentNode.remove();
    });
    each(article.querySelectorAll(".gal-strip"), function (s) {
      var count = s.parentNode ? s.parentNode.querySelector(".gal-count") : null;
      if (!count) {
        var labelId = s.getAttribute("aria-labelledby");
        var heading = labelId ? document.getElementById(labelId) : null;
        count = heading ? heading.querySelector(".gal-count") : null;
      }
      var n = s.querySelectorAll("li").length;
      if (count) count.textContent = n + (n === 1 ? " image" : " images");
    });
  });

  // ---- Memories album: section.album-leaf > figure.snap > a.snap-link[href] ----
  var book = document.querySelector("#album .album-book");
  if (book) {
    var album = data.album || {};
    var captions = album.captions || {};
    var order = album.order || [];
    var hideAlbum = hidden.album || [];
    var additions = data.albumAdditions || [];

    var figures = Array.prototype.slice.call(book.querySelectorAll("figure.snap"));
    additions.forEach(function (p) {
      if (!p || !p.full || !p.src) return;
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
      figures.push(fig);
    });

    var changed = additions.length > 0 || hideAlbum.length > 0 || order.length > 0;
    figures = figures.filter(function (fig) {
      var a = fig.querySelector(".snap-link");
      var href = a ? a.getAttribute("href") : "";
      if (has(hideAlbum, href)) {
        fig.remove();
        return false;
      }
      var c = captions[href];
      if (c && a) {
        if (c.title) {
          a.setAttribute("data-title", c.title);
          var fc = fig.querySelector("figcaption");
          if (fc) fc.textContent = c.title;
        }
        var im = a.querySelector("img");
        if (c.alt && im) im.alt = c.alt;
      }
      return true;
    });

    if (changed) {
      var pos = function (fig) {
        var a = fig.querySelector(".snap-link");
        var i = a ? order.indexOf(a.getAttribute("href")) : -1;
        return i === -1 ? order.length : i;
      };
      var indexed = figures.map(function (fig, i) { return { fig: fig, i: i }; });
      indexed.sort(function (x, y) { return pos(x.fig) - pos(y.fig) || x.i - y.i; });
      // Repack: a tall photo gets a page to itself, everything else two to a page.
      each(book.querySelectorAll(".album-leaf"), function (l) { l.remove(); });
      var leaf = null;
      indexed.forEach(function (x) {
        var tall = x.fig.classList.contains("snap-tall");
        if (!leaf || tall || leaf.children.length >= 2 || leaf.getAttribute("data-tall")) {
          leaf = document.createElement("section");
          leaf.className = "album-leaf";
          if (tall) leaf.setAttribute("data-tall", "1");
          book.appendChild(leaf);
        }
        leaf.appendChild(x.fig);
      });
    }
    each(book.querySelectorAll(".album-leaf"), function (l) {
      if (!l.querySelector("figure")) l.remove();
      l.removeAttribute("data-tall");
    });
    var leaves = book.querySelectorAll(".album-leaf");
    each(leaves, function (l, i) {
      l.id = "album-page-" + (i + 1);
      l.setAttribute("aria-label", "Album page " + (i + 1) + " of " + leaves.length);
    });
  }

  // ---- sensitive images: blurred behind an eye button until 18+ is confirmed ----
  if (!sensitive.length) return;

  function confirmed() {
    var names = ["localStorage", "sessionStorage"];
    for (var i = 0; i < names.length; i++) {
      try { if (window[names[i]] && window[names[i]].getItem(AGE_KEY)) return true; } catch (e) { /* blocked */ }
    }
    return false;
  }
  function saveConfirmed() {
    var names = ["localStorage", "sessionStorage"];
    for (var i = 0; i < names.length; i++) {
      try { if (window[names[i]]) { window[names[i]].setItem(AGE_KEY, new Date().toISOString()); return; } } catch (e) { /* try next */ }
    }
  }

  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';
  var dialog = null;
  var pending = null;
  var opener = null;

  function askAge(done) {
    if (confirmed()) return done();
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "veil-dialog";
      dialog.setAttribute("aria-labelledby", "veil-title");
      dialog.innerHTML =
        '<h2 id="veil-title">Show a sensitive image?</h2>' +
        "<p>This image shows lingerie or underwear. Confirm that you are 18 or older to see it.</p>" +
        '<div class="btn-row"><button type="button" class="btn btn-primary" data-veil-yes>I’m 18 or older, show it</button>' +
        '<button type="button" class="btn" data-veil-no>Keep it hidden</button></div>';
      document.body.appendChild(dialog);
      dialog.querySelector("[data-veil-yes]").addEventListener("click", function () {
        saveConfirmed();
        var fn = pending;
        pending = null;
        dialog.close();
        if (fn) fn();
      });
      dialog.querySelector("[data-veil-no]").addEventListener("click", function () { dialog.close(); });
      dialog.addEventListener("close", function () {
        if (pending) {
          pending = null;
          if (opener && opener.focus) opener.focus();
        }
      });
    }
    pending = done;
    opener = document.activeElement;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else if (window.confirm("This image shows lingerie or underwear. Are you 18 or older?")) {
      saveConfirmed();
      pending = null;
      done();
    }
  }

  function reveal(wrap) {
    var a = wrap.querySelector("a");
    wrap.classList.remove("is-veiled");
    var b = wrap.querySelector(".veil-btn");
    if (b) b.remove();
    if (a) {
      a.removeAttribute("tabindex");
      a.removeAttribute("aria-hidden");
      a.focus();
    }
  }

  each(document.querySelectorAll(".gal-strip a[href], #album .snap-link"), function (a) {
    if (!has(sensitive, a.getAttribute("href"))) return;
    var wrap = document.createElement("span");
    wrap.className = "veil is-veiled";
    a.parentNode.insertBefore(wrap, a);
    wrap.appendChild(a);
    a.setAttribute("tabindex", "-1");
    a.setAttribute("aria-hidden", "true");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "veil-btn";
    var img = a.querySelector("img");
    var title = a.getAttribute("data-title") || (img && img.alt) || "image";
    btn.setAttribute("aria-label", "Sensitive image hidden: " + title + ". Show it (18 or older only)");
    btn.innerHTML = EYE + '<span class="veil-label" aria-hidden="true">18+</span>';
    btn.addEventListener("click", function () {
      askAge(function () { reveal(wrap); });
    });
    wrap.appendChild(btn);
  });

  // A veiled link never opens its full-size image (the gallery and album viewers listen for clicks).
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest(".veil.is-veiled a") : null;
      if (!a) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      var wrap = a.parentNode;
      askAge(function () { reveal(wrap); });
    },
    true
  );
})();

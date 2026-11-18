// Reflections age gate: asks readers to confirm they are 18 or older before the
// series and chapter pages show. No dependencies.
//
// To gate a page:
//   1. Add data-age-gate to <html>.
//   2. Add data-age-gated to every element that must stay hidden until confirmed (usually <main>).
//   3. Load this file in <head> WITHOUT defer, before other scripts:
//        <script src="/js/age-gate.js"></script>
//   4. Optionally add <noscript> text inside <body> for readers without JavaScript.
// Scripts that load content (like the chapter reader) can call
// window.ReflectionsAgeGate.whenConfirmed(fn) so nothing loads before confirmation.
//
// The answer is saved in localStorage. If storage is blocked, it falls back to
// sessionStorage, then to memory for the current page only.
(function () {
  "use strict";

  var KEY = "reflections:age-confirmed:v1";
  var root = document.documentElement;
  var memory = false;
  var waiting = [];

  function store(name) {
    try { return window[name] || null; } catch (e) { return null; }
  }

  function readConfirmed() {
    if (memory) return true;
    var names = ["localStorage", "sessionStorage"];
    for (var i = 0; i < names.length; i++) {
      var s = store(names[i]);
      try { if (s && s.getItem(KEY)) return true; } catch (e) { /* blocked */ }
    }
    return false;
  }

  function saveConfirmed() {
    memory = true;
    var value = new Date().toISOString();
    var names = ["localStorage", "sessionStorage"];
    for (var i = 0; i < names.length; i++) {
      var s = store(names[i]);
      try { if (s) { s.setItem(KEY, value); return names[i]; } } catch (e) { /* try next */ }
    }
    return "memory";
  }

  var confirmed = readConfirmed();
  if (confirmed) root.classList.add("age-ok");

  function flush() {
    var fns = waiting;
    waiting = [];
    fns.forEach(function (fn) { try { fn(); } catch (e) { setTimeout(function () { throw e; }); } });
  }

  window.ReflectionsAgeGate = {
    isConfirmed: function () { return confirmed || !root.hasAttribute("data-age-gate"); },
    whenConfirmed: function (fn) {
      if (this.isConfirmed()) fn(); else waiting.push(fn);
    }
  };

  if (confirmed || !root.hasAttribute("data-age-gate")) return;

  function build() {
    var gated = document.querySelector("[data-age-gated]");
    var lastFocus = null;

    // Inline notice that stays on the page while unconfirmed (for example if the dialog is closed with Escape).
    var panel = document.createElement("section");
    panel.className = "age-locked wrap";
    panel.setAttribute("aria-labelledby", "age-locked-title");
    panel.innerHTML =
      '<h1 id="age-locked-title" tabindex="-1">For readers 18 and over</h1>' +
      "<p>The Reflections series and its chapters are for adult readers. Confirm your age to keep reading.</p>" +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn-primary" data-age-open>Confirm my age</button>' +
      '<a class="btn" href="/">Back to the home page</a>' +
      "</div>";
    if (gated && gated.parentNode) gated.parentNode.insertBefore(panel, gated);
    else document.body.appendChild(panel);

    var dialog = document.createElement("dialog");
    dialog.className = "age-dialog";
    dialog.setAttribute("aria-labelledby", "age-dialog-title");
    dialog.setAttribute("aria-describedby", "age-dialog-desc");
    dialog.innerHTML =
      '<h2 id="age-dialog-title">Are you 18 or older?</h2>' +
      '<p id="age-dialog-desc">The Reflections series and its chapters are for adult readers. ' +
      "Confirm that you are 18 or older to continue. We'll remember your answer in this browser.</p>" +
      '<div class="btn-row">' +
      '<button type="button" class="btn btn-primary" data-age-confirm>Yes, I\'m 18 or older</button>' +
      '<a class="btn" href="/" data-age-leave>No, take me home</a>' +
      "</div>";
    document.body.appendChild(dialog);

    var canModal = typeof dialog.showModal === "function";

    function open() {
      if (dialog.open) return;
      lastFocus = document.activeElement;
      if (canModal) {
        dialog.showModal();
      } else {
        // Very old browsers: show the dialog inline; the gated content is already hidden.
        dialog.setAttribute("open", "");
      }
      var first = dialog.querySelector("[data-age-confirm]");
      if (first) first.focus();
    }

    function confirm() {
      confirmed = true;
      saveConfirmed();
      root.classList.add("age-ok");
      if (dialog.open) { if (canModal) dialog.close(); else dialog.removeAttribute("open"); }
      dialog.remove();
      panel.remove();
      // Return focus to the content the reader came for.
      var target = gated || document.getElementById("main");
      if (lastFocus && lastFocus !== document.body && document.contains(lastFocus) && lastFocus.focus) {
        lastFocus.focus();
      } else if (target) {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
      flush();
      // Links such as /series?chapter=001#reader: jump to the anchor now that it is visible.
      var hashTarget = location.hash && document.getElementById(location.hash.slice(1));
      if (hashTarget) hashTarget.scrollIntoView({ block: "start" });
    }

    dialog.querySelector("[data-age-confirm]").addEventListener("click", confirm);
    panel.querySelector("[data-age-open]").addEventListener("click", open);

    // Escape closes the dialog; the content stays hidden and focus moves to the inline notice.
    dialog.addEventListener("close", function () {
      if (confirmed) return;
      var heading = document.getElementById("age-locked-title");
      if (heading) heading.focus();
    });

    open();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();

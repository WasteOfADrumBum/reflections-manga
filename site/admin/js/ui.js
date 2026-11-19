// Small DOM helpers. All text goes through textContent, never innerHTML, so
// content from the repository or database cannot inject markup.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Replaces an element's children. Skips null and false, so optional parts never render as the word "null". */
export function fill(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

const announcer = () => document.getElementById("announcer");
const alerter = () => document.getElementById("alerter");

/** Polite screen-reader announcement. */
export function announce(message) {
  const el = announcer();
  if (!el) return;
  el.textContent = "";
  window.setTimeout(() => (el.textContent = message), 50);
}

/** Assertive announcement for errors. */
export function alertMessage(message) {
  const el = alerter();
  if (!el) return;
  el.textContent = "";
  window.setTimeout(() => (el.textContent = message), 50);
}

export const pad3 = (n) => String(n).padStart(3, "0");
export const usd = (n) => (n == null ? "–" : `$${Number(n).toFixed(2)}`);
export const when = (d) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "–");

const BADGE = {
  published: "ok",
  approved: "ok",
  completed: "ok",
  pass: "ok",
  locked: "neutral",
  has_art: "ok",
  ready: "neutral",
  queued: "info",
  running: "info",
  generating: "info",
  checking: "info",
  retrying: "warn",
  awaiting_review: "info",
  needs_attention: "warn",
  uncertain: "warn",
  completed_with_issues: "warn",
  paused: "warn",
  budget_exceeded: "warn",
  blocked: "bad",
  failed: "bad",
  fail: "bad",
  cancelled: "neutral",
  unprepared: "neutral",
  rejected: "bad",
  auto_rejected: "bad",
  superseded: "neutral",
  pending: "neutral",
  pr_open: "info",
  unpublished: "neutral",
};

export const LABELS = {
  completed_with_issues: "Finished, needs attention",
  budget_exceeded: "Stopped at budget",
  awaiting_review: "Awaiting review",
  needs_attention: "Needs a closer look",
  auto_rejected: "Failed checks",
  pr_open: "Pull request open",
  retry_wait: "Waiting to retry",
};

export function label(status) {
  return LABELS[status] ?? String(status).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function badge(status, text) {
  return h("span", { class: `badge badge-${BADGE[status] ?? "neutral"}` }, text ?? label(status));
}

/** Badges in a row wrap instead of spilling out of their card. */
export function badges(...items) {
  return h("span", { class: "badge-row" }, ...items.filter(Boolean));
}

export function notice(kind, ...children) {
  return h("div", { class: `notice notice-${kind}` }, ...children);
}

/** Accessible confirmation using the native <dialog> element (focus is trapped and restored). */
export function confirmDialog({ title, body, confirmLabel = "Continue", danger = false }) {
  const dialog = document.getElementById("confirm-dialog");
  const opener = document.activeElement;
  document.getElementById("confirm-title").textContent = title;
  const b = clear(document.getElementById("confirm-body"));
  append(b, [body]);
  const ok = document.getElementById("confirm-ok");
  ok.textContent = confirmLabel;
  ok.className = danger ? "btn btn-danger" : "btn btn-primary";
  return new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        resolve(dialog.returnValue === "ok");
        if (opener && typeof opener.focus === "function") opener.focus();
      },
      { once: true },
    );
    dialog.returnValue = "";
    dialog.showModal();
    document.getElementById("confirm-cancel").focus();
  });
}

export function field({ id, label: text, input, hint, error }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || null;
  input.id = id;
  if (describedBy) input.setAttribute("aria-describedby", describedBy);
  return h("div", { class: "field" }, h("label", { for: id }, text), input, hint ? h("p", { class: "hint", id: `${id}-hint` }, hint) : null, error ? h("p", { class: "error-text", id: `${id}-error` }, error) : null);
}

export function progress(done, total, labelText) {
  const id = `p-${Math.random().toString(36).slice(2)}`;
  return h(
    "div",
    {},
    h("span", { id, class: "small" }, labelText ?? `${done} of ${total} pages`),
    h("progress", { max: String(Math.max(total, 1)), value: String(done), "aria-labelledby": id }),
  );
}

/**
 * Options for an outfit picker, grouped by category (Main, Casual, Formal, ...,
 * Needs review) so long wardrobes stay easy to scan.
 */
export function sheetOptions(sheets, selected, note = () => "") {
  const groups = new Map();
  for (const s of sheets) {
    const key = s.isDefault ? "Main" : s.needsReview ? "Needs review" : s.category ? s.category.charAt(0).toUpperCase() + s.category.slice(1) : "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const order = (k) => (k === "Main" ? 0 : k === "Needs review" ? 3 : k === "Other" ? 2 : 1);
  return [...groups.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([key, list]) => h("optgroup", { label: key }, ...list.map((s) => h("option", { value: s.path, selected: s.path === selected }, `${s.label}${note(s)}`))));
}

// ---- revealing images: blurred until the viewer confirms they are 18 or older ----
const AGE_KEY = "reflections:age-confirmed:v1";
let ageConfirmedHere = false;

function ageConfirmed() {
  if (ageConfirmedHere) return true;
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      if (window[name]?.getItem(AGE_KEY)) return true;
    } catch {
      // storage blocked
    }
  }
  return false;
}

function saveAgeConfirmed() {
  ageConfirmedHere = true;
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      window[name]?.setItem(AGE_KEY, new Date().toISOString());
      return;
    } catch {
      // try the next store
    }
  }
}

function eyeIcon() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("d", "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z");
  svg.append(path);
  return svg;
}

/** Asks once per browser for 18+ confirmation (shared with the public site), then resolves true. */
export async function confirmAge() {
  if (ageConfirmed()) return true;
  const ok = await confirmDialog({
    title: "Show a sensitive image?",
    body: h("p", {}, "This image shows lingerie or underwear. Confirm that you are 18 or older to see it."),
    confirmLabel: "I'm 18 or older, show it",
  });
  if (ok) saveAgeConfirmed();
  return ok;
}

/**
 * Wraps an image so it can be blurred behind an eye button. Call
 * wrapper.setSensitive(true|false, label) whenever the image changes.
 */
export function veil(img, sensitive = false, labelText = "") {
  const btn = h("button", { type: "button", class: "veil-btn" }, eyeIcon(), h("span", {}, "Sensitive image"), h("span", { class: "small" }, "Show (18+)"));
  const wrap = h("span", { class: "veil" }, img, btn);
  wrap.setSensitive = (on, text = "") => {
    wrap.classList.toggle("is-veiled", !!on);
    wrap.classList.toggle("is-revealed", !on);
    btn.hidden = !on;
    btn.setAttribute("aria-label", `Sensitive image${text ? `: ${text}` : ""}. Show it (18 or older only)`);
  };
  btn.addEventListener("click", async () => {
    if (!(await confirmAge())) return;
    wrap.classList.add("is-revealed");
    btn.hidden = true;
    announce("Image shown.");
  });
  wrap.setSensitive(sensitive, labelText);
  return wrap;
}

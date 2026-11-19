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

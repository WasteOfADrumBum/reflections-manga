// Pieces every studio screen uses: rendering, headings, breadcrumbs, busy buttons and polling.
import { alertMessage, announce, clear, h, notice } from "./ui.js";

export const view = () => document.getElementById("view");
let pollTimer = null;
let lastAnnounced = "";

export function render(...nodes) {
  const v = view();
  clear(v).append(...nodes.flat().filter(Boolean));
  const heading = v.querySelector("h1");
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    document.title = `${heading.textContent} | Reflections Studio`;
    heading.focus({ preventScroll: false });
  }
}

/** Redraws in place (polling) without moving focus away from the control the user is on. */
export function redraw(...nodes) {
  const focused = document.activeElement?.id;
  clear(view()).append(...nodes.flat().filter(Boolean));
  if (focused && document.getElementById(focused)) document.getElementById(focused).focus();
}

export function head(title, intro, ...actions) {
  const a = actions.flat().filter(Boolean);
  return h("div", { class: "view-head" }, h("div", {}, h("h1", {}, title), intro ? h("p", { class: "lede" }, intro) : null), a.length ? h("div", { class: "btn-row" }, ...a) : null);
}

export function crumbs(...items) {
  return h("nav", { class: "breadcrumbs", "aria-label": "Breadcrumb" }, h("ol", {}, items.map(([text, href]) => h("li", {}, href ? h("a", { href }, text) : h("span", { "aria-current": "page" }, text)))));
}

export function section(title, id, ...children) {
  return h("section", { class: "box", "aria-labelledby": id }, h("h2", { id }, title), ...children);
}

export function stopPolling() {
  window.clearInterval(pollTimer);
  pollTimer = null;
}

export function poll(fn, ms = 5000) {
  stopPolling();
  pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") fn().catch(() => undefined);
  }, ms);
}

export function announceOnce(message) {
  if (message && message !== lastAnnounced) {
    lastAnnounced = message;
    announce(message);
  }
}

export async function act(button, fn, success) {
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const out = await fn();
    if (success) announce(typeof success === "function" ? success(out) : success);
    return out;
  } catch (err) {
    alertMessage(err.message);
    const box = document.getElementById("action-error");
    if (box) {
      box.hidden = false;
      box.textContent = err.message;
    }
    throw err;
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = original;
  }
}

export const errorBox = () => h("div", { id: "action-error", class: "notice notice-error", role: "alert", hidden: true });

export const repoImage = (path, w) => `/api/studio/repo-image?${w ? `w=${w}&` : ""}path=${encodeURIComponent(path)}`;

export function prLink(url) {
  return notice("ok", h("p", {}, "Pull request opened: ", h("a", { href: url, target: "_blank", rel: "noopener" }, url, h("span", { class: "visually-hidden" }, " (opens in a new tab)")), ". Merge it on GitHub to apply the change."));
}

const money = (n) => (n == null ? "unknown" : `$${Number(n).toFixed(2)}`);

/** Plain-language cost explanation, shown wherever paid generation can start. */
export function costExplainer(cost) {
  return h(
    "div",
    { class: "explain" },
    h("h3", {}, "What this costs"),
    h(
      "ul",
      {},
      h("li", {}, h("strong", {}, "Model: "), h("code", {}, cost?.model ?? "not set"), ", OpenAI's image model. Quality is that model's render setting, not a different model."),
      cost?.perAttemptUsd != null
        ? h("li", {}, h("strong", {}, "Price: "), `about ${money(cost.perAttemptUsd)} per image at this quality with ${cost.referenceImages} reference image(s), including a small quality check. A page can retry up to its attempt limit, so one page costs at most about ${money(cost.worstCasePageUsd)}.`)
        : null,
      h("li", {}, h("strong", {}, "Who pays: "), "your OpenAI API account (prepaid API credit). This is separate from ChatGPT Plus. It does not use your Plus limits, and Plus does not cover it."),
      h("li", {}, h("strong", {}, "Budget: "), "a dollar cap for one run, in API dollars. The run stops before any request that would go over it."),
      h("li", {}, h("strong", {}, "No-cost option: "), "make the image in ChatGPT, then use “Upload a version” on the page. Uploads go through the same review and publishing."),
    ),
    cost?.byQuality?.length
      ? h(
          "div",
          { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Estimated price per image by quality" },
          h(
            "table",
            {},
            h("caption", {}, "Estimated price per image by quality"),
            h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Quality"), h("th", { scope: "col" }, "Per image"))),
            h("tbody", {}, ...cost.byQuality.map((q) => h("tr", {}, h("th", { scope: "row" }, q.quality), h("td", {}, money(q.usd))))),
          ),
        )
      : null,
    cost?.pricingSource ? h("p", { class: "small muted" }, `Estimates from OpenAI's published rates (checked ${cost.pricingCheckedOn}). Your OpenAI billing page is the real bill.`) : null,
  );
}

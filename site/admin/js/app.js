import { ApiError, get, post } from "./api.js";
import { render, stopPolling } from "./shared.js";
import { alertMessage, h, notice } from "./ui.js";
import { charactersView } from "./views/characters.js";
import { dashboardView, jobView, studioView } from "./views/jobs.js";
import { pageView } from "./views/page.js";
import { reviewView } from "./views/review.js";
import { siteView } from "./views/site.js";
import { spendingView } from "./views/spending.js";
import { arcsView, arcView, chapterView } from "./views/story.js";

const view = document.getElementById("view");

// ---------- routing ----------
const routes = [
  [/^#\/dashboard$/, dashboardView, "dashboard"],
  [/^#\/story$/, arcsView, "story"],
  [/^#\/story\/(arc-\d{2})$/, arcView, "story"],
  [/^#\/chapters$/, arcsView, "story"],
  [/^#\/chapters\/(\d{3})$/, chapterView, "story"],
  [/^#\/chapters\/(\d{3})\/pages\/(\d{1,3})$/, pageView, "story"],
  [/^#\/characters$/, charactersView, "characters"],
  [/^#\/studio(?:\/(\d{3}))?$/, studioView, "studio"],
  [/^#\/jobs\/([0-9a-f-]{36})$/, jobView, "studio"],
  [/^#\/review(?:\/(\d{3}))?$/, reviewView, "review"],
  [/^#\/site$/, siteView, "site"],
  [/^#\/spending$/, spendingView, "spending"],
];

async function route() {
  stopPolling();
  const hash = window.location.hash || "#/dashboard";
  const found = routes.map(([re, fn, nav]) => [hash.match(re), fn, nav]).find(([m]) => m);
  const nav = found?.[2] ?? "";
  for (const a of document.querySelectorAll("[data-nav]")) {
    if (a.dataset.nav === nav) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  view.setAttribute("aria-busy", "true");
  try {
    if (!found) {
      render(h("h1", {}, "Page not found"), h("p", {}, h("a", { href: "#/dashboard" }, "Go to the dashboard")));
    } else {
      const [m, fn] = found;
      await fn(...m.slice(1));
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    render(h("h1", {}, "Something went wrong"), notice("error", h("p", {}, err.message || String(err))), h("p", {}, h("button", { class: "btn", type: "button", onclick: route }, "Try again")));
    alertMessage(err.message || "Something went wrong");
  } finally {
    view.setAttribute("aria-busy", "false");
  }
}

// ---------- boot ----------
document.getElementById("sign-out").addEventListener("click", async () => {
  try {
    await post("/auth/logout");
  } finally {
    window.location.assign("/admin/login");
  }
});

(async function boot() {
  try {
    await get("/auth/me");
  } catch {
    window.location.assign(`/admin/login?next=${encodeURIComponent(window.location.hash || "#/dashboard")}`);
    return;
  }
  window.addEventListener("hashchange", route);
  if (!window.location.hash) window.location.replace("#/dashboard");
  route();
})();

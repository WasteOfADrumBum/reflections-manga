// Spending and performance: monthly API cost and tokens, pages made vs used, and pages that took too many tries.
import { get, put } from "../api.js";
import { act, errorBox, head, render, section } from "../shared.js";
import { field, h, notice, pad3, usd } from "../ui.js";

const SVG = "http://www.w3.org/2000/svg";
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const c of children) if (c != null) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
const num = (n) => Math.round(n).toLocaleString();

/** Bar chart of monthly spend. The data table below it carries the same numbers for screen readers. */
function spendChart(byMonth) {
  const w = 720;
  const hgt = 240;
  const pad = { l: 48, r: 8, t: 12, b: 32 };
  const max = Math.max(1, ...byMonth.map((m) => m.reportedUsd || m.estimateUsd));
  const bw = (w - pad.l - pad.r) / byMonth.length;
  const y = (v) => pad.t + (hgt - pad.t - pad.b) * (1 - v / max);
  const svg = s("svg", { viewBox: `0 0 ${w} ${hgt}`, role: "img", "aria-labelledby": "chart-title chart-desc", class: "chart" });
  svg.append(s("title", { id: "chart-title" }, "API spending by month"), s("desc", { id: "chart-desc" }, "Bar chart of estimated monthly spending. The same figures are in the table below."));
  for (const t of [0, 0.5, 1]) {
    svg.append(s("line", { x1: pad.l, x2: w - pad.r, y1: y(max * t), y2: y(max * t), class: "chart-grid" }), s("text", { x: pad.l - 6, y: y(max * t) + 4, "text-anchor": "end", class: "chart-label" }, usd(max * t)));
  }
  byMonth.forEach((m, i) => {
    const v = m.reportedUsd || m.estimateUsd;
    const x = pad.l + i * bw + bw * 0.15;
    svg.append(s("rect", { x, y: y(v), width: bw * 0.7, height: Math.max(0, hgt - pad.b - y(v)), class: "chart-bar" }), s("text", { x: x + bw * 0.35, y: hgt - 10, "text-anchor": "middle", class: "chart-label" }, monthName(m.month)));
  });
  return h("figure", { class: "chart-wrap" }, svg);
}

export async function spendingView() {
  const d = await get("/spending");
  const t = d.totals;
  const threshold = h("input", { type: "number", min: "2", max: "50", value: String(d.threshold) });
  const save = h("button", { class: "btn btn-small", type: "button" }, "Save");
  save.addEventListener("click", () => act(save, () => put("/spending/threshold", { attempts: Number(threshold.value) }), "Saved.").then(spendingView).catch(() => undefined));
  render(
    head("Spending", "What generation has cost and how much of it you kept. Covers the last 12 months."),
    errorBox(),
    h(
      "ul",
      { class: "stat-row", "aria-label": "Totals" },
      h("li", { class: "card" }, h("p", { class: "stat" }, usd(t.reportedUsd || t.estimateUsd)), h("p", { class: "small" }, t.reportedUsd ? "Spent, from usage OpenAI reported" : "Spent, estimated")),
      h("li", { class: "card" }, h("p", { class: "stat" }, num(t.inputTokens + t.outputTokens)), h("p", { class: "small" }, `Tokens (${num(t.inputTokens)} in, ${num(t.outputTokens)} out)`)),
      h("li", { class: "card" }, h("p", { class: "stat" }, `${t.pagesUsed} of ${t.pagesGenerated}`), h("p", { class: "small" }, "Generated pages you kept")),
      h("li", { class: "card" }, h("p", { class: "stat" }, d.attemptsPerAcceptedPage == null ? "–" : d.attemptsPerAcceptedPage.toFixed(1)), h("p", { class: "small" }, "Attempts per kept page")),
    ),
    section("By month", "month-title", spendChart(d.byMonth), monthTable(d.byMonth)),
    section(
      "Pages that took too many tries",
      "flag-title",
      h("div", { class: "inline-form" }, field({ id: "flag-threshold", label: "Flag a page after this many attempts", input: threshold }), save),
      d.flags.length
        ? h("ul", { class: "flag-list" }, ...d.flags.map((f) => h("li", {}, h("a", { href: `#/chapters/${f.chapterId}/pages/${f.page}` }, `Chapter ${f.chapterId}, page ${pad3(f.page)}`), `: ${f.message} (about ${usd(f.spentUsd)})`)))
        : notice("ok", h("p", {}, "No page has needed that many attempts.")),
    ),
    h("p", { class: "small muted" }, d.note),
  );
}

function monthTable(rows) {
  return h(
    "div",
    { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Spending by month" },
    h(
      "table",
      {},
      h("caption", {}, "Spending and pages by month"),
      h("thead", {}, h("tr", {}, ["Month", "Spent", "Tokens in", "Tokens out", "Image requests", "Generated", "Uploaded", "Kept"].map((x) => h("th", { scope: "col" }, x)))),
      h(
        "tbody",
        {},
        ...rows.map((m) =>
          h(
            "tr",
            {},
            h("th", { scope: "row" }, monthName(m.month)),
            h("td", {}, usd(m.reportedUsd || m.estimateUsd)),
            h("td", {}, num(m.inputTokens)),
            h("td", {}, num(m.outputTokens)),
            h("td", {}, String(m.imageAttempts)),
            h("td", {}, String(m.pagesGenerated)),
            h("td", {}, String(m.pagesUploaded)),
            h("td", {}, String(m.pagesUsed)),
          ),
        ),
      ),
    ),
  );
}

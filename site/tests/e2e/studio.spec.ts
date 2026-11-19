import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function signIn(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("the public reader still works and has no studio links to drafts", async ({ page }) => {
  await page.goto("/series");
  // series.html hides the reader until the visitor confirms they are 18+.
  // The heading stays out of the accessibility tree (display:none) until then.
  const gate = page.getByRole("dialog", { name: "Are you 18 or older?" });
  await expect(gate).toBeVisible();
  const readerHeading = page.getByRole("heading", { level: 1, name: "Read Reflections" });
  await expect(readerHeading).toBeHidden();
  await gate.getByRole("button", { name: "Yes, I'm 18 or older" }).click();
  await expect(readerHeading).toBeVisible();
  await expect(page.locator("#reader")).toBeVisible();
  // The hero fades in over 0.6s. Contrast is checked on the settled text.
  await expect(page.locator(".page-hero .reveal")).toHaveCSS("opacity", "1");
  const html = await page.content();
  expect(html).not.toContain("/api/studio/assets");
  await expectAccessible(page);
});

test("the studio requires sign-in", async ({ page }) => {
  await page.goto("/admin#/dashboard");
  await expect(page).toHaveURL(/\/admin\/login/);
  const res = await page.request.get("/api/studio/dashboard");
  expect(res.status()).toBe(401);
});

test("sign-in page is accessible and keyboard operable", async ({ page }) => {
  await page.goto("/admin/login");
  await expectAccessible(page);
  await page.keyboard.press("Tab");
  await expect(page.locator("a.skip-link")).toBeFocused();
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password", { exact: true }).fill("wrong password value");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("do not match");
});

test("one-click test page, approval, full chapter run, review and publish", async ({ page }) => {
  // A full chapter is 27 mocked pages. CI runners are slower than a warm laptop.
  test.setTimeout(180_000);
  await signIn(page);
  await expectAccessible(page);

  await page.getByRole("link", { name: "Story" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Story" })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Characters" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Characters" })).toBeVisible();
  await expectAccessible(page);

  await page.goto("/admin/#/chapters/001/pages/23");
  await expect(page.getByRole("heading", { level: 1, name: /^Page 023/ })).toBeVisible();
  await expect(page.getByText("separate from ChatGPT Plus").first()).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Spending" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Spending" })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Generate" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Generate pages" })).toBeVisible();
  // Page 002 already has art: it can get a new version but is not selected by default.
  await expect(page.getByLabel("Page 002", { exact: false })).not.toBeChecked();
  await expect(page.getByText("Estimated cost")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Run one test page" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Start paid generation" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chapter 001 run" })).toBeVisible();
  await expect(page.locator("#view").getByText(/Run (Completed|Finished, needs attention): \d+ of/)).toBeVisible({ timeout: 60_000 });
  await expectAccessible(page);

  await page.getByRole("link", { name: "Review pages" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Review" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.locator(".publish-row").first()).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("link", { name: "Generate" }).first().click();
  await page.getByRole("button", { name: "Generate selected pages" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start paid generation" }).click();
  await expect(page.locator("#view").getByText(/Run (Completed|Finished, needs attention): \d+ of/)).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole("link", { name: "Export pages (ZIP)" })).toBeVisible();

  await page.getByRole("link", { name: "Review pages" }).click();
  await page.getByLabel("Publish even if earlier pages are not in the reader yet").check();
  await page.getByRole("button", { name: "Publish to the reader" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Open pull request" }).click();
  await expect(page.getByText("Pull request opened:")).toBeVisible();
});

test("reduced motion is respected", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/admin/login");
  const duration = await page.locator(".btn-primary").evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(["0s", "0s, 0s"]).toContain(duration);
  await context.close();
});

import { expect, test, type Page } from "@playwright/test";

// The landscape page against the dev server: named tiles, the colour metric with its legend, its
// persistence in the address and in saved views, and the render time of the whole register.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const tiles = (page: Page) => page.locator("button.tl");
const total = (page: Page) => page.evaluate(() => (window as any).__CCCP_WORKBOOK__.tabs[0].rows.slice(1).filter((r: unknown[]) => r[0]).length as number);

async function ready(page: Page, query = "") {
  await page.goto("/?r=landscape" + query);
  await expect(page.locator(".land")).toBeVisible();
}
const pressed = (page: Page) => page.locator(".segs button[aria-pressed=true]");

test("every application is a named tile, domains are ordered by size, tiles have no title", async ({ page }) => {
  const bad = watchConsole(page);
  await ready(page);
  const n = await total(page);
  await expect(tiles(page)).toHaveCount(n);
  expect(await page.locator("[title]").count()).toBe(0);
  const sizes = await page.locator(".dbox > header small").allInnerTexts();
  const nums = sizes.map((x) => Number(x.replace(/,/g, "")));
  expect(nums.reduce((a, b) => a + b, 0)).toBe(n);
  for (let i = 1; i < nums.length; i++) expect(nums[i]!).toBeLessThanOrEqual(nums[i - 1]!);
  // Each tile's accessible name starts with the application's own name.
  const first = tiles(page).first();
  const name = (await first.innerText()).trim();
  expect(await first.getAttribute("aria-label")).toContain(name);
  await expect(page.getByRole("button", { name, exact: false }).first()).toBeVisible();
  expect(bad).toEqual([]);
});

test("the metric switch recolours, the legend follows it and the address keeps it", async ({ page }) => {
  const bad = watchConsole(page);
  await ready(page);
  await expect(pressed(page)).toHaveText("Worst status");
  await expect(page.locator(".lgd")).toContainText("Needs attention");
  await page.getByRole("button", { name: "Tier", exact: true }).click();
  await expect(pressed(page)).toHaveText("Tier");
  await expect(page.locator(".lgd")).toContainText("No tier");
  await expect(page.locator(".lgd")).not.toContainText("Needs attention");
  await page.getByRole("button", { name: "Completeness", exact: true }).click();
  await expect(page.locator(".lgd")).toContainText("80% or more");
  // A tile's tip reads the metric.
  await tiles(page).first().focus();
  await expect(page.locator(".tip, [role=tooltip]").first()).toContainText("Completeness:");
  // A link with the metric opens with it.
  await ready(page, "&metric=c2");
  await expect(pressed(page)).toHaveText("Continuity");
  expect(bad).toEqual([]);
});

test("unknown values are hatched tiles and the legend says so", async ({ page }) => {
  await ready(page, "&metric=tier");
  const hatched = await page.locator("button.tl.ls-none").count();
  const sample = page.locator("button.tl.ls-none").first();
  if (hatched) {
    const bg = await sample.evaluate((e) => getComputedStyle(e).backgroundImage);
    expect(bg).toContain("repeating-linear-gradient");
  }
  await expect(page.locator(".lgd")).toContainText("No tier");
});

test("the metric is stored in a saved view", async ({ page }) => {
  await ready(page, "&metric=tier");
  await page.getByRole("button", { name: "Save view" }).click();
  await page.getByLabel("View name").fill("By tier");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cccp.views.v1") as string));
  expect(stored[0].route).toBe("landscape");
  expect(stored[0].state.metric).toBe("tier");
  // Another metric, then the view brings the metric back.
  await page.getByRole("button", { name: "Platform", exact: true }).click();
  await expect(pressed(page)).toHaveText("Platform");
  await page.getByRole("tab", { name: "By tier" }).click();
  await expect(pressed(page)).toHaveText("Tier");
});

test("1,125-scale render is fast", async ({ page }) => {
  await ready(page);
  const ms = await page.evaluate(async () => {
    const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(".segs button")).find((b) => b.textContent === "Tier")!;
    const t0 = performance.now();
    btn.click();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return performance.now() - t0;
  });
  const n = await tiles(page).count();
  expect(n).toBe(await total(page));
  expect(ms).toBeLessThan(300);
});

test("a tile opens the application and Back returns to the landscape", async ({ page }) => {
  await ready(page, "&metric=c1");
  await tiles(page).first().click();
  await expect(page.locator(".land")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".land")).toBeVisible();
  await expect(pressed(page)).toHaveText("Compliance");
});

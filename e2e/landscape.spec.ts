import { expect, test, type Page } from "@playwright/test";

// The landscape lens of the Inventory (opened through the old ?r=landscape address) against the dev server: named tiles, the colour metric with its legend, its
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
  await expect(pressed(page)).toHaveText("Worst");
  await expect(page.locator(".lgd")).toContainText("Needs attention");
  await page.locator(".segs").getByRole("button", { name: "Tier", exact: true }).click();
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

test("unknown values have a dashed square and the legend says so", async ({ page }) => {
  await ready(page, "&metric=tier");
  const sample = page.locator("button.tl.ls-none").first();
  expect(await page.locator("button.tl.ls-none").count()).toBeGreaterThan(0);
  expect(await sample.locator(".sq").evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("dashed");
  await expect(page.locator(".lgd")).toContainText("No tier");
  await expect(page.locator(".lgd .sq.ls-none")).toHaveCount(1);
});

test("a tile has a status square, a Gap tile a red-tinted border, and domains sit in columns under a 2px ink rule", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await ready(page);
  const bad = page.locator("button.tl.ls-bad").first();
  const ok = page.locator("button.tl.ls-ok").first();
  expect(await bad.count()).toBe(1);
  const bc = await bad.evaluate((e) => getComputedStyle(e).borderTopColor);
  const oc = await ok.evaluate((e) => getComputedStyle(e).borderTopColor);
  expect(bc).not.toBe(oc);
  expect(await bad.locator(".sq").evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(await ok.locator(".sq").evaluate((e) => getComputedStyle(e).backgroundColor));
  const box = page.locator(".dbox").first();
  const rule = await box.evaluate((e) => [getComputedStyle(e).borderTopWidth, getComputedStyle(e).borderTopColor === getComputedStyle(document.body).color]);
  expect(rule).toEqual(["2px", true]);
  const xs = await page.locator(".dbox").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().x)))]);
  expect(xs.length).toBeGreaterThanOrEqual(3);
});

test("the pillar choices of the switch are in the pillar's colour", async ({ page }) => {
  await ready(page);
  const colours = await page.locator(".segs button").evaluateAll((els) => els.map((e) => [e.textContent, getComputedStyle(e).color]));
  const byName = Object.fromEntries(colours.map(([n, c]) => [n, c]));
  const pillars = [byName.Cyber, byName.Compliance, byName.Continuity, byName.Platform];
  expect(new Set(pillars).size).toBe(4);
  expect(new Set([...pillars, byName.Tier]).size).toBe(5);
});

test("the metric is stored in a saved view, which is not bound to the page", async ({ page }) => {
  await ready(page, "&metric=tier");
  await page.getByRole("button", { name: "+ Save" }).click();
  await page.getByLabel("View name").fill("By tier");
  await page.locator('[data-k="vsave"]').click();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cccp.views.v1") as string));
  expect(stored[0]).not.toHaveProperty("route");
  expect(stored[0].state.metric).toBe("tier");
  // Another metric, then the view brings the metric back, still on the landscape lens.
  await page.getByRole("button", { name: "Platform", exact: true }).click();
  await expect(pressed(page)).toHaveText("Platform");
  await expect(page.locator(".vi.on .vn")).toHaveText("By tier");
  await expect(page.locator("[data-cue]")).toContainText("changed");
  await page.locator(".vrow", { hasText: "By tier" }).click();
  await expect(pressed(page)).toHaveText("Tier");
  await expect(page.locator(".land")).toBeVisible();
});

test("1,125-scale render is fast", async ({ page }) => {
  await ready(page);
  const ms = await page.evaluate(async () => {
    const btn = Array.from(document.querySelectorAll<HTMLButtonElement>(".segs button")).find((b) => b.textContent === "Tier")!;
    const t0 = performance.now();
    btn.click();
    // After style and layout: a frame, then a task.
    await new Promise((r) => requestAnimationFrame(() => setTimeout(() => r(null), 0)));
    void document.body.offsetHeight;
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
  await expect(page.locator("[data-page=app]")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".land")).toBeVisible();
  await expect(pressed(page)).toHaveText("Compliance");
});

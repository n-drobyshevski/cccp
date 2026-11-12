import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// The filter toolbar stays on one line with a heavy filter state (Tier 1+2, five domains, one long
// security officer: 8 selected values), at 1280, 1024 and 820 px in both themes; it may wrap at phone
// width but never scrolls the page sideways. Popovers open and close by keyboard. Set
// TOOLBAR_SHOTS to a folder to save screenshots of the toolbar.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const pill = (page: Page, k: string) => page.locator(`[data-k="pill-${k}"]`);
const pop = (page: Page) => page.locator(".pop");

async function tick(page: Page, k: string, pick: (values: string[]) => string[]) {
  await pill(page, k).click();
  await expect(pop(page)).toBeVisible();
  const values = await pop(page).locator(".ck input").evaluateAll((els) => els.map((e) => e.getAttribute("data-v") as string));
  for (const v of pick(values)) await pop(page).locator(`input[data-v="${v}"]`).check();
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
}

/** The mockup's filter state, applied through the popovers. */
async function heavy(page: Page) {
  await page.goto("/?r=list");
  await expect(page.locator(".toolbar")).toBeVisible();
  await tick(page, "tier", () => ["T1", "T2"]);
  await tick(page, "dom", (v) => v.slice(0, 5));
  await tick(page, "so", (v) => [v.reduce((a, b) => (b.length > a.length ? b : a), "")]);
  await expect(page.locator(".badge")).toHaveText("8");
}

async function oneRow(page: Page) {
  const tops = await page.locator(".toolbar .row").evaluate((row) => {
    const out: { name: string; mid: number }[] = [];
    row.querySelectorAll<HTMLElement>(".search, .pill, .sbtn, .clr").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ name: el.className + ":" + (el.textContent || "").trim().slice(0, 20), mid: r.top + r.height / 2 });
    });
    return out;
  });
  expect(tops.length).toBeGreaterThanOrEqual(7);
  const min = Math.min(...tops.map((t) => t.mid));
  const max = Math.max(...tops.map((t) => t.mid));
  expect(max - min, JSON.stringify(tops)).toBeLessThanOrEqual(4);
  const rowBox = await page.locator(".toolbar .row").boundingBox();
  const right = await page.locator(".toolbar .sbtn").boundingBox();
  expect(right!.x + right!.width).toBeLessThanOrEqual(rowBox!.x + rowBox!.width + 1);
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 1024, 820]) {
    test(`one row at ${width} px, ${theme}, with a heavy filter state`, async ({ page }) => {
      const bad = watchConsole(page);
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch { /* storage refused */ } }, theme);
      await heavy(page);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await oneRow(page);
      expect(await noSideways(page)).toBe(true);
      await expect(page.getByRole("searchbox", { name: "Search applications" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Filter panel, 8 filters$/ })).toBeVisible();
      if (process.env.TOOLBAR_SHOTS) {
        mkdirSync(process.env.TOOLBAR_SHOTS, { recursive: true });
        await page.locator(".toolbar").screenshot({ path: `${process.env.TOOLBAR_SHOTS}/list-${width}-${theme}.png` });
      }
      expect(bad).toEqual([]);
    });
  }

  test(`390 px does not scroll sideways, ${theme}`, async ({ page }) => {
    const bad = watchConsole(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch { /* storage refused */ } }, theme);
    await heavy(page);
    expect(await noSideways(page)).toBe(true);
    await expect(page.getByRole("searchbox", { name: "Search applications" })).toBeVisible();
    if (process.env.TOOLBAR_SHOTS) {
      mkdirSync(process.env.TOOLBAR_SHOTS, { recursive: true });
      await page.locator(".toolbar").screenshot({ path: `${process.env.TOOLBAR_SHOTS}/list-390-${theme}.png` });
    }
    expect(bad).toEqual([]);
  });
}

test("active values are cut short, with the full list in the tip and the name", async ({ page }) => {
  const bad = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await heavy(page);
  const so = pill(page, "so");
  const full = (await so.getAttribute("aria-label")) as string;
  expect(full.startsWith("Security officer: ")).toBe(true);
  expect(await so.getAttribute("data-tip")).toBe(full);
  expect((await so.boundingBox())!.width).toBeLessThanOrEqual(191);
  const dom = pill(page, "dom");
  expect(await dom.getAttribute("aria-label")).toMatch(/^Domain: .*,.*,.*,.*,/);
  await expect(page.getByRole("button", { name: full, exact: true })).toBeVisible();
  await so.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator(".tip")).toHaveText(full);
  expect(bad).toEqual([]);
});

test("the tier pill and the panel button work by keyboard", async ({ page }) => {
  const bad = watchConsole(page);
  await page.goto("/?r=list");
  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Filter panel", exact: true })).toBeVisible();
  const tier = pill(page, "tier");
  await tier.focus();
  await page.keyboard.press("Enter");
  await expect(pop(page)).toBeVisible();
  await expect(tier).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Space");
  await expect(pop(page).locator("input").first()).toBeChecked();
  await expect(tier).toHaveText(/^Tier: [1-4]$/);
  await page.keyboard.press("Escape");
  await expect(pop(page)).toHaveCount(0);
  await expect(tier).toBeFocused();
  await expect(tier).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: /^Filter panel, 1 filter$/ }).press("Enter");
  await expect(page.locator(".side")).toBeVisible();
  await expect(pill(page, "tier")).toBeVisible();
  await expect(pill(page, "dom")).toHaveCount(0);
  expect(bad).toEqual([]);
});

test("below 1024 px the search is an icon that opens on focus and stays reachable by Tab", async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 800 });
  await page.goto("/?r=list");
  const box = page.getByRole("searchbox", { name: "Search applications" });
  await expect(box).toBeVisible();
  expect((await box.boundingBox())!.width).toBeLessThan(60);
  await page.keyboard.press("Tab");
  for (let i = 0; i < 12 && !(await box.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(box).toBeFocused();
  expect((await box.boundingBox())!.width).toBeGreaterThan(200);
});

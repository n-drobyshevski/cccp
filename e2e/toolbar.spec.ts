import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// The Inventory's header line (count, active-filter tags, tools and the lens switch) and its facet panel
// with a heavy filter state (Tier 1+2, five domains, one long security officer: 8 selected values), at 1280, 1024 and
// 820 px in both themes, on every lens. The tools and the lens switch stay on one row, the tags may wrap, the page never
// scrolls sideways. The panel and the drawer work by keyboard; long tag text is cut with its full text
// in the tip and the name. Set TOOLBAR_SHOTS to a folder to save screenshots of the header.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const facets = (page: Page) => page.locator("aside.facets");
const sec = (page: Page, k: string) => facets(page).locator(`section[data-facet="${k}"]`);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** The mockup's heavy filter state, applied through the panel (a drawer below 1024 px). */
async function heavy(page: Page, lens = "table") {
  await page.goto("/?r=list&lens=" + lens);
  await expect(page.locator("[data-region=content] .rhead")).toBeVisible();
  const drawer = (page.viewportSize()?.width ?? 1280) < 1024;
  if (drawer) await page.locator('[data-k="fopen"]').click();
  await sec(page, "tier").locator('[data-k="side-tier-T1"]').check();
  await sec(page, "tier").locator('[data-k="side-tier-T2"]').check();
  const dom = sec(page, "dom");
  if (await dom.locator('[data-k="fmore-dom"]').count()) await dom.locator('[data-k="fmore-dom"]').click();
  for (const i of [0, 1, 2, 3, 4]) await dom.locator(".ck input").nth(i).check();
  const so = sec(page, "so");
  if (await so.locator('[data-k="fmore-so"]').count()) await so.locator('[data-k="fmore-so"]').click();
  const values = await so.locator(".ck input").evaluateAll((els) => els.map((e) => e.getAttribute("data-v") as string));
  await so.locator(`input[data-v="${values.reduce((a, b) => (b.length > a.length ? b : a), "")}"]`).check();
  if (drawer) await page.locator('[data-k="fdone"]').click();
  await expect(page.locator(".ftag")).toHaveCount(3);
}

/** Columns, Export and the lens switch share one line. */
async function oneRow(page: Page) {
  const tops = await page.locator("[data-region=content] .rtools").evaluate((row) => {
    const out: { name: string; mid: number }[] = [];
    row.querySelectorAll<HTMLElement>(".tlink, .lens button").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ name: el.className + ":" + (el.textContent || "").trim().slice(0, 20), mid: r.top + r.height / 2 });
    });
    return out;
  });
  expect(tops.length).toBeGreaterThanOrEqual(4);
  const min = Math.min(...tops.map((t) => t.mid));
  const max = Math.max(...tops.map((t) => t.mid));
  expect(max - min, JSON.stringify(tops)).toBeLessThanOrEqual(8);
  const content = (await page.locator("[data-region=content]").boundingBox())!;
  const right = (await page.locator(".lens").boundingBox())!;
  expect(right.x + right.width).toBeLessThanOrEqual(content.x + content.width + 1);
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [1280, 1024, 820]) {
    test(`tools and lens switch on one row at ${width} px, ${theme}, heavy filters, every lens`, async ({ page }) => {
      const bad = watchConsole(page);
      await page.setViewportSize({ width, height: 800 });
      await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch { /* storage refused */ } }, theme);
      for (const lens of ["table", "heatmap", "landscape"]) {
        await heavy(page, lens);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await oneRow(page);
        expect(await noSideways(page)).toBe(true);
        await expect(page.getByRole("searchbox", { name: "Search applications" })).toBeVisible();
        await expect(page.getByRole("button", { name: lens === "table" ? "Table" : lens === "heatmap" ? "Heatmap" : "Landscape", exact: true })).toHaveAttribute("aria-pressed", "true");
        if (process.env.TOOLBAR_SHOTS) {
          mkdirSync(process.env.TOOLBAR_SHOTS, { recursive: true });
          await page.locator("[data-region=content] .rhead").screenshot({ path: `${process.env.TOOLBAR_SHOTS}/${lens}-${width}-${theme}.png` });
        }
      }
      expect(bad).toEqual([]);
    });
  }

  test(`390 px does not scroll sideways on any lens, ${theme}`, async ({ page }) => {
    const bad = watchConsole(page);
    await page.setViewportSize({ width: 390, height: 800 });
    await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch { /* storage refused */ } }, theme);
    for (const lens of ["table", "heatmap", "landscape"]) {
      await heavy(page, lens);
      expect(await noSideways(page)).toBe(true);
      await expect(page.locator(".lens")).toBeInViewport();
      await expect(page.getByRole("searchbox", { name: "Search applications" })).toBeVisible();
    }
    expect(bad).toEqual([]);
  });
}

test("a long tag is cut short, with the full text in the tip and in the remove button's name", async ({ page }) => {
  const bad = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await heavy(page);
  const tag = page.locator('.ftag[data-tag="so"]');
  const full = (await tag.locator("> span").getAttribute("data-tip")) as string;
  expect(full.startsWith("Security officer: ")).toBe(true);
  expect(await tag.locator("button").getAttribute("aria-label")).toBe("Remove " + full);
  expect((await tag.boundingBox())!.width).toBeLessThanOrEqual(300);
  const dom = page.locator('.ftag[data-tag="dom"]');
  expect(await dom.locator("button").getAttribute("aria-label")).toMatch(/^Remove Domain: .*,.*,.*,.*,/);
  await expect(page.getByRole("button", { name: "Remove " + full, exact: true })).toBeVisible();
  expect(await page.locator("[title]").count()).toBe(0);
  expect(bad).toEqual([]);
});

test("the panel, the Filters button and the lens switch work by keyboard", async ({ page }) => {
  const bad = watchConsole(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/?r=list");
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  const btn = page.locator('[data-k="fopen"]');
  await btn.focus();
  await page.keyboard.press("Enter");
  await expect(facets(page)).toBeVisible();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  const box = sec(page, "tier").locator('[data-k="side-tier-T1"]');
  await box.focus();
  await page.keyboard.press("Space");
  await expect(box).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(facets(page)).toBeHidden();
  await expect(btn).toBeFocused();
  await expect(btn).toHaveText("Filters (1)");
  const heat = page.getByRole("button", { name: "Heatmap", exact: true });
  await heat.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  await expect(heat).toHaveAttribute("aria-pressed", "true");
  expect(bad).toEqual([]);
});

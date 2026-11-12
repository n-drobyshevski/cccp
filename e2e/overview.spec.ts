import { expect, test, type Page } from "@playwright/test";

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}
const num = (t: string) => Number(t.replace(/,/g, ""));

test("overview shows 4 KPIs, pillar bars and the domains", async ({ page }) => {
  const bad = watchConsole(page);
  await page.goto("/?r=overview");
  await expect(page.locator("[data-page=overview]")).toBeVisible();
  await expect(page.locator(".kpi")).toHaveCount(4);
  await expect(page.locator(".pbar")).toHaveCount(4);
  const rows = await page.locator("table[data-table=domains] tbody tr").count();
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThanOrEqual(8);
  for (const bar of await page.locator(".pbar").all()) {
    await expect(bar.locator(".stk i[data-tip]").first()).toBeVisible();
    expect(await bar.locator(".stk .sr-only").innerText()).toMatch(/\d/);
  }
  expect(bad).toEqual([]);
});

test("the Tier 1 tile lands on List with the same count", async ({ page }) => {
  await page.goto("/?r=overview");
  const tile = page.locator('.kpi[data-kpi=t1gap]');
  const value = num(await tile.locator("[data-value]").innerText());
  await tile.click();
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  expect(num(await page.locator("[data-count=visible]").innerText())).toBe(value);
  const u = new URL(page.url());
  expect(u.searchParams.get("r")).toBe("list");
  expect(u.searchParams.get("tier")).toBe("T1");
});

test("every KPI and pillar lands on List with its count", async ({ page }) => {
  for (const sel of ['.kpi[data-kpi=gap]', '.kpi[data-kpi=noso]', '.kpi[data-kpi=eol]']) {
    await page.goto("/?r=overview");
    const value = num(await page.locator(sel + " [data-value]").innerText());
    await page.locator(sel).click();
    await expect(page.locator("table[data-table=list], [data-page=list]").first()).toBeVisible();
    expect(num(await page.locator("[data-count=visible]").innerText())).toBe(value);
  }
  await page.goto("/?r=overview");
  const bar = page.locator(".pbar[data-pillar=cyber]");
  const gaps = num(await bar.locator("small b").innerText());
  await bar.click();
  expect(num(await page.locator("[data-count=visible]").innerText())).toBe(gaps);
});

test("a bar tip shows on hover", async ({ page }) => {
  await page.goto("/?r=overview");
  await page.locator(".pbar .stk i").first().hover();
  await expect(page.locator(".tip:not([hidden])")).toContainText(/gaps?|OK|attention|no data/);
});

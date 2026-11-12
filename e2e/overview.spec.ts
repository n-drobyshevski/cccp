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

test("the title line, four mono figures with Open in inventory, and the pillar names in their colour", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?r=overview");
  await expect(page.locator("[data-page=overview] .ovh")).toContainText(/applications · read /);
  await expect(page.locator(".kpi .kgo")).toHaveText(["Open in inventory ›", "Open in inventory ›", "Open in inventory ›", "Open in inventory ›"]);
  const fam = await page.locator(".kpi b").first().evaluate((e) => getComputedStyle(e).fontFamily);
  expect(fam).toMatch(/IBM Plex Mono|monospace/);
  const cols = await page.locator(".pbar .pn").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  expect(new Set(cols).size).toBe(4);
  const rule = await page.locator(".ovh").evaluate((e) => [getComputedStyle(e).borderBottomWidth, getComputedStyle(e).borderBottomColor === getComputedStyle(document.body).color]);
  expect(rule).toEqual(["2px", true]);
  // the legend: No data is not a plain colour square
  await expect(page.locator(".legend span")).toHaveText(["OK", "Needs attention", "Gap", "No data"]);
});

test("the domains table has four pillar gap-count columns; a row opens the Inventory on that domain", async ({ page }) => {
  await page.goto("/?r=overview");
  const head = page.locator("table[data-table=domains] thead th");
  await expect(head).toHaveText(["Domain", "Apps", "With a gap", /CY/, /CO/, /CT/, /PL/]);
  const first = page.locator("table[data-table=domains] tbody tr").first();
  await expect(first.locator("td.p")).toHaveCount(4);
  const name = (await first.locator("button.lk b").first().innerText()).trim();
  const apps = num(await first.locator("td.num").first().innerText());
  await first.locator("td").first().click();
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).searchParams.get("dom") || "")).toBe(name);
  expect(num(await page.locator("[data-count=visible]").innerText())).toBe(apps);
});

test("a pillar gap count opens the Inventory on that domain and pillar, with that many applications", async ({ page }) => {
  await page.goto("/?r=overview");
  const cell = page.locator("table[data-table=domains] button.pgap").first();
  const n = num(await cell.innerText());
  await cell.click();
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  expect(num(await page.locator("[data-count=visible]").innerText())).toBe(n);
  expect(new URL(page.url()).searchParams.get("gap")).not.toBeNull();
});

test("'With a gap' opens the Inventory on that domain's gaps", async ({ page }) => {
  await page.goto("/?r=overview");
  const first = page.locator("table[data-table=domains] tbody tr").first();
  const gaps = num(await first.locator("button.gapn").innerText());
  await first.locator("button.gapn").click();
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  expect(num(await page.locator("[data-count=visible]").innerText())).toBe(gaps);
  expect(new URL(page.url()).searchParams.get("gap")).not.toBeNull();
});

test("Open in inventory keeps the lens the viewer was on", async ({ page }) => {
  await page.goto("/?r=list&lens=landscape");
  await expect(page.locator(".land")).toBeVisible();
  await page.locator('[data-k="nav-overview"]').click();
  await page.locator(".kpi[data-kpi=gap]").click();
  await expect(page.locator(".land")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("lens")).toBe("landscape");
});

test("no sideways scroll at 390, 820 and 1920 px", async ({ page }) => {
  for (const width of [390, 820, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?r=overview");
    await expect(page.locator("[data-page=overview]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), String(width)).toBe(true);
  }
});

import { expect, test, type Page } from "@playwright/test";

// One Inventory page, three lenses (Table, Heatmap, Landscape): the switch, what is shared between
// them (the facet panel, the pillar tabs, the count line and the tags), the address, the old
// ?r=heatmap and ?r=landscape links, Back, and no sideways scroll on any lens at any width.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const lensBtn = (page: Page, lens: string) => page.locator(`[data-act=lens][data-lens=${lens}]`);
const visible = async (page: Page) => Number((await page.locator("[data-count=visible]").innerText()).replace(/,/g, ""));
const urlParam = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);
const body = (page: Page, lens: string) => page.locator(`.tbl[data-lens=${lens}]`);
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test("the switch is Table, Heatmap, Landscape at the top right and swaps only the content", async ({ page }) => {
  const bad = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?r=list");
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  await expect(page.locator(".lens button")).toHaveText(["Table", "Heatmap", "Landscape"]);
  await expect(lensBtn(page, "table")).toHaveAttribute("aria-pressed", "true");
  const sw = (await page.locator(".lens").boundingBox())!;
  const content = (await page.locator("[data-region=content]").boundingBox())!;
  expect(sw.x + sw.width).toBeGreaterThan(content.x + content.width - 8);
  expect(sw.y - content.y).toBeLessThan(80);
  const facetsBox = await page.locator("aside.facets").boundingBox();
  const n = await visible(page);
  await lensBtn(page, "heatmap").click();
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  await expect(page.locator("table[data-table=list]")).toHaveCount(0);
  await expect(lensBtn(page, "heatmap")).toHaveAttribute("aria-pressed", "true");
  expect(urlParam(page, "lens")).toBe("heatmap");
  expect(urlParam(page, "r")).toBe("list");
  expect(await visible(page)).toBe(n);
  await lensBtn(page, "landscape").click();
  await expect(page.locator(".land")).toBeVisible();
  expect(urlParam(page, "lens")).toBe("landscape");
  await lensBtn(page, "table").click();
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  expect(urlParam(page, "lens")).toBeNull();
  expect(await page.locator("aside.facets").boundingBox()).toEqual(facetsBox);
  // the pillar tabs and the count line are on every lens
  for (const lens of ["table", "heatmap", "landscape"]) {
    await lensBtn(page, lens).click();
    await expect(page.getByRole("tablist", { name: "Pillar" }).getByRole("tab")).toHaveCount(5);
    await expect(page.locator("[data-count=visible]")).toBeVisible();
  }
  expect(bad).toEqual([]);
});

test("switching the lens keeps the filters, the search, the pillar tab, the open view and the colour metric", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?r=list&tier=T1&q=a&metric=c1");
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  await page.getByRole("tablist", { name: "Pillar" }).getByRole("tab").nth(1).click();
  const n = await visible(page);
  expect(urlParam(page, "gap")).toBe("Cyber");
  await page.locator('[data-k="vsave"]').count();
  for (const lens of ["heatmap", "landscape", "table"]) {
    await lensBtn(page, lens).click();
    expect(urlParam(page, "tier")).toBe("T1");
    expect(urlParam(page, "q")).toBe("a");
    expect(urlParam(page, "gap")).toBe("Cyber");
    expect(urlParam(page, "metric")).toBe("c1");
    expect(await visible(page)).toBe(n);
    await expect(page.getByRole("searchbox", { name: "Search applications" })).toHaveValue("a");
    await expect(page.getByRole("tablist", { name: "Pillar" }).getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator('aside.facets [data-k="side-tier-T1"]')).toBeChecked();
  }
});

test("a lens switch is a replace: Back leaves the page, it does not step through lenses", async ({ page }) => {
  await page.goto("/?r=overview");
  await expect(page.locator("[data-page=overview]")).toBeVisible();
  await page.locator('[data-k="nav-list"]').click();
  await expect(page.locator("[data-page=list]")).toBeVisible();
  await lensBtn(page, "heatmap").click();
  await lensBtn(page, "landscape").click();
  await page.goBack();
  await expect(page.locator("[data-page=overview]")).toBeVisible();
});

test("the old ?r=heatmap and ?r=landscape links open the Inventory on that lens, with their filters", async ({ page }) => {
  const bad = watchConsole(page);
  await page.goto("/?r=heatmap&tier=T1");
  await expect(page.locator("[data-page=list]")).toBeVisible();
  await expect(body(page, "heatmap")).toBeVisible();
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  await expect(lensBtn(page, "heatmap")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".navb [aria-current=page]")).toHaveText("Inventory");
  await expect(page.locator('aside.facets [data-k="side-tier-T1"]')).toBeChecked();
  await page.goto("/?r=landscape&metric=tier");
  await expect(body(page, "landscape")).toBeVisible();
  await expect(page.locator(".land")).toBeVisible();
  await expect(page.locator(".segs button[aria-pressed=true]")).toHaveText("Tier");
  await expect(lensBtn(page, "landscape")).toHaveAttribute("aria-pressed", "true");
  // a lens address in the new form
  await page.goto("/?r=list&lens=landscape");
  await expect(page.locator(".land")).toBeVisible();
  await page.goto("/?lens=heatmap");
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  expect(bad).toEqual([]);
});

test("a saved link to a lens survives a reload and Back from a fact sheet lands on the same lens", async ({ page }) => {
  await page.goto("/?r=list&lens=landscape&metric=c2");
  await expect(page.locator(".land")).toBeVisible();
  await page.reload();
  await expect(page.locator(".land")).toBeVisible();
  await expect(page.locator(".segs button[aria-pressed=true]")).toHaveText("Continuity");
  await page.locator("button.tl").first().click();
  await expect(page.locator("[data-page=app]")).toBeVisible();
  await page.goBack();
  await expect(page.locator(".land")).toBeVisible();
  await expect(page.locator(".segs button[aria-pressed=true]")).toHaveText("Continuity");
});

test("the heatmap lens: a status bar per pillar with a hatched No data segment, glyph rows, pillar-coloured heads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?r=list&lens=heatmap");
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  // no Group by or Reasons toggles
  await expect(page.getByText("Group by")).toHaveCount(0);
  await expect(page.getByText("Glyphs only")).toHaveCount(0);
  const heads = await page.locator("table.heat th.hp").evaluateAll((els) => els.map((e) => [e.textContent, getComputedStyle(e).color, getComputedStyle(e).borderBottomWidth, getComputedStyle(e).borderBottomColor]));
  expect(heads.map((h) => h[0])).toEqual(["Cyber", "Compliance", "Continuity", "Platform"]);
  for (const h of heads) { expect(h[2]).toBe("3px"); expect(h[3]).toBe(h[1]); }
  expect(new Set(heads.map((h) => h[1])).size).toBe(4);
  // the four heads are columns of one header row, left to right
  const boxes = await page.locator("table.heat th.hp").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.top, r.left]; }));
  expect(new Set(boxes.map((b) => Math.round(b[0]))).size).toBe(1);
  expect(boxes.map((b) => b[1])).toEqual([...boxes.map((b) => b[1])].sort((a, b) => a - b));
  const bars = page.locator("tr.grp").first().locator(".sb");
  await expect(bars).toHaveCount(4);
  const order = await bars.first().locator("i").evaluateAll((els) => els.map((e) => e.className || "ok"));
  const rank = ["ok", "warn", "bad", "none"];
  const idx = order.map((c) => rank.indexOf(c));
  expect(idx).toEqual([...idx].sort((a, b) => a - b));
  const none = page.locator(".sb i.none").first();
  if (await none.count()) expect(await none.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain("repeating-linear-gradient");
  // an opened group: glyph and short reason per pillar
  const first = page.locator("tr[data-id]").first();
  await expect(first.locator("td.hc .gl")).toHaveCount(4);
  for (const t of await first.locator("td.hc").allInnerTexts()) expect(t.trim().length).toBeGreaterThan(2);
});

for (const width of [390, 820, 1280, 1920]) {
  test(`no sideways scroll on any lens at ${width} px, and the lens switch stays reachable`, async ({ page }) => {
    const bad = watchConsole(page);
    await page.setViewportSize({ width, height: 900 });
    for (const lens of ["table", "heatmap", "landscape"]) {
      await page.goto("/?r=list&lens=" + lens);
      await expect(page.locator(`.tbl[data-lens=${lens}]`)).toBeVisible();
      expect(await noSideways(page), lens).toBe(true);
      await expect(page.locator(".lens")).toBeInViewport();
      const sw = (await page.locator(".lens").boundingBox())!;
      expect(sw.x).toBeGreaterThanOrEqual(0);
      expect(sw.x + sw.width).toBeLessThanOrEqual(width + 1);
      if (width < 1024) {
        await page.locator('[data-k="fopen"]').click();
        await expect(page.locator("aside.facets")).toBeVisible();
        expect(await noSideways(page), lens + " drawer").toBe(true);
        await page.locator('[data-k="fdone"]').click();
      }
    }
    expect(bad).toEqual([]);
  });
}

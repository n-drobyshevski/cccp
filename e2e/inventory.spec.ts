import { expect, test, type Page } from "@playwright/test";

// The Inventory (identity G): the left facet panel and its drawer below 1024 px, pillar tabs, the
// glyph status columns, active-filter tags, and the shell search (live here, Enter from elsewhere).

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const urlParam = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);
const visible = async (page: Page) => Number((await page.locator("[data-count=visible]").innerText()).replace(/,/g, ""));
const search = (page: Page) => page.getByRole("searchbox", { name: "Search applications" });
const facets = (page: Page) => page.locator("aside.facets");
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function ready(page: Page, query = "") {
  await page.goto("/?r=list" + query);
  await expect(page.locator("table[data-table=list]")).toBeVisible();
}

test.describe("facet panel", () => {
  test("at 1280 px it is on the left with counts, checkboxes and per-facet Clear", async ({ page }) => {
    const bad = watchConsole(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await ready(page);
    const panel = facets(page);
    await expect(panel).toBeVisible();
    const p = (await panel.boundingBox())!;
    const c = (await page.locator("[data-region=content]").boundingBox())!;
    expect(p.x).toBeLessThan(c.x);
    await expect(panel.locator(".fh > span:first-child")).toContainText(["Tier", "Lifecycle", "Domain", "Security officer", "Gap in"]);
    await expect(page.locator('[data-k="fopen"]')).toBeHidden();
    const total = await visible(page);
    const t1 = panel.locator('[data-k="side-tier-T1"]');
    const count = Number((await t1.locator("xpath=..").locator("small").innerText()).replace(/,/g, ""));
    await t1.check();
    await expect.poll(() => visible(page)).toBe(count);
    expect(urlParam(page, "tier")).toBe("T1");
    await expect(page.locator(".ftag")).toHaveText(["Tier: T1"]);
    await expect(panel.locator('[data-k="fclear-tier"]')).toBeVisible();
    await panel.locator('[data-k="fclear-tier"]').click();
    await expect.poll(() => visible(page)).toBe(total);
    await expect(page.locator(".ftag")).toHaveCount(0);
    expect(bad).toEqual([]);
  });

  test("a long facet shows the top few with '+ N more', which opens the rest with a find box", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await ready(page);
    const dom = facets(page).locator('section[data-facet="dom"]');
    const before = await dom.locator(".ck").count();
    expect(before).toBe(5);
    await dom.locator('[data-k="fmore-dom"]').click();
    await expect.poll(() => dom.locator(".ck").count()).toBeGreaterThan(before);
    await expect(dom.locator("input.find")).toBeVisible();
    await dom.locator("input.find").fill("qqqqzzzz");
    await expect(dom.locator(".hint")).toHaveText("Nothing matches");
    await dom.locator('[data-k="fmore-dom"]').click();
    await expect(dom.locator(".ck")).toHaveCount(5);
  });

  test("below 1024 px the panel is behind a Filters button and opens as a drawer", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await ready(page);
    await expect(facets(page)).toBeHidden();
    const btn = page.locator('[data-k="fopen"]');
    await expect(btn).toHaveText("Filters");
    await btn.click();
    await expect(facets(page)).toBeVisible();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await facets(page).locator('[data-k="side-tier-T1"]').check();
    await page.locator('[data-k="fdone"]').click();
    await expect(facets(page)).toBeHidden();
    await expect(btn).toHaveText("Filters (1)");
    await expect(btn).toBeFocused();
    await btn.click();
    await expect(facets(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(facets(page)).toBeHidden();
  });

  test("at 390 px nothing scrolls sideways, even with filters on", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page, "&tier=T1,T2&gap=Cyber");
    expect(await noSideways(page)).toBe(true);
    await page.locator('[data-k="fopen"]').click();
    expect(await noSideways(page)).toBe(true);
  });
});

test.describe("pillar tabs", () => {
  test("All and four pillars; a pillar applies Gap in, All clears it, counts are over the filtered set", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    const tabs = page.getByRole("tablist", { name: "Pillar" }).getByRole("tab");
    await expect(tabs).toHaveCount(5);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    const cyber = tabs.nth(1);
    const gaps = Number((await cyber.locator("b").innerText()).replace(/,/g, ""));
    await cyber.click();
    await expect(cyber).toHaveAttribute("aria-selected", "true");
    expect(urlParam(page, "gap")).toBe("Cyber");
    await expect.poll(() => visible(page)).toBe(gaps);
    await expect(facets(page).locator('[data-k="side-gap-Cyber"]')).toBeChecked();
    // The tabs keep their counts while one is open.
    await expect(cyber.locator("b")).toHaveText(gaps.toLocaleString("en-US"));
    await tabs.nth(0).click();
    expect(urlParam(page, "gap")).toBeNull();
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    // A tier filter narrows every count.
    const allBefore = Number((await tabs.nth(0).locator("b").innerText()).replace(/,/g, ""));
    await facets(page).locator('[data-k="side-tier-T1"]').check();
    await expect.poll(async () => Number((await tabs.nth(0).locator("b").innerText()).replace(/,/g, ""))).toBeLessThan(allBefore);
    // Arrow keys move between tabs.
    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    expect(bad).toEqual([]);
  });
});

test.describe("status glyphs", () => {
  test("four columns CY CO CT PL with a glyph per pillar, named in words; no data is dashed", async ({ page }) => {
    await ready(page);
    await expect(page.locator("table[data-table=list] thead th.p")).toHaveText(["CY", "CO", "CT", "PL"]);
    const first = page.locator("tbody tr").first();
    await expect(first.locator("td[data-col=st]")).toHaveCount(4);
    const labels = await first.locator("td[data-col=st] .gl").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
    expect(labels.map((l) => l.split(":")[0])).toEqual(["Cyber", "Compliance", "Continuity", "Platform"]);
    for (const l of labels) expect(l).toMatch(/: (Gap|Needs attention|OK|No data)/);
    const tips = await first.locator("td[data-col=st] .gl").evaluateAll((els) => els.map((e) => e.getAttribute("data-tip") ?? ""));
    expect(tips).toEqual(labels);
    const none = page.locator("td[data-col=st] .gl.none").first();
    expect(await none.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("dashed");
    expect(await none.locator("svg").count()).toBe(0);
    await page.locator("td[data-col=st] .gl").first().focus();
    await expect(page.locator(".tip")).toContainText(/Cyber: /);
  });
});

test.describe("shell search", () => {
  test("typing on the Inventory filters live and writes q; clearing the field restores the list", async ({ page }) => {
    await ready(page);
    const total = await visible(page);
    await search(page).fill("zzzzqqqq");
    await expect.poll(() => visible(page)).toBe(0);
    expect(urlParam(page, "q")).toBe("zzzzqqqq");
    await expect(page.locator(".ftag")).toContainText("Search");
    await page.locator('.ftag [data-act="rm-q"]').click();
    await expect.poll(() => visible(page)).toBe(total);
    await expect(search(page)).toHaveValue("");
  });

  test("typing is debounced: fast typing sends one update", async ({ page }) => {
    await ready(page);
    await page.evaluate(() => {
      const w = window as any;
      w.__writes = 0;
      const h = w.google.script.history;
      const r = h.replace;
      h.replace = (...a: unknown[]) => { w.__writes++; return r.apply(h, a); };
    });
    await search(page).click();
    await page.keyboard.type("abcdef", { delay: 10 });
    await expect.poll(() => urlParam(page, "q")).toBe("abcdef");
    expect(await page.evaluate(() => (window as any).__writes)).toBe(1);
    await expect(search(page)).toBeFocused();
  });

  test("from another page Enter opens the Inventory with that query", async ({ page }) => {
    await page.goto("/?r=overview");
    await expect(page.locator("[data-page=overview]")).toBeVisible();
    await search(page).fill("zzzzqqqq");
    await page.waitForTimeout(300);
    await expect(page.locator("[data-page=overview]")).toBeVisible();
    await search(page).press("Enter");
    await expect(page.locator("[data-page=list]")).toBeVisible();
    expect(urlParam(page, "r")).toBe("list");
    expect(urlParam(page, "q")).toBe("zzzzqqqq");
    await expect.poll(() => visible(page)).toBe(0);
    await expect(search(page)).toHaveValue("zzzzqqqq");
  });

  test("a query in the address is shown in the field; Clear all empties it", async ({ page }) => {
    await ready(page, "&q=a&tier=T1");
    await expect(search(page)).toHaveValue("a");
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await expect(search(page)).toHaveValue("");
    expect(urlParam(page, "q")).toBeNull();
    expect(urlParam(page, "tier")).toBeNull();
  });
});

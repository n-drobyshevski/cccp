import { expect, test, type Page } from "@playwright/test";

// The facet panel of the Inventory (shared by the table, heatmap and landscape lenses), against the dev
// server: values and counts, the skip rule, find, focus handling across re-renders, the active-filter
// tags, Clear all, the address and hostile values.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const facets = (page: Page) => page.locator("aside.facets");
const sec = (page: Page, k: string) => facets(page).locator(`section[data-facet="${k}"]`);
const visible = async (page: Page) => Number((await page.locator("[data-count=visible]").innerText()).split(" ")[0].replace(/,/g, ""));
const urlParam = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);
const search = (page: Page) => page.getByRole("searchbox", { name: "Search applications" });

async function ready(page: Page, query = "") {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?r=list" + query);
  await expect(page.locator("table[data-table=list]")).toBeVisible();
}

/** The values and counts of a panel section, in order. */
async function rowsOf(scope: ReturnType<Page["locator"]>) {
  return scope.locator(".ck").evaluateAll((els) => els.map((e) => ({
    value: (e.querySelector("span") as HTMLElement).textContent as string,
    count: Number((e.querySelector("small") as HTMLElement).textContent!.replace(/,/g, "")),
    muted: e.classList.contains("zero"),
    checked: (e.querySelector("input") as HTMLInputElement).checked,
  })));
}

async function openAll(page: Page, k: string) {
  const more = sec(page, k).locator(`[data-k="fmore-${k}"]`);
  if (await more.count()) await more.click();
}

test.describe("values, counts and selection", () => {
  test("a section lists its values with counts; ticking shows a tag, the count and the address", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    await openAll(page, "lc");
    const rows = await rowsOf(sec(page, "lc"));
    expect(rows.length).toBeGreaterThan(2);
    await sec(page, "lc").locator(".ck input").nth(0).check();
    await expect(page.locator(".ftag")).toHaveText([`Lifecycle: ${rows[0].value}`]);
    expect(urlParam(page, "lc")).toBe(rows[0].value);
    await expect.poll(() => visible(page)).toBe(rows[0].count);
    await sec(page, "lc").locator(".ck input").nth(1).check();
    await expect(page.locator(".ftag")).toHaveText([`Lifecycle: ${rows[0].value}, ${rows[1].value}`]);
    expect(urlParam(page, "lc")).toContain(",");
    expect(bad).toEqual([]);
  });

  test("counts skip the facet's own selection; zero rows are muted but listed", async ({ page }) => {
    await ready(page);
    await openAll(page, "lc");
    const before = await rowsOf(sec(page, "lc"));
    const total = before.reduce((n, r) => n + r.count, 0);
    expect(total).toBe(await visible(page));
    await sec(page, "lc").locator(".ck input").nth(0).check();
    const own = await rowsOf(sec(page, "lc"));
    expect(own.map((r) => r.count)).toEqual(before.map((r) => r.count));
    expect(own[0].checked).toBe(true);
    await sec(page, "tier").locator('[data-k="side-tier-No tier"]').check();
    const narrowed = await rowsOf(sec(page, "lc"));
    expect(narrowed.length).toBe(before.length);
    for (const r of narrowed) expect(r.muted).toBe(r.count === 0);
    expect(narrowed.reduce((n, r) => n + r.count, 0)).toBeLessThan(total);
  });

  test("Domain and Security officer have find once opened; Lifecycle does not", async ({ page }) => {
    await ready(page);
    await expect(sec(page, "lc").locator("input.find")).toHaveCount(0);
    for (const k of ["dom", "so"]) {
      await openAll(page, k);
      const find = sec(page, k).locator("input.find");
      await expect(find).toBeVisible();
      const all = await rowsOf(sec(page, k));
      const probe = all.map((r) => r.value).find((v) => /[a-z]{3}/i.test(v))!;
      const needle = probe.replace(/[^a-z]/gi, "").slice(0, 3).toLowerCase();
      await find.pressSequentially(needle, { delay: 15 });
      await expect(find).toBeFocused();
      const found = await rowsOf(sec(page, k));
      expect(found.length).toBeGreaterThan(0);
      expect(found.length).toBeLessThanOrEqual(all.length);
      for (const r of found) expect(r.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).toContain(needle);
      await find.fill("qqqqzzzz");
      await expect(sec(page, k).locator(".hint")).toHaveText("Nothing matches");
      await find.fill("");
    }
  });

  test("checkbox focus survives the re-render, by keyboard", async ({ page }) => {
    await ready(page);
    await openAll(page, "lc");
    const box = sec(page, "lc").locator(".ck input").nth(1);
    const key = await box.getAttribute("data-k");
    await box.focus();
    await page.keyboard.press("Space");
    await expect(box).toBeChecked();
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-k"));
    expect(focused).toBe(key);
    await expect(page.locator(".ftag")).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(page.locator(".ftag")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-k"))).toBe(key);
  });

  test("an open list keeps its scroll while a value is ticked", async ({ page }) => {
    await ready(page);
    await openAll(page, "dom");
    const n = await sec(page, "dom").locator(".ck").count();
    test.skip(n < 14, "not enough domains to scroll");
    const list = sec(page, "dom").locator(".plist");
    await list.evaluate((e) => { e.scrollTop = 100; });
    await sec(page, "dom").locator(".ck input").nth(9).check();
    await expect(page.locator(".ftag")).toHaveCount(1);
    expect(await sec(page, "dom").locator(".plist").evaluate((e) => e.scrollTop)).toBe(100);
  });
});

test.describe("search, tiers, count, Clear all", () => {
  test("tier toggles update the count and the address; Clear all resets", async ({ page }) => {
    await ready(page);
    const total = await visible(page);
    await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);
    await sec(page, "tier").locator('[data-k="side-tier-T1"]').check();
    await expect(page.locator(".ftag")).toHaveText(["Tier: T1"]);
    await expect.poll(() => visible(page)).toBeLessThan(total);
    await expect(page.locator("[data-count=of]")).toContainText(`of ${total.toLocaleString("en-US")} application`);
    expect(urlParam(page, "tier")).toBe("T1");
    const afterTier = await visible(page);
    await sec(page, "tier").locator('[data-k="side-tier-T2"]').check();
    await expect(page.locator(".ftag")).toHaveText(["Tier: T1, T2"]);
    await expect.poll(() => visible(page)).toBeGreaterThan(afterTier);
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await expect.poll(() => visible(page)).toBe(total);
    await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);
    await expect(page.locator(".ftag")).toHaveCount(0);
    for (const k of ["q", "tier", "dom", "lc", "so", "gap"]) expect(urlParam(page, k)).toBeNull();
    await expect(facets(page).locator("input:checked")).toHaveCount(0);
  });

  test("a filter in the address is shown by the panel and the tags on load", async ({ page }) => {
    await ready(page, "&tier=T1&q=a");
    await expect(sec(page, "tier").locator('[data-k="side-tier-T1"]')).toBeChecked();
    await expect(page.locator(".ftag")).toHaveCount(2);
    await expect(search(page)).toHaveValue("a");
    await expect(page.getByRole("button", { name: "Clear all" })).toBeVisible();
  });

  test("the same panel and filters drive every lens", async ({ page }) => {
    await ready(page, "&tier=T1");
    const n = await visible(page);
    for (const lens of ["heatmap", "landscape", "table"]) {
      await page.locator(`[data-act=lens][data-lens=${lens}]`).click();
      await expect(sec(page, "tier").locator('[data-k="side-tier-T1"]')).toBeChecked();
      expect(await visible(page)).toBe(n);
      expect(urlParam(page, "tier")).toBe("T1");
    }
  });
});

test.describe("hostile values", () => {
  const BAD = '<img src=x onerror="window.__xss=1">';
  test("a domain and an officer that are markup stay text in the panel, tags and search", async ({ page }) => {
    const bad = watchConsole(page);
    await page.route("**/workbook.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\n(function () {
        var rows = window.__CCCP_WORKBOOK__.tabs[0].rows;
        var h = rows[0];
        var d = h.indexOf("Domain"), o = h.indexOf("Security Officer Name"), l = h.indexOf("Lifecycle");
        for (var i = 1; i <= 3; i++) { rows[i][d] = ${JSON.stringify(BAD)}; rows[i][o] = ${JSON.stringify(BAD)}; }
        rows[4][d] = '"><script>window.__xss=2<\\/script>';
        rows[4][l] = ${JSON.stringify(BAD)};
      })();`;
      await route.fulfill({ response: res, body });
    });
    await ready(page);
    for (const k of ["dom", "so", "lc"]) {
      await openAll(page, k);
      await expect(sec(page, k).locator("img, script")).toHaveCount(0);
      if (k !== "lc") await sec(page, k).locator("input.find").fill(BAD);
      await expect(sec(page, k).locator("img, script")).toHaveCount(0);
      if (k !== "lc") await sec(page, k).locator("input.find").fill("");
    }
    await openAll(page, "dom");
    expect((await rowsOf(sec(page, "dom"))).some((r) => r.value === BAD)).toBe(true);
    await sec(page, "dom").locator("input.find").fill("img src");
    await sec(page, "dom").locator(".ck input").first().check();
    await expect(page.locator(".ftag")).toContainText("<img src=x");
    const box = search(page);
    await box.fill(BAD);
    await box.press("Enter");
    await expect.poll(() => urlParam(page, "q")).toBe(BAD);
    await page.reload();
    await expect(page.locator("[data-page=list]")).toBeVisible();
    await expect(search(page)).toHaveValue(BAD);
    await expect(page.locator("aside.facets img, .ftag img, script:not([src])")).toHaveCount(await page.locator("script:not([src])").count());
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    expect(bad).toEqual([]);
  });
});

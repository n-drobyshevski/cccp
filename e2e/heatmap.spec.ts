import { expect, test, type Page } from "@playwright/test";

// The heatmap page against the dev server: groups sorted by size, exact counts, the red number,
// the default open set and its persistence across filter changes, cells and Back.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const groups = (page: Page) => page.locator("tr.grp");
const open = (page: Page) => page.locator('tr.grp .gb[aria-expanded="true"]');
const total = (page: Page) => page.evaluate(() => (window as any).__CCCP_WORKBOOK__.tabs[0].rows.slice(1).filter((r: unknown[]) => r[0]).length as number);

async function ready(page: Page, query = "") {
  await page.goto("/?r=heatmap" + query);
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
}
const sizeOf = async (page: Page, i: number) => Number(await groups(page).nth(i).locator(".gb > span").innerText());

test("groups are sorted by size and the red number equals the bad count", async ({ page }) => {
  const bad = watchConsole(page);
  await ready(page);
  const n = await groups(page).count();
  expect(n).toBeGreaterThan(1);
  let sum = 0;
  let prev = Infinity;
  for (let i = 0; i < n; i++) {
    const size = await sizeOf(page, i);
    expect(size).toBeLessThanOrEqual(prev);
    prev = size;
    sum += size;
    const g = groups(page).nth(i);
    for (const p of ["cyber", "compliance", "continuity", "platform"]) {
      const cell = g.locator("td.sbc").nth(["cyber", "compliance", "continuity", "platform"].indexOf(p));
      const tip = (await cell.locator(".sbw").getAttribute("data-tip"))!;
      const m = tip.match(/: ([\d,]+) gaps? · ([\d,]+) need.* · ([\d,]+) no data · ([\d,]+) OK/)!;
      const [b, w, nn, ok] = m.slice(1).map((x) => Number(x.replace(/,/g, "")));
      expect(b! + w! + nn! + ok!).toBe(size);
      const red = (await cell.locator("small").innerText()).trim();
      expect(red).toBe(b ? String(b) : "");
    }
  }
  expect(sum).toBe(await total(page));
  expect(bad).toEqual([]);
});

test("the largest group is open by default and stays open across a filter change", async ({ page }) => {
  await ready(page);
  const size = await sizeOf(page, 0);
  if ((await total(page)) > 40) {
    await expect(open(page)).toHaveCount(1);
    await expect(groups(page).first().locator(".gb")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("tr[data-id]")).toHaveCount(size);
  }
  const firstName = (await groups(page).first().getAttribute("data-group"))!;
  await page.getByRole("searchbox").or(page.locator("input[type=search]")).first().fill("a");
  await expect(page.locator("[data-count=visible]")).not.toHaveText(String(await total(page)));
  await page.locator("input[type=search]").first().fill("");
  await expect(groups(page)).not.toHaveCount(0);
  if ((await total(page)) > 40) {
    await expect(page.locator(`tr.grp[data-group="${firstName}"] .gb`)).toHaveAttribute("aria-expanded", "true");
    await expect(open(page)).toHaveCount(1);
  }
});

test("40 applications or fewer open every group; no match shows the empty state", async ({ page }) => {
  await ready(page);
  const word = (await page.locator("tr[data-id] button.nm").first().innerText()).trim().split(/\s+/)[0]!;
  await page.goto("/?r=heatmap&q=" + encodeURIComponent(word));
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  const shown = Number((await page.locator("[data-count=visible]").innerText()).replace(/,/g, ""));
  if (shown <= 40) {
    const n = await groups(page).count();
    await expect(open(page)).toHaveCount(n);
    await expect(page.locator("tr[data-id]")).toHaveCount(shown);
  }
  await page.goto("/?r=heatmap&q=zzzzzzzz");
  await expect(page.locator(".empty")).toBeVisible();
});

test("toggling a group shows and hides its rows; cells show the dot and why", async ({ page }) => {
  await ready(page);
  const second = groups(page).nth(1).locator(".gb");
  const size = await sizeOf(page, 1);
  const before = await page.locator("tr[data-id]").count();
  await second.click();
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("tr[data-id]")).toHaveCount(before + size);
  const cell = page.locator("tr[data-id] td.hc").first();
  await expect(cell.locator(".dot")).toBeVisible();
  expect((await cell.innerText()).trim().length).toBeGreaterThan(2);
  await second.click();
  await expect(page.locator("tr[data-id]")).toHaveCount(before);
});

test("opening an application and going Back restores the scroll and the open groups", async ({ page }) => {
  const bad = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page);
  await groups(page).nth(1).locator(".gb").click();
  await groups(page).nth(2).locator(".gb").click();
  const openBefore = await open(page).count();
  const target = page.locator("tr[data-id]").nth(40).locator("button.nm");
  await target.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 150));
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(300);
  await target.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-page=app]")).toBeVisible();
  await page.goBack();
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  await expect(open(page)).toHaveCount(openBefore);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 4);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(y + 4);
  expect(bad).toEqual([]);
});

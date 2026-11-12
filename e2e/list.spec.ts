import { expect, test, type Page } from "@playwright/test";

// The list page against the dev server: sortable headers (aria-sort, the URL), the Columns menu
// and its persistence, the count, Show more, the empty state, keyboard rows and Back restoring
// the scroll position.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const urlParam = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);
const rowsOf = (page: Page) => page.locator("table[data-table=list] tbody tr");
const heads = (page: Page) => page.locator("table[data-table=list] thead th");
const headNames = async (page: Page) => (await heads(page).allInnerTexts()).map((t) => t.trim().toLowerCase());
const head = (page: Page, name: string) => page.locator("table[data-table=list] thead").getByRole("button", { name, exact: true });
const visible = async (page: Page) => Number((await page.locator("[data-count=visible]").innerText()).replace(/,/g, ""));
const total = (page: Page) => page.evaluate(() => (window as any).__CCCP_WORKBOOK__.tabs[0].rows.slice(1).filter((r: unknown[]) => r[0]).length as number);

async function ready(page: Page, query = "") {
  await page.goto("/?r=list" + query);
  await expect(page.locator("table[data-table=list]")).toBeVisible();
}

test.describe("sorting", () => {
  test("a header click sorts, toggles and writes the URL; aria-sort follows", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    await expect(page.locator("th[aria-sort]")).toHaveCount(1);
    await expect(page.locator("th[aria-sort]")).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("th[aria-sort]")).toContainText("Application");
    await head(page, "Domain").click();
    await expect(page.locator("th[aria-sort]")).toContainText("Domain");
    await expect(page.locator("th[aria-sort]")).toHaveAttribute("aria-sort", "ascending");
    expect(urlParam(page, "sort")).toBe("d");
    expect(urlParam(page, "desc")).toBeNull();
    const asc = await page.locator("td[data-col=d]").allInnerTexts();
    expect(asc).toEqual([...asc].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    await head(page, "Domain").click();
    await expect(page.locator("th[aria-sort]")).toHaveAttribute("aria-sort", "descending");
    expect(urlParam(page, "desc")).toBe("1");
    const desc = await page.locator("td[data-col=d]").allInnerTexts();
    expect(desc).toEqual([...desc].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    expect(bad).toEqual([]);
  });

  test("Status uses the lx3 key: worst first on the first click", async ({ page }) => {
    await ready(page);
    await head(page, "Status").click();
    await expect(page.locator("th[aria-sort]")).toHaveAttribute("aria-sort", "descending");
    expect(urlParam(page, "sort")).toBe("st");
    const gaps = await rowsOf(page).evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll("td[data-col=st] .dot.bad").length));
    expect(gaps.length).toBeGreaterThan(1);
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
    expect(gaps[0]).toBeGreaterThanOrEqual(gaps[gaps.length - 1]);
  });

  test("a link with a sort opens sorted, and the column is drawn", async ({ page }) => {
    await ready(page, "&sort=so&desc=1");
    await expect(page.locator("th[aria-sort]")).toContainText("Security officer");
    await expect(page.locator("th[aria-sort]")).toHaveAttribute("aria-sort", "descending");
    await ready(page, "&sort=ty");
    await expect(page.locator("th[aria-sort]")).toContainText("Typology");
  });
});

test.describe("columns", () => {
  test("the Columns menu opens by keyboard on its first enabled checkbox", async ({ page }) => {
    await ready(page);
    await page.getByRole("button", { name: "Columns" }).focus();
    await page.keyboard.press("Enter");
    const f = page.locator("input[data-act=col]:focus");
    await expect(f).toHaveCount(1);
    await expect(f).toBeEnabled();
    await page.keyboard.press("Space");
    expect(urlParam(page, "cols")).toMatch(/^[-+]/);
  });

  test("choose, persist, reset; Application is fixed", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    const defaults = await headNames(page);
    expect(defaults[0]).toBe("application");
    await page.getByRole("button", { name: "Columns" }).click();
    const pop = page.getByRole("dialog", { name: "Columns" });
    await expect(pop).toBeVisible();
    await expect(pop.getByLabel("Application")).toBeDisabled();
    await expect(pop.getByLabel("Application")).toBeChecked();
    await pop.getByLabel("Security officer").uncheck();
    await expect(page.locator("th", { hasText: "Security officer" })).toHaveCount(0);
    expect(urlParam(page, "cols")).toBe("-so");
    await pop.getByLabel("Typology").check();
    await expect(page.locator("th", { hasText: "Typology" })).toHaveCount(1);
    expect(urlParam(page, "cols")).toBe("-so,+ty");
    expect(await page.evaluate(() => localStorage.getItem("cccp.cols"))).toBe('["-so","+ty"]');
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Columns" })).toBeFocused();
    // A bare address in a fresh load keeps the choice.
    await page.goto("/?r=list");
    await expect(page.locator("table[data-table=list]")).toBeVisible();
    await expect(page.locator("th", { hasText: "Security officer" })).toHaveCount(0);
    await expect(page.locator("th", { hasText: "Typology" })).toHaveCount(1);
    expect(urlParam(page, "cols")).toBe("-so,+ty");
    // Reset forgets it.
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("button", { name: "Reset to default" }).click();
    expect(await headNames(page)).toEqual(defaults);
    expect(await page.evaluate(() => localStorage.getItem("cccp.cols"))).toBeNull();
    expect(urlParam(page, "cols")).toBeNull();
    expect(bad).toEqual([]);
  });

  test("a refusing localStorage does not stop the chooser", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    });
    await ready(page);
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("dialog", { name: "Columns" }).getByLabel("Owner").uncheck();
    await expect(page.locator("th", { hasText: "Owner" })).toHaveCount(0);
  });
});

test.describe("count, Show more and the empty state", () => {
  test("the count follows the search; Show more adds 50", async ({ page }) => {
    await ready(page);
    const n = await total(page);
    expect(n).toBeGreaterThan(100);
    expect(await visible(page)).toBe(n);
    await expect(page.locator("[data-count=of]")).toHaveText("of " + n.toLocaleString("en-US") + " applications");
    await expect(rowsOf(page)).toHaveCount(50);
    await expect(page.getByRole("button", { name: /^Show 50 more/ })).toContainText((n - 50).toLocaleString("en-US") + " left");
    await page.getByRole("button", { name: /^Show 50 more/ }).click();
    await expect(rowsOf(page)).toHaveCount(100);
    await page.getByRole("button", { name: "T1", exact: true }).click();
    const t1 = await visible(page);
    expect(t1).toBeLessThan(n);
    await expect(page.locator("[data-count=of]")).toContainText("of " + n.toLocaleString("en-US"));
    await expect(rowsOf(page)).toHaveCount(Math.min(50, t1));
  });

  test("an empty result offers Clear all", async ({ page }) => {
    await ready(page);
    await page.getByLabel("Search applications").fill("zzzz-no-such-application");
    await expect(page.locator(".empty")).toContainText("No application matches");
    await expect(page.locator("table[data-table=list]")).toHaveCount(0);
    await expect(page.locator("[data-count=visible]")).toHaveText("0");
    await page.locator(".empty").getByRole("button", { name: "Clear all filters" }).click();
    await expect(page.locator("table[data-table=list]")).toBeVisible();
    await expect(page.getByLabel("Search applications")).toHaveValue("");
    expect(await visible(page)).toBe(await total(page));
  });
});

test.describe("rows open the application", () => {
  test("a name is a keyboard button; Enter opens, Back restores the scroll and the rows", async ({ page }) => {
    const bad = watchConsole(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await ready(page);
    await page.getByRole("button", { name: /^Show 50 more/ }).click();
    await expect(rowsOf(page)).toHaveCount(100);
    const target = rowsOf(page).nth(30).locator("button.nm");
    const name = (await target.innerText()).trim();
    const id = await rowsOf(page).nth(30).getAttribute("data-id");
    await target.focus();
    await page.evaluate(() => window.scrollTo(0, 700));
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(300);
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-page=app]")).toBeVisible();
    await expect(page.locator("[data-app-id]")).toHaveText(id!);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.goBack();
    await expect(page.locator("table[data-table=list]")).toBeVisible();
    await expect(rowsOf(page)).toHaveCount(100);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 4);
    expect(await page.evaluate(() => window.scrollY)).toBeLessThan(before + 4);
    expect(name.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  test("a click on a row opens it too, and the button is reachable by role", async ({ page }) => {
    await ready(page);
    const first = rowsOf(page).first();
    const id = await first.getAttribute("data-id");
    const name = (await first.locator("button.nm").innerText()).trim();
    await expect(page.getByRole("button", { name, exact: true }).first()).toBeVisible();
    await first.locator("td[data-col=d]").click();
    await expect(page.locator("[data-app-id]")).toHaveText(id!);
  });
});

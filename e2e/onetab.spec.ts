import { expect, test, type Page } from "@playwright/test";

// The single-tab owner: the workbook has ONE tab, named Inventory, and the Settings are the
// untouched defaults (?onetab). Nothing is configured, and everything has to work: the list, a
// fact sheet whose pillars show No data, and Settings > Data source with the detected tab and the
// pillars on the same tab, in neutral styling.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("the list shows all 1,125 applications and a fact sheet opens with no pillar data", async ({ page }) => {
  const bad = watchConsole(page);
  await page.goto("/?onetab&r=list");
  await expect(page.locator("[data-count=of]")).toContainText("of 1,125");
  await expect(page.locator("[data-count=visible]")).toHaveText("1,125");
  const id = await page.locator("tr[data-id]").first().getAttribute("data-id");
  await page.goto("/?onetab&app=" + id);
  await expect(page.locator(".hx h1")).toBeVisible();
  await expect(page.locator(".pstat .stag")).toHaveCount(4);
  // Compliance and Continuity read only pillar columns, so they have no data. (Cyber and Platform also judge identity columns the inventory does have.)
  const labels = await page.locator(".pstat .stag").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  for (const pillar of ["Compliance", "Continuity"]) {
    expect(labels.find((l) => l.startsWith(pillar + ":")), pillar).toMatch(/No data/);
  }
  await expect(page.locator(".state.error, [role=alert]")).toHaveCount(0);
  expect(bad).toEqual([]);
});

for (const [w, h] of [[1280, 900], [390, 800]] as const) {
  test("Settings > Data source at " + w + "px: detected tab, same-tab pillars, neutral, no overflow", async ({ page }) => {
    const bad = watchConsole(page);
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/?onetab&r=settings&tab=source");
    await expect(page.locator("[data-page=settings]")).toBeVisible();
    const apps = page.locator("[data-tab-row=apps]");
    await expect(apps.locator("select option:checked")).toHaveText("Inventory · detected");
    for (const k of ["ciat", "aud", "drp", "plat"]) {
      const row = page.locator("[data-tab-row=" + k + "]");
      await expect(row.locator("select option:checked")).toHaveText("Same tab as Applications");
      await expect(row.locator("[data-neutral]")).toContainText(/\d+ of \d+ columns yet/);
      await expect(row.locator(".res")).toHaveCount(0);
    }
    await expect(page.locator("[data-tab-row] .res.warn, [data-tab-row] .res.bad")).toHaveCount(0);
    await expect(page.locator("[data-region=conn] .dot.warn")).toHaveCount(0);
    await expect(page.locator("[data-region=conn]")).toContainText("Connected to");
    await expect(page.locator("[data-issues]")).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(bad).toEqual([]);
  });
}

test("Field mapping offers the inventory headers for a pillar field and notes the absent columns neutrally", async ({ page }) => {
  const bad = watchConsole(page);
  await page.goto("/?onetab&r=settings&tab=fields");
  await expect(page.locator("[data-page=settings]")).toBeVisible();
  await expect(page.locator("[data-callout-note]")).toContainText("not provided yet");
  await expect(page.locator("[data-callout]")).toHaveCount(0);
  const hosting = page.locator("[data-field=hosting] select");
  await expect(hosting.locator("option[value=Typology]")).toHaveCount(1);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(bad).toEqual([]);
});

test("choosing a separate tab for a pillar is a pending change", async ({ page }) => {
  const bad = watchConsole(page);
  await page.goto("/?onetab&r=settings&tab=source");
  await expect(page.locator("[data-tab-row=ciat]")).toBeVisible();
  await page.locator("[data-tab-row=ciat] select").selectOption("Inventory");
  await expect(page.locator("[data-tab-row=ciat] select option:checked")).toHaveText("Inventory");
  await expect(page.locator("[data-tab-row=ciat] [data-neutral]")).toHaveText("Save to check");
  expect(bad).toEqual([]);
});

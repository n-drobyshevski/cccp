import { expect, test, type Page } from "@playwright/test";

// Settings, Status rules against the dev server: live draft counts, toggles, clamped months,
// the tier chips, fixed rules without a switch, one save patch, and the dots changing on the
// List and the Heatmap after the save.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const spy = (page: Page) => page.evaluate(() => {
  const w = window as any;
  w.__saves = [];
  const orig = w.api_saveSettings;
  w.api_saveSettings = (p: unknown) => { w.__saves.push(JSON.parse(JSON.stringify(p))); return orig(p); };
});
const saves = (page: Page) => page.evaluate(() => (window as any).__saves as any[]);
const saveBtn = (page: Page) => page.locator(".savebar").getByRole("button", { name: "Save changes" });
const cnt = async (page: Page, id: string) => Number((await page.locator('[data-cnt="' + id + '"] b').innerText()).replace(/,/g, ""));
const months = (page: Page, id: string) => page.locator('input[data-rule="' + id + '"][data-prop=months]');
const nav = (page: Page, name: string) => page.locator(".navb").getByRole("button", { name });

async function open(page: Page) {
  await page.goto("/?r=settings&tab=rules");
  await expect(page.locator("[data-page=settings][data-tab=rules]")).toBeVisible();
  await expect(page.locator("[data-rule-row]")).toHaveCount(14);
}

/** Cyber 'needs attention' across every domain of the heatmap. */
async function heatCyberWarn(page: Page): Promise<number> {
  await nav(page, "Heatmap").click();
  await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
  const tips = await page.locator("tr.grp td.sbc:nth-child(2) .sbw").evaluateAll((els) => els.map((e) => e.getAttribute("data-tip") || ""));
  let sum = 0;
  for (const t of tips) {
    const m = t.match(/: ([\d,]+) gaps? · ([\d,]+) need/);
    if (m) sum += Number(m[2]!.replace(/,/g, ""));
  }
  return sum;
}
const listCyberWarn = async (page: Page) => {
  await nav(page, "List").click();
  await expect(page.locator("table[data-table=list]")).toBeVisible();
  return page.locator('table[data-table=list] [aria-label^="Cyber: Needs attention"]').count();
};

test("the catalogue is shown by pillar; fixed rules have no switch, the others do", async ({ page }) => {
  const bad = watchConsole(page);
  await open(page);
  await expect(page.locator("[data-pillar]")).toHaveCount(4);
  await expect(page.locator("[data-pillar=cyber] [data-rule-row]")).toHaveCount(5);
  for (const id of ["cy.high", "ct.drpMissing", "ct.drpNeverTested", "pl.decommissioning", "cy.pentestAge", "co.review", "ct.drpAge"]) {
    await expect(page.locator('[data-rule-row="' + id + '"] input[data-prop=on]')).toHaveCount(0);
    await expect(page.locator('[data-rule-row="' + id + '"] [data-fixed]')).toHaveText("Always on");
  }
  for (const id of ["cy.noOfficer", "cy.exposedUntested", "cy.critical", "co.majorAudit", "ct.drpFailed", "pl.eol", "pl.noSso"]) {
    await expect(page.locator('[data-rule-row="' + id + '"] input[data-prop=on]')).toHaveCount(1);
  }
  await expect(page.locator('[data-rule-row="cy.pentestAge"]')).toContainText("Last pentest older than");
  expect(await page.locator("[title]").count()).toBe(0);
  expect(bad).toEqual([]);
});

test("a threshold edit updates the counts before save and discard restores them", async ({ page }) => {
  await open(page);
  const before = await cnt(page, "cy.pentestAge");
  await months(page, "cy.pentestAge").fill("1");
  await expect(page.locator("#st-tab-rules .dirtydot")).toHaveCount(1);
  await expect(page.locator(".savebar")).toContainText("1 unsaved change");
  const short = await cnt(page, "cy.pentestAge");
  expect(short).toBeGreaterThan(before);
  await months(page, "cy.pentestAge").fill("120");
  expect(await cnt(page, "cy.pentestAge")).toBeLessThan(before);
  await page.locator(".savebar").getByRole("button", { name: "Discard" }).click();
  await expect(months(page, "cy.pentestAge")).toHaveValue("18");
  expect(await cnt(page, "cy.pentestAge")).toBe(before);
  await expect(page.locator(".savebar")).toHaveCount(0);
});

test("months are clamped to 1 to 120", async ({ page }) => {
  await open(page);
  await months(page, "ct.drpAge").fill("9999");
  await expect(months(page, "ct.drpAge")).toHaveValue("120");
  await months(page, "co.review").fill("0");
  await expect(months(page, "co.review")).toHaveValue("1");
  await spy(page);
  await saveBtn(page).click();
  await expect(page.locator(".toast")).toContainText("Settings saved");
  const s = await saves(page);
  expect(s[0].patch).toEqual({ rules: { rules: { "ct.drpAge": { months: 120 }, "co.review": { months: 1 } } } });
});

test("tier chips change the DRP count and a rule with no tier says so", async ({ page }) => {
  await open(page);
  const row = page.locator('[data-rule-row="ct.drpMissing"]');
  const before = await cnt(page, "ct.drpMissing");
  await row.locator("[data-tier='3']").click();
  await expect(row.locator("[data-tier='3']")).toHaveAttribute("aria-pressed", "true");
  expect(await cnt(page, "ct.drpMissing")).toBeGreaterThanOrEqual(before);
  await row.locator("[data-tier='1']").click();
  await row.locator("[data-tier='2']").click();
  await row.locator("[data-tier='3']").click();
  await expect(page.locator("[data-no-tier]")).toContainText("at least one tier");
  expect(await cnt(page, "ct.drpMissing")).toBe(0);
});

test("a switch maps to on or off, dims the rule, keeps its count, and saves as one patch", async ({ page }) => {
  await open(page);
  await spy(page);
  const row = page.locator('[data-rule-row="pl.noSso"]');
  const n = await cnt(page, "pl.noSso");
  await row.locator("input[data-prop=on]").uncheck({ force: true });
  await expect(row).toHaveClass(/off/);
  expect(await cnt(page, "pl.noSso")).toBe(n);
  await expect(page.locator(".savebar")).toContainText("1 unsaved change");
  await saveBtn(page).click();
  await expect(page.locator(".toast")).toContainText("Settings saved");
  const s = await saves(page);
  expect(s.length).toBe(1);
  expect(s[0].patch).toEqual({ rules: { rules: { "pl.noSso": { on: false } } } });
  expect(typeof s[0].baseGen).toBe("number");
  await expect(page.locator(".savebar")).toHaveCount(0);
  await expect(row).toHaveClass(/off/);
  await row.locator("input[data-prop=on]").check({ force: true });
  await expect(row).not.toHaveClass(/off/);
});

test("after save the dots change on the List and the Heatmap", async ({ page }) => {
  await open(page);
  // Before: the default 18 months. The settings draft stays in memory while the pages change.
  const heat0 = await heatCyberWarn(page);
  const list0 = await listCyberWarn(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: /Status rules/ }).click();
  await months(page, "cy.pentestAge").fill("1");
  // Unsaved: the register still shows the saved rules.
  expect(await heatCyberWarn(page)).toBe(heat0);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: /Status rules/ }).click();
  await expect(months(page, "cy.pentestAge")).toHaveValue("1");
  await saveBtn(page).click();
  await expect(page.locator(".toast")).toContainText("Settings saved");
  expect(await heatCyberWarn(page)).toBeGreaterThan(heat0);
  expect(await listCyberWarn(page)).toBeGreaterThan(list0);
  // and back: 120 months makes fewer
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("tab", { name: /Status rules/ }).click();
  await months(page, "cy.pentestAge").fill("120");
  await saveBtn(page).click();
  await expect(page.locator(".toast").last()).toContainText("Settings saved");
  expect(await heatCyberWarn(page)).toBeLessThan(heat0);
});

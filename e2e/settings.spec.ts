import { expect, test, type Page } from "@playwright/test";

// Settings (Data source, Field mapping, Display) against the dev server: roles, dirty marks, one
// save patch with baseGen, clamped toast, conflict, discard, guard, probe, reload, mapping and
// live counts.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const rpcLog = (page: Page) => page.evaluate(() => (window as any).__rpcLog as string[]);
const spy = (page: Page) => page.evaluate(() => {
  const w = window as any;
  w.__saves = [];
  const orig = w.api_saveSettings;
  w.api_saveSettings = (p: unknown) => { w.__saves.push(JSON.parse(JSON.stringify(p))); return orig(p); };
});
const saves = (page: Page) => page.evaluate(() => (window as any).__saves as any[]);
const link = (page: Page) => page.evaluate(() => ["https:", "", "docs.google.com", "spreadsheets", "d", (window as any).__CCCP_WORKBOOK__.id, "edit"].join("/"));

async function open(page: Page, qs = "", tab = "source") {
  await page.goto("/?r=settings&tab=" + tab + (qs ? "&" + qs : ""));
  await expect(page.locator("[data-page=settings]")).toBeVisible();
  await expect(page.locator("[role=tab]")).toHaveCount(5);
}

test("a viewer gets the Only admins card", async ({ page }) => {
  await page.goto("/?r=settings&as=viewer@example.com");
  await expect(page.locator(".state")).toContainText("Only admins");
  await expect(page.locator("[role=tab]")).toHaveCount(0);
});

test("five tabs, the unmapped warn mark and dirty dots follow the draft", async ({ page }) => {
  const bad = watchConsole(page);
  await open(page);
  await expect(page.locator("[role=tab]")).toHaveText([/Data source/, /Field mapping/, /Status rules/, /Access/, /Display/]);
  await expect(page.locator(".warnmark")).toHaveCount(0);
  await expect(page.locator(".dirtydot")).toHaveCount(0);
  await page.getByRole("tab", { name: /Field mapping/ }).click();
  await expect(page).toHaveURL(/tab=fields/);
  await page.locator("select[data-key='fields.owner']").selectOption("");
  await expect(page.locator("[data-callout]")).toContainText("1 field is not mapped");
  await expect(page.locator("#st-tab-fields .warnmark")).toHaveCount(1);
  await expect(page.locator("#st-tab-fields .dirtydot")).toHaveCount(1);
  await expect(page.locator("#st-tab-display .dirtydot")).toHaveCount(0);
  await expect(page.locator(".savebar")).toContainText("1 unsaved change");
  await page.locator(".savebar").getByRole("button", { name: "Discard" }).click();
  await expect(page.locator(".savebar")).toHaveCount(0);
  await expect(page.locator("[data-callout]")).not.toContainText("not mapped");
  expect(await page.locator("[title]").count()).toBe(0);
  expect(bad).toEqual([]);
});

test("an owner edits and probes the Sheet; an admin reads it", async ({ page, browser }) => {
  await open(page);
  const url = await link(page);
  await expect(page.locator("input[data-key='source.sheetId']")).toBeVisible();
  await page.getByRole("button", { name: "Probe" }).click();
  await expect(page.locator("[data-probe]")).toContainText("tabs");
  await page.locator("input[data-key='source.sheetId']").fill("not a link at all");
  await expect(page.locator("[data-problems]")).toContainText("not valid");
  await expect(page.locator(".savebar").getByRole("button", { name: "Save changes" })).toBeDisabled();
  await page.locator("input[data-key='source.sheetId']").fill(url);
  await expect(page.locator(".savebar")).toHaveCount(0);

  const admin = await browser.newPage();
  await admin.goto("/?r=settings&tab=source&as=admin@example.com");
  await expect(admin.locator("[data-readonly-link]")).toBeVisible();
  await expect(admin.locator("input[data-key='source.sheetId']")).toHaveCount(0);
  await expect(admin.getByRole("button", { name: "Probe" })).toHaveCount(0);
  await expect(admin.locator(".why-ro")).toContainText("Only the owner");
  await expect(admin.locator("select[data-key='source.tabs.aud.name']")).toBeVisible();
  await admin.close();
});

test("tabs table shows rows and missing columns; Reload says just now", async ({ page }) => {
  await open(page);
  const rows = page.locator("tr[data-tab-row]");
  await expect(rows).toHaveCount(5);
  await expect(rows.first().locator("[data-rows]")).toContainText(/\d/);
  await expect(page.locator("[data-loaded]")).toContainText("Last loaded");
  await page.getByRole("button", { name: "Reload data" }).click();
  await expect(page.locator("[data-loaded]")).toContainText("Last loaded just now");
  expect(await rpcLog(page)).toContain("reloadData");
  await page.getByRole("button", { name: /Advanced/ }).click();
  await expect(page.locator("#st-adv")).toBeVisible();
});

test("save sends one patch with baseGen and toasts the clamped key", async ({ page }) => {
  await open(page);
  await spy(page);
  await page.locator("input[data-key='source.cacheMinutes']").fill("9999");
  await expect(page.locator("#st-tab-source .dirtydot")).toHaveCount(1);
  await page.locator(".savebar").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".toast")).toContainText("Adjusted to the allowed range: Keep data in memory for");
  const s = await saves(page);
  expect(s.length).toBe(1);
  expect(s[0].patch).toEqual({ source: { cacheMinutes: 9999 } });
  expect(typeof s[0].baseGen).toBe("number");
  await expect(page.locator(".savebar")).toHaveCount(0);
  await expect(page.locator("input[data-key='source.cacheMinutes']")).toHaveValue("360");
});

test("a stale baseGen is a conflict: settings reload with an explanation", async ({ page }) => {
  await open(page);
  await page.locator("input[data-key='source.cacheMinutes']").fill("20");
  // someone else saves first
  await page.evaluate(() => {
    const w = window as any;
    const cur = w.api_getSettings({}).data.cfgGen;
    w.api_saveSettings({ patch: { display: { theme: "dark" } }, baseGen: cur });
  });
  await page.locator(".savebar").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator("[data-banner=conflict]")).toContainText("Someone else changed the settings");
  await expect(page.locator("[data-banner=conflict]")).toContainText("discarded");
  await expect(page.locator(".savebar")).toHaveCount(0);
  await expect(page.locator("input[data-key='source.cacheMinutes']")).toHaveValue("10");
});

test("the unsaved-changes guard asks only while the draft is dirty", async ({ page }) => {
  await open(page);
  const ask = () => page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  expect(await ask()).toBe(false);
  await page.locator("input[data-key='source.cacheMinutes']").fill("15");
  expect(await ask()).toBe(true);
  await page.locator(".savebar").getByRole("button", { name: "Discard" }).click();
  expect(await ask()).toBe(false);
});

test("mapping lists the real headers with examples, and saving refetches the register", async ({ page }) => {
  await open(page, "", "fields");
  const sel = page.locator("select[data-key='fields.domain']");
  await expect(sel.locator("option")).not.toHaveCount(1);
  await expect(sel.locator("option[value='Subdomain']")).toHaveCount(1);
  // the register comes back with the bootstrap when the server has it warm, else by getRegister
  const fetched = async () => (await rpcLog(page)).filter((n) => n === "getRegister" || n === "bootstrap").length;
  const before = await fetched();
  await sel.selectOption("Subdomain");
  const row = page.locator("tr[data-field=domain]");
  await expect(row.locator("[data-example]")).not.toHaveText("—");
  await page.locator("select[data-key='fields.owner']").selectOption("");
  await expect(page.locator("[data-callout]")).toContainText("1 field is not mapped");
  await page.locator("select[data-key='fields.owner']").selectOption("Owner Name");
  await expect(page.locator("[data-callout]")).not.toContainText("not mapped");
  await page.locator(".savebar").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".toast")).toContainText("Settings saved");
  const after = await fetched();
  expect(after).toBeGreaterThan(before);
});

test("display counts are live", async ({ page }) => {
  await open(page, "", "display");
  const prefix = page.locator("[data-cnt=hidePrefix]");
  await expect(prefix).toContainText("0 apps");
  const name = await page.evaluate(() => (window as any).__CCCP_WORKBOOK__.tabs[0].rows[1][1] as string);
  await page.locator("input[data-key='display.hidePrefix']").fill(name.slice(0, 4));
  await expect(prefix).not.toContainText("0 apps");
  await expect(page.locator("#st-tab-display .dirtydot")).toHaveCount(1);
  const eol = page.locator("[data-cnt=hideEol]");
  await expect(eol).toContainText("apps");
  await page.locator(".sw input[data-key='display.hideEol']").check({ force: true });
  await expect(page.locator(".savebar")).toContainText("2 unsaved changes");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator(".savebar")).toContainText("3 unsaved changes");
  await page.locator(".savebar").getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".toast")).toContainText("Settings saved");
});

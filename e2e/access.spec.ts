import { expect, test, type Page } from "@playwright/test";

// Settings, Access against the dev server: the owner-only mode radio with its confirmations,
// People (locked owner row, domain warning, named removal, flush of a typed address, notKept),
// the Admins editor for the owner only, and the unsaved-changes guard.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const rpcLog = (page: Page) => page.evaluate(() => (window as any).__rpcLog as string[]);
const roster = (page: Page) => page.evaluate(() => (window as any).api_getAccess({}).data as { users: string[]; admins: string[]; mode: string });
/** Whether this address may open the app right now (the server's own decision). */
const admitted = (page: Page, email: string) => page.evaluate((e) => {
  const w = window as any;
  // The access decision is memoised for one execution; a deployment starts each call afresh.
  w.__gasFakes.setActiveUser(e);
  w.Server.access.__resetMemosForTest();
  const ok = w.api_bootstrap({}).ok === true;
  w.__gasFakes.setActiveUser(w.__gasFakes.OWNER);
  w.Server.access.__resetMemosForTest();
  return ok;
}, email);
const dialog = (page: Page) => page.getByRole("alertdialog");
const people = (page: Page) => page.locator("[data-people]");

async function open(page: Page, qs = "") {
  await page.goto("/?r=settings&tab=access" + (qs ? "&" + qs : ""));
  await expect(page.locator("[data-region=access]")).toBeVisible();
}

test("the owner sees the mode, People and Admins; the owner row is locked", async ({ page }) => {
  const bad = watchConsole(page);
  await open(page);
  await expect(page.locator("input[data-mode=list]")).toBeChecked();
  await expect(page.locator("input[data-mode=org]")).toBeEnabled();
  await expect(page.locator("[data-owner-row]")).toContainText("owner@example.com");
  await expect(page.locator("[data-owner-row]")).toContainText("always has access");
  await expect(page.locator("[data-owner-row] button")).toHaveCount(0);
  await expect(people(page).locator('[data-person="viewer@example.com"] [data-act=a-remove]')).toHaveCount(1);
  await expect(page.locator("[data-admins-editor]")).toBeVisible();
  await expect(page.locator('[data-admins-editor] [data-person="admin@example.com"]')).toBeVisible();
  expect(await page.locator("[title]").count()).toBe(0);
  expect(bad).toEqual([]);
});

test("an admin cannot change the mode and has no Admins editor", async ({ page }) => {
  await open(page, "as=admin@example.com");
  await expect(page.locator("input[data-mode=org]")).toBeDisabled();
  await expect(page.locator("input[data-mode=list]")).toBeDisabled();
  await expect(page.locator("[data-mode-ro]")).toContainText("Only the owner");
  await expect(page.locator("[data-admins-editor]")).toHaveCount(0);
  await expect(people(page)).toBeVisible();
  await expect(page.locator("[data-owner-row]")).toBeVisible();
  // the server refuses what the panel does not offer
  const res = await page.evaluate(() => (window as any).api_saveAccessMode({ mode: "org" }));
  expect(res.ok).toBe(false);
  const adm = await page.evaluate(() => (window as any).api_saveAdmins({ admins: "x@example.com" }));
  expect(adm.ok).toBe(false);
});

test("org mode asks first, naming the domain; then a same-domain user is admitted", async ({ page }) => {
  await open(page);
  expect(await admitted(page, "newbie@example.com")).toBe(false);
  await page.locator(".rcard", { has: page.locator("input[data-mode=org]") }).click();
  await expect(dialog(page)).toContainText("example.com");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("input[data-mode=list]")).toBeChecked();
  expect(await admitted(page, "newbie@example.com")).toBe(false);
  expect(await rpcLog(page)).not.toContain("saveAccessMode");

  await page.locator(".rcard", { has: page.locator("input[data-mode=org]") }).click();
  await dialog(page).getByRole("button", { name: /Allow example.com/ }).click();
  await expect(page.locator(".toast")).toContainText("Everyone at example.com can now open CCCP");
  await expect(page.locator("input[data-mode=org]")).toBeChecked();
  expect(await admitted(page, "newbie@example.com")).toBe(true);
  expect(await admitted(page, "stranger@other.com")).toBe(false);
  expect((await roster(page)).mode).toBe("org");

  // back to the list: it says how many people keep access (owner, viewer, admin = 3)
  await page.locator(".rcard", { has: page.locator("input[data-mode=list]") }).click();
  await expect(dialog(page)).toContainText("3 people keep access");
  await dialog(page).getByRole("button", { name: "Use the list" }).click();
  await expect(page.locator(".toast").last()).toContainText("3 people keep access");
  await expect(page.locator("input[data-mode=list]")).toBeChecked();
  expect(await admitted(page, "newbie@example.com")).toBe(false);
});

test("People: adding, the outside-domain warning and what is refused", async ({ page }) => {
  await open(page);
  const box = page.locator("input[data-add=users]");
  await box.fill("not an address");
  await box.press("Enter");
  await expect(page.locator("[data-add-note=users]")).toContainText("email address");
  await box.fill("owner@example.com");
  await box.press("Enter");
  await expect(page.locator("[data-add-note=users]")).toContainText("owner always has access");
  await box.fill("viewer@example.com");
  await page.getByRole("button", { name: "Add" }).first().click();
  await expect(page.locator("[data-add-note=users]")).toContainText("already on the list");
  await box.fill("friend@other.com");
  await box.press("Enter");
  const row = people(page).locator('[data-person="friend@other.com"]');
  await expect(row).toBeVisible();
  await expect(row.locator(".pwarn")).toContainText("outside example.com");
  await expect(row.locator(".pwarn")).toHaveAttribute("aria-label", /grants nothing/);
  await box.fill("mate@example.com");
  await box.press("Enter");
  await expect(people(page).locator('[data-person="mate@example.com"] .pwarn')).toHaveCount(0);
  await expect(page.locator("[data-access-dirty]")).toBeVisible();
  await expect(page.locator("#st-tab-access .dirtydot")).toHaveCount(1);
});

test("a typed address that was never added is part of the save", async ({ page }) => {
  await open(page);
  await page.locator("input[data-add=users]").fill("typed@example.com");
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(page.locator(".toast")).toContainText("Access updated.");
  expect((await roster(page)).users).toContain("typed@example.com");
  await expect(people(page).locator('[data-person="typed@example.com"]')).toBeVisible();
  await expect(page.locator("input[data-add=users]")).toHaveValue("");
  // a bad typed entry stops the save
  await page.locator("input[data-add=users]").fill("oops");
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(page.locator("[data-add-note=users]")).toContainText("email address");
  expect((await rpcLog(page)).filter((n) => n === "saveAccess").length).toBe(1);
});

test("an unchanged roster says so and sends nothing", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(page.locator(".toast")).toContainText("No changes to save.");
  const log = await rpcLog(page);
  expect(log).not.toContain("saveAccess");
  expect(log).not.toContain("saveAdmins");
});

test("a removal is confirmed by name, again after a later save", async ({ page }) => {
  await open(page);
  await people(page).locator('[data-person="viewer@example.com"] [data-act=a-remove]').click();
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(dialog(page)).toContainText("viewer@example.com");
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  expect(await rpcLog(page)).not.toContain("saveAccess");
  expect((await roster(page)).users).toContain("viewer@example.com");
  await page.getByRole("button", { name: "Save access" }).click();
  await dialog(page).getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".toast")).toContainText("Access updated.");
  expect((await roster(page)).users).not.toContain("viewer@example.com");
  // the baseline moved with the save: the next removal is confirmed too
  await page.locator("input[data-add=users]").fill("a@example.com");
  await page.locator("input[data-add=users]").press("Enter");
  await page.locator("input[data-add=users]").fill("b@example.com");
  await page.locator("input[data-add=users]").press("Enter");
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(page.locator(".toast").last()).toContainText("Access updated.");
  await people(page).locator('[data-person="a@example.com"] [data-act=a-remove]').click();
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(dialog(page)).toContainText("a@example.com");
  await dialog(page).getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".toast").last()).toContainText("Access updated.");
});

test("an address the server did not keep is named, not reported as saved", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const w = window as any;
    const orig = w.api_saveAccess;
    w.api_saveAccess = (p: { users: string }) => orig({ users: p.users.split(",").filter((e) => e.indexOf("lost@") < 0).join(",") });
  });
  await page.locator("input[data-add=users]").fill("lost@example.com");
  await page.locator("input[data-add=users]").press("Enter");
  await page.locator("input[data-add=users]").fill("kept@example.com");
  await page.locator("input[data-add=users]").press("Enter");
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(page.locator(".toast")).toContainText("Not saved: lost@example.com");
  await expect(page.locator(".toast")).not.toContainText("Access updated.");
  await expect(people(page).locator('[data-person="kept@example.com"]')).toBeVisible();
  await expect(people(page).locator('[data-person="lost@example.com"]')).toHaveCount(0);
});

test("the owner adds and removes admins; they are saved with saveAdmins", async ({ page }) => {
  await open(page);
  const box = page.locator("input[data-add=admins]");
  await box.fill("boss@example.com");
  await box.press("Enter");
  await expect(page.locator('[data-admins-editor] [data-person="boss@example.com"]')).toBeVisible();
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(page.locator(".toast")).toContainText("Access updated.");
  expect(await rpcLog(page)).toContain("saveAdmins");
  expect(await rpcLog(page)).not.toContain("saveAccess");
  expect((await roster(page)).admins).toContain("boss@example.com");
  await page.locator('[data-admins-editor] [data-person="admin@example.com"] [data-act=a-remove]').click();
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(dialog(page)).toContainText("admin@example.com");
  await dialog(page).getByRole("button", { name: "Remove" }).click();
  await expect(page.locator(".toast").last()).toContainText("Access updated.");
  expect((await roster(page)).admins).toEqual(["boss@example.com"]);
});

test("an admin adds a person with saveAccess only", async ({ page }) => {
  await open(page, "as=admin@example.com");
  await page.locator("input[data-add=users]").fill("fresh@example.com");
  await page.locator("input[data-add=users]").press("Enter");
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(page.locator(".toast")).toContainText("Access updated.");
  const log = await rpcLog(page);
  expect(log).toContain("saveAccess");
  expect(log).not.toContain("saveAdmins");
});

test("the guard asks while an edit is staged or an address is typed, not after a save", async ({ page }) => {
  await open(page);
  const ask = () => page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  expect(await ask()).toBe(false);
  await page.locator("input[data-add=users]").fill("half@example.com");
  expect(await ask()).toBe(true);
  await page.locator("input[data-add=users]").press("Enter");
  expect(await ask()).toBe(true);
  await page.getByRole("button", { name: "Save access" }).click();
  await expect(page.locator(".toast")).toContainText("Access updated.");
  expect(await ask()).toBe(false);
});

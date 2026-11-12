import { expect, test, type Page } from "@playwright/test";

// The saved-views tab row on the list route, against the dev server: save, the cue, update,
// the cap of 20, sharing by an admin, the shared view for a viewer after a reload, links,
// refused storage and the protected All applications tab.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const tabs = (page: Page) => page.locator(".vtabs [role=tab]");
const selected = (page: Page) => page.locator(".vtabs [role=tab][aria-selected=true]");
const visible = async (page: Page) => Number((await page.locator("[data-count=visible]").innerText()).split(" ")[0].replace(/,/g, ""));
const urlParam = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);

async function ready(page: Page, query = "") {
  await page.goto("/?r=list" + query);
  await expect(page.locator(".vtabs")).toBeVisible();
}

async function tier1(page: Page) {
  await page.locator('[data-k="pill-tier"]').click();
  await page.locator('[data-k="pop-tier-T1"]').check();
  await page.keyboard.press("Escape");
}

async function saveView(page: Page, name: string, share = false) {
  await page.getByRole("button", { name: "Save view" }).click();
  await page.getByLabel("View name").fill(name);
  if (share) await page.getByLabel("Share with everyone").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

test.describe("personal views", () => {
  test("save, the cue and Update work", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    await expect(tabs(page)).toHaveText(["All applications"]);
    await expect(page.locator("[data-cue]")).toHaveCount(0);
    const all = await visible(page);
    await tier1(page);
    const t1 = await visible(page);
    expect(t1).toBeLessThan(all);
    await expect(page.locator("[data-cue]")).toHaveText("Filters changed · Save as view");
    await saveView(page, "Tier one");
    await expect(tabs(page)).toHaveText(["All applications", "Tier one"]);
    await expect(selected(page)).toHaveText("Tier one");
    await expect(page.locator("[data-cue]")).toHaveCount(0);
    // Change the filters: the cue appears, Update stores them.
    await page.locator('[data-k="pill-tier"]').click();
    await page.locator('[data-k="pop-tier-T2"]').check();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-cue]")).toHaveText("Filters changed · Update view");
    await page.getByRole("button", { name: "Update view" }).click();
    await expect(page.locator("[data-cue]")).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cccp.views.v1") as string));
    expect(stored).toHaveLength(1);
    expect(stored[0].state.f.tier).toEqual(["T1", "T2"]);
    // Survives a reload, and opening it brings the filters back.
    await page.reload();
    await expect(tabs(page)).toHaveText(["All applications", "Tier one"]);
    await page.getByRole("tab", { name: "All applications" }).click();
    expect(await visible(page)).toBe(all);
    await page.getByRole("tab", { name: "Tier one" }).click();
    expect(urlParam(page, "tier")).toContain("T1");
    await expect(page.locator('[data-k="pill-tier"]')).toHaveText("Tier: 1, 2");
    expect(bad).toEqual([]);
  });

  test("the 21st personal view is refused", async ({ page }) => {
    await ready(page);
    const seed = Array.from({ length: 20 }, (_, i) => ({ id: "p" + i, name: "View " + i, scope: "personal", route: "list", state: { q: "", f: {}, sort: "n", cols: [], metric: "worst" } }));
    await page.evaluate((v) => localStorage.setItem("cccp.views.v1", JSON.stringify(v)), seed);
    await page.reload();
    await expect(tabs(page)).toHaveCount(21);
    await saveView(page, "One too many");
    await expect(page.locator(".vfail")).toContainText("at most 20");
    await expect(tabs(page)).toHaveCount(21);
    const n = await page.evaluate(() => JSON.parse(localStorage.getItem("cccp.views.v1") as string).length);
    expect(n).toBe(20);
    // Deleting one makes room again.
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("tab", { name: "View 3" }).click();
    await page.getByRole("button", { name: /Delete View 3/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(tabs(page)).toHaveCount(20);
    await expect(selected(page)).toHaveText("All applications");
  });

  test("Copy link on a personal view gives explicit params that reproduce the filters", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ready(page);
    await tier1(page);
    await page.getByPlaceholder("Search name, team, owner, officer").fill("a");
    await expect.poll(() => urlParam(page, "q")).toBe("a");
    const n = await visible(page);
    await saveView(page, "Mine");
    await page.getByRole("button", { name: /Copy link/ }).click();
    await expect(page.locator(".toast", { hasText: "copied" })).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).not.toContain("view=");
    const u = new URL(link);
    expect(u.searchParams.get("q")).toBe("a");
    expect(u.searchParams.get("tier")).toContain("T1");
    // Opening it in a fresh page reproduces the filters.
    const other = await context.newPage();
    await other.goto("/" + u.search);
    await expect(other.locator(".vtabs")).toBeVisible();
    expect(await visible(other)).toBe(n);
  });

  test("a damaged stored list does not break the page", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    await page.evaluate(() => localStorage.setItem("cccp.views.v1", '[{"id":"a","name":"<img src=x onerror=alert(1)>","route":"list","state":{}},7,null]'));
    await page.reload();
    await expect(tabs(page)).toHaveCount(2);
    await expect(page.locator(".vtabs img")).toHaveCount(0);
    expect(bad).toEqual([]);
  });
});

test.describe("shared views", () => {
  test("an admin shares a view; a viewer sees it after a reload, without delete", async ({ page, browser }) => {
    const bad = watchConsole(page);
    await ready(page, "&as=admin@example.com");
    await tier1(page);
    await page.getByRole("button", { name: "Save view" }).click();
    await page.getByLabel("View name").fill("Tier one for all");
    await page.getByLabel("Share with everyone").check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(tabs(page)).toHaveText(["All applications", "Tier one for all"]);
    await expect(selected(page)).toHaveText("Tier one for all");
    expect(await page.evaluate(() => (window as any).__rpcLog.filter((n: string) => n === "saveSharedView").length)).toBe(1);
    // The admin can delete it, copy its link.
    await expect(page.getByRole("button", { name: /Delete Tier one for all/ })).toBeVisible();
    // What the server stored is what a viewer is served after a reload.
    const prop = await page.evaluate(() => (window as any).__gasFakes.snapshot().props.get("SHARED_VIEWS"));
    const stored = JSON.parse(prop);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: "Tier one for all", scope: "shared", route: "list" });
    const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const v = await ctx.newPage();
    await v.goto("/?r=list&as=viewer@example.com&sharedviews=" + encodeURIComponent(prop));
    await expect(v.locator(".vtabs")).toBeVisible();
    await expect(tabs(v)).toHaveText(["All applications", "Tier one for all"]);
    await v.getByRole("tab", { name: "Tier one for all" }).click();
    await expect(v.getByRole("button", { name: /Copy link/ })).toBeVisible();
    await expect(v.getByRole("button", { name: /Delete/ })).toHaveCount(0);
    await expect(v.locator('[data-k="pill-tier"]')).toHaveText("Tier: 1");
    // A viewer cannot share: no checkbox in the save form.
    await v.getByRole("button", { name: "Save view" }).click();
    await expect(v.getByLabel("Share with everyone")).toHaveCount(0);
    await ctx.close();
    expect(bad).toEqual([]);
  });

  test("Copy link on a shared view gives ?view=<id>, and opening it reproduces the filters", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ready(page, "&as=admin@example.com");
    await tier1(page);
    const t1 = await visible(page);
    await saveView(page, "Shared tier one", true);
    await expect(selected(page)).toHaveText("Shared tier one");
    await page.getByRole("button", { name: /Copy link/ }).click();
    await expect(page.locator(".toast", { hasText: "copied" })).toBeVisible();
    const link = await page.evaluate(() => navigator.clipboard.readText());
    const u = new URL(link);
    const id = u.searchParams.get("view");
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(u.searchParams.has("tier")).toBe(false);
    const prop = await page.evaluate(() => (window as any).__gasFakes.snapshot().props.get("SHARED_VIEWS"));
    const other = await context.newPage();
    await other.goto(`/?view=${id}&as=viewer@example.com&sharedviews=${encodeURIComponent(prop)}`);
    await expect(other.locator(".vtabs")).toBeVisible();
    await expect(other.locator(".vtabs [role=tab][aria-selected=true]")).toHaveText("Shared tier one");
    expect(await visible(other)).toBe(t1);
    expect(new URL(other.url()).searchParams.get("tier")).toContain("T1");
    // A link to a view that was deleted says so and shows the whole register.
    const gone = await context.newPage();
    await gone.goto("/?view=deadbeef&as=viewer@example.com");
    await expect(gone.locator(".toast")).toContainText("no longer exists");
  });

  test("an admin deletes a shared view", async ({ page }) => {
    await ready(page, "&as=admin@example.com");
    await tier1(page);
    await saveView(page, "Doomed", true);
    await expect(tabs(page)).toHaveCount(2);
    await page.getByRole("button", { name: /Delete Doomed/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(tabs(page)).toHaveText(["All applications"]);
    const prop = await page.evaluate(() => (window as any).__gasFakes.snapshot().props.get("SHARED_VIEWS"));
    expect(JSON.parse(prop)).toEqual([]);
  });
});

test.describe("guards", () => {
  test("All applications cannot be deleted or linked", async ({ page }) => {
    await ready(page);
    await expect(selected(page)).toHaveText("All applications");
    await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Copy link/ })).toHaveCount(0);
    await tier1(page);
    await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0);
  });

  test("when storage is refused the Save control hides for a viewer", async ({ page }) => {
    const bad = watchConsole(page);
    await page.addInitScript(() => {
      const refuse = () => { throw new DOMException("blocked", "SecurityError"); };
      Object.defineProperty(window, "localStorage", { get: refuse });
    });
    await page.goto("/?r=list&as=viewer@example.com");
    await expect(page.locator(".vtabs")).toBeVisible();
    await expect(tabs(page)).toHaveText(["All applications"]);
    await expect(page.getByRole("button", { name: "Save view" })).toHaveCount(0);
    await tier1(page);
    // Nothing a refused browser could keep is offered: no cue, no form.
    await expect(page.locator("[data-cue]")).toHaveCount(0);
    expect(bad.filter((m) => !/localStorage|blocked/i.test(m))).toEqual([]);
  });

  test("when storage is refused an admin can still share", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get: () => { throw new DOMException("blocked", "SecurityError"); } });
    });
    await page.goto("/?r=list&as=admin@example.com");
    await expect(page.locator(".vtabs")).toBeVisible();
    await tier1(page);
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.locator(".vshare")).toHaveText("Shared with everyone");
    await page.getByLabel("View name").fill("Only shared");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(tabs(page)).toHaveText(["All applications", "Only shared"]);
  });
});

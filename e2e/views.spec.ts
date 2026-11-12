import { expect, test, type Page } from "@playwright/test";

// Saved views in the Inventory's side panel, against the dev server: rows with live counts, save, the
// "changed" marker with Save and Save as new, the cap of 20, sharing and Manage for an admin, the shared view
// for a viewer after a reload, links, refused storage, the protected All applications row, and that a view
// opens in the lens the viewer is on, whatever page an older view was saved on.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const tabs = (page: Page) => page.locator(".vrow .vn");
const selected = (page: Page) => page.locator(".vrow[aria-current=true] .vn");
const row = (page: Page, name: string) => page.locator(".vrow", { has: page.locator(".vn", { hasText: name }) });
const counts = (page: Page) => page.locator(".vrow [data-vcount]").allInnerTexts();
const visible = async (page: Page) => Number((await page.locator("[data-count=visible]").innerText()).split(" ")[0].replace(/,/g, ""));
const urlParam = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);

async function ready(page: Page, query = "") {
  await page.goto("/?r=list" + query);
  await expect(page.locator("aside.facets .vg").first()).toBeVisible();
}

async function tier1(page: Page) {
  await page.locator('[data-k="side-tier-T1"]').check();
}

async function saveView(page: Page, name: string, share = false) {
  await page.getByRole("button", { name: "+ Save" }).click();
  await page.getByLabel("View name").fill(name);
  if (share) await page.getByLabel("Share with everyone").check();
  await page.locator('[data-k="vsave"]').click();
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
    await expect(page.locator("[data-cue]")).toContainText("changed");
    await expect(page.locator("[data-cue] [data-act=vupdate]")).toHaveCount(0);
    await expect(page.locator("[data-cue] [data-k=vsaveas]")).toHaveText("Save as new");
    await saveView(page, "Tier one");
    await expect(tabs(page)).toHaveText(["All applications", "Tier one"]);
    await expect(selected(page)).toHaveText("Tier one");
    await expect(page.locator("[data-cue]")).toHaveCount(0);
    // Change the filters: the cue appears, Update stores them.
    await page.locator('[data-k="side-tier-T2"]').check();
    await expect(page.locator("[data-cue]")).toContainText("changed");
    await expect(page.locator("[data-cue] [data-k=vsaveas]")).toHaveText("Save as new");
    await page.locator("[data-cue] [data-k=vupdate]").click();
    await expect(page.locator("[data-cue]")).toHaveCount(0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cccp.views.v1") as string));
    expect(stored).toHaveLength(1);
    expect(stored[0].state.f.tier).toEqual(["T1", "T2"]);
    // Survives a reload, and opening it brings the filters back.
    await page.reload();
    await expect(tabs(page)).toHaveText(["All applications", "Tier one"]);
    await row(page, "All applications").click();
    expect(await visible(page)).toBe(all);
    await row(page, "Tier one").click();
    expect(urlParam(page, "tier")).toContain("T1");
    await expect(page.locator('[data-k="side-tier-T1"]')).toBeChecked();
    await expect(page.locator('[data-k="side-tier-T2"]')).toBeChecked();
    expect(bad).toEqual([]);
  });

  test("the 21st personal view is refused", async ({ page }) => {
    await ready(page);
    const seed = Array.from({ length: 20 }, (_, i) => ({ id: "p" + i, name: "View " + i, scope: "personal", state: { q: "", f: {}, sort: "n", cols: [], metric: "worst" } }));
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
    await row(page, "View 3").click();
    await page.getByRole("button", { name: /Delete View 3/ }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(tabs(page)).toHaveCount(20);
    await expect(selected(page)).toHaveText("All applications");
  });

  test("Copy link on a personal view gives explicit params that reproduce the filters", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await ready(page);
    await tier1(page);
    await page.getByPlaceholder("Search applications, people").fill("a");
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
    await expect(other.locator("aside.facets .vg").first()).toBeVisible();
    expect(await visible(other)).toBe(n);
  });

  test("a damaged stored list does not break the page", async ({ page }) => {
    const bad = watchConsole(page);
    await ready(page);
    await page.evaluate(() => localStorage.setItem("cccp.views.v1", '[{"id":"a","name":"<img src=x onerror=alert(1)>","route":"list","state":{}},7,null]'));
    await page.reload();
    await expect(tabs(page)).toHaveCount(2);
    await expect(page.locator(".views img")).toHaveCount(0);
    expect(bad).toEqual([]);
  });
});

test.describe("shared views", () => {
  test("an admin shares a view; a viewer sees it after a reload, without delete", async ({ page, browser }) => {
    const bad = watchConsole(page);
    await ready(page, "&as=admin@example.com");
    await tier1(page);
    await page.getByRole("button", { name: "+ Save" }).click();
    await page.getByLabel("View name").fill("Tier one for all");
    await page.getByLabel("Share with everyone").check();
    await page.locator('[data-k="vsave"]').click();
    await expect(tabs(page)).toHaveText(["All applications", "Tier one for all"]);
    await expect(selected(page)).toHaveText("Tier one for all");
    expect(await page.evaluate(() => (window as any).__rpcLog.filter((n: string) => n === "saveSharedView").length)).toBe(1);
    // The admin can delete it, copy its link.
    await expect(page.getByRole("button", { name: /Delete Tier one for all/ })).toBeVisible();
    // What the server stored is what a viewer is served after a reload.
    const prop = await page.evaluate(() => (window as any).__gasFakes.snapshot().props.get("SHARED_VIEWS"));
    const stored = JSON.parse(prop);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: "Tier one for all", scope: "shared" });
    expect(stored[0]).not.toHaveProperty("route");
    const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
    const v = await ctx.newPage();
    await v.goto("/?r=list&as=viewer@example.com&sharedviews=" + encodeURIComponent(prop));
    await expect(v.locator("aside.facets .vg").first()).toBeVisible();
    await expect(tabs(v)).toHaveText(["All applications", "Tier one for all"]);
    await row(v, "Tier one for all").click();
    await expect(v.getByRole("button", { name: /Copy link/ })).toBeVisible();
    await expect(v.getByRole("button", { name: /Delete/ })).toHaveCount(0);
    await expect(v.locator('[data-k="side-tier-T1"]')).toBeChecked();
    // A viewer cannot share: no checkbox in the save form.
    await v.getByRole("button", { name: "+ Save" }).click();
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
    await expect(other.locator("aside.facets .vg").first()).toBeVisible();
    await expect(selected(other)).toHaveText("Shared tier one");
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
    await expect(page.locator("aside.facets .vg").first()).toBeVisible();
    await expect(tabs(page)).toHaveText(["All applications"]);
    await expect(page.getByRole("button", { name: "+ Save" })).toHaveCount(0);
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
    await expect(page.locator("aside.facets .vg").first()).toBeVisible();
    await tier1(page);
    await page.getByRole("button", { name: "+ Save" }).click();
    await expect(page.locator(".vshare")).toHaveText("Shared with everyone");
    await page.getByLabel("View name").fill("Only shared");
    await page.locator('[data-k="vsave"]').click();
    await expect(tabs(page)).toHaveText(["All applications", "Only shared"]);
  });
});

test.describe("the side panel", () => {
  test("Shared views and My views, each row with its live count; the open view has the accent bar", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const shared = [{ id: "sh1", name: "Tier one", scope: "shared", state: { q: "", f: { tier: ["T1"] }, sort: "n", cols: [], metric: "worst" } }];
    await page.goto("/?r=list&as=viewer@example.com&sharedviews=" + encodeURIComponent(JSON.stringify(shared)));
    await expect(page.locator("aside.facets .vg").first()).toBeVisible();
    await expect(page.locator("aside.facets .vg h4 > span:first-child")).toHaveText(["Shared views", "My views"]);
    await expect(tabs(page)).toHaveText(["All applications", "Tier one"]);
    const total = await visible(page);
    const [all, t1] = (await counts(page)).map((x) => Number(x.replace(/,/g, "")));
    expect(all).toBe(total);
    expect(t1).toBeGreaterThan(0);
    expect(t1).toBeLessThan(total);
    await row(page, "Tier one").click();
    await expect.poll(() => visible(page)).toBe(t1);
    const bar = await row(page, "Tier one").evaluate((e) => getComputedStyle(e).boxShadow);
    expect(bar).toContain("inset");
    expect(bar).toMatch(/3px/);
    await expect(row(page, "Tier one")).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("button", { name: "Manage", exact: true })).toHaveCount(0);
    await page.goto("/?r=list&as=admin@example.com&sharedviews=" + encodeURIComponent(JSON.stringify(shared)));
    await expect(page.getByRole("button", { name: "Manage", exact: true })).toBeVisible();
  });

  test("changing the open view says changed, with Save and Save as new; Save as new keeps the first view", async ({ page }) => {
    await ready(page);
    await tier1(page);
    await saveView(page, "Mine");
    await expect(page.locator("[data-cue]")).toHaveCount(0);
    await page.locator('[data-k="side-tier-T2"]').check();
    const cue = page.locator("[data-cue]");
    await expect(cue).toContainText("changed");
    await expect(cue.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    await expect(cue.getByRole("button", { name: "Save as new" })).toBeVisible();
    await cue.getByRole("button", { name: "Save as new" }).click();
    await page.getByLabel("View name").fill("Mine two");
    await page.locator('[data-k="vsave"]').click();
    await expect(tabs(page)).toHaveText(["All applications", "Mine", "Mine two"]);
    await expect(selected(page)).toHaveText("Mine two");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cccp.views.v1") as string));
    expect(stored.map((v: any) => v.state.f.tier)).toEqual([["T1"], ["T1", "T2"]]);
    const [, a, b] = (await counts(page)).map((x) => Number(x.replace(/,/g, "")));
    expect(a).toBeLessThan(b);
  });

  test("a view opens in the current lens, and the lens switch keeps the filters and the open view", async ({ page }) => {
    await ready(page);
    await tier1(page);
    await saveView(page, "Mine");
    for (const lens of ["heatmap", "landscape"]) {
      await row(page, "All applications").click();
      await page.locator(`[data-act=lens][data-lens=${lens}]`).click();
      await row(page, "Mine").click();
      await expect(page.locator(`.tbl[data-lens=${lens}]`)).toBeVisible();
      expect(urlParam(page, "lens")).toBe(lens);
      expect(urlParam(page, "tier")).toBe("T1");
      await expect(selected(page)).toHaveText("Mine");
      await page.locator("[data-act=lens][data-lens=table]").click();
      await expect(selected(page)).toHaveText("Mine");
      await expect(page.locator("[data-cue]")).toHaveCount(0);
    }
  });

  test("a shared view opens on each lens, in the lens the viewer is on, with its count", async ({ page }) => {
    const shared = [{ id: "sh1", name: "Tier one", scope: "shared", state: { q: "", f: { tier: ["T1"] }, sort: "n", cols: [], metric: "tier" } }];
    await page.goto("/?r=list&as=viewer@example.com&sharedviews=" + encodeURIComponent(JSON.stringify(shared)));
    await expect(row(page, "Tier one")).toBeVisible();
    const t1 = Number(((await counts(page))[1]).replace(/,/g, ""));
    for (const lens of ["table", "heatmap", "landscape"]) {
      await row(page, "All applications").click();
      await page.locator(`[data-act=lens][data-lens=${lens}]`).click();
      await row(page, "Tier one").click();
      await expect(page.locator(`.tbl[data-lens=${lens}]`)).toBeVisible();
      await expect(selected(page)).toHaveText("Tier one");
      await expect.poll(() => visible(page)).toBe(t1);
      await expect(page.locator("[data-cue]")).toHaveCount(0);
    }
  });

  test("a view saved on the old heatmap page still loads and opens on the Inventory in the current lens", async ({ page }) => {
    await ready(page);
    const seed = [{ id: "old1", name: "Old heat", scope: "personal", route: "heatmap", state: { q: "", f: { tier: ["T1"] }, sort: "n", cols: [], metric: "worst" } },
      { id: "old2", name: "Old land", scope: "personal", route: "landscape", state: { q: "", f: { tier: ["T2"] }, sort: "n", cols: [], metric: "tier" } }];
    await page.evaluate((v) => localStorage.setItem("cccp.views.v1", JSON.stringify(v)), seed);
    await page.reload();
    await expect(tabs(page)).toHaveText(["All applications", "Old heat", "Old land"]);
    await row(page, "Old heat").click();
    await expect(page.locator("table[data-table=list]")).toBeVisible();
    expect(urlParam(page, "r")).toBe("list");
    expect(urlParam(page, "lens")).toBeNull();
    expect(urlParam(page, "tier")).toBe("T1");
    await page.locator("[data-act=lens][data-lens=heatmap]").click();
    await row(page, "Old land").click();
    await expect(page.locator("table[data-table=heatmap]")).toBeVisible();
    expect(urlParam(page, "metric")).toBe("tier");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cccp.views.v1") as string));
    expect(stored.map((v: any) => v.route)).toEqual(["heatmap", "landscape"]);
  });

  test("a shared view that carries a landscape route is served and opens on the Inventory", async ({ page }) => {
    const shared = [{ id: "sh9", name: "Legacy landscape", scope: "shared", route: "landscape", state: { q: "", f: { tier: ["T1"] }, sort: "n", cols: [], metric: "c1" } }];
    await page.goto("/?r=list&as=viewer@example.com&sharedviews=" + encodeURIComponent(JSON.stringify(shared)));
    await expect(tabs(page)).toHaveText(["All applications", "Legacy landscape"]);
    await row(page, "Legacy landscape").click();
    await expect(page.locator("table[data-table=list]")).toBeVisible();
    expect(urlParam(page, "metric")).toBe("c1");
    await page.goto("/?view=sh9&as=viewer@example.com&sharedviews=" + encodeURIComponent(JSON.stringify(shared)));
    await expect(selected(page)).toHaveText("Legacy landscape");
    await expect(page.locator("[data-page=list]")).toBeVisible();
  });

  test("Manage lets an admin delete any shared view", async ({ page }) => {
    await ready(page, "&as=admin@example.com");
    await tier1(page);
    await saveView(page, "Manage me", true);
    await expect(tabs(page)).toHaveText(["All applications", "Manage me"]);
    await row(page, "All applications").click();
    await page.getByRole("button", { name: "Manage", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete the shared view Manage me" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete the shared view All applications/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Delete the shared view Manage me" }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(tabs(page)).toHaveText(["All applications"]);
    await page.getByRole("button", { name: "Done" }).click();
  });

  test("below 1024 px the views are in the Filters drawer", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/?r=list");
    await expect(page.locator("table[data-table=list]")).toBeVisible();
    await expect(page.locator(".vg").first()).toBeHidden();
    await page.locator('[data-k="fopen"]').click();
    await expect(page.locator(".vg").first()).toBeVisible();
    await expect(tabs(page).first()).toHaveText("All applications");
  });
});

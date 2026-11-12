import { expect, test, type Page } from "@playwright/test";

// The loading states against the dev server: the branded splash on the first open with its steps
// driven by the real calls, the route-shaped skeleton for every later wait, the refresh bar and
// the slow line. Nothing here may log a console error or scroll sideways.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const VIEWPORTS = [{ width: 390, height: 800 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }];
const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const step = (page: Page, key: string) => page.locator(`[data-step=${key}]`);
const firstId = (page: Page) => page.evaluate(() => (window as any).__CCCP_WORKBOOK__.tabs[0].rows[1][0] as string);

// Make the first getRegister fail once, so the error card with Retry appears with the route known.
async function failRegisterOnce(page: Page) {
  await page.route("**/entry.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) + "\nvar __realReg = api_getRegister; window.__failReg = true; api_getRegister = function (p) { return window.__failReg ? { ok: false, error: 'Data source unreachable', errorKind: 'error' } : __realReg(p); };";
    await route.fulfill({ response: res, body });
  });
}

test.describe("first open: the splash", () => {
  test("shows the steps as the real calls land, then the page", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?slow=1500&coldcache&r=list");
    const splash = page.locator(".boot[aria-busy=true]");
    await expect(splash).toBeVisible();
    await expect(splash).toContainText("CCCP");
    await expect(page.locator(".appbar")).toBeHidden();
    await expect(step(page, "access")).toHaveAttribute("data-state", "active");
    await expect(step(page, "apps")).toHaveAttribute("data-state", "todo");
    // The bootstrap resolved; the register fetch is in flight.
    await expect(step(page, "apps")).toHaveAttribute("data-state", "active");
    await expect(step(page, "access")).toHaveAttribute("data-state", "done");
    await expect(page.locator("[data-page=list]")).toBeVisible();
    await expect(page.locator(".boot")).toHaveCount(0);
    await expect(page.locator(".appbar")).toBeVisible();
    await expect(page.locator("body")).not.toHaveAttribute("data-boot", /.*/);
    expect(bad).toEqual([]);
  });

  test("the warm inline path just shows the page", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?inline&r=list");
    await expect(page.locator("[data-page=list]")).toBeVisible();
    await expect(page.locator(".boot")).toHaveCount(0);
    expect(bad).toEqual([]);
  });

  for (const theme of ["light", "dark"]) {
    for (const vp of VIEWPORTS) {
      test(`no sideways scroll at ${vp.width}px, ${theme}`, async ({ page }) => {
        const bad = watchConsole(page);
        await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch (e) { /* refused */ } }, theme);
        await page.setViewportSize(vp);
        await page.goto("/?slow=1500&coldcache&r=list");
        await expect(page.locator(".boot")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
        await expect(page.locator("[data-page=list]")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
        expect(bad).toEqual([]);
      });
    }
  }

  test("after 8 s a calm line is added", async ({ page }) => {
    await page.goto("/?slow=9500&r=list");
    await expect(page.locator(".boot")).toBeVisible();
    await expect(page.locator(".ld-slow")).toHaveCount(0);
    await expect(page.locator(".boot .ld-slow")).toHaveText("Still loading. Large sheets take a moment.", { timeout: 12_000 });
  });
});

test.describe("later waits: the route-shaped skeleton", () => {
  // The heatmap and the landscape are lenses of the Inventory: route list, a lens in the address.
  const ROUTES: Array<[string, string, string]> = [
    ["overview", "overview", "Status by pillar"],
    ["list", "list", "All applications"],
    ["heatmap", "heatmap", "Domain / application"],
    ["landscape", "landscape", "Colour by"],
  ];
  for (const [route, key, words] of ROUTES) {
    test(`Retry on ${route} shows its frame, then the page`, async ({ page }) => {
      const bad = watchConsole(page);
      await failRegisterOnce(page);
      await page.goto("/?coldcache&slow=1200&r=" + (key === "heatmap" || key === "landscape" ? "list&lens=" + key : route));
      await expect(page.getByRole("alert")).toContainText("Data source unreachable");
      await page.evaluate(() => { (window as any).__failReg = false; });
      await page.getByRole("button", { name: "Retry" }).click();
      const sk = page.locator(`[data-skeleton=${key}][aria-busy=true]`);
      await expect(sk).toBeVisible();
      await expect(sk).toContainText(words);
      await expect(page.locator(".boot")).toHaveCount(0);
      await expect(page.locator(".appbar")).toBeVisible();
      await expect(page.locator(key === "heatmap" || key === "landscape" ? `[data-lens-body=${key}]` : `[data-page=${route}]`)).toBeVisible();
      await expect(page.locator("[data-skeleton]")).toHaveCount(0);
      expect(bad.filter((m) => !/Failed to load resource/.test(m))).toEqual([]);
    });
  }

  test("Retry on the fact sheet shows the fact sheet frame", async ({ page }) => {
    await failRegisterOnce(page);
    await page.goto("/?slow=1200");
    const id = await firstId(page);
    await page.goto("/?coldcache&slow=1200&app=" + id);
    await expect(page.getByRole("alert")).toContainText("Data source unreachable");
    await page.evaluate(() => { (window as any).__failReg = false; });
    await page.getByRole("button", { name: "Retry" }).click();
    const sk = page.locator("[data-skeleton=app]");
    await expect(sk).toBeVisible();
    await expect(sk).toContainText("Data quality");
    await expect(sk).toContainText("Front exposed on internet");
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  });

  test("opening Settings shows the settings frame with its tab names", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?r=settings&tab=source&slow=1200");
    const sk = page.locator("[data-skeleton=settings][aria-busy=true]");
    await expect(sk).toBeVisible({ timeout: 10_000 });
    await expect(sk).toContainText("Data source");
    await expect(sk).toContainText("Field mapping");
    await expect(page.locator("[data-page=settings]")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);
    expect(bad).toEqual([]);
  });

  for (const theme of ["light", "dark"]) {
    for (const vp of VIEWPORTS) {
      test(`skeletons do not scroll sideways at ${vp.width}px, ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch (e) { /* refused */ } }, theme);
        await page.setViewportSize(vp);
        await failRegisterOnce(page);
        await page.goto("/?coldcache&slow=1500&r=list");
        await expect(page.getByRole("alert")).toBeVisible();
        await page.evaluate(() => { (window as any).__failReg = false; });
        await page.getByRole("button", { name: "Retry" }).click();
        await expect(page.locator("[data-skeleton=list]")).toBeVisible();
        expect(await noSideways(page)).toBe(true);
      });
    }
  }
});

test.describe("refresh: the old data stays under a thin bar", () => {
  test("Reload data keeps the page and shows the bar until the data is back", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?r=settings&tab=source&as=admin@example.com&slow=800");
    await expect(page.locator("[data-page=settings]")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".refresh-bar")).toHaveCount(0);
    await page.getByRole("button", { name: "Reload data" }).click();
    const bar = page.locator(".refresh-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute("role", "progressbar");
    await expect(page.locator("[data-page=settings]")).toBeVisible();
    await expect(page.locator("[data-skeleton]")).toHaveCount(0);
    await expect(page.locator("[data-loaded]")).toContainText("Last loaded just now", { timeout: 15_000 });
    await expect(bar).toHaveCount(0);
    expect(bad).toEqual([]);
  });
});

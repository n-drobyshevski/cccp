import { expect, test, type Page } from "@playwright/test";

// Review-panel fidelity regressions: the List fits its card, Settings does not scroll sideways
// on a phone with unsaved changes, the whole domain row opens the List, tabs take arrow keys,
// focus returns to the opened row, and the saved-view cue stays while the name form is open.

async function theme(page: Page, t: "light" | "dark") {
  await page.addInitScript((v) => { try { localStorage.setItem("cccp.theme", v); } catch { /* storage refused */ } }, t);
}

for (const t of ["light", "dark"] as const) {
  for (const w of [1280, 1440]) {
    test("list status glyphs stay inside the table, " + t + " at " + w, async ({ page }) => {
      await theme(page, t);
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto("/?r=list");
      await page.locator("tr[data-id]").first().waitFor();
      const r = await page.evaluate(() => {
        const tw = document.querySelector(".tbl .tw") as HTMLElement;
        const box = tw.getBoundingClientRect();
        const dots = Array.from(document.querySelectorAll("td[data-col=st] .gl")).map((d) => d.getBoundingClientRect());
        const head = Array.from(document.querySelectorAll("th [data-col=st]")).pop()!.getBoundingClientRect();
        return { right: box.right, vw: innerWidth, overflow: tw.scrollWidth - tw.clientWidth, dotsRight: Math.max(...dots.map((d) => d.right)), headRight: head.right };
      });
      expect(r.overflow).toBeLessThanOrEqual(0);
      expect(r.dotsRight).toBeLessThanOrEqual(Math.min(r.right, r.vw));
      expect(r.headRight).toBeLessThanOrEqual(Math.min(r.right, r.vw));
    });
  }
}

test("settings with unsaved changes does not scroll sideways on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?r=settings&tab=display");
  const input = page.locator("input[data-key='display.hidePrefix']");
  await input.waitFor();
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(await over()).toBe(0);
  await input.fill("A");
  await expect(page.locator(".stabs .dirtydot")).toHaveCount(1);
  expect(await over()).toBe(0);
});

test("any cell of a domain row opens the List, and only actionable tables look clickable", async ({ page }) => {
  await page.goto("/?r=overview");
  const row = page.locator("table[data-table=domains] tbody tr").first();
  await row.waitFor();
  expect(await row.locator("td").nth(1).evaluate((e) => getComputedStyle(e).cursor)).toBe("pointer");
  await row.locator("td").nth(3).click();
  await expect(page).toHaveURL(/r=list/);
  await page.goto("/?r=settings&tab=source");
  const tr = page.locator("tr[data-tab-row]").first();
  await tr.waitFor();
  expect(await tr.evaluate((e) => getComputedStyle(e).cursor)).not.toBe("pointer");
});

test("a fact sheet with no tier shows the dashed No tier in the meta line and in Identity", async ({ page }) => {
  await page.goto("/?r=list");
  await page.locator("tr[data-id]").first().waitFor();
  const id = await page.locator("tr[data-id]:has(td[data-col=t] .tier.t0)").first().getAttribute("data-id");
  test.skip(!id, "every application in the data has a tier");
  await page.goto("/?app=" + id);
  await expect(page.locator(".hx .meta .tier.t0")).toHaveCount(1);
  await expect(page.locator("[data-sub=identity] .kv .tier.t0").first()).toBeVisible();
});

test("fact sheet tabs take arrow keys", async ({ page }) => {
  await page.goto("/?r=list");
  const id = (await page.locator("tr[data-id]").first().getAttribute("data-id"))!;
  await page.goto("/?app=" + id);
  const sheet = page.locator("[data-k=fs-tab-sheet]");
  await sheet.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-k=fs-tab-people]")).toBeFocused();
  await expect(page.locator("[data-k=fs-tab-people]")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("[data-k=fs-tab-sheet]")).toBeFocused();
});

test("focus goes to the title on a fact sheet and back to the opened row on Back", async ({ page }) => {
  await page.goto("/?r=list");
  const btn = page.locator("td[data-col=n] button").nth(4);
  await btn.waitFor();
  const k = (await btn.getAttribute("data-k"))!;
  await btn.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-k=fs-title]")).toBeFocused();
  await page.goBack();
  await expect(page.locator("[data-k=" + k + "]")).toBeFocused();
});

test("the Filters changed cue stays while the Save view form is open", async ({ page }) => {
  await page.goto("/?r=list");
  await page.locator("tr[data-id]").first().waitFor();
  await page.locator("input[data-k=q]").fill("a");
  const cue = page.locator("[data-cue]");
  await expect(cue).toBeVisible();
  await page.locator("[data-k=vnew]").click();
  await expect(page.locator("[data-k=vname]")).toBeVisible();
  await expect(cue).toBeVisible();
});

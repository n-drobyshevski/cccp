import { expect, test, type Page } from "@playwright/test";

// The pill toolbar, its popovers and the right filter panel (the Heatmap and the Landscape carry
// them; the Inventory has its own left panel, see inventory.spec.ts), against the dev server: pill labels, counts, find, focus handling, panel placement and persistence, the
// count, Clear all and hostile values.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const pill = (page: Page, k: string) => page.locator(`[data-k="pill-${k}"]`);
const pop = (page: Page) => page.locator(".pop");
const visible = async (page: Page) => Number((await page.locator("[data-count=visible]").innerText()).split(" ")[0].replace(/,/g, ""));
const urlParam = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);

async function open(page: Page, k: string) {
  await pill(page, k).click();
  await expect(pop(page)).toBeVisible();
}

/** The values and counts of the open popover or the panel section, in order. */
async function rowsOf(scope: ReturnType<Page["locator"]>) {
  return scope.locator(".ck").evaluateAll((els) => els.map((e) => ({
    value: (e.querySelector("span") as HTMLElement).textContent as string,
    count: Number((e.querySelector("small") as HTMLElement).textContent!.replace(/,/g, "")),
    muted: e.classList.contains("zero"),
    checked: (e.querySelector("input") as HTMLInputElement).checked,
  })));
}

test.describe("pills and popovers", () => {
  test("a pill opens its checklist; the label shows the first value and +n", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?r=heatmap");
    await expect(page.locator(".toolbar")).toBeVisible();
    await expect(page.locator(".pill[data-act=open] > span")).toHaveText(["Tier", "Domain", "Lifecycle", "Security officer", "Gap in"]);
    await open(page, "lc");
    const rows = await rowsOf(pop(page));
    expect(rows.length).toBeGreaterThan(2);
    await pop(page).locator(".ck input").nth(0).check();
    await expect(pill(page, "lc")).toHaveText(`Lifecycle: ${rows[0].value}`);
    await expect(pill(page, "lc")).toHaveClass(/\bon\b/);
    await pop(page).locator(".ck input").nth(1).check();
    await expect(pill(page, "lc")).toHaveText(`Lifecycle: ${rows[0].value} +1`);
    await expect(pop(page).locator(".pfoot span")).toHaveText("2 selected");
    expect(urlParam(page, "lc")).toContain(",");
    expect(bad).toEqual([]);
  });

  test("counts skip the facet's own selection; zero rows are muted but listed", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await expect(page.locator(".toolbar")).toBeVisible();
    await open(page, "lc");
    const before = await rowsOf(pop(page));
    const total = before.reduce((n, r) => n + r.count, 0);
    expect(total).toBe(await visible(page));
    // Select one lifecycle: its own list keeps every count.
    await pop(page).locator(".ck input").nth(0).check();
    const own = await rowsOf(pop(page));
    expect(own.map((r) => r.count)).toEqual(before.map((r) => r.count));
    expect(own[0].checked).toBe(true);
    // Another facet narrows this one: T1 alone leaves some lifecycles with zero.
    await page.keyboard.press("Escape");
    await open(page, "tier");
    await pop(page).locator('[data-k="pop-tier-No tier"]').check();
    await page.keyboard.press("Escape");
    await open(page, "lc");
    const narrowed = await rowsOf(pop(page));
    expect(narrowed.length).toBe(before.length);
    const muted = narrowed.filter((r) => r.muted);
    for (const r of narrowed) expect(r.muted).toBe(r.count === 0);
    expect(narrowed.reduce((n, r) => n + r.count, 0)).toBeLessThan(total);
    expect(muted.length + narrowed.filter((r) => !r.muted).length).toBe(before.length);
  });

  test("Domain and Security officer have find; Lifecycle does not", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await expect(page.locator(".toolbar")).toBeVisible();
    await open(page, "lc");
    await expect(pop(page).locator("input.find")).toHaveCount(0);
    await page.keyboard.press("Escape");
    for (const k of ["dom", "so"]) {
      await open(page, k);
      const find = pop(page).locator("input.find");
      await expect(find).toBeVisible();
      const all = await rowsOf(pop(page));
      const probe = all.map((r) => r.value).find((v) => /[a-z]{3}/i.test(v))!;
      const needle = probe.replace(/[^a-z]/gi, "").slice(0, 3).toLowerCase();
      await find.fill(needle);
      const found = await rowsOf(pop(page));
      expect(found.length).toBeGreaterThan(0);
      expect(found.length).toBeLessThanOrEqual(all.length);
      for (const r of found) expect(r.value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()).toContain(needle);
      await expect(find).toBeFocused();
      await find.fill("qqqqzzzz");
      await expect(pop(page).locator(".hint")).toHaveText("Nothing matches");
      await page.keyboard.press("Escape");
      await expect(pop(page)).toHaveCount(0);
    }
  });

  test("Escape closes the popover and returns focus to the pill", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await expect(page.locator(".toolbar")).toBeVisible();
    await pill(page, "so").focus();
    await page.keyboard.press("Enter");
    await expect(pop(page)).toBeVisible();
    await expect(pop(page).locator("input.find")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(pop(page)).toHaveCount(0);
    await expect(pill(page, "so")).toBeFocused();
    await expect(pill(page, "so")).toHaveAttribute("aria-expanded", "false");
  });

  test("Escape still returns focus to the pill after a selection re-rendered it", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await open(page, "lc");
    await pop(page).locator(".ck input").nth(0).check();
    await expect(pill(page, "lc")).toHaveClass(/\bon\b/);
    await page.keyboard.press("Escape");
    await expect(pill(page, "lc")).toBeFocused();
  });

  test("an outside click closes it, and so does a route change", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await expect(page.locator(".toolbar")).toBeVisible();
    await open(page, "dom");
    await page.locator("[data-page=heatmap] .rhead").click();
    await expect(pop(page)).toHaveCount(0);
    await page.locator('[data-k="nav-landscape"]').click();
    await expect(page.locator("[data-page=landscape]")).toBeVisible();
    await open(page, "dom");
    await page.goBack();
    await expect(page.locator("[data-page=heatmap]")).toBeVisible();
    await expect(pop(page)).toHaveCount(0);
  });

  test("a pill toggles its popover, and opening another replaces it", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await open(page, "dom");
    await pill(page, "dom").click();
    await expect(pop(page)).toHaveCount(0);
    await open(page, "dom");
    await pill(page, "lc").click();
    await expect(pop(page)).toHaveCount(1);
    await expect(pop(page)).toHaveAttribute("aria-label", "Lifecycle filter");
    await expect(pill(page, "dom")).toHaveAttribute("aria-expanded", "false");
    await expect(pill(page, "lc")).toHaveAttribute("aria-expanded", "true");
  });

  test("checkbox focus survives the re-render, by keyboard", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await open(page, "lc");
    const box = pop(page).locator(".ck input").nth(1);
    const key = await box.getAttribute("data-k");
    await box.focus();
    await page.keyboard.press("Space");
    await expect(pill(page, "lc")).toHaveClass(/\bon\b/);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-k"));
    expect(focused).toBe(key);
    await expect(pop(page).locator(`input[data-k="${key}"]`)).toBeChecked();
    await page.keyboard.press("Space");
    await expect(pill(page, "lc")).not.toHaveClass(/\bon\b/);
    expect(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-k"))).toBe(key);
    await expect(pop(page)).toBeVisible();
  });

  test("the popover list keeps its scroll while a value is ticked", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await open(page, "dom");
    const list = pop(page).locator(".plist");
    const n = await pop(page).locator(".ck").count();
    test.skip(n < 12, "not enough domains to scroll");
    await list.evaluate((e) => { e.scrollTop = 100; });
    await pop(page).locator(".ck input").nth(8).check();
    await expect(pill(page, "dom")).toHaveClass(/\bon\b/);
    expect(await pop(page).locator(".plist").evaluate((e) => e.scrollTop)).toBe(100);
  });
});

test.describe("search, tiers, count, Clear all", () => {
  test("tier toggles update the count and the address; Clear all resets", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await expect(page.locator(".toolbar")).toBeVisible();
    const total = await visible(page);
    await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);
    await expect(pill(page, "tier")).toHaveText("Tier");
    await open(page, "tier");
    await pop(page).locator('[data-k="pop-tier-T1"]').check();
    await expect(pill(page, "tier")).toHaveText("Tier: 1");
    await expect(pill(page, "tier")).toHaveClass(/\bon\b/);
    await page.keyboard.press("Escape");
    await expect.poll(() => visible(page)).toBeLessThan(total);
    await expect(page.locator("[data-count=of]")).toContainText(`of ${total.toLocaleString("en-US")} application`);
    expect(urlParam(page, "tier")).toBe("T1");
    const afterTier = await visible(page);
    await open(page, "tier");
    await pop(page).locator('[data-k="pop-tier-T2"]').check();
    await expect(pill(page, "tier")).toHaveText("Tier: 1, 2");
    await page.keyboard.press("Escape");
    await expect.poll(() => visible(page)).toBeGreaterThan(afterTier);
    await expect(page.locator(".badge")).toHaveText("2");
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await expect.poll(() => visible(page)).toBe(total);
    await expect(pill(page, "tier")).toHaveText("Tier");
    await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);
    await expect(page.locator(".badge")).toHaveCount(0);
    for (const k of ["q", "tier", "dom", "lc", "so", "gap"]) expect(urlParam(page, k)).toBeNull();
    await expect(page.locator(".pill[data-act=open].on")).toHaveCount(0);
  });

  test("a filter in the address is shown by the toolbar on load", async ({ page }) => {
    await page.goto("/?r=heatmap&tier=T1&q=a");
    await expect(pill(page, "tier")).toHaveText("Tier: 1");
    await expect(page.getByRole("searchbox", { name: "Search applications" })).toHaveValue("a");
    await expect(page.getByRole("button", { name: "Clear all" })).toBeVisible();
  });
});

test.describe("the right filter panel", () => {
  test("at 1280 px it sits to the right of the content and is remembered in cccp.side", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?r=heatmap");
    await expect(page.locator(".side")).toHaveCount(0);
    const btn = page.locator('[data-k="side"]');
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    const side = page.locator(".side");
    await expect(side).toBeVisible();
    const s = (await side.boundingBox())!;
    const c = (await page.locator("[data-region=content]").boundingBox())!;
    expect(s.x).toBeGreaterThan(c.x + c.width - 1);
    expect(Math.abs(s.y - c.y)).toBeLessThan(2);
    expect(await page.evaluate(() => localStorage.getItem("cccp.side"))).toBe("1");
    await expect(side.locator("fieldset legend")).toHaveText(["Domain", "Lifecycle", "Security officer", "Gap in"]);
    await page.reload();
    await expect(page.locator(".side")).toBeVisible();
    await page.locator('[data-k="side-hide"]').click();
    await expect(page.locator(".side")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("cccp.side"))).toBe("0");
    await page.reload();
    await expect(page.locator(".toolbar")).toBeVisible();
    await expect(page.locator(".side")).toHaveCount(0);
  });

  test("below 820 px the panel stacks above the content", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.addInitScript(() => localStorage.setItem("cccp.side", "1"));
    await page.goto("/?r=heatmap");
    await expect(page.locator(".side")).toBeVisible();
    const s = (await page.locator(".side").boundingBox())!;
    const c = (await page.locator("[data-region=content]").boundingBox())!;
    expect(s.y + s.height).toBeLessThanOrEqual(c.y + 1);
  });

  test("at exactly 820 px the panel is on the right", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.addInitScript(() => localStorage.setItem("cccp.side", "1"));
    await page.goto("/?r=heatmap");
    const s = (await page.locator(".side").boundingBox())!;
    const c = (await page.locator("[data-region=content]").boundingBox())!;
    expect(s.x).toBeGreaterThanOrEqual(c.x + c.width - 1);
  });

  test("chips replace the pills, and the panel and pills stay in sync", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await expect(page.locator(".toolbar")).toBeVisible();
    await open(page, "lc");
    const first = (await rowsOf(pop(page)))[0].value;
    await pop(page).locator(".ck input").nth(0).check();
    await page.keyboard.press("Escape");
    await page.locator('[data-k="side"]').click();
    await expect(page.locator(".pill[data-act=open]")).toHaveCount(1);
    await expect(pill(page, "tier")).toBeVisible();
    await expect(page.locator(".chip")).toHaveText([`Lifecycle: ${first}×`]);
    const section = page.locator(".side fieldset").nth(1);
    await expect(section.locator("input").first()).toBeChecked();
    await expect(section.locator("legend")).toHaveText("Lifecycle · 1");
    // A tick in the panel adds a chip and counts in the badge and the address.
    await section.locator("input").nth(1).check();
    await expect(page.locator(".chip")).toHaveCount(2);
    await expect(page.locator(".badge")).toHaveText("2");
    expect(urlParam(page, "lc")).toContain(",");
    // Removing a chip unticks the panel row.
    await page.locator('.chip button[aria-label^="Remove"]').first().click();
    await expect(page.locator(".chip")).toHaveCount(1);
    await expect(section.locator("input").first()).not.toBeChecked();
    // Hide the panel: the pills are back with the same selection.
    await page.locator('[data-k="side-hide"]').click();
    await expect(pill(page, "lc")).toHaveClass(/\bon\b/);
    await open(page, "lc");
    expect((await rowsOf(pop(page))).filter((r) => r.checked)).toHaveLength(1);
  });

  test("the panel's find narrows its own list and keeps focus while typing", async ({ page }) => {
    await page.goto("/?r=heatmap");
    await page.locator('[data-k="side"]').click();
    const find = page.locator('input.find[data-k="find-side-so"]');
    await expect(find).toBeVisible();
    const all = await rowsOf(page.locator(".side fieldset").nth(2));
    const probe = all.map((r) => r.value).find((v) => /[a-z]{3}/i.test(v))!;
    await find.pressSequentially(probe.replace(/[^a-z]/gi, "").slice(0, 3).toLowerCase(), { delay: 20 });
    await expect(find).toBeFocused();
    const found = await rowsOf(page.locator(".side fieldset").nth(2));
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThanOrEqual(all.length);
    await expect(page.locator(".side fieldset").nth(0).locator("input.find")).toHaveValue("");
  });

  test("panel counts match the pill popover counts", async ({ page }) => {
    await page.goto("/?r=heatmap&tier=T1");
    await page.locator('[data-k="side"]').click();
    const panel = await rowsOf(page.locator(".side fieldset").nth(1));
    await page.locator('[data-k="side"]').click();
    await open(page, "lc");
    expect(await rowsOf(pop(page))).toEqual(panel);
  });

  test("the toggle works for the session when storage is refused", async ({ page }) => {
    await page.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
    await page.goto("/?r=heatmap");
    await page.locator('[data-k="side"]').click();
    await expect(page.locator(".side")).toBeVisible();
  });
});

test.describe("hostile values", () => {
  const BAD = '<img src=x onerror="window.__xss=1">';
  test("a domain and an officer that are markup stay text in the pills, popovers, panel and chips", async ({ page }) => {
    const bad = watchConsole(page);
    await page.route("**/workbook.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + `\n(function () {
        var rows = window.__CCCP_WORKBOOK__.tabs[0].rows;
        var h = rows[0];
        var d = h.indexOf("Domain"), o = h.indexOf("Security Officer Name"), l = h.indexOf("Lifecycle");
        for (var i = 1; i <= 3; i++) { rows[i][d] = ${JSON.stringify(BAD)}; rows[i][o] = ${JSON.stringify(BAD)}; }
        rows[4][d] = '"><script>window.__xss=2<\\/script>';
        rows[4][l] = ${JSON.stringify(BAD)};
      })();`;
      await route.fulfill({ response: res, body });
    });
    await page.goto("/?r=heatmap");
    await expect(page.locator(".toolbar")).toBeVisible();
    for (const k of ["dom", "so", "lc"]) {
      await open(page, k);
      await expect(pop(page).locator("img, script")).toHaveCount(0);
      await pop(page).locator("input.find, .ck input").first().focus();
      if (k !== "lc") await pop(page).locator("input.find").fill(BAD);
      await expect(pop(page).locator("img, script")).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    await open(page, "dom");
    const rows = await rowsOf(pop(page));
    expect(rows.some((r) => r.value === BAD)).toBe(true);
    await pop(page).locator("input.find").fill("img src");
    await pop(page).locator(".ck input").first().check();
    await page.keyboard.press("Escape");
    await expect(pill(page, "dom")).toContainText("<img src=x");
    await page.locator('[data-k="side"]').click();
    await expect(page.locator(".chip")).toContainText("<img src=x");
    const box = page.getByRole("searchbox", { name: "Search applications" });
    await box.fill(BAD);
    await box.press("Enter");
    await expect.poll(() => urlParam(page, "q")).toBe(BAD);
    await page.reload();
    await expect(page.locator("[data-page=list]")).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "Search applications" })).toHaveValue(BAD);
    await expect(page.locator(".toolbar img, .side img, .chip img, .pill img, script:not([src])")).toHaveCount(await page.locator("script:not([src])").count());
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    expect(bad).toEqual([]);
  });
});

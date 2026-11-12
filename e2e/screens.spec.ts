import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Screenshot set for comparison with the approved mockups: every page in both themes at 1280 and
// 820 px. Files go to $SHOTS_DIR (default: a temp folder), never into the repo.

const OUT = process.env.SHOTS_DIR || join(tmpdir(), "cccp-shots");
const SIZES = [{ w: 1280, h: 900 }, { w: 820, h: 1000 }];
const THEMES = ["light", "dark"] as const;
const SCREENS: { name: string; url: (id: string) => string; ready: string }[] = [
  { name: "overview", url: () => "/?r=overview", ready: "[data-page=overview]" },
  { name: "list", url: () => "/?r=list", ready: "[data-page=list] tr[data-id]" },
  { name: "heatmap", url: () => "/?r=heatmap", ready: "[data-page=heatmap]" },
  { name: "landscape", url: () => "/?r=landscape", ready: "[data-page=landscape]" },
  { name: "factsheet", url: (id) => "/?app=" + id, ready: "[data-page=app] .hx h1" },
  ...["source", "fields", "rules", "access", "display"].map((t) => ({ name: "settings-" + t, url: () => "/?r=settings&tab=" + t, ready: "[data-page=settings][data-tab=" + t + "]" })),
];

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

for (const theme of THEMES) {
  for (const size of SIZES) {
    test("screens, " + theme + " at " + size.w, async ({ page }) => {
      test.setTimeout(120_000);
      const bad = watchConsole(page);
      await page.setViewportSize({ width: size.w, height: size.h });
      await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch { /* storage refused */ } }, theme);
      await page.goto("/?r=list");
      const id = (await page.locator("tr[data-id]").first().getAttribute("data-id"))!;
      for (const s of SCREENS) {
        await page.goto(s.url(id));
        await expect(page.locator(s.ready).first()).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, s.name + " scrolls sideways").toBeLessThanOrEqual(0);
        await page.screenshot({ path: join(OUT, s.name + "-" + theme + "-" + size.w + ".png"), fullPage: true });
      }
      expect(bad).toEqual([]);
    });
  }
}

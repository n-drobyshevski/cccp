import { expect, test, type Page } from "@playwright/test";

// Visual baselines: every page and state of the app, light and dark, at 1280x800 and 390x844.
// Run alone: npx playwright test e2e/shots.spec.ts   (update: add --update-snapshots).
// Data is the dev fixtures with a fixed "today"; animations are frozen, the caret hidden, and
// anything that could vary between runs is masked (build id, timestamps, clocks).
// Shots are viewport-sized, not full page, to keep the baseline small.

const VIEWPORTS = [
  { tag: "desktop", width: 1280, height: 800 },
  { tag: "mobile", width: 390, height: 844 },
] as const;
const THEMES = ["light", "dark"] as const;

type Shot = { name: string; url: string | ((id: string) => string); ready: string; needsId?: boolean; mobile?: boolean };

const SHOTS: Shot[] = [
  { name: "overview", url: "/?r=overview", ready: "[data-page=overview]" },
  { name: "inventory", url: "/?r=list", ready: "[data-page=list] tr[data-id]" },
  { name: "heatmap", url: "/?r=list&lens=heatmap", ready: "[data-lens-body=heatmap]" },
  { name: "landscape", url: "/?r=list&lens=landscape", ready: "[data-lens-body=landscape]" },
  { name: "factsheet", url: (id) => "/?app=" + id, ready: "[data-page=app] .hx h1", needsId: true },
  ...["source", "fields", "rules", "access", "display"].map((tab) => ({
    name: "settings-" + tab,
    url: "/?r=settings&tab=" + tab,
    ready: "[data-page=settings] [role=tab]",
  })),
  { name: "denied", url: "/?as=stranger@example.com&r=list", ready: ".state.denied" },
  { name: "only-admins", url: "/?as=viewer@example.com&r=settings", ready: ".state" },
  { name: "no-source-owner", url: "/?nosource", ready: ".state.nosource" },
  { name: "no-source-viewer", url: "/?nosource&as=viewer@example.com", ready: ".state.nosource" },
  { name: "not-found", url: "/?app=no-such-app", ready: ".state" },
  { name: "splash", url: "/?slow=600000&coldcache&r=list", ready: ".boot[aria-busy=true]" },
];

// Possibly time-dependent text: build id, clocks, "x minutes ago" style stamps.
const maskOf = (page: Page) => [
  page.locator("[data-loaded], [data-build], [data-time], time"),
];

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(vp.tag + " " + theme, () => {
      test.use({ viewport: { width: vp.width, height: vp.height }, reducedMotion: "reduce" });
      for (const shot of SHOTS) {
        test(shot.name, async ({ page }) => {
          await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch { /* storage refused */ } }, theme);
          let url = shot.url;
          if (typeof url === "function") {
            await page.goto("/?r=list");
            await expect(page.locator("tr[data-id]").first()).toBeVisible();
            const id = (await page.locator("tr[data-id]").first().getAttribute("data-id"))!;
            url = url(id);
          }
          await page.goto(url);
          await expect(page.locator(shot.ready).first()).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          // Let fonts and the post-render frame settle before the capture.
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
          await expect(page).toHaveScreenshot(vp.tag + "-" + theme + "-" + shot.name + ".png", {
            animations: "disabled",
            caret: "hide",
            mask: maskOf(page),
            maxDiffPixelRatio: 0.001,
          });
        });
      }
    });
  }
}

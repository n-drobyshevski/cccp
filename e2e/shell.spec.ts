import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

// The client shell against the dev server: boot cases, the app bar, theme, the URL bridge,
// renderRegion in a real browser and the cost of deriving the whole register.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const rpcLog = (page: Page) => page.evaluate(() => (window as unknown as { __rpcLog: string[] }).__rpcLog);
const firstId = (page: Page) => page.evaluate(() => (window as any).__CCCP_WORKBOOK__.tabs[0].rows[1][0] as string);
const appCount = (page: Page) => page.evaluate(() => (window as any).__CCCP_WORKBOOK__.tabs[0].rows.slice(1).filter((r: unknown[]) => r[0]).length as number);

test.describe("boot", () => {
  test("inline data is used: no bootstrap or register call", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?inline&r=list");
    await expect(page.locator("[data-page=list]")).toBeVisible();
    expect(await rpcLog(page)).toEqual([]);
    expect(bad).toEqual([]);
  });

  test("a cold cache fetches the register behind a skeleton", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?coldcache&slow=700&r=list");
    await expect(page.locator(".skel[aria-busy=true]")).toBeVisible();
    await expect(page.locator("[data-page=list]")).toBeVisible();
    expect(await rpcLog(page)).toContain("getRegister");
    expect(bad).toEqual([]);
  });

  test("a stranger gets the access card with a contact link", async ({ page }) => {
    await page.goto("/?as=stranger@example.com");
    const card = page.locator(".state.denied");
    await expect(card).toBeVisible();
    await expect(card.getByRole("link", { name: /Contact owner@example\.com/ })).toHaveAttribute("href", /^mailto:owner@example\.com/);
    await expect(page.locator(".navb")).toHaveCount(0);
  });

  test("no source: the owner is offered Connect a sheet, a viewer is not", async ({ page, browser }) => {
    await page.goto("/?nosource");
    await expect(page.getByRole("button", { name: "Connect a sheet" })).toBeVisible();
    await page.getByRole("button", { name: "Connect a sheet" }).click();
    await expect(page.locator("[data-page=settings]")).toBeVisible();
    const other = await browser.newPage();
    await other.goto("/?nosource&as=viewer@example.com");
    await expect(other.locator(".state.nosource")).toBeVisible();
    await expect(other.getByRole("button", { name: "Connect a sheet" })).toHaveCount(0);
    await other.close();
  });

  test("a failed bootstrap shows the error with Retry, and Retry recovers", async ({ page }) => {
    let fail = true;
    await page.route("**/entry.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) + "\nvar __real = api_bootstrap; api_bootstrap = function (p) { return window.__fail ? { ok: false, error: 'Data source unreachable', errorKind: 'error' } : __real(p); };\nwindow.__fail = true;";
      await route.fulfill({ response: res, body });
    });
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText("Data source unreachable");
    if (fail) { await page.evaluate(() => { (window as any).__fail = false; }); fail = false; }
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("[data-page]")).toBeVisible();
  });
});

test.describe("app bar", () => {
  test("four views with aria-current on the open one", async ({ page }) => {
    await page.goto("/?r=heatmap");
    const nav = page.getByRole("navigation", { name: "View" });
    await expect(nav.getByRole("button")).toHaveText(["Overview", "List", "Heatmap", "Landscape"]);
    await expect(nav.locator("[aria-current=page]")).toHaveCount(1);
    await expect(nav.getByRole("button", { name: "Heatmap" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("button", { name: "Landscape" }).click();
    await expect(nav.getByRole("button", { name: "Landscape" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-page=landscape]")).toBeVisible();
    expect(new URL(page.url()).searchParams.get("r")).toBe("landscape");
  });

  for (const [who, gear] of [["owner@example.com", true], ["admin@example.com", true], ["viewer@example.com", false]] as const) {
    test(`the gear is ${gear ? "shown" : "absent"} for ${who}`, async ({ page }) => {
      await page.goto("/?as=" + who);
      await expect(page.locator(".navb")).toBeVisible();
      await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(gear ? 1 : 0);
    });
  }

  test("a viewer who opens settings by link gets the admins-only card", async ({ page }) => {
    await page.goto("/?as=viewer@example.com&r=settings");
    await expect(page.getByRole("heading", { name: "Only admins can change settings" })).toBeVisible();
  });

  test("a tip opens on keyboard focus", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Switch to/ }).focus();
    await expect(page.locator("#cccp-tip")).toBeVisible();
    await expect(page.locator("#cccp-tip")).toHaveText(/Switch to (dark|light) theme/);
    await page.keyboard.press("Escape");
    await expect(page.locator("#cccp-tip")).toBeHidden();
  });
});

test.describe("theme", () => {
  test("the choice persists across a reload and both themes draw", async ({ page }) => {
    const bad = watchConsole(page);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bg);
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    expect(bad).toEqual([]);
  });

  test("with storage refused the toggle still works for the session", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Switch to/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", /dark|light/);
  });
});

test.describe("url bridge", () => {
  test("?app=<UUID> opens the fact sheet and Back works", async ({ page }) => {
    await page.goto("/");
    const id = await firstId(page);
    await page.goto("/?app=" + id);
    await expect(page.locator("[data-page=app]")).toBeVisible();
    await expect(page.locator("[data-app-id]")).toHaveAttribute("data-app-id", id);
    await page.getByRole("button", { name: "Overview" }).click();
    await expect(page.locator("[data-page=overview]")).toBeVisible();
    await page.goBack();
    await expect(page.locator("[data-page=app]")).toBeVisible();
    await expect(page.locator("[data-app-id]")).toHaveAttribute("data-app-id", id);
    await page.goForward();
    await expect(page.locator("[data-page=overview]")).toBeVisible();
  });

  test("an unknown application id shows not found", async ({ page }) => {
    await page.goto("/?app=does-not-exist");
    await expect(page.getByRole("heading", { name: /not found/ })).toBeVisible();
  });

  test("a bare address opens the Display default view", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-page=overview]")).toBeVisible();
  });
});

test.describe("register", () => {
  test("deriving the whole register takes under 150 ms and nothing is hidden by default", async ({ page }) => {
    await page.goto("/?r=list");
    await expect(page.locator("[data-page=list]")).toBeVisible();
    const n = await appCount(page);
    const d = await page.evaluate(() => {
      const m = performance.getEntriesByName("cccp:derive")[0] as PerformanceMeasure | undefined;
      return m ? { ms: m.duration, apps: (m.detail as { apps: number }).apps } : null;
    });
    expect(d).not.toBeNull();
    expect(d!.apps).toBe(n);
    expect(d!.ms).toBeLessThan(150);
    await expect(page.locator("[data-count=visible]")).toHaveText(n.toLocaleString("en-US"));
    await expect(page.locator("[data-count=of]")).toHaveText("of " + n.toLocaleString("en-US") + " applications");
    await expect(page.locator("[data-count=hidden]")).toHaveCount(0);
  });
});

test.describe("history and hidden count", () => {
  test("a view switch pushes history, a replace keeps it", async ({ page }) => {
    await page.goto("/?r=list");
    await expect(page.locator("[data-page=list]")).toBeVisible();
    const before = await page.evaluate(() => history.length);
    await page.locator('[data-k="nav-heatmap"]').click();
    await expect(page.locator("[data-page=heatmap]")).toBeVisible();
    const after = await page.evaluate(() => history.length);
    expect(after).toBe(before + 1);
    await page.evaluate(() => (window as any).google.script.history.replace(null, { r: "heatmap", x: "1" }, ""));
    expect(await page.evaluate(() => history.length)).toBe(after);
  });

  test("a hidden-name prefix shows a non-zero hidden count", async ({ page }) => {
    await page.goto("/?r=list&hideprefix=n");
    await expect(page.locator("[data-page=list]")).toBeVisible();
    await expect(page.locator("[data-count=hidden]")).toBeVisible();
    const n = await appCount(page);
    const vis = Number((await page.locator("[data-count=visible]").innerText()).split(" ")[0].replace(/,/g, ""));
    const hid = Number((await page.locator("[data-count=hidden]").innerText()).trim().split(" ")[1].replace(/,/g, ""));
    expect(hid).toBeGreaterThan(0);
    expect(vis + hid).toBe(n);
  });
});

test.describe("renderRegion in a real browser", () => {
  test("keeps focus, caret and scroll across a re-render, and rejects strings", async ({ page }) => {
    const out = await build({
      stdin: { contents: 'import { renderRegion } from "./src/client/lib/dom.js"; import { html } from "./src/client/lib/html.js"; window.__rr = { renderRegion, html };', resolveDir: process.cwd(), loader: "js" },
      bundle: true, format: "iife", write: false, supported: { "template-literal": false },
    });
    await page.goto("about:blank");
    await page.addScriptTag({ content: out.outputFiles[0].text });
    const r = await page.evaluate(() => {
      const w = window as any;
      const el = document.createElement("div");
      document.body.appendChild(el);
      const view = (v: string) => w.__rr.html`<div data-keep-scroll="l" style="height:60px;overflow:auto"><div style="height:600px"></div></div><input data-k="q" value="${v}">`;
      w.__rr.renderRegion(el, view("hello"));
      const box = el.querySelector("[data-keep-scroll]") as HTMLElement;
      box.scrollTop = 120;
      const input = el.querySelector("input") as HTMLInputElement;
      input.focus();
      input.setSelectionRange(1, 3);
      w.__rr.renderRegion(el, view("hello"), { keepFocus: true, keepScroll: true });
      const after = el.querySelector("input") as HTMLInputElement;
      let threw = false;
      try { w.__rr.renderRegion(el, "<b>x</b>"); } catch { threw = true; }
      return { sameNode: after === input, focused: document.activeElement === after, sel: [after.selectionStart, after.selectionEnd], top: (el.querySelector("[data-keep-scroll]") as HTMLElement).scrollTop, threw };
    });
    expect(r).toEqual({ sameNode: false, focused: true, sel: [1, 3], top: 120, threw: true });
  });
});

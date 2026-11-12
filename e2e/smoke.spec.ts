import { expect, test, type Page } from "@playwright/test";

// The whole app in one pass against the dev server: every page, the Settings save, access for the
// owner, a viewer, a stranger and both org-mode cases, zero console errors, keyboard reach, the
// popover Escape contract, the focus ring and text contrast in both themes.

function watchConsole(page: Page): string[] {
  const bad: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") bad.push(m.text()); });
  page.on("pageerror", (e) => bad.push(String(e)));
  return bad;
}

const PAGES = ["overview", "list", "heatmap", "landscape"] as const;

test("the walk: every page, the fact sheet and a Settings save, with no console errors", async ({ page }) => {
  const bad = watchConsole(page);
  await page.goto("/");
  await expect(page.locator(".navb")).toBeVisible();
  for (const route of PAGES) {
    await page.getByRole("button", { name: route === "list" ? "Inventory" : new RegExp("^" + route, "i") }).click();
    await expect(page.locator("[data-page=" + route + "]")).toBeVisible();
  }
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await expect(page.locator("tr[data-id]").first()).toBeVisible();
  const id = await page.locator("tr[data-id]").first().getAttribute("data-id");
  await page.goto("/?app=" + id);
  await expect(page.locator("[data-page=app] .hx h1")).toBeVisible();
  await page.goBack();
  await expect(page.locator("[data-page=list]")).toBeVisible();

  // Settings: change a Display value, save, and see it stored.
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.locator("[data-page=settings]")).toBeVisible();
  await page.getByRole("tab", { name: /Display/ }).click();
  await page.locator('[data-key="display.opensOn"][data-v=heatmap]').click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.locator(".toast")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  // The dev fakes are per page load, so the stored value is checked in this load: the brand goes
  // to the saved default view.
  await page.getByRole("button", { name: "CCCP home" }).click();
  await expect(page.locator("[data-page=heatmap]")).toBeVisible();
  expect(bad).toEqual([]);
});

test.describe("access", () => {
  test("a viewer reads the register but has no gear and no Settings", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?as=viewer@example.com&r=overview");
    await expect(page.locator("[data-page=overview]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
    await page.goto("/?as=viewer@example.com&r=settings");
    await expect(page.locator(".state")).toContainText("Only admins");
    expect(bad).toEqual([]);
  });

  test("a stranger gets the access card and no navigation", async ({ page }) => {
    await page.goto("/?as=stranger@example.com&r=list");
    await expect(page.locator(".state.denied")).toBeVisible();
    await expect(page.locator(".navb")).toHaveCount(0);
    await expect(page.locator("tr[data-id]")).toHaveCount(0);
  });

  test("org mode admits a same-domain colleague as a viewer", async ({ page }) => {
    const bad = watchConsole(page);
    await page.goto("/?mode=org&as=colleague@example.com&r=list");
    await expect(page.locator("[data-page=list]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toHaveCount(0);
    expect(bad).toEqual([]);
  });

  test("org mode refuses another domain, a lookalike and a subdomain", async ({ page }) => {
    for (const who of ["someone@other.org", "x@example.com.evil.org", "x@mail.example.com"]) {
      await page.goto("/?mode=org&r=list&as=" + who);
      await expect(page.locator(".state.denied")).toBeVisible();
      await expect(page.locator(".navb")).toHaveCount(0);
    }
  });
});

test.describe("keyboard", () => {
  /** Tab through the page and report the visible, enabled controls that Tab never reached. */
  async function unreached(page: Page): Promise<string[]> {
    const want: string[] = await page.evaluate(() => {
      const sel = "button, a[href], input, select, textarea, summary, [role=tab], [tabindex]";
      const vis = (e: Element) => { const r = (e as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden"; };
      return [...document.querySelectorAll(sel)]
        .filter((e) => vis(e) && !(e as HTMLInputElement).disabled && !(e instanceof HTMLInputElement && e.type === "radio" && e.name && !e.checked && document.querySelector('input[type=radio][name="' + e.name + '"]:checked')) && !e.closest("[inert]") && (e as HTMLElement).tabIndex >= 0 && !(e as HTMLElement).closest("[aria-hidden=true]"))
        .map((e, i) => { e.setAttribute("data-smoke", String(i)); return String(i); });
    });
    const seen = new Set<string>();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < want.length + 40; i++) {
      await page.keyboard.press("Tab");
      const k = await page.evaluate(() => document.activeElement?.getAttribute("data-smoke") ?? null);
      if (k) seen.add(k);
      if (seen.size === want.length) break;
    }
    const miss = want.filter((k) => !seen.has(k));
    return page.evaluate((m) => m.map((k) => { const e = document.querySelector('[data-smoke="' + k + '"]')!; return e.tagName + "." + e.className + "[" + (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30) + "]"; }), miss);
  }

  for (const route of PAGES) {
    test("Tab reaches every control on " + route, async ({ page }) => {
      await page.goto("/?r=" + route);
      await expect(page.locator("[data-page=" + route + "]")).toBeVisible();
      expect(await unreached(page)).toEqual([]);
    });
  }

  test("Tab reaches every control on the fact sheet and on each Settings tab", async ({ page }) => {
    await page.goto("/?r=list");
    const id = await page.locator("tr[data-id]").first().getAttribute("data-id");
    await page.goto("/?app=" + id);
    await expect(page.locator(".hx h1")).toBeVisible();
    expect(await unreached(page)).toEqual([]);
    for (const tab of ["source", "fields", "rules", "access", "display"]) {
      await page.goto("/?r=settings&tab=" + tab);
      await expect(page.locator("[data-page=settings]")).toBeVisible();
      expect(await unreached(page), tab).toEqual([]);
    }
  });

  test("a popover opens from the keyboard and Escape returns focus to its trigger", async ({ page }) => {
    await page.goto("/?r=heatmap");
    const pill = page.locator(".toolbar [aria-haspopup], .tb [aria-haspopup]").first();
    await expect(pill).toBeVisible();
    await pill.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".pop")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".pop")).toHaveCount(0);
    await expect(pill).toBeFocused();
  });

  for (const theme of ["light", "dark"]) {
    test("the focus ring is 2px accent, visible in " + theme, async ({ page }) => {
      await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch { /* storage refused */ } }, theme);
      await page.goto("/?r=list");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.keyboard.press("Tab");
      const ring = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const s = getComputedStyle(e);
        const probe = document.createElement("i");
        probe.style.color = "var(--accent)";
        document.body.appendChild(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return { w: s.outlineWidth, st: s.outlineStyle, c: s.outlineColor, accent };
      });
      expect(ring.st).toBe("solid");
      expect(ring.w).toBe("2px");
      expect(ring.c).toBe(ring.accent);
    });
  }
});

test.describe("contrast", () => {
  for (const theme of ["light", "dark"]) {
    for (const route of PAGES) {
      test(route + " text is at least 4.5:1 in " + theme, async ({ page }) => {
        await page.addInitScript((t) => { try { localStorage.setItem("cccp.theme", t); } catch { /* storage refused */ } }, theme);
        await page.goto("/?r=" + route);
        await expect(page.locator("[data-page=" + route + "]")).toBeVisible();
        const low = await page.evaluate(() => {
          const cv = document.createElement("canvas").getContext("2d")!;
          const rgba = (c: string): number[] => {
            cv.clearRect(0, 0, 1, 1); cv.fillStyle = "#000"; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1);
            const d = cv.getImageData(0, 0, 1, 1).data;
            return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
          };
          const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
          const over = (top: number[], under: number[]) => { const a = top[3]!; return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1); };
          const bgOf = (el: Element): number[] => {
            const chain: number[][] = [];
            for (let e: Element | null = el; e; e = e.parentElement) { const c = rgba(getComputedStyle(e).backgroundColor); if (c[3]! > 0) { chain.push(c); if (c[3] === 1) break; } }
            let base = [255, 255, 255, 1];
            const root = rgba(getComputedStyle(document.body).backgroundColor);
            if (root[3] === 1) base = root;
            for (const c of chain.reverse()) base = over(c, base);
            return base;
          };
          const out: string[] = [];
          const seen = new Set<string>();
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || !(n.textContent || "").trim() || el.closest("script,style,[aria-hidden=true]")) continue;
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || Number(s.opacity) === 0) continue;
            if ((el as HTMLInputElement).disabled || el.closest(":disabled")) continue;
            const fg = rgba(s.color);
            const bg = bgOf(el);
            const f = over(fg, bg);
            const l1 = lum(f), l2 = lum(bg);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            if (ratio < 4.5) {
              const key = el.tagName + "." + el.className + s.color + s.backgroundColor;
              if (!seen.has(key)) { seen.add(key); out.push(ratio.toFixed(2) + " " + el.tagName + "." + el.className + " '" + (n.textContent || "").trim().slice(0, 24) + "' " + s.color); }
            }
          }
          return out;
        });
        expect(low).toEqual([]);
      });
    }
  }
});

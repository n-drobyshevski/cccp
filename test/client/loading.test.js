// The loading states: the first-open splash, the route-shaped skeletons, the slow line and the
// refresh bar. Views are pure, so they are checked as strings; the timers run on fake time.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appbarView } from "../../src/client/shell/appbar.js";
import { BOOT_STEPS, splashView, stepsView } from "../../src/client/shell/splash.js";
import { SKELETON_ROUTES, SLOW_AFTER_MS, SLOW_TEXT } from "../../src/client/shell/skeletons.js";
import { armSlow, skeleton } from "../../src/client/shell/states.js";
import { SETTINGS_TABS } from "../../src/client/pages/settings/draft.js";
import { SEARCH_PLACEHOLDER } from "../../src/client/components/toolbar.js";
import { withRefresh } from "../../src/client/state/refresh.js";
import { initialState, store } from "../../src/client/state/store.js";
import { COLUMN_BY_KEY, DEFAULT_COLUMN_KEYS } from "../../src/domain/columns";
import { PILLAR_LABEL } from "../../src/domain/facets";
import { factsheetOutline } from "../../src/domain/factsheet";
import { PILLARS } from "../../src/domain/types";

const s = (v) => String(v);

describe("splash", () => {
  it("is a busy status region with a screen reader sentence and the four dots", () => {
    const h = s(splashView("access"));
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('class="sr-only"');
    expect(h).toContain("CCCP");
    expect((h.match(/<i><\/i>/g) || []).length).toBe(4);
    expect(h).toContain('data-slot="slow"');
  });

  it("names the three steps in order", () => {
    expect(BOOT_STEPS.map((x) => x.label)).toEqual(["Checking access", "Loading applications", "Working out status"]);
  });

  it.each([
    ["access", ["active", "todo", "todo"]],
    ["apps", ["done", "active", "todo"]],
    ["status", ["done", "done", "active"]],
  ])("at %s the steps read %j", (step, states) => {
    const h = s(stepsView(step));
    const got = [...h.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]);
    expect(got).toEqual(states);
    expect((h.match(/aria-current="step"/g) || []).length).toBe(1);
    expect((h.match(/\(done\)/g) || []).length).toBe(states.filter((x) => x === "done").length);
  });

  it("an unknown step falls back to the first", () => {
    expect(s(stepsView(undefined))).toContain('data-step="access" data-state="active"');
  });

  it("index.html ships the same splash, and hides the app bar until the router takes over", () => {
    const page = readFileSync(new URL("../../src/client/index.html", import.meta.url), "utf8");
    const main = page.slice(page.indexOf('<main class="shell" id="main">') + '<main class="shell" id="main">'.length, page.indexOf("</main>"));
    expect(main.trim()).toBe(s(splashView("access")));
    expect(page).toContain('<body data-boot="splash">');
  });
});

describe("route skeletons", () => {
  it("covers overview, list, heatmap, landscape, app and settings", () => {
    expect([...SKELETON_ROUTES].sort()).toEqual(["app", "heatmap", "landscape", "list", "overview", "settings"]);
  });

  it.each(["overview", "list", "heatmap", "landscape", "app", "settings"])("%s is a busy region with a sr-only label and a slow slot", (route) => {
    const h = s(skeleton(route));
    expect(h).toContain(`data-skeleton="${route}"`);
    expect(h).toContain('aria-busy="true"');
    expect(h).toContain('role="status"');
    expect(h).toContain('class="sr-only"');
    expect(h).toContain('data-slot="slow"');
    expect(h).toContain('aria-hidden="true"');
    expect(h).toContain('class="sk');
    expect(h).not.toMatch(/\stitle=/);
    expect(h).not.toContain("<button");
  });

  it("escapes the label", () => {
    const h = s(skeleton("list", '<img src=x onerror="1">'));
    expect(h).not.toContain("<img");
    expect(h).toContain("&lt;img");
  });

  it("an unknown route draws the list frame", () => {
    expect(s(skeleton(""))).toContain('data-skeleton="list"');
    expect(s(skeleton("nope"))).toContain('data-skeleton="list"');
  });

  it("list: toolbar words and every default column head are real text", () => {
    const h = s(skeleton("list"));
    expect(h).toContain(SEARCH_PLACEHOLDER);
    for (const l of ["All applications", "Tier", "Domain", "Lifecycle", "Security officer", "Gap in", "Columns", "Export"]) expect(h).toContain(l);
    for (const k of DEFAULT_COLUMN_KEYS) expect(h).toContain(">" + COLUMN_BY_KEY[k].label + "<");
  });

  it("overview: KPI titles, pillar names and both section titles", () => {
    const h = s(skeleton("overview"));
    for (const l of ["Applications with a gap", "Tier 1 with a gap", "No security officer", "Past end of life", "Status by pillar", "Domains with the most gaps"]) expect(h).toContain(l);
    for (const p of PILLARS) expect(h).toContain(PILLAR_LABEL[p]);
  });

  it("heatmap: the lead heads and the pillar column heads", () => {
    const h = s(skeleton("heatmap"));
    expect(h).toContain("Domain / application");
    for (const p of PILLARS) expect(h).toContain(">" + PILLAR_LABEL[p] + "<");
  });

  it("landscape: the colour switch and the toolbar", () => {
    const h = s(skeleton("landscape"));
    expect(h).toContain("Colour by");
    expect(h).toContain("Worst status");
    expect(h).toContain(SEARCH_PLACEHOLDER);
  });

  it("app: every section title, the field names of the first sections and the Data quality title", () => {
    const h = s(skeleton("app"));
    const outline = factsheetOutline();
    expect(outline.map((x) => x.title)).toEqual(["Overview", "Cyber", "Compliance", "Continuity", "Platform"]);
    for (const sec of outline) expect(h).toContain(">" + sec.title + "<");
    expect(h).toContain("Front exposed on internet");
    expect(h).toContain("Last pentest");
    expect(h).toContain("Data quality");
  });

  it("settings: the tab names", () => {
    const h = s(skeleton("settings", "Opening the settings"));
    for (const t of SETTINGS_TABS) expect(h).toContain(">" + t.label + "<");
    expect(h).toContain("Opening the settings");
  });
});

// A stand-in for the router's element: one slow slot, and renderRegion's innerHTML write.
function fakeEl() {
  const slot = { html: "", ownerDocument: { activeElement: null }, contains: () => false, hasAttribute: () => false, querySelectorAll: () => [], set innerHTML(v) { this.html = v; } };
  return { slot, querySelector: (q) => (q === '[data-slot="slow"]' ? slot : null) };
}

describe("the slow line", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("appears once after 8 s", () => {
    const el = fakeEl();
    armSlow(el);
    vi.advanceTimersByTime(SLOW_AFTER_MS - 1);
    expect(el.slot.html).toBe("");
    vi.advanceTimersByTime(2);
    expect(el.slot.html).toContain(SLOW_TEXT);
    expect(SLOW_TEXT).toBe("Still loading. Large sheets take a moment.");
  });

  it("never appears once cancelled", () => {
    const el = fakeEl();
    const cancel = armSlow(el);
    vi.advanceTimersByTime(3000);
    cancel();
    vi.advanceTimersByTime(20000);
    expect(el.slot.html).toBe("");
  });
});

describe("the refresh bar", () => {
  const base = () => ({ ...initialState(), boot: { status: "ready", message: "" } });

  it("shows under the app bar only while refreshing", () => {
    expect(s(appbarView(base(), "light"))).not.toContain("refresh-bar");
    const h = s(appbarView({ ...base(), refreshing: true }, "light"));
    expect(h).toContain('class="refresh-bar"');
    expect(h).toContain('role="progressbar"');
    expect(h).toContain('aria-label="Reloading data"');
  });

  it("the flag follows a reload, nested ones included, and survives a failure", async () => {
    store.reset();
    const seen = [];
    const off = store.subscribe((n) => seen.push(n.refreshing));
    await withRefresh(async () => {
      expect(store.get().refreshing).toBe(true);
      await withRefresh(async () => {});
      expect(store.get().refreshing).toBe(true);
    });
    expect(store.get().refreshing).toBe(false);
    await expect(withRefresh(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(store.get().refreshing).toBe(false);
    off();
    expect(seen).toEqual([true, false, true, false]);
  });
});

describe("the app bar during a wait", () => {
  const live = { viewer: { canEditSettings: true } };
  const at = (o) => s(appbarView({ ...initialState(), route: "list", ...o }, "light"));

  it("keeps the nav and gear on a reload once the core is known", () => {
    const h = at({ booted: true, core: {}, live, boot: { status: "loading", message: "" } });
    expect(h).toContain('class="navb"');
    expect(h).toContain('data-act="settings"');
  });

  it("shows no nav on the first boot, or when the bootstrap itself has to rerun", () => {
    expect(at({ booted: false, core: {}, live, boot: { status: "loading", message: "" } })).not.toContain('class="navb"');
    expect(at({ booted: true, core: null, live: null, boot: { status: "loading", message: "" } })).not.toContain('class="navb"');
    expect(at({ booted: true, core: {}, live, boot: { status: "error", message: "x" } })).not.toContain('class="navb"');
  });
});

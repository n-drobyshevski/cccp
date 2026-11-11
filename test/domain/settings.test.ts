import { describe, expect, it } from "vitest";
import { FIELD_KEYS } from "../../src/domain/fields";
import {
  DEFAULT_SETTINGS, RULE_PARAMS, SECTION_KEYS, SECTION_MAX_BYTES, applyPatch, changedSections, cleanSettings,
  makeDefaultSettings, patchTouchesSheetId, sectionBytes, sheetIdFrom, validateSettings,
} from "../../src/domain/settings";
import type { Settings } from "../../src/domain/types";

const D = (): Settings => makeDefaultSettings();

describe("defaults", () => {
  it("clean to themselves", () => {
    expect(cleanSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("have every field and every rule", () => {
    expect(Object.keys(DEFAULT_SETTINGS.fields).sort()).toEqual([...FIELD_KEYS].sort());
    expect(Object.keys(DEFAULT_SETTINGS.rules.rules).sort()).toEqual(Object.keys(RULE_PARAMS).sort());
    expect(DEFAULT_SETTINGS.rules.rules["co.review"]).toEqual({ months: 12 });
    expect(DEFAULT_SETTINGS.rules.rules["ct.drpMissing"]).toEqual({ tiers: [1, 2] });
  });

  it("keeps each section under 8000 bytes", () => {
    for (const k of SECTION_KEYS) expect(sectionBytes(DEFAULT_SETTINGS[k]), k).toBeLessThan(SECTION_MAX_BYTES);
  });

  it("are frozen but makeDefaultSettings gives a fresh copy", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    const a = D();
    a.source.tabs.apps.name = "X";
    expect(D().source.tabs.apps.name).toBe("Apps");
  });
});

describe("cleanSettings", () => {
  it("never throws on any input", () => {
    const weird: unknown[] = [null, undefined, 0, "x", [], [1], true, NaN, () => 1, Symbol("s"), { source: 5 }, { source: { tabs: null } },
      { fields: { id: null, name: [] } }, { rules: { rules: 7 } }, { display: "x" }, JSON.parse('{"__proto__":{"x":1}}'),
      { source: { cacheMinutes: {} } }, { rules: { rules: { "co.review": { months: {} } } } }];
    for (const w of weird) expect(() => cleanSettings(w)).not.toThrow();
    const hostile = { get source(): never { throw new Error("boom"); } };
    expect(cleanSettings(hostile)).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps numbers", () => {
    const lo = cleanSettings({ source: { cacheMinutes: -5 }, rules: { rules: { "co.review": { months: 0 }, "cy.pentestAge": { months: 9999 } } } });
    expect(lo.source.cacheMinutes).toBe(1);
    expect(lo.rules.rules["co.review"]!.months).toBe(1);
    expect(lo.rules.rules["cy.pentestAge"]!.months).toBe(120);
    expect(cleanSettings({ source: { cacheMinutes: 100000 } }).source.cacheMinutes).toBe(360);
    expect(cleanSettings({ source: { cacheMinutes: "30" } }).source.cacheMinutes).toBe(30);
    expect(cleanSettings({ source: { cacheMinutes: "abc" } }).source.cacheMinutes).toBe(10);
    expect(cleanSettings({ source: { cacheMinutes: 7.6 } }).source.cacheMinutes).toBe(8);
  });

  it("repairs enums and tiers and drops unknown keys", () => {
    const s = cleanSettings({
      source: { tabs: { aud: { joinOn: "zzz", pick: "newest" }, bogus: { name: "x" } }, extra: 1 },
      fields: { name: { binding: "nope", header: "  Title " }, madeUp: { header: "x" } },
      rules: { version: 9, rules: { "ct.drpMissing": { tiers: [5, "2", 0, 2, "x"] }, "not.a.rule": { on: false } } },
      display: { opensOn: "nowhere", theme: "neon", hideEol: "yes", extra: true },
    });
    expect(s.source.tabs.aud.joinOn).toBe("id");
    expect(s.source.tabs.aud.pick).toBe("latest");
    expect(Object.keys(s.source.tabs)).toEqual(["apps", "ciat", "aud", "drp", "plat"]);
    expect(s.fields.name).toEqual({ binding: "apps", header: "Title" });
    expect("madeUp" in s.fields).toBe(false);
    expect(s.rules.version).toBe(1);
    expect(s.rules.rules["ct.drpMissing"]!.tiers).toEqual([1, 2, 4]);
    expect("not.a.rule" in s.rules.rules).toBe(false);
    expect(s.display).toEqual({ opensOn: "overview", theme: "system", hidePrefix: "", hideEol: false });
  });

  it("is idempotent", () => {
    const messy = cleanSettings({ source: { sheetId: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0", cacheMinutes: 999 }, display: { hidePrefix: "  TO DELETE " } });
    expect(messy.source.sheetId).toBe("1AbCdEfGhIjKlMnOp");
    expect(messy.display.hidePrefix).toBe("TO DELETE");
    expect(cleanSettings(messy)).toEqual(messy);
  });

  it("caps long strings and strips control characters", () => {
    const s = cleanSettings({ fields: { name: { header: "a\u0000b" + "x".repeat(500) } } });
    expect(s.fields.name.header.length).toBeLessThanOrEqual(120);
    expect(s.fields.name.header).not.toMatch(/\u0000/);
  });

  it("extracts the sheet id", () => {
    expect(sheetIdFrom("1AbCdEfGhIjKlMnOp")).toBe("1AbCdEfGhIjKlMnOp");
    expect(sheetIdFrom("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit")).toBe("1AbCdEfGhIjKlMnOp");
    expect(sheetIdFrom("not an id!")).toBe("");
    expect(sheetIdFrom(5)).toBe("");
  });
});

describe("validateSettings", () => {
  it("accepts the defaults", () => {
    expect(validateSettings(D())).toEqual([]);
  });

  it("returns readable sentences", () => {
    const s = D();
    s.source.tabs.apps.name = "";
    s.source.tabs.drp.name = "";
    s.fields.id.header = "";
    s.fields.name.header = "";
    s.source.sheetId = "short";
    const errs = validateSettings(s);
    expect(errs.length).toBeGreaterThanOrEqual(4);
    for (const e of errs) {
      expect(e).toMatch(/^[A-Z“].*[.:]$/);
      expect(e.length).toBeGreaterThan(20);
    }
    expect(errs.join(" ")).toContain("Applications tab");
    expect(errs.join(" ")).toContain("not used");
  });

  it("flags a field mapped into an unused tab", () => {
    const s = D();
    s.source.tabs.plat.name = "";
    expect(validateSettings(s).some((e) => e.includes("Hosting type"))).toBe(true);
    s.fields.hosting.header = "";
    expect(validateSettings(s).some((e) => e.includes("Hosting type"))).toBe(false);
  });

  it("refuses an oversize section", () => {
    const s = D();
    for (const k of FIELD_KEYS) s.fields[k].header = "é".repeat(120);
    const errs = validateSettings(s);
    expect(errs.some((e) => e.includes("fields settings are too large"))).toBe(true);
  });
});

describe("applyPatch", () => {
  it("merges by section and cleans", () => {
    const s = applyPatch(D(), { source: { cacheMinutes: 0, tabs: { aud: { name: "Pentests" } } }, rules: { rules: { "co.review": { months: 6 } } } });
    expect(s.source.cacheMinutes).toBe(1);
    expect(s.source.tabs.aud.name).toBe("Pentests");
    expect(s.source.tabs.aud.pick).toBe("latest");
    expect(s.rules.rules["co.review"]).toEqual({ months: 6 });
  });

  it("does not change its input", () => {
    const base = D();
    const copy = JSON.stringify(base);
    applyPatch(base, { display: { theme: "dark" } });
    expect(JSON.stringify(base)).toBe(copy);
  });

  it("is order-insensitive", () => {
    const patch = {
      source: { cacheMinutes: 20, tabs: { ciat: { name: "C2" }, apps: { name: "A2" } } },
      display: { theme: "dark", hideEol: true },
      fields: { owner: { header: "Own" }, name: { header: "Nom" } },
      rules: { rules: { "pl.eol": { on: false }, "co.review": { months: 3 } } },
    };
    // The same patch with every object's keys in reversed, then rotated, order.
    const reorder = (v: unknown, mode: number): unknown => {
      if (Array.isArray(v) || typeof v !== "object" || v === null) return v;
      let keys = Object.keys(v);
      keys = mode === 0 ? keys.reverse() : [...keys.slice(mode % keys.length), ...keys.slice(0, mode % keys.length)];
      return Object.fromEntries(keys.map((k) => [k, reorder((v as Record<string, unknown>)[k], mode)]));
    };
    const first = applyPatch(D(), patch);
    for (const mode of [0, 1, 2, 3]) expect(applyPatch(D(), reorder(patch, mode))).toEqual(first);
    expect(first.source.tabs.ciat.name).toBe("C2");
    expect(first.fields.name.header).toBe("Nom");
    expect(first.rules.rules["pl.eol"]!.on).toBe(false);
  });

  it("applying two disjoint patches in either order agrees", () => {
    const p1 = { display: { theme: "dark" } };
    const p2 = { source: { cacheMinutes: 30 } };
    expect(applyPatch(applyPatch(D(), p1), p2)).toEqual(applyPatch(applyPatch(D(), p2), p1));
  });

  it("ignores prototype pollution and garbage patches", () => {
    const s = applyPatch(D(), JSON.parse('{"__proto__":{"polluted":1},"display":{"__proto__":{"x":1},"theme":"light"}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(s.display.theme).toBe("light");
    expect(applyPatch(D(), null)).toEqual(D());
    expect(applyPatch(D(), "x")).toEqual(D());
    expect(applyPatch(D(), { rules: 5 })).toEqual(D());
  });

  it("replaces tier arrays instead of merging", () => {
    expect(applyPatch(D(), { rules: { rules: { "ct.drpMissing": { tiers: [3] } } } }).rules.rules["ct.drpMissing"]!.tiers).toEqual([3]);
  });

  it("reports changed sections and sheet id changes", () => {
    const a = D();
    const b = applyPatch(a, { fields: { owner: { header: "X" } }, display: { hideEol: true } });
    expect(changedSections(a, b)).toEqual(["fields", "display"]);
    expect(patchTouchesSheetId({ source: { sheetId: "x" } })).toBe(true);
    expect(patchTouchesSheetId({ source: { cacheMinutes: 5 } })).toBe(false);
    expect(patchTouchesSheetId(null)).toBe(false);
  });
});

describe("sectionBytes", () => {
  it("counts UTF-8 bytes", () => {
    expect(sectionBytes("abc")).toBe(5);
    expect(sectionBytes("é")).toBe(4);
    expect(sectionBytes("€")).toBe(5);
    expect(sectionBytes("😀")).toBe(6);
  });
});

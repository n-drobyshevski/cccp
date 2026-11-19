// The settings draft kernel (src/client/pages/settings/formKernel.js), formerly the vendored
// settingsForm and its vendored contract; the contract's assertions now live here as an app test.
// Part one runs the kernel against a small synthetic registry (so the behaviour is pinned apart
// from CCCP's own names); part two checks CCCP's own registry is well-formed and that the
// kernel is reached by its app-owned path, never through the vendored tree.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { settingsForm } from "../../src/client/pages/settings/formKernel.js";
import { DEFAULT_TAB, SETTINGS_TABS, SETTING_FIELDS } from "../../src/client/pages/settings/draft.js";

const TABS = [
  { key: "alpha", label: "Alpha" },
  { key: "beta", label: "Beta" },
  { key: "gamma", label: "Gamma" },
];
const FIELDS = {
  one: { tab: "alpha", label: "One" },
  two: { tab: "alpha", label: "Two" },
  three: { tab: "beta", label: "Three" },
};
const KERNEL = settingsForm({ tabs: TABS, fields: FIELDS, defaultTab: "alpha" });
const app = "CCCP";
const tabs = SETTINGS_TABS;
const fields = SETTING_FIELDS;

describe(app + ": the settings registry is well-formed", () => {
  it("names a real tab for every field", () => {
    const tabKeys = tabs.map((t) => t.key);
    for (const [field, meta] of Object.entries(fields)) {
      expect(tabKeys, field + " names a tab that does not exist").toContain(meta.tab);
    }
  });

  it("has no two tabs sharing a key", () => {
    const keys = tabs.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every tab and every field a non-empty label", () => {
    for (const t of tabs) expect(typeof t.label === "string" && t.label.length > 0, t.key).toBe(true);
    for (const [field, meta] of Object.entries(fields)) expect(typeof meta.label === "string" && meta.label.length > 0, field).toBe(true);
  });

  it("throws on a field naming no tab and on a default tab that does not exist", () => {
    const tabKeys = tabs.map((t) => t.key);
    expect(() => settingsForm({ tabs, fields: { ...fields, __bogus: { tab: "nope-not-real", label: "x" } }, defaultTab: tabKeys[0] })).toThrow(/names tab/);
    expect(() => settingsForm({ tabs, fields, defaultTab: "nope-not-real" })).toThrow(/defaultTab/);
    expect(DEFAULT_TAB).toBe("source");
  });
});

describe(app + ": nothing in the client reaches the vendored settings kernel", () => {
  it("draft.js imports the app-owned formKernel and the kit guard", () => {
    const src = readFileSync(new URL("../../src/client/pages/settings/draft.js", import.meta.url), "utf8");
    expect(src).toMatch(/from\s+["']\.\/formKernel\.js["']/);
    expect(src).toMatch(/from\s+["']@gas-kit\/client\/unsaved\.js["']/);
    expect(src).not.toMatch(/gas_shared/);
  });
});

  // ---------------------------------------------------------------- the kernel's own behaviour
  describe(app + ": the settings kernel's behaviour, against a synthetic registry", () => {
    it("changedFields is order-insensitive for arrays — re-picking a set is not an edit", () => {
      const saved = { one: ["a", "b"], two: 1, three: "x" };
      const draft = { one: ["b", "a"], two: 1, three: "x" };
      expect(KERNEL.changedFields(saved, draft)).toEqual([]);
    });

    it("changedFields reports what actually moved, in registry order", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      const draft = { one: ["a"], two: 2, three: "y" };
      expect(KERNEL.changedFields(saved, draft)).toEqual(["two", "three"]);
    });

    it("settingsPatch carries only the changed keys, with their draft values", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      const draft = { one: ["a"], two: 5, three: "x" };
      expect(KERNEL.settingsPatch(saved, draft)).toEqual({ two: 5 });
    });

    it("settingsPatch is empty when nothing moved", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      expect(KERNEL.settingsPatch(saved, { ...saved })).toEqual({});
    });

    it("changeSummary names the owning tab and its label for each change", () => {
      expect(KERNEL.changeSummary(["two", "three"])).toEqual([
        { field: "two", label: "Two", tab: "alpha", tabLabel: "Alpha" },
        { field: "three", label: "Three", tab: "beta", tabLabel: "Beta" },
      ]);
    });

    it("changeSummary silently drops a key the registry does not own", () => {
      // Defensive rather than vacuous — see settingsForm.js's own header for the app this
      // matters to (gas_devsecops's `showExperimental`, part of its draft but no batched tab).
      expect(KERNEL.changeSummary(["two", "not-a-real-field"])).toEqual([
        { field: "two", label: "Two", tab: "alpha", tabLabel: "Alpha" },
      ]);
    });

    it("changeCountText takes the array and pluralizes on its length", () => {
      expect(KERNEL.changeCountText([])).toBe("0 unsaved changes");
      expect(KERNEL.changeCountText(["one"])).toBe("1 unsaved change");
      expect(KERNEL.changeCountText(["one", "two"])).toBe("2 unsaved changes");
    });

    it("tabStatus marks dirty and invalid independently", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      const dirtyOnly = KERNEL.tabStatus({ ...saved, two: 2 }, saved, {}, KERNEL.TAB_FIELDS);
      expect(dirtyOnly.alpha).toEqual({ dirty: true, invalid: false });
      const invalidOnly = KERNEL.tabStatus(saved, saved, { two: "bad" }, KERNEL.TAB_FIELDS);
      expect(invalidOnly.alpha).toEqual({ dirty: false, invalid: true });
    });

    it("tabStatus never mentions a tab owning no batched field", () => {
      const saved = { one: ["a"], two: 1, three: "x" };
      const status = KERNEL.tabStatus(saved, saved, {}, KERNEL.TAB_FIELDS);
      expect(status.gamma).toBeUndefined();
    });

    it("normalizeTab falls back to the default for a tab that does not exist", () => {
      expect(KERNEL.normalizeTab("nonsense")).toBe("alpha");
      expect(KERNEL.normalizeTab(undefined)).toBe("alpha");
    });

    it("normalizeTab's two-argument form rejects a tab the caller did not build", () => {
      expect(KERNEL.normalizeTab("beta", ["alpha", "gamma"])).toBe("alpha");
      expect(KERNEL.normalizeTab("beta", ["alpha", "beta"])).toBe("beta");
    });

    it("sameValue treats two NaN fields as unchanged, and a NaN against null as changed", () => {
      // THE LEAF THIS KERNEL RESOLVES TO, over the three predecessors' three different wrong
      // answers — see settingsForm.js's own header for gas_ai's reachable `Number("1e400")`
      // case. `JSON.stringify(NaN)`/`JSON.stringify(Infinity)`/`JSON.stringify(null)` are all
      // `"null"`, so a JSON.stringify-fallback leaf (gas's/gas_ai's old sameValue) reads NaN
      // and null as equal; a bare `a === b` leaf (gas_devsecops's old sameFieldValue) reads two
      // matching NaNs as different. `Object.is` closes exactly the first gap without reopening
      // the second.
      expect(KERNEL.sameValue(Number.NaN, Number.NaN)).toBe(true);
      expect(KERNEL.sameValue(Number.NaN, null)).toBe(false);
      expect(KERNEL.sameValue(Number.NaN, Infinity)).toBe(false);
    });

    it("sameValue recurses into an object, order-insensitive on its nested arrays", () => {
      // gas's own sameValue never grew this branch (nothing it owns needed it — see
      // settingsForm.js's header); gas_ai's and gas_devsecops's `fiveRsPins`/`slaTargets`-shaped
      // fields do, so the kernel carries it for every app that binds it, not just the two that
      // exercise it today.
      const a = { in: ["p1", "p2"], out: ["p3"] };
      const b = { in: ["p2", "p1"], out: ["p3"] };
      expect(KERNEL.sameValue(a, b)).toBe(true);
      expect(KERNEL.sameValue(a, { in: ["p1"], out: ["p3"] })).toBe(false);
    });

    // ====================================================================== perturbation
    it("a truthiness read of errors instead of key presence silently un-invalidates a tab "
      + "whose field carries a falsy-but-present error", () => {
      const saved = { one: ["a"], two: 1, three: "x" };

      // THE WRONG VERSION, reproduced rather than described: `if (errors[field])` instead of
      // `Object.prototype.hasOwnProperty.call(errors, field)`. Everything else is copied from
      // settingsForm.js's own tabStatus so the only variable is the one line under test.
      function defectiveTabStatus(draft, savedSnapshot, errors, tabFields) {
        const out = {};
        for (const tab of new Set(Object.values(tabFields))) out[tab] = { dirty: false, invalid: false };
        for (const [field, tab] of Object.entries(tabFields)) {
          if (!out[tab]) continue;
          if (!KERNEL.sameValue(savedSnapshot[field], draft[field])) out[tab].dirty = true;
          if (errors[field]) out[tab].invalid = true; // THE BUG: truthiness, not presence
        }
        return out;
      }

      // A field "cleared" the way a caller is contractually forbidden to (a falsy placeholder
      // left in place instead of the key being deleted) — see tabStatus's own header.
      const errors = { two: "" };
      const defective = defectiveTabStatus(saved, saved, errors, KERNEL.TAB_FIELDS);
      expect(defective.alpha.invalid).toBe(false); // the bug: misses the present-but-falsy key

      const real = KERNEL.tabStatus(saved, saved, errors, KERNEL.TAB_FIELDS);
      expect(real.alpha.invalid).toBe(true); // the shipped implementation does not miss it
    });
  });

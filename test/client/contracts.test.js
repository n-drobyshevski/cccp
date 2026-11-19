// What Settings → Access must never lose silently, pinned against the Access tab's own source and
// the kit's notKept. Formerly the vendored accessSave contract (and the vendored settingsForm
// contract, which is now test/client/formKernel.test.js).
//
// The bug this pins: an owner typed a new admin's address, clicked "Save access" without pressing
// Add, and was told "Access updated." although no call had run and the address was gone on the
// next reload.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notKept } from "@gas-kit/ui/components/accessModel.js";

const editorSrc = readFileSync(new URL("../../src/client/pages/settings/access.js", import.meta.url), "utf8");

describe("access save: notKept names what the server did not keep (the kit's)", () => {
  it("is empty when every sent address came back", () => {
    expect(notKept(["a@x.com", "b@x.com"], ["b@x.com", "a@x.com", "c@x.com"])).toEqual([]);
    expect(notKept([], ["a@x.com"])).toEqual([]);
  });

  it("names each missing address, ignoring case and stray whitespace", () => {
    expect(notKept(["A@x.com ", "new@x.com"], ["a@x.com"])).toEqual(["new@x.com"]);
    expect(notKept(["new@x.com"], null)).toEqual(["new@x.com"]);
  });

  it("does what the vendored helper did on its own edge cases", () => {
    // blanks and null entries in the sent list are not 'missing'; a stored list with blanks is read leniently
    expect(notKept(["", null, " "], ["a@x.com"])).toEqual([]);
    expect(notKept(["a@x.com"], ["", " A@X.com "])).toEqual([]);
    expect(notKept(null, null)).toEqual([]);
  });
});

describe("access save: the editor cannot drop an edit without saying so", () => {
  const fn = editorSrc.slice(editorSrc.indexOf("async function save("));

  it("flushes typed-but-not-added addresses before deciding whether anything changed", () => {
    const flush = fn.indexOf("addInputs.values()");
    expect(flush).toBeGreaterThan(-1);
    expect(flush).toBeLessThan(fn.indexOf("No changes to save."));
    // A bad address stops the save rather than being skipped over.
    expect(fn).toMatch(/if \(!commit\([^)]*\)\) return;/);
  });

  it("never claims a save that did nothing", () => {
    const noop = fn.slice(fn.indexOf("No changes to save."), fn.indexOf("No changes to save.") + 80);
    expect(noop).toMatch(/return;/);
    // "Access updated." is only said after the fresh read, on the all-kept branch.
    expect(fn.indexOf('toast("Access updated."')).toBeGreaterThan(fn.indexOf('rpc.call("getAccess")'));
    expect(fn).toContain("notKept(");
  });

  it("asks before a reload throws unsaved edits away, with the kit guard", () => {
    expect(editorSrc).toMatch(/from "@gas-kit\/client\/unsaved\.js"/);
    expect(editorSrc).toMatch(/guardUnsaved\(\w+, \(\) => [^;]*typedButNotAdded\(\)\)/);
    expect(editorSrc).not.toMatch(/gas_shared|vendor\//);
  });

  it("drops the guard when the page is torn down", () => {
    // guardUnsaved returns its disposer; the controller keeps it with the other listeners.
    expect(editorSrc).toMatch(/offs\.push\(guardUnsaved\(/);
    expect(editorSrc).toMatch(/dispose\(\) \{ offs\.forEach\(\(f\) => f\(\)\); \}/);
  });

  it("says Access updated only after the fresh read", () => {
    expect(fn.indexOf('rpc.call("getAccess")')).toBeGreaterThan(-1);
    expect(fn.indexOf('toast("Access updated."')).toBeGreaterThan(fn.indexOf('rpc.call("getAccess")'));
  });
});

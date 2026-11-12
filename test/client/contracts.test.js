// The vendored contracts, run against this app's own registries: the settings draft kernel
// (settingsForm) and the access save helpers.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { registerAccessSaveContract } from "../../src/vendor/gas_shared/test/contracts/accessSave.js";
import { registerSettingsFormContract } from "../../src/vendor/gas_shared/test/contracts/settingsForm.js";
import { DEFAULT_TAB, SETTINGS_TABS, SETTING_FIELDS } from "../../src/client/pages/settings/draft.js";

registerSettingsFormContract({
  describe,
  it,
  expect,
  appRoot: new URL("../../", import.meta.url),
  app: "CCCP",
  tabs: SETTINGS_TABS,
  fields: SETTING_FIELDS,
  defaultTab: DEFAULT_TAB,
  settingsModelPath: "src/client/pages/settings/draft.js",
  // CCCP's tablist is Data source, Field mapping, Status rules, Access, Display: not the
  // Register-first spine of the sidekick registers.
  spine: false,
});

// The access save contract, against the Access tab's own source. The contract looks for the
// sidekick call spelling (call("api_getAccess")) only to order two strings; CCCP's rpc seam names
// the endpoint without the api_ prefix, which the ordering check tolerates (see the test below).
registerAccessSaveContract({
  describe,
  it,
  expect,
  editorSrc: readFileSync(new URL("../../src/client/pages/settings/access.js", import.meta.url), "utf8"),
});

describe("CCCP: the access editor says Access updated only after the fresh read", () => {
  const src = readFileSync(new URL("../../src/client/pages/settings/access.js", import.meta.url), "utf8");
  const fn = src.slice(src.indexOf("async function save("));
  it("reads getAccess again before the success toast", () => {
    expect(fn.indexOf('rpc.call("getAccess")')).toBeGreaterThan(-1);
    expect(fn.indexOf('toast("Access updated."')).toBeGreaterThan(fn.indexOf('rpc.call("getAccess")'));
  });
});

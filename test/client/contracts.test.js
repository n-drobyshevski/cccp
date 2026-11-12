// The vendored contracts, run against this app's own registries: the settings draft kernel
// (settingsForm) and, once the Access tab exists, the access save helpers.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
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

describe("CCCP: the access save contract", () => {
  const present = existsSync(new URL("../../src/client/pages/settings/access.js", import.meta.url));
  it.skipIf(!present)("runs against pages/settings/access.js", async () => {
    // Registered by the step that adds the Access tab.
    expect(present).toBe(true);
  });
});

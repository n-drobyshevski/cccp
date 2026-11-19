import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { kitAliases } from "./tools/kitPaths.mjs";

// Layers as in CLAUDE.md (domain, server, client, build). Dates are computed in UTC so the suites
// do not depend on the machine's zone; the *.tz.test.* files run a second time under
// Pacific/Kiritimati (UTC+14), where a date-only string fed to new Date() lands on the wrong day.
// '@gas-kit/*' resolves to the vendored kit (src/kit), as in the build.
const root = fileURLToPath(new URL(".", import.meta.url));
const kit = kitAliases(root);
const ext = "?([cm])[jt]s";
// include and exclude also sit in the shared block, so a run where the projects do not apply never
// falls back to vitest's default include, which would load the Playwright specs in e2e/.
const common = { testTimeout: 30_000, hookTimeout: 30_000, passWithNoTests: true, environment: "node" as const, include: ["test/**/*.test." + ext], exclude: ["**/node_modules/**", "e2e/**"] };

export default defineConfig({
  resolve: { alias: kit },
  test: {
    ...common,
    env: { TZ: "UTC" },
    projects: [
      { resolve: { alias: kit }, test: { ...common, name: "domain", include: ["test/domain/**/*.test." + ext], env: { TZ: "UTC" } } },
      { resolve: { alias: kit }, test: { ...common, name: "server", include: ["test/server/**/*.test." + ext], env: { TZ: "UTC" } } },
      { resolve: { alias: kit }, test: { ...common, name: "client", include: ["test/client/**/*.test." + ext], env: { TZ: "UTC" } } },
      { resolve: { alias: kit }, test: { ...common, name: "build", include: ["test/build/**/*.test." + ext, "test/contracts.test.ts"], env: { TZ: "UTC" } } },
      { resolve: { alias: kit }, test: { ...common, name: "kiritimati", include: ["test/**/*.tz.test." + ext], env: { TZ: "Pacific/Kiritimati" } } },
    ],
  },
});

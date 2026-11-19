import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { kitAliases } from "./tools/kitPaths.mjs";

// Layers as in CLAUDE.md (domain, server, client, build). Dates are computed in UTC so the suites
// do not depend on the machine's zone; the *.tz.test.* files run a second time under
// Pacific/Kiritimati (UTC+14), where a date-only string fed to new Date() lands on the wrong day.
// '@gas-kit/*' resolves to the vendored kit (src/kit), as in the build.
const root = fileURLToPath(new URL(".", import.meta.url));
const kit = kitAliases(root);
const common = { testTimeout: 30_000, hookTimeout: 30_000, passWithNoTests: true, environment: "node" as const };
const ext = "?([cm])[jt]s";

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

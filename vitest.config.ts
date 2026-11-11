import { defineConfig } from "vitest/config";

// Four projects, one per layer (see CLAUDE.md). Dates are always computed in UTC so the
// suites do not depend on the machine's zone. Later work packages add test/gasEnv.ts as the
// setup file of the server project.
const common = { testTimeout: 30_000, hookTimeout: 30_000, passWithNoTests: true };

export default defineConfig({
  test: {
    ...common,
    env: { TZ: "UTC" },
    projects: [
      { test: { ...common, name: "domain", environment: "node", include: ["test/domain/**/*.test.?([cm])[jt]s"], env: { TZ: "UTC" } } },
      { test: { ...common, name: "server", environment: "node", include: ["test/server/**/*.test.?([cm])[jt]s"], env: { TZ: "UTC" } } },
      { test: { ...common, name: "client", environment: "node", include: ["test/client/**/*.test.?([cm])[jt]s"], env: { TZ: "UTC" } } },
      { test: { ...common, name: "build", environment: "node", include: ["test/build/**/*.test.?([cm])[jt]s"], env: { TZ: "UTC" } } },
    ],
  },
});

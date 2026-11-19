// Extracted from the author's production Apps Script apps; adapted.
//
// Where the kit lives, for every tool that needs it (build, dev server, vitest, ESLint).
//
// The kit is vendored at src/kit/<pkg>/ (the src folder of each package), pinned by kit.lock.json.
// The app never reaches outside its own folder. Update it with npm run kit:sync.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const KIT_PACKAGES = ["server", "client", "ui", "tooling"];

/** The app root: the folder above tools/. */
export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The src folder of each kit package, absolute.
 * @param {string} [root] the app root
 * @returns {Record<string, string>} package name to its src directory
 */
export function kitDirs(root = APP_ROOT) {
  const vendored = join(root, "src", "kit");
  return Object.fromEntries(KIT_PACKAGES.map((p) => [p, join(vendored, p, "src")]));
}

/**
 * The esbuild and vitest alias map: "@gas-kit/<pkg>" to its src directory. A prefix match, so
 * both the bare name and "@gas-kit/client/html.js" resolve.
 * @param {string} [root]
 * @returns {Record<string, string>}
 */
export function kitAliases(root = APP_ROOT) {
  const dirs = kitDirs(root);
  return Object.fromEntries(KIT_PACKAGES.map((p) => ["@gas-kit/" + p, dirs[p]]));
}

/**
 * Import a node-side kit module by its path under a package's src, for example
 * kitImport("tooling", "build/defineBuild.mjs").
 * @param {string} pkg
 * @param {string} rel
 * @param {string} [root]
 */
export function kitImport(pkg, rel, root = APP_ROOT) {
  return import(pathToFileURL(join(kitDirs(root)[pkg], rel)).href);
}

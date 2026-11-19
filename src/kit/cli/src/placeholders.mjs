// The placeholder rewrite: pure functions from a template file's text to the scaffolded text.
// A marker that is not found is an error, so a drifting template fails loudly in the CLI tests.
import { deriveBrand } from "./color.mjs";
import { TEMPLATE } from "./values.mjs";

/**
 * Replace one match of a pattern, or throw.
 * @param {string} text @param {RegExp} re @param {string | ((...a: string[]) => string)} to @param {string} what
 */
function must(text, re, to, what) {
  if (!re.test(text)) throw new Error("template marker not found: " + what);
  return text.replace(re, /** @type {any} */ (to));
}

/** @param {string} s */
const q = (s) => JSON.stringify(s);

/** The data class create writes: confidential with --confidential (or a yes at the prompt), else internal. @param {import("./values.mjs").Values} v */
export const dataClassOf = (v) => (v.confidential ? "confidential" : "internal");

/**
 * @param {Record<string, string>} t
 * @returns {string}
 */
function brandLine(t) {
  return "{ accent: " + q(t.accent) + ", accentInk: " + q(t.accentInk) + ", accentSoft: " + q(t.accentSoft) + ", mark: " + q(t.mark) + ", markInk: " + q(t.markInk) + " }";
}

/**
 * The brand to write for an accent, or null when it is the template's own.
 * @param {string} accent
 */
export function brandFor(accent) {
  return accent.toLowerCase() === TEMPLATE.accent ? null : deriveBrand(accent);
}

/** @param {string} text @param {import("./values.mjs").Values} v */
export function rewriteAppConfig(text, v) {
  let t = text;
  t = must(t, /^(\s*name: )"[^"]*",/m, (_m, a) => a + q(v.product) + ",", "app.config name");
  t = must(t, /^(\s*product: )"[^"]*",/m, (_m, a) => a + q(v.product) + ",", "app.config product");
  t = must(t, /^(\s*storagePrefix: )"[^"]*",/m, (_m, a) => a + q(v.prefix) + ",", "app.config storagePrefix");
  t = must(t, /^(\s*timeZone: )"[^"]*",/m, (_m, a) => a + q(v.tz) + ",", "app.config timeZone");
  t = must(t, /^(\s*accessDefault: )"[^"]*",/m, (_m, a) => a + q(v.access) + ",", "app.config accessDefault");
  t = must(t, /^(\s*dataClass: )"[^"]*",/m, (_m, a) => a + q(dataClassOf(v)) + ",", "app.config dataClass");
  const brand = brandFor(v.accent);
  if (brand) {
    t = must(t, /^(\s*light: )\{[^}]*\},/m, (_m, a) => a + brandLine(brand.light) + ",", "app.config brand.light");
    t = must(t, /^(\s*dark: )\{[^}]*\},/m, (_m, a) => a + brandLine(brand.dark) + ",", "app.config brand.dark");
  }
  return t;
}

/** @param {string} text @param {import("./values.mjs").Values} v */
export function rewriteServerConfig(text, v) {
  let t = text;
  t = must(t, /^(export const PRODUCT = )"[^"]*";/m, (_m, a) => a + q(v.product) + ";", "server PRODUCT");
  t = must(t, /^(export const CACHE_PREFIX = )"[^"]*";/m, (_m, a) => a + q(v.prefix.slice(0, -1)) + ";", "server CACHE_PREFIX");
  t = must(t, /^(export const ACCESS_DEFAULT = )"[^"]*"( as const;)/m, (_m, a, b) => a + q(v.access) + b, "server ACCESS_DEFAULT");
  t = must(t, /^(export const DATA_CLASS: DataClass = )"[^"]*";/m, (_m, a) => a + q(dataClassOf(v)) + ";", "server DATA_CLASS");
  return t;
}

/** @param {string} text @param {import("./values.mjs").Values} v */
export function rewriteClientConfig(text, v) {
  let t = text;
  t = must(t, /^(export const PRODUCT = )"[^"]*";/m, (_m, a) => a + q(v.product) + ";", "client PRODUCT");
  t = must(t, /^(export const PREFIX = )"[^"]*";/m, (_m, a) => a + q(v.prefix) + ";", "client PREFIX");
  return t;
}

/** @param {string} text @param {import("./values.mjs").Values} v */
export function rewriteIndexHtml(text, v) {
  let t = text;
  t = must(t, /<title>[^<]*<\/title>/, () => "<title>" + v.product + "</title>", "index.html title");
  t = must(t, /localStorage\.getItem\("[^"]*\.theme"\)/, () => 'localStorage.getItem("' + v.prefix + 'theme")', "index.html theme key");
  t = must(t, /localStorage\.getItem\("[^"]*\.motion"\)/, () => 'localStorage.getItem("' + v.prefix + 'motion")', "index.html motion key");
  t = must(t, /(<b class="boot__name">)[^<]*(<\/b>)/, (_m, a, b) => a + v.product + b, "index.html splash name");
  return t;
}

/** The app's own tests repeat the product name; keep them equal to the config. @param {string} text @param {import("./values.mjs").Values} v */
export function rewriteTestFile(text, v) {
  return text.split(TEMPLATE.product).join(v.product);
}

/** The template test insists on a prefix without hyphens; the CLI allows them. @param {string} text */
export function rewriteStaticTest(text) {
  return text.split("[a-z][a-z0-9]*\\.$/").join("[a-z][a-z0-9-]*\\.$/");
}

/**
 * The template's server tests assume the default mode is "list"; pin it when the app's default differs.
 * @param {string} text @param {import("./values.mjs").Values} v
 */
export function rewriteServerHelpers(text, v) {
  if (v.access === "list") return text;
  return must(text, /^(\s*p\.setProperty\("ALLOWED_USERS", .*\n)/m, (_m, a) => a + '  p.setProperty("ACCESS_MODE", "list");\n', "test/server/helpers.ts ALLOWED_USERS line");
}

/** @param {string} text @param {import("./values.mjs").Values} v */
export function rewriteManifest(text, v) {
  return must(text, /("timeZone": )"[^"]*"/, (_m, a) => a + q(v.tz), "appsscript timeZone");
}

/**
 * Add the kit scripts, set the name, optionally drop e2e.
 * @param {string} text @param {import("./values.mjs").Values} v
 */
export function rewritePackageJson(text, v) {
  const pkg = JSON.parse(text);
  pkg.name = v.name;
  pkg.scripts = { ...pkg.scripts };
  pkg.scripts["kit:verify"] = "node src/kit/cli/src/bin.mjs kit:verify";
  pkg.scripts["kit:sync"] = "node src/kit/cli/src/bin.mjs kit:sync";
  pkg.scripts["kit:diff"] = "node src/kit/cli/src/bin.mjs kit:diff";
  // A scaffolded app's check also proves the vendored kit is untouched.
  if (typeof pkg.scripts.check === "string" && !/kit:verify/.test(pkg.scripts.check)) pkg.scripts.check += " && npm run kit:verify";
  if (!v.e2e) {
    // @playwright/test stays: the verify-ui skill's screenshot script imports it.
    delete pkg.scripts.e2e;
  }
  return JSON.stringify(pkg, null, 2) + "\n";
}

/** Drop the second (packages fallback) element of every tsconfig paths entry. @param {string} text */
export function stripPathFallbacks(text) {
  const out = text.replace(/,\s*"(?:\.\.\/)+packages\/[^"]*"/g, "");
  JSON.parse(out);
  return out;
}

const KITPATHS_HEADER = /\/\/ Where the kit lives[\s\S]*?\/\/ kitDirs\(\) answers the first that exists, so the same files run in both places\.\n/;
const KITPATHS_BODY = /  const vendored = join\(root, "src", "kit"\);\n[\s\S]*?  return Object\.fromEntries\(KIT_PACKAGES\.map\(\(p\) => \[p, base\(p\)\]\)\);\n/;

/** kitPaths.mjs without the monorepo fallback: the kit is always src/kit. @param {string} text */
export function rewriteKitPaths(text) {
  let t = must(
    text,
    KITPATHS_HEADER,
    "// Where the kit lives, for every tool that needs it (build, dev server, vitest, ESLint).\n//\n// The kit is vendored at src/kit/<pkg>/ (the src folder of each package), pinned by kit.lock.json.\n// The app never reaches outside its own folder. Update it with npm run kit:sync.\n",
    "kitPaths header",
  );
  t = must(t, KITPATHS_BODY, '  const vendored = join(root, "src", "kit");\n  return Object.fromEntries(KIT_PACKAGES.map((p) => [p, join(vendored, p, "src")]));\n', "kitPaths body");
  t = must(t, /import \{ existsSync \} from "node:fs";\n/, "", "kitPaths existsSync import");
  return t;
}

/** Remove the e2e steps from the CI workflow, and add kit:verify after the check step. @param {string} text @param {boolean} e2e */
export function rewriteCi(text, e2e) {
  let t = must(text, /^(\s*- run: npm run check\n)/m, (_m, a) => a + "      - run: npm run kit:verify\n", "ci check step");
  if (!e2e) {
    const i = t.indexOf("      - name: Install the browser");
    if (i === -1) throw new Error("template marker not found: ci browser step");
    t = t.slice(0, i);
  }
  return t;
}

/** @param {string} text @param {import("./values.mjs").Values} v */
export function rewriteReadme(text, v) {
  let t = text;
  t = must(t, /It is built on the gas-kit packages[\s\S]*?replaces\./, () => "It is built on the gas-kit packages (server kernel, client kernel, UI components, tooling), vendored in `src/kit/`.", "README kit paragraph");
  t = must(
    t,
    /The kit is found in[\s\S]*?list both places\./,
    () => "The kit is vendored in `src/kit/<pkg>/` and pinned by `kit.lock.json`; `tools/kitPaths.mjs` resolves it for the\nbuild, the dev server, vitest and ESLint. Do not edit files under `src/kit`: `npm run kit:verify` fails when a file no\nlonger matches its hash in the lock, and `npm run kit:verify -- --upstream` also fetches the kit repository at\nthe locked commit and fails on any difference (an edit made together with its lock hash included). Preview a\nnewer kit with `npm run kit:diff` and take it with `npm run kit:sync -- --ref <tag | full commit>`. Both take the\nkit from `-- --from <kit checkout | git URL#ref>` when given, else from `GAS_KIT` when it is set, else from\nthe kit's git URL remembered in `kit.lock.json` (`kit.remote`).",
    "README kit resolution paragraph",
  );
  t = t.split(TEMPLATE.product).join(v.product);
  t = t.split("`" + TEMPLATE.prefix + "`").join("`" + v.prefix + "`");
  t = t.replace(/^(\| `npm run deploy` .*\n)/m, (_m, a) => a + "| `npm run kit:verify` | checks that `src/kit` still matches `kit.lock.json` |\n| `npm run kit:diff` | shows how the vendored kit differs from the kit source: the remembered git URL, `GAS_KIT`, or `-- --from <kit checkout \\| git URL#ref>` |\n| `npm run kit:sync` | re-vendors the kit from that source and rewrites the lock (`-- --ref <tag>` picks a version) |\n");
  if (!v.e2e) t = dropE2eReferences(t);
  if (v.source === "none") t = must(t, /Set the `SOURCE_SHEET_ID` Script Property and the app reads\nthat workbook\./, (m) => "The app was scaffolded with `--source none`, so `SOURCE_SHEET_ID` starts unset. " + m, "README source paragraph");
  return t;
}

/**
 * Remove every mention of the removed `npm run e2e` script (and the browser-suite section) from a
 * scaffold doc, so no instruction names a missing script.
 * @param {string} text
 */
export function dropE2eReferences(text) {
  return text
    .replace(/^\| `npm run e2e` .*\n/gm, "")
    .replace(/\n## The browser suite\n[\s\S]*?(?=\n## )/, "")
    .replace(/^npm run e2e\n/gm, "")
    .replace(/; for a flow run `npm run e2e`/g, "")
    .replace(/ \(and `npm run e2e` when the change is a flow\)/g, "")
    .replace(/; `npm run e2e` passes/g, "")
    .replace(/, `npm run e2e`/g, "");
}

/** The app config names the package in a comment; keep it equal to package.json. @param {string} text @param {import("./values.mjs").Values} v */
export function rewriteConfigComment(text, v) {
  return text.replace(/\("register-app"\)/, "(" + q(v.name) + ")");
}

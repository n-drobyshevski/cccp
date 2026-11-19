// `create <dir>`: scaffold an app from templates/register with the kit vendored into src/kit.
import { execFileSync } from "node:child_process";
import { gitEnv } from "./git.mjs";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { UsageError } from "./args.mjs";
import { SKIP_TOP, walkFiles } from "./hash.mjs";
import * as ph from "./placeholders.mjs";
import { askAll, isInteractive } from "./prompt.mjs";
import { commitOf, kitVersion, originOf, remoteFromFlag, shareableRemote } from "./source.mjs";
import { CHECKS, checkYesNo, resolveValues, validateValues } from "./values.mjs";
import { assertNoLink, writeVendored } from "./vendor.mjs";

/** The kit checkout this CLI runs from: packages/cli/src/../../.. */
export function defaultKitRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Skipped when copying the template. @param {string} rel */
export function skipped(rel) {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  // Local, secret or generated files a maintainer may have in the template (its .gitignore lists them).
  if (base === ".clasp.json" || base === ".clasprc.json" || base.endsWith(".tsbuildinfo") || rel === ".claude/settings.local.json") return true;
  return rel.startsWith("dev/.cache/") || rel.startsWith("src/kit/") || rel === "kit.lock.json";
}

/**
 * @param {string} dir
 * @returns {boolean}
 */
function nonEmpty(dir) {
  return existsSync(dir) && readdirSync(dir).length > 0;
}

/**
 * @param {string} root @param {string} rel @param {(t: string) => string} fn
 */
function edit(root, rel, fn) {
  const p = join(root, rel);
  writeFileSync(p, fn(readFileSync(p, "utf8")));
}

/**
 * The real path of a target that may not exist yet: the nearest existing ancestor's realpath with the
 * missing tail joined back on.
 * @param {string} abs an absolute path
 * @returns {string}
 */
export function realTarget(abs) {
  /** @type {string[]} */
  const tail = [];
  let cur = abs;
  while (!existsSync(cur) && !isLink(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    tail.unshift(basename(cur));
    cur = up;
  }
  let real = cur;
  try {
    real = realpathSync(cur);
  } catch {
    // a dangling link or unreadable ancestor: compare the lexical path
  }
  return join(real, ...tail);
}

/** @param {string} p */
function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Case-folded on filesystems that are usually case-insensitive. @param {string} p */
function fold(p) {
  return process.platform === "darwin" || process.platform === "win32" ? p.toLowerCase() : p;
}

/**
 * True when one real path is the other or inside it.
 * @param {string} a @param {string} b
 */
function overlaps(a, b) {
  const x = fold(a) + sep;
  const y = fold(b) + sep;
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * Apply every placeholder rewrite to a copied template.
 * @param {string} root @param {import("./values.mjs").Values} v
 */
export function applyPlaceholders(root, v) {
  edit(root, "app.config.mjs", (t) => ph.rewriteConfigComment(ph.rewriteAppConfig(t, v), v));
  edit(root, "src/server/config.ts", (t) => ph.rewriteServerConfig(t, v));
  edit(root, "src/client/config.js", (t) => ph.rewriteClientConfig(t, v));
  edit(root, "src/client/index.html", (t) => ph.rewriteIndexHtml(t, v));
  edit(root, "src/gas/appsscript.json", (t) => ph.rewriteManifest(t, v));
  edit(root, "package.json", (t) => ph.rewritePackageJson(t, v));
  edit(root, "README.md", (t) => ph.rewriteReadme(t, v));
  for (const f of walkFiles(join(root, "test"))) {
    if (/\.(?:m?[jt]s)$/.test(f)) edit(root, "test/" + f, (t) => ph.rewriteTestFile(t, v));
  }
  edit(root, "test/server/helpers.ts", (t) => ph.rewriteServerHelpers(t, v));
  if (existsSync(join(root, "test/static.test.ts"))) edit(root, "test/static.test.ts", ph.rewriteStaticTest);
  for (const f of ["tsconfig.json", "tsconfig.client.json", "tsconfig.clienttest.json"]) edit(root, f, ph.stripPathFallbacks);
  edit(root, "tools/kitPaths.mjs", ph.rewriteKitPaths);
  if (existsSync(join(root, ".github/workflows/ci.yml"))) edit(root, ".github/workflows/ci.yml", (t) => ph.rewriteCi(t, v.e2e));
  if (!v.e2e) {
    rmSync(join(root, "e2e"), { recursive: true, force: true });
    rmSync(join(root, "playwright.config.mjs"), { force: true });
    for (const rel of ["AGENTS.md", "CLAUDE.md", ...walkFiles(join(root, ".claude")).filter((f) => f.endsWith(".md")).map((f) => ".claude/" + f)]) {
      if (existsSync(join(root, rel))) edit(root, rel, ph.dropE2eReferences);
    }
  }
}

/** A fixed identity only when the user has none configured. @param {string} cwd @returns {string[]} */
function gitIdentity(cwd) {
  /** @param {string} key */
  const get = (key) => {
    try {
      return execFileSync("git", ["config", key], { cwd, encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  const out = [];
  if (!get("user.name")) out.push("-c", "user.name=gas-kit");
  if (!get("user.email")) out.push("-c", "user.email=gas-kit@example.org");
  return out;
}

/**
 * The closing lines of create.
 * @param {string} target the directory as the user typed it
 * @param {string | null} kitRemote the kit remote written to the lock, if any
 * @param {boolean} [confidential] the app was scaffolded with --confidential
 * @returns {string[]}
 */
export function nextSteps(target, kitRemote, confidential = false) {
  return [
    "",
    "Next steps:",
    "  cd " + target,
    "  npm install",
    "  git add package-lock.json    commit the lockfile npm install wrote: CI installs exactly it with npm ci",
    "  npm run check          typecheck, lint and tests",
    "  npm run dev            dev server with fakes of the Apps Script services",
    "  npx clasp login        sign in to Apps Script",
    "                         (no browser on this machine, e.g. Cloud Shell: npx clasp login --no-localhost)",
    "  cp .clasp.json.example .clasp.json    then put your script id in it",
    "  npm run push           build, check, clasp push",
    ...(confidential
      ? [
          "  run setup() in the Apps Script editor, signed in as the deploying account: until it pins",
          "  the owner the app is closed to everyone, and it creates the audit sheet",
        ]
      : []),
    "",
    "The kit lives in src/kit and is pinned by kit.lock.json. Do not edit it:",
    "  npm run kit:verify     fails when a vendored file changed or app code strays into src/kit",
    ...(kitRemote
      ? ["  npm run kit:diff       see what a newer kit changes", "  npm run kit:sync       take the newer kit"]
      : [
          "  npm run kit:diff -- --from <kit checkout>    see what a newer kit changes",
          "  npm run kit:sync -- --from <kit checkout>    take the newer kit",
          "  or set GAS_KIT=<kit checkout> and leave --from out",
        ]),
  ];
}

/**
 * Scaffold. Returns the lines to print.
 * @param {{ positional: string[], flags: Record<string, string | boolean> }} parsed
 * @param {{ kitRoot?: string }} [opts]
 * @returns {Promise<string[]>}
 */
export async function runCreate(parsed, opts = {}) {
  const kitRoot = opts.kitRoot ?? defaultKitRoot();
  const target = parsed.positional[0];
  if (!target) throw new UsageError("create needs a directory: gas-kit create <dir>");
  const template = join(kitRoot, "templates", "register");
  if (!existsSync(join(template, "app.config.mjs"))) {
    throw new Error("templates/register was not found next to this CLI (" + kitRoot + "); run create from a gas-kit checkout");
  }
  const root = resolve(target);
  // Never scaffold into the kit checkout itself (or a folder holding it): --force would rewrite it.
  // Real paths, so a symlink into the kit (or a case variant on a case-insensitive disk) cannot dodge it.
  const kitAbs = realpathSync(resolve(kitRoot));
  if (isLink(root)) throw new UsageError(root + " is a symbolic link; scaffold into a real directory");
  const rootReal = realTarget(root);
  if (overlaps(rootReal, kitAbs)) {
    throw new UsageError(root + " is inside, or contains, the kit checkout " + kitAbs + "; scaffold somewhere else");
  }
  if (nonEmpty(root) && parsed.flags["force"] !== true) throw new UsageError(root + " is not empty; pass --force to scaffold into it anyway");

  const flags = { ...parsed.flags };
  // The kit repository teammates fetch from, remembered in the lock: --kit-remote, else this clone's origin.
  const kitRemote = typeof flags["kit-remote"] === "string" ? remoteFromFlag("--kit-remote", flags["kit-remote"]) : shareableRemote(originOf(kitRoot));
  const values = resolveValues(flags, basename(root));
  if (isInteractive() && flags["yes"] !== true) {
    const keys = /** @type {Array<"name" | "product" | "prefix" | "accent" | "confidential" | "access" | "tz">} */ (["name", "product", "prefix", "accent", "confidential", "access", "tz"]);
    const labels = { name: "App name (a slug)", product: "Product (display name)", prefix: "Storage prefix", accent: "Accent colour", confidential: "Will it hold confidential data? (yes or no)", access: "Access mode (list or org)", tz: "Time zone" };
    const checks = { ...CHECKS, confidential: checkYesNo };
    /** @param {Record<string, string>} answers */
    const now = (answers) => resolveValues({ ...flags, ...answers }, basename(root));
    // Each default is recomputed from the earlier answers (and the flags), so a typed name feeds the product and prefix.
    const asked = await askAll(
      keys
        .filter((k) => (k === "confidential" ? flags["confidential"] !== true : typeof flags[k] !== "string"))
        .map((k) => ({
          key: k,
          label: labels[k],
          check: checks[k],
          def: (/** @type {Record<string, string>} */ answers) => (k === "confidential" ? (now(answers).confidential ? "yes" : "no") : String(now(answers)[k])),
          // A confidential app is list-only: the access mode is not asked.
          skip: (/** @type {Record<string, string>} */ answers) => k === "access" && now(answers).confidential,
        })),
    );
    Object.assign(values, resolveValues({ ...flags, ...asked }, basename(root)));
  }
  validateValues(values);

  const rels = walkFiles(template, { skipTop: SKIP_TOP }).filter((rel) => !skipped(rel));
  // Never follow a symlink in the target: check every path create will write before writing any.
  if (existsSync(root)) for (const rel of [...rels, "src/kit", "kit.lock.json", ".npmrc", "src/client/styles/brand.css"]) assertNoLink(root, rel, { who: "create", hint: " or scaffold somewhere else" });
  mkdirSync(root, { recursive: true });
  for (const rel of rels) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(template, rel), join(root, rel));
  }
  writeVendored(root, { dir: kitRoot, version: kitVersion(kitRoot), commit: commitOf(kitRoot), source: "local checkout", remote: kitRemote });
  // The kit needs legacy-peer-deps for an npm resolver bug; without it a fresh npm install fails.
  if (!existsSync(join(root, ".npmrc"))) writeFileSync(join(root, ".npmrc"), "legacy-peer-deps=true\n");
  applyPlaceholders(root, values);

  const brandMod = await import(pathToFileURL(join(root, "tools", "brandCss.mjs")).href);
  const brand = ph.brandFor(values.accent);
  const brandPath = join(root, brandMod.BRAND_CSS_PATH);
  if (brand) writeFileSync(brandPath, brandMod.renderBrandCss(brand));

  /** @type {string[]} */
  const lines = [];
  if (values.git) {
    try {
      execFileSync("git", ["init", "-q"], { cwd: root, env: gitEnv(), stdio: "ignore" });
      execFileSync("git", ["add", "-A"], { cwd: root, env: gitEnv(), stdio: "ignore" });
      execFileSync("git", [...gitIdentity(root), "commit", "-q", "-m", "Scaffold " + values.name + " from gas-kit"], { cwd: root, env: gitEnv(), stdio: "ignore" });
      lines.push("Initialised a git repository with a first commit.");
    } catch (e) {
      lines.push("Could not make the git commit: " + /** @type {Error} */ (e).message);
    }
  }
  lines.unshift("Created " + values.product + " in " + root + " (kit " + kitVersion(kitRoot) + ", " + Object.keys(JSON.parse(readFileSync(join(root, "kit.lock.json"), "utf8")).files).length + " vendored files).");
  if (values.source === "none") lines.push("Source: none. The template has no separate no-source build, so SOURCE_SHEET_ID is simply left unset and the app shows its bundled sample until you set it.");
  if (kitRemote) lines.push("Kit source remembered: " + kitRemote + " (kit.remote in kit.lock.json; kit:sync and kit:diff fetch from it).");
  if (values.confidential) lines.push("Data class: confidential (list access only, owner pin required, no data in the page or the browser, exports for admins only, an audit sheet). dataClass in app.config.mjs and DATA_CLASS in src/server/config.ts say so.");
  lines.push(...nextSteps(target, kitRemote, values.confidential));
  return lines;
}

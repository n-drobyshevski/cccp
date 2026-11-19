// Hashing, the vendored file set and the lock file shape.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { gitView } from "./git.mjs";

/** The kit packages an app vendors, under src/kit/<pkg>/. */
export const VENDOR_PACKAGES = ["server", "client", "ui", "tooling", "cli"];

/** Extra top-level files vendored per package (besides src/ and package.json). */
export const EXTRA_FILES = { ui: ["components.json"] };

export const LOCK_FILE = "kit.lock.json";
export const KIT_DIR = "src/kit";

/** Build and tool output skipped at the top level of a template or kit package only. */
export const SKIP_TOP = new Set(["node_modules", ".DS_Store", "dist", "test-results", "playwright-report"]);

/**
 * Local, secret or generated names never vendored from a directory that is not a git checkout, at any
 * depth (a git checkout vendors its tracked files only).
 * @param {string} name a file or directory name
 */
export function skippedAnywhere(name) {
  return name === "node_modules" || name === ".DS_Store" || name === ".env" || name.startsWith(".env.") || name === ".clasp.json" || name === ".clasprc.json" || name.endsWith(".tsbuildinfo") || name === ".cache" || name === "coverage";
}

/**
 * The path under src/kit a kit-root-relative path vendors to, or null when it is not in the vendored
 * set (src/ and package.json of each vendored package, plus EXTRA_FILES). Mirrors vendorFiles.
 * @param {string} rel posix path relative to the kit root
 * @returns {string | null}
 */
export function vendoredKey(rel) {
  const m = /^packages\/([^/]+)\/(.+)$/.exec(rel);
  if (!m || !VENDOR_PACKAGES.includes(/** @type {string} */ (m[1]))) return null;
  const pkg = /** @type {string} */ (m[1]);
  const rest = /** @type {string} */ (m[2]);
  if (rest === "package.json" || (EXTRA_FILES[/** @type {keyof typeof EXTRA_FILES} */ (pkg)] ?? []).includes(rest)) return pkg + "/" + rest;
  if (!rest.startsWith("src/")) return null;
  const first = rest.slice(4).split("/")[0] ?? "";
  return SKIP_TOP.has(first) ? null : pkg + "/" + rest;
}

/** @param {string | Uint8Array} data @returns {string} */
export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Every file under a directory, as sorted posix paths relative to it. Symlinks are never followed:
 * they are pushed to `opts.links` when given, else they throw.
 * @param {string} dir
 * @param {{ skipTop?: Set<string>, links?: string[] }} [opts] skipTop names are skipped at the top level only
 * @returns {string[]}
 */
export function walkFiles(dir, opts = {}) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} sub */
  const go = (sub) => {
    for (const name of readdirSync(join(dir, sub)).sort()) {
      if (!sub && opts.skipTop?.has(name)) continue;
      const rel = sub ? sub + "/" + name : name;
      const st = lstatSync(join(dir, rel));
      if (st.isSymbolicLink()) {
        if (!opts.links) throw new Error("refusing a symlink in " + dir + ": " + rel + " (kit and template sources must be plain files)");
        opts.links.push(rel);
      } else if (st.isDirectory()) go(rel);
      else out.push(rel);
    }
  };
  if (existsSync(dir)) go("");
  return out;
}

/**
 * A path below the kit root that must be a real directory inside it: not a symlink, and its real path
 * under the kit root's real path.
 * @param {string} kitRoot @param {string} rel
 */
function assertRealDir(kitRoot, rel) {
  const at = join(kitRoot, rel);
  const st = lstatSync(at);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("refusing to vendor " + rel + ": it is not a directory (a symlink could point anywhere on this machine)");
  const root = realpathSync(kitRoot);
  if (!realpathSync(at).startsWith(root + sep)) throw new Error("refusing to vendor " + rel + ": it resolves outside the kit checkout " + root);
}

/**
 * The files a kit checkout contributes, keyed by their path under src/kit. In a git checkout only the
 * files git would commit are taken (tracked, or untracked and not ignored): an ignored .env or token
 * file never travels. In a plain directory the skippedAnywhere names are left out at any depth. The packages directory and each package
 * directory must be real directories inside the kit root, and nothing below them may be a symlink.
 * @param {string} kitRoot a gas-kit checkout
 * @returns {Record<string, string>} path under src/kit to absolute source path
 */
export function vendorFiles(kitRoot) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!existsSync(join(kitRoot, "packages", "server", "src"))) throw new Error("not a gas-kit checkout: packages/server/src is missing in " + kitRoot);
  assertRealDir(kitRoot, "packages");
  const view = gitView(kitRoot);
  const listed = view ? new Set(view.files.filter((p) => p.startsWith("packages/"))) : null;
  // A kit folder that some other repository ignores whole (a home directory under git) is a plain folder.
  const only = listed && listed.size ? listed : null;
  for (const pkg of VENDOR_PACKAGES) {
    const pdir = join(kitRoot, "packages", pkg);
    if (!existsSync(join(pdir, "src"))) throw new Error("not a gas-kit checkout: packages/" + pkg + "/src is missing in " + kitRoot);
    assertRealDir(kitRoot, "packages/" + pkg);
    assertRealDir(kitRoot, "packages/" + pkg + "/src");
    for (const f of walkFiles(join(pdir, "src"), { skipTop: SKIP_TOP })) {
      const rel = "packages/" + pkg + "/src/" + f;
      if (only ? !only.has(rel) : f.split("/").some(skippedAnywhere)) continue;
      out[pkg + "/src/" + f] = join(pdir, "src", f);
    }
    for (const f of ["package.json", ...(EXTRA_FILES[/** @type {keyof typeof EXTRA_FILES} */ (pkg)] ?? [])]) {
      const at = join(pdir, f);
      if (!existsSync(at) && !isLink(at)) continue;
      // A link could point anywhere on the machine (a hostile kit source): vendor regular files only.
      if (!lstatSync(at).isFile()) throw new Error("refusing to vendor packages/" + pkg + "/" + f + ": it is not a regular file");
      if (only && !only.has("packages/" + pkg + "/" + f)) continue;
      out[pkg + "/" + f] = at;
    }
  }
  return out;
}

/** @param {string} p */
function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * @typedef {object} LockKit
 * @property {string} version
 * @property {string | null} commit the kit commit the files came from, null for a dirty or non-git checkout
 * @property {string} source where this vendoring was taken from: "local checkout", or the git URL#ref (no credentials)
 * @property {string | null} [remote] the shareable git URL of the kit repository (no credentials, no #ref), the
 *   default source of kit:sync and kit:diff; null or absent (a lock written before it existed) when none is known
 */

/**
 * @typedef {object} Lock
 * @property {LockKit} kit
 * @property {Record<string, string>} files path under src/kit to sha256 hex
 */

/**
 * The key order is fixed (version, commit, source, remote; then the sorted files), so the same input
 * always renders the same bytes.
 * @param {LockKit} kit
 * @param {Record<string, string>} hashes
 * @returns {Lock}
 */
export function buildLock(kit, hashes) {
  const files = Object.fromEntries(Object.keys(hashes).sort().map((k) => [k, /** @type {string} */ (hashes[k])]));
  return { kit: { version: kit.version, commit: kit.commit, source: kit.source, remote: kit.remote ?? null }, files };
}

/** @param {Lock} lock */
export function renderLock(lock) {
  return JSON.stringify(lock, null, 2) + "\n";
}

/**
 * Hash a map of path to absolute file.
 * @param {Record<string, string>} files
 * @returns {Record<string, string>}
 */
export function hashFiles(files) {
  return Object.fromEntries(Object.entries(files).map(([k, abs]) => [k, sha256(readFileSync(abs))]));
}

/**
 * Parse a lock file's text; throws a readable error on a bad shape.
 * @param {string} text
 * @returns {Lock}
 */
export function parseLock(text) {
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(LOCK_FILE + " is not valid JSON");
  }
  if (!data || typeof data !== "object" || !data.kit || typeof data.files !== "object" || data.files === null) {
    throw new Error(LOCK_FILE + " has the wrong shape (expected { kit, files })");
  }
  return /** @type {Lock} */ (data);
}

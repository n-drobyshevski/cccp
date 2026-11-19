// Extracted from the author's production Apps Script apps; adapted.
// No file under root names a denied term (private names, an email domain, a deployment id).
// The denylist belongs to the app and is passed in; a violation prints file and line plus the
// index of the term, never the term, so a log does not repeat what it guards.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { isAllowed, wire } from "./_util.js";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "test-results", "playwright-report", ".cache"]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|pdf)$/i;

/** @param {string} dir @param {string[]} [out] @returns {string[]} */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Git-listed files when root is a checkout, else every file. @param {string} root */
function files(root) {
  if (existsSync(join(root, ".git"))) {
    try {
      const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" });
      return out.split("\n").filter(Boolean).map((f) => join(root, f)).filter((f) => existsSync(f));
    } catch {
      // fall through to the walk
    }
  }
  return walk(root);
}

/**
 * A string is matched as text, case-insensitively. A RegExp is cloned without the g and y flags,
 * which make test() stateful across lines and skip matches.
 * @param {string | RegExp} t
 */
const toRegExp = (t) =>
  t instanceof RegExp ? new RegExp(t.source, t.flags.replace(/[gy]/g, "")) : new RegExp(t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "i");

/**
 * @param {{ root: string, extraTerms?: (string | RegExp)[], base64Terms?: string[], allow?: string[] }} opts
 *   extraTerms: plain strings (matched case-insensitively as text) or regular expressions.
 *   base64Terms: plain terms stored base64-encoded, so the file that holds the denylist does not
 *   itself contain them. allow: files (relative path, file name or suffix) whose content is not
 *   scanned, such as the file that holds the denylist; their path still is.
 * @returns {string[]} violations; also one when no terms are given or the root has no files
 */
export function check({ root, extraTerms = [], base64Terms = [], allow = [] }) {
  const pats = [...extraTerms, ...base64Terms.map((b) => Buffer.from(b, "base64").toString("utf8"))].map(toRegExp);
  /** @type {string[]} */ const bad = [];
  // An empty denylist or an empty root would pass vacuously, so each one is a violation.
  if (!pats.length) return ["scrub clean was given no terms (extraTerms or base64Terms), so it checks nothing"];
  const all = files(root);
  if (!all.length) return ["scrub clean scanned no files under " + root];
  for (const f of all) {
    const rel = relative(root, f).split(sep).join("/");
    pats.forEach((p, k) => { if (p.test(rel)) bad.push(rel + " (path) matches denied term #" + (k + 1)); });
    if (BINARY.test(f) || isAllowed(rel, allow)) continue;
    // An untracked symlink to a directory is listed by git; only regular files are read.
    if (!statSync(f).isFile()) continue;
    readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      pats.forEach((p, k) => { if (p.test(line)) bad.push(rel + ":" + (i + 1) + " matches denied term #" + (k + 1)); });
    });
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "scrub clean", () => check(opts));
}

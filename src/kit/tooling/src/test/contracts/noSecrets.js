// No credential in the source or in the built files. dist/js_app.html is inlined into every page
// and a define applies to both bundles, so a key in src or one that reaches dist is in every
// viewer's browser. Caught, line by line:
//   - by shape: PEM private key headers, a "private_key" JSON field, Google API keys (AIza...),
//     OAuth access tokens (ya29....), client_secret and refresh_token values, a Bearer or Basic
//     credential, a JSON Web Token, a URL with a password in its userinfo (scheme, two slashes,
//     user:password@), a credential in a URL query (api_key=, access_token=, ...), and well-known
//     key prefixes (source-host personal and fine-grained tokens, chat-bot tokens, live payment
//     keys, cloud access key ids, OAuth client secrets, package-registry tokens, sk- keys);
//   - by name: a long key-like literal (24+ characters with a letter and a digit) assigned to a
//     name ending in key, secret, token or password, with or without a TypeScript type
//     annotation, in single, double or back quotes, or passed after such a name in quotes
//     (setProp("CRM_API_KEY", "..."));
//   - files named .clasprc.json (the clasp login), .env or .env.<name> (except .env.example)
//     anywhere under the scanned dirs or, with root, tracked by git.
// With root, the app's own config and tooling are scanned too, where a key is most often pasted:
// app.config.mjs (a build define reaches both bundles), dev/ (fixture properties), tools/, and
// every JSON file at the root (tracked by git, or every one when root is not a checkout).
// A violation prints file, line and the pattern, never the value. Secrets belong in Script
// Properties, read on the server only (see the secrets recipe).
//
// Not caught: a value split over lines or built by concatenation, an unlabelled random string (a
// blanket long-hex or base64 rule would flag build ids, hashes and sheet ids, so there is none),
// and anything in a file the scan is not given.
//
// The patterns are written in pieces so this file does not match itself.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { isAllowed, isKitPath, relPath, wire } from "./_util.js";

const DASHES = "-".repeat(5);
const BQ = String.fromCharCode(96);
/** Any quote: single, double or back. */
const Q = "[\"'" + BQ + "]";
const NOT_Q = "[^\"'" + BQ + "\\s]";
/** A TypeScript type annotation between a name and its value: `: string`, `: Readonly<X> | null`. */
const TYPE = "(?:\\s*:\\s*[A-Za-z_$][\\w$.]*(?:<[^>\\n]*>)?(?:\\[\\])*(?:\\s*\\|\\s*[A-Za-z_$][\\w$.]*(?:<[^>\\n]*>)?(?:\\[\\])*)*)?";
/** A key-like value: 24+ characters with at least one letter and one digit. */
const KEYLIKE = "(?=" + NOT_Q + "*\\d)(?=" + NOT_Q + "*[A-Za-z])[A-Za-z0-9_+/=-]{24,}";
const NAME = "[\\w$]*(?:key|secret|token|password|passwd)";
/** @type {{ id: string, re: RegExp }[]} */
export const PATTERNS = [
  { id: "a PEM private key", re: new RegExp(DASHES + "BEGIN (?:[A-Z]+ )*PRIVATE KEY" + DASHES) },
  { id: "a service-account private_key field", re: new RegExp("[\"']private" + "_key[\"']\\s*:") },
  { id: "a Google API key", re: new RegExp("\\bAI" + "za[0-9A-Za-z_-]{35}") },
  { id: "an OAuth access token", re: new RegExp("\\bya" + "29\\.[0-9A-Za-z_-]{20,}") },
  { id: "a client_secret value", re: new RegExp("[\"']?client" + "_secret[\"']?\\s*[:=]\\s*" + Q + NOT_Q + "{8,}" + Q, "i") },
  { id: "a refresh_token value", re: new RegExp("[\"']?refresh" + "_token[\"']?\\s*[:=]\\s*" + Q + NOT_Q + "{8,}" + Q, "i") },
  { id: "a Bearer or Basic credential", re: new RegExp("\\b(?:Bear" + "er|Bas" + "ic)\\s+(?=[A-Za-z0-9._~+/-]*\\d)[A-Za-z0-9._~+/-]{20,}=*") },
  { id: "a JSON Web Token", re: new RegExp("\\bey" + "J[A-Za-z0-9_-]{8,}\\.ey" + "J[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}") },
  { id: "a password in a URL's userinfo", re: new RegExp("\\b[A-Za-z][A-Za-z0-9+.-]*:[/]{2}[^\\s/?#@:\"'" + BQ + "]+:[^\\s/?#@\"'" + BQ + "]+@") },
  { id: "a credential in a URL query", re: new RegExp("[?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|key|secret|client[_-]?secret|password)=(?=[^&\\s\"'" + BQ + "]*\\d)[A-Za-z0-9._~+/%-]{16,}", "i") },
  {
    id: "a well-known key prefix",
    re: new RegExp([
      "\\bgh" + "[pousr]_[A-Za-z0-9]{36,}", "\\bgithub" + "_pat_[A-Za-z0-9_]{40,}", "\\bgl" + "pat-[A-Za-z0-9_-]{20,}",
      "\\bxo" + "x[abposr]-[A-Za-z0-9-]{10,}", "\\b[rs]k" + "_live_[A-Za-z0-9]{20,}", "\\b(?:AK" + "IA|AS" + "IA)[0-9A-Z]{16}\\b",
      "\\bGOC" + "SPX-[A-Za-z0-9_-]{20,}", "\\bnp" + "m_[A-Za-z0-9]{36}\\b", "\\bs" + "k-[A-Za-z0-9_-]{32,}",
    ].join("|")),
  },
  {
    id: "a long literal assigned to a key, secret, token or password name",
    re: new RegExp(NAME + Q + "?" + TYPE + "\\s*[:=]\\s*" + Q + KEYLIKE + Q, "i"),
  },
  {
    id: "a long literal stored under a key, secret, token or password name",
    re: new RegExp(Q + NAME + Q + "\\s*,\\s*" + Q + KEYLIKE + Q, "i"),
  },
];

/** True for a file name that holds credentials by convention. @param {string} name */
export const isSecretFileName = (name) => name === ".clasprc.json" || name === ".env" || (/^\.env\.[\w.-]+$/.test(name) && name !== ".env.example");

const SKIP_DIRS = new Set(["node_modules", ".git"]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip|gz|pdf)$/i;
const MAX_BYTES = 4 * 1024 * 1024;
/** The app files and folders under root that are scanned besides dirs. */
export const ROOT_SCAN = ["app.config.mjs", "dev", "tools"];

/** @param {string} dir @param {string[]} [out] @returns {string[]} */
function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/**
 * The violations of one file's text, one per line at most (the first pattern that matches).
 * @param {string} label @param {string} text
 * @returns {string[]}
 */
export function scanText(label, text) {
  /** @type {string[]} */ const bad = [];
  text.split("\n").forEach((line, i) => {
    const p = PATTERNS.find((x) => x.re.test(line));
    if (p) bad.push(label + ":" + (i + 1) + " holds " + p.id);
  });
  return bad;
}

/**
 * @param {{ dirs: string[], root?: string, allow?: string[], includeKit?: boolean, minFiles?: number }} opts
 *   dirs: directories to scan, typically src and dist (a missing one is skipped, so a dist that is
 *   not built yet does not fail). root: the app root; its app.config.mjs, dev/ and tools/ and the
 *   JSON files at its top (git-tracked ones in a checkout, all of them otherwise) are scanned
 *   too, and in a git checkout the tracked files are checked for credential file names. allow:
 *   files (relative path, file name or suffix) whose content is not scanned. The vendored kit
 *   (kit/ right under a dir) is skipped unless includeKit. minFiles: fewest files the scan must
 *   see in total (default 1).
 * @returns {string[]} violations
 */
export function check({ dirs, root, allow = [], includeKit = false, minFiles = 1 }) {
  /** @type {string[]} */ const bad = [];
  let seen = 0;
  /** @param {string} f @param {string} rel @param {string} label */
  const scanFile = (f, rel, label) => {
    if (isSecretFileName(basename(f))) { bad.push(label + " is a credential file; keep it out of the app tree"); return; }
    if (BINARY.test(f) || isAllowed(rel, allow) || statSync(f).size > MAX_BYTES) return;
    bad.push(...scanText(label, readFileSync(f, "utf8")));
  };
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of walk(dir)) {
      const rel = relPath(dir, f);
      if (!includeKit && isKitPath(rel)) continue;
      seen++;
      scanFile(f, rel, basename(dir) + "/" + rel);
    }
  }
  if (seen < minFiles) bad.unshift("scanned " + seen + " file(s) under " + dirs.join(", ") + ", expected at least " + minFiles);
  if (!root) return bad;
  const git = existsSync(join(root, ".git"));
  /** @type {string[] | null} */ let tracked = null;
  if (git) {
    try {
      tracked = execFileSync("git", ["ls-files", "--cached"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    } catch {
      bad.push("git ls-files failed in " + root + ", so tracked credential files were not checked");
    }
  }
  const inDirs = (/** @type {string} */ p) => dirs.some((d) => { const r = relPath(d, p); return r === "" || !(r.startsWith("..") || r.startsWith("/")); });
  for (const name of ROOT_SCAN) {
    const p = join(root, name);
    if (!existsSync(p) || inDirs(p)) continue;
    const files = statSync(p).isDirectory() ? walk(p) : [p];
    for (const f of files) {
      const rel = relPath(root, f);
      // A tracked credential file is reported once, below, with what to do about it.
      if (tracked && tracked.includes(rel) && isSecretFileName(basename(f))) continue;
      scanFile(f, rel, rel);
    }
  }
  const rootJson = tracked
    ? tracked.filter((t) => !t.includes("/") && t.endsWith(".json"))
    : readdirSync(root).filter((n) => n.endsWith(".json") && statSync(join(root, n)).isFile());
  for (const n of rootJson) if (existsSync(join(root, n))) scanFile(join(root, n), n, n);
  for (const t of tracked || []) if (isSecretFileName(basename(t))) bad.push(t + " is tracked by git; remove it from the index and rotate what it holds");
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "no secrets", () => check(opts));
}

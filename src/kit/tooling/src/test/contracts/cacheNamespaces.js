// Extracted from the author's production Apps Script apps; adapted.
// Every cache namespace used at a call site is a versioned literal (letters then digits, so a
// changed payload bumps its own suffix) and no two call sites share a namespace by accident.
import { lineOf, read, scannedEnough, sourceFiles, stripComments, wire } from "./_util.js";

export const NAMESPACE_RE = /^[a-z][a-zA-Z]*\d+$/;

// cache.get / put / getOrCompute / remove / peek / refresh on anything named like a cache: the kit's server cache
// API. The first argument is the namespace. A bare wrapper name is not in the default (the client
// swr cached(name, params) takes an RPC name, not a namespace); an app with its own wrapper passes
// it as `callee`.
// A receiver bound from createCache(...) counts whatever its name (const store = createCache(...))
// in its own file, and in every scanned file when it is exported, so an imported kit cache with a
// plain name is still checked.
// A receiver assigned from CacheService.get*Cache() is a raw Apps Script cache (its first argument
// is a key, not a namespace) and is skipped. Wrap it in the kit's cache, or name a custom callee.
const DEFAULT_CALLEE = "[\\w$]*[cC]ache[\\w$]*\\s*\\.\\s*(?:getOrCompute|get|put|remove|peek|refresh)";

const METHODS = "\\s*\\.\\s*(?:getOrCompute|get|put|remove|peek|refresh)";

/**
 * Names bound from createCache(...) in one source text (const, let or var). With exportedOnly,
 * only the exported ones: those are the names other files may import.
 * @param {string} text @param {boolean} [exportedOnly]
 * @returns {string[]}
 */
export function cacheReceivers(text, exportedOnly = false) {
  const src = stripComments(text);
  return [...src.matchAll(/(\bexport\s+)?\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=;]+)?=\s*createCache\s*(?:<[^>(]*>)?\(/g)]
    .filter((m) => !exportedOnly || m[1])
    .map((m) => m[2]);
}

/** @param {string} name */
const escapeRe = (name) => name.replace(/[$]/g, "\\$");

/**
 * Namespaces at call sites in one source text. A const name is resolved through
 * const NAME = "literal"; a first argument that is neither is reported as unresolved.
 * @param {string} text @param {string} [callee] regex source for the callee; a function declaration
 *   of that name is not a call
 * @param {string[]} [receivers] more receiver names to treat as kit caches (the exported
 *   createCache names of other files)
 * @returns {{ ns: string | null, raw: string, at: number }[]}
 */
export function findNamespaces(text, callee = DEFAULT_CALLEE, receivers = []) {
  const src = stripComments(text);
  const names = [...new Set([...receivers, ...cacheReceivers(text)])];
  if (names.length) callee = callee + "|(?:" + names.map(escapeRe).join("|") + ")" + METHODS;
  const rawCaches = new Set([...src.matchAll(/\b(?:const|let|var)\s+([\w$]+)\s*(?::[^=;]+)?=\s*CacheService\s*\.\s*get\w*Cache\s*\(/g)].map((m) => m[1]));
  const consts = new Map([...src.matchAll(/\bconst\s+(\w+)\s*(?::\s*string\s*)?=\s*["']([^"']*)["']/g)].map((m) => [m[1], m[2]]));
  const re = new RegExp("(?<!\\bfunction\\s+)(?<![\\w$])(?:" + callee + ")\\s*(?:<[^>(]*>)?\\(\\s*(?:([\"'])([^\"']*)\\1|([\\w$]+)|([^,)\\s][^,)]*))", "g");
  /** @type {{ ns: string | null, raw: string, at: number }[]} */ const out = [];
  for (const m of src.matchAll(re)) {
    const recv = /^([\w$]+)\s*\./.exec(m[0]);
    if (recv && rawCaches.has(recv[1]) && src[m.index - 1] !== ".") continue;
    if (m[2] !== undefined) out.push({ ns: m[2], raw: m[2], at: m.index });
    else if (m[3] !== undefined) out.push({ ns: consts.get(m[3]) ?? null, raw: m[3], at: m.index });
    else out.push({ ns: null, raw: m[4].trim(), at: m.index });
  }
  return out;
}

/**
 * @param {{ srcDir: string | string[], callee?: string, allow?: string[], shared?: string[],
 *   includeClient?: boolean, includeKit?: boolean, minFiles?: number, minHits?: number }} opts
 *   allow: files left out. Browser code (client/) and the vendored kit (kit/) are not scanned
 *   unless includeClient or includeKit. minFiles (default 1) and minHits (default 0): fewest files
 *   scanned and namespaces found, so a wrong srcDir or callee fails loudly instead of passing
 *   vacuously (an app that must cache something sets minHits: 1). shared: namespaces that several call sites may use (a get and a put of one model)
 * @returns {string[]} violations
 */
export function check({ srcDir, callee, allow = [], shared = [], includeClient = false, includeKit = false, minFiles = 1, minHits = 0 }) {
  const files = sourceFiles(srcDir, { exts: [".ts", ".js", ".mjs"], allow, includeClient, includeKit });
  /** @type {string[]} */ const bad = scannedEnough(sourceFiles(srcDir, { exts: [".ts", ".js", ".mjs"], includeClient, includeKit }), minFiles, srcDir);
  let hits = 0;
  /** @type {Map<string, Set<string>>} */ const owners = new Map();
  const receivers = [...new Set(files.flatMap(({ file }) => cacheReceivers(read(file), true)))];
  for (const { file, rel } of files) {
    const text = read(file);
    for (const h of findNamespaces(text, callee, receivers)) {
      hits++;
      const where = rel + ":" + lineOf(stripComments(text), h.at);
      if (h.ns === null) { bad.push(where + " cache namespace is not a string literal or a const of one: " + h.raw); continue; }
      if (!NAMESPACE_RE.test(h.ns)) bad.push(where + " cache namespace " + JSON.stringify(h.ns) + " must match " + String(NAMESPACE_RE));
      if (!owners.has(h.ns)) owners.set(h.ns, new Set());
      owners.get(h.ns)?.add(rel);
    }
  }
  if (hits < minHits) bad.push("found " + hits + " cache namespace call site(s), expected at least " + minHits + " (wrong callee or srcDir?)");
  for (const [ns, owned] of owners) {
    if (owned.size > 1 && !shared.includes(ns)) bad.push("cache namespace " + ns + " is used in several files: " + [...owned].sort().join(", "));
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "cache namespaces", () => check(opts));
}

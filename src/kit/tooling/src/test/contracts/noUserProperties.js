// Extracted from the author's production Apps Script apps; adapted.
// Per-user stores are banned in source: under a script that runs as its deployer they are the
// deployer's store, and anything per viewer must never reach a shared cache. Comments may name
// them; code may not (a quoted key such as PropertiesService["getUserProperties"] counts).
import { lineOf, read, scannedEnough, sourceFiles, stripComments, wire } from "./_util.js";

export const BANNED = ["UserProperties", "getUserProperties", "getUserCache", "getUserLock"];

/**
 * @param {{ srcDir: string | string[], banned?: string[], allow?: string[], includeKit?: boolean, minFiles?: number }} opts
 *   allow: files (relative path, file name or suffix) exempt from the scan; the vendored kit
 *   (src/kit/...) is skipped unless includeKit, since the kit's own tooling names the banned calls.
 *   minFiles: fewest files the scan must see (default 1), so a wrong srcDir fails loudly
 * @returns {string[]} violations
 */
export function check({ srcDir, banned = BANNED, allow = [], includeKit = false, minFiles = 1 }) {
  const re = new RegExp("\\b(" + banned.join("|") + ")\\b", "g");
  const files = sourceFiles(srcDir, { allow, includeKit });
  /** @type {string[]} */ const bad = scannedEnough(sourceFiles(srcDir, { includeKit }), minFiles, srcDir);
  for (const { file, rel } of files) {
    const code = stripComments(read(file));
    for (const m of code.matchAll(re)) bad.push(rel + ":" + lineOf(code, m.index) + " uses " + m[1]);
  }
  return bad;
}

/** @param {any} describe @param {any} it @param {any} expect @param {Parameters<typeof check>[0]} opts */
export function register(describe, it, expect, opts) {
  wire(describe, it, expect, "no user properties", () => check(opts));
}

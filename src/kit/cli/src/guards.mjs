// What an update can loosen: the guard lists an app runs live in its vendored kit (the allow lists, defaults and
// scope tables of the tooling package). update compares them between the kit the app has and the release, by reading
// the source as text. Nothing from the release is executed or imported; it is untrusted text, scanned in one pass.
// A list that grew where growing loosens (an allow list), or shrank where shrinking loosens (a ban list), is reported,
// and the update stops until the person says they reviewed it (see the upgrade-kit skill).
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vendoredKey } from "./hash.mjs";

const MAX_BYTES = 1024 * 1024;

/**
 * The guard lists compared. `loosens` says which change widens what an app may do: "added" (a new entry is allowed
 * something) or "removed" (an entry that used to be banned or gated is gone).
 * @type {ReadonlyArray<{ file: string, name: string, loosens: "added" | "removed" }>}
 */
export const GUARD_LISTS = [
  { file: "packages/tooling/src/eslint/preset.mjs", name: "DEFAULT_RAW_ALLOWED", loosens: "added" },
  { file: "packages/tooling/src/eslint/preset.mjs", name: "DEFAULT_SCRIPT_ALLOWED", loosens: "added" },
  { file: "packages/tooling/src/test/contracts/noDangerousServerApis.js", name: "DEFAULT_ALLOW", loosens: "added" },
  { file: "packages/tooling/src/test/contracts/entryParity.js", name: "DEFAULT_ALLOW", loosens: "added" },
  { file: "packages/tooling/src/test/contracts/entryParity.js", name: "DEFAULT_UNGATED", loosens: "added" },
  { file: "packages/tooling/src/test/contracts/entryParity.js", name: "DEFAULT_GATES", loosens: "removed" },
  { file: "packages/tooling/src/test/contracts/manifestScopes.js", name: "DEFAULT_SERVICE_SCOPES", loosens: "added" },
  { file: "packages/tooling/src/test/contracts/manifestScopes.js", name: "BROAD_SCOPES", loosens: "removed" },
  { file: "packages/tooling/src/test/contracts/noUserProperties.js", name: "BANNED", loosens: "removed" },
  { file: "packages/tooling/src/test/contracts/viewerFreeCore.js", name: "DEFAULT_FORBIDDEN_KEYS", loosens: "removed" },
  { file: "packages/tooling/src/test/contracts/noSecrets.js", name: "ROOT_SCAN", loosens: "removed" },
];

/**
 * The tokens of the declaration `export const NAME = ...;` in source text: its string literals and its
 * UPPER_CASE names (a scope constant), as a count per token. Comments and regular expression literals are
 * skipped. Null when there is no such declaration or it does not end.
 * @param {string} text @param {string} name
 * @returns {Map<string, number> | null}
 */
export function listTokens(text, name) {
  const m = new RegExp("^export\\s+const\\s+" + name + "\\s*=", "m").exec(text);
  if (!m) return null;
  /** @type {Map<string, number>} */
  const out = new Map();
  const add = (/** @type {string} */ t) => out.set(t, (out.get(t) ?? 0) + 1);
  let depth = 0;
  let prev = "=";
  let i = m.index + m[0].length;
  while (i < text.length) {
    const c = /** @type {string} */ (text[i]);
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return null;
      i = end + 2;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let s = "";
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") {
          s += text[j + 1] ?? "";
          j += 2;
        } else s += text[j++];
      }
      if (j >= text.length) return null;
      add(s);
      i = j + 1;
      prev = c;
    } else if (c === "/" && "=(,:[{!&|?;".includes(prev)) {
      // A regular expression literal: skip to the closing slash, outside a [class].
      let j = i + 1;
      let cls = false;
      while (j < text.length && (cls || text[j] !== "/") && text[j] !== "\n") {
        if (text[j] === "\\") j++;
        else if (text[j] === "[") cls = true;
        else if (text[j] === "]") cls = false;
        j++;
      }
      if (text[j] !== "/") return null;
      i = j + 1;
      prev = "/";
    } else if (/[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < text.length && /[\w$]/.test(/** @type {string} */ (text[j]))) j++;
      const word = text.slice(i, j);
      if (/^[A-Z][A-Z0-9_]*$/.test(word)) add(word);
      i = j;
      prev = "a";
    } else {
      if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
      else if (c === ";" && depth <= 0) return out;
      if (c.trim()) prev = c;
      i++;
    }
  }
  return null;
}

/** The text of a regular file of at most 1 MB, or null. @param {string} file */
function readText(file) {
  try {
    const st = lstatSync(file);
    return st.isFile() && st.size <= MAX_BYTES ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

/**
 * The guard lists of a kit checkout dir (a kit repository, packages/... at its root) or of an app's vendored kit.
 * @param {{ kitDir: string } | { appKit: string }} where
 * @param {string} file the kit-root-relative path
 */
function readGuardFile(where, file) {
  if ("kitDir" in where) return readText(join(where.kitDir, file));
  const key = vendoredKey(file);
  return key ? readText(join(where.appKit, key)) : null;
}

/**
 * The guard changes between the kit an app has (its src/kit) and a release checkout that make the guards looser.
 * A list the release does not hold any more, or that cannot be read in either, is reported as unreadable: the
 * answer is then "do not know", never "fine".
 * @param {string} appKit the app's src/kit folder @param {string} releaseDir the fetched release
 * @returns {Array<{ list: string, added: string[], removed: string[], unreadable: boolean }>} the lists that are looser or unknown
 */
export function guardChanges(appKit, releaseDir) {
  /** @type {Array<{ list: string, added: string[], removed: string[], unreadable: boolean }>} */
  const found = [];
  for (const g of GUARD_LISTS) {
    const label = g.file.replace(/^packages\/tooling\/src\//, "") + " " + g.name;
    const oldText = readGuardFile({ appKit }, g.file);
    const newText = readGuardFile({ kitDir: releaseDir }, g.file);
    const before = oldText === null ? null : listTokens(oldText, g.name);
    const after = newText === null ? null : listTokens(newText, g.name);
    if (!before || !after) {
      // Both missing: this kit does not have the list (an older or newer layout), nothing to compare.
      if (before || after) found.push({ list: label, added: [], removed: [], unreadable: true });
      continue;
    }
    /** @type {string[]} */ const added = [];
    /** @type {string[]} */ const removed = [];
    for (const [t, n] of after) if (n > (before.get(t) ?? 0)) added.push(t);
    for (const [t, n] of before) if (n > (after.get(t) ?? 0)) removed.push(t);
    if ((g.loosens === "added" && added.length) || (g.loosens === "removed" && removed.length)) found.push({ list: label, added: g.loosens === "added" ? added : [], removed: g.loosens === "removed" ? removed : [], unreadable: false });
  }
  return found;
}

/**
 * Plain lines for the changes guardChanges found (no leading indent).
 * @param {ReturnType<typeof guardChanges>} changes
 */
export function describeGuardChanges(changes) {
  /** @type {string[]} */
  const lines = [];
  for (const c of changes) {
    if (c.unreadable) lines.push(c.list + ": could not be compared");
    else if (c.added.length) lines.push(c.list + ": now also allows " + c.added.map((s) => JSON.stringify(s)).join(", "));
    else lines.push(c.list + ": no longer bans or gates " + c.removed.map((s) => JSON.stringify(s)).join(", "));
  }
  return lines;
}

// Finds the import specifiers of a source file with a line scanner (no parser needed) and decides
// whether each one stays inside the vendored kit.
import { builtinModules } from "node:module";
import { VENDOR_PACKAGES } from "./hash.mjs";
import { dirname, relative, resolve, sep } from "node:path";

/** Bare specifiers vendored kit code may use besides @gas-kit/* and node builtins. */
export const KIT_EXTERNALS = ["esbuild", "eslint", "gallery:data"];

const BUILTINS = new Set(builtinModules);
/** An absolute path or a URL scheme other than node: always leaves the kit. */
const ESCAPES = /^(?:\/[^\s"']*|(?!node:)[a-z][a-z0-9+.-]*:[^\s"']*)$/i;
const SHAPE = /^[@\w][\w./:@-]*$/;

/**
 * Source with comments blanked out (newlines kept). A small scanner, so a comment opener inside a
 * string (a glob such as "src/*" ) is not mistaken for a comment and string contents stay intact.
 * @param {string} source
 */
export function stripComments(source) {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = /** @type {string} */ (source[i]);
    const d = source[i + 1];
    if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === "/" && d === "/" && source[i - 1] !== ":") {
      while (i < n && source[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && source[j] !== c && !(c !== "`" && source[j] === "\n")) j += source[j] === "\\" ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  // A stray JSDoc continuation line (an opener the scan did not see) is prose too.
  return out.replace(/^[ \t]*\*[ \t][^\n]*/gm, "");
}

/**
 * The module specifiers a file imports. The whole text is scanned, so a specifier on a different
 * line from its `from` is seen; comments are stripped first.
 * @param {string} source
 * @returns {string[]}
 */
export function importSpecifiers(source) {
  /** @type {Array<[number, string]>} */
  const found = [];
  const patterns = [/\bfrom\s*["']([^"'\n]+)["']/g, /\bimport\s*["']([^"'\n]+)["']/g, /\bimport\s*\(\s*["']([^"'\n]+)["']/g, /\brequire\s*\(\s*["']([^"'\n]+)["']/g];
  const text = stripComments(source);
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const spec = m[1] ?? "";
      if (spec.startsWith(".") ? /^\.{1,2}(\/[^\s"']*)?$/.test(spec) : ESCAPES.test(spec) || SHAPE.test(spec)) found.push([m.index ?? 0, spec]);
    }
  }
  return [...new Set(found.sort((x, y) => x[0] - y[0]).map((f) => f[1]))];
}

/**
 * Why a specifier leaves the kit set, or null when it is fine.
 * @param {string} spec
 * @param {string} fileAbs absolute path of the importing file
 * @param {string} kitRootAbs absolute path of src/kit
 * @returns {string | null}
 */
export function importProblem(spec, fileAbs, kitRootAbs) {
  if (spec.startsWith(".")) {
    const target = resolve(dirname(fileAbs), spec);
    const rel = relative(kitRootAbs, target);
    if (rel === ".." || rel.startsWith(".." + sep)) return "imports " + JSON.stringify(spec) + ", which resolves outside src/kit";
    return null;
  }
  if (spec.startsWith("/") || spec.startsWith("file:")) return "imports " + JSON.stringify(spec) + ", an absolute path that leaves src/kit";
  if (spec.startsWith("@gas-kit/")) {
    const [, pkg, ...rest] = spec.split("/");
    if (rest.includes("..")) return "imports " + JSON.stringify(spec) + ", whose .. segments climb out of the kit alias";
    if (!VENDOR_PACKAGES.includes(pkg ?? "")) return "imports " + JSON.stringify(spec) + ", which is not one of the vendored kit packages (" + VENDOR_PACKAGES.join(", ") + ")";
    return null;
  }
  if ( spec.startsWith("node:") || BUILTINS.has(spec.split("/")[0] ?? "") || KIT_EXTERNALS.includes(spec) || KIT_EXTERNALS.includes(spec.split("/")[0] ?? "")) return null;
  return "imports " + JSON.stringify(spec) + ", which is not part of the kit (only @gas-kit/*, node: builtins and " + KIT_EXTERNALS.filter((x) => !x.includes(":")).join(", ") + " are allowed)";
}

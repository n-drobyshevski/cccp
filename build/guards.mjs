// Build guards, importable by the build and by tests.
// Derived from sidekick gas_hub/esbuild.config.mjs at commit 77bcf22 (see VENDOR.md).
//
// The Apps Script middlebox "strips comments" from served documents with a tokenizer that
// understands quoted strings but not template literals or regexes. A bare double slash in a
// string, regex or CSS url() would truncate the line. These guards replay that rewrite and
// fail the build when anything would be corrupted.

/** Replay the proxy's comment stripping: string-aware, template/regex-unaware. */
export function stripCommentsLikeMiddlebox(code) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (quote) {
      out += c;
      if (c === "\\" && n !== undefined) { out += n; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === "/" && n === "/") { while (i < code.length && code[i] !== "\n") i++; continue; }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Throws when the client JS contains a backtick, a surviving double slash, or stops compiling. */
export function guardJs(label, code) {
  if (code.includes("`")) {
    throw new Error("middlebox guard: " + label + " still contains backticks");
  }
  const stripped = stripCommentsLikeMiddlebox(code);
  if (stripped.includes("//")) {
    const line = stripped.slice(0, stripped.indexOf("//")).split("\n").length;
    throw new Error(
      "middlebox guard: bare double slash survives comment stripping in " + label +
      " (in a string or regex) near stripped line " + line,
    );
  }
  try {
    new Function(stripped);
  } catch (e) {
    throw new Error("middlebox guard: " + label + " breaks under comment stripping: " + e.message);
  }
}

/** Throws when the stylesheet keeps a double slash after stripping (a url() or string). */
export function guardCss(label, css) {
  const stripped = stripCommentsLikeMiddlebox(css);
  if (stripped.includes("//")) {
    const at = stripped.indexOf("//");
    throw new Error(
      "middlebox guard: bare double slash survives comment stripping in " + label + " near " +
      JSON.stringify(stripped.slice(Math.max(0, at - 60), at + 20)),
    );
  }
}

/** Names of the api_<name> delegators declared in entry.js. */
export function delegatedNames(entryJs) {
  return [...entryJs.matchAll(/^function api_(\w+)\s*\(/gm)].map((m) => m[1]);
}

/** Names exported as functions from api.ts. */
export function exportedNames(apiTs) {
  return [...apiTs.matchAll(/^export function (\w+)\s*[(<]/gm)].map((m) => m[1]);
}

/**
 * entry.js drift guard. GAS resolves google.script.run targets against top-level functions,
 * so the delegators are hand-written; this fails in both directions: an export with no
 * delegator is unreachable, a delegator with no export throws at call time.
 */
export function guardEntryDrift(entryJs, apiTs) {
  const declared = new Set(delegatedNames(entryJs));
  const exported = new Set(exportedNames(apiTs));
  const missing = [...exported].filter((n) => !declared.has(n));
  const stale = [...declared].filter((n) => !exported.has(n));
  if (missing.length || stale.length) {
    throw new Error(
      "entry.js guard: src/gas/entry.js and src/server/api.ts disagree" +
      (missing.length ? "\n  exported by api.ts but unreachable from GAS: " + missing.join(", ") : "") +
      (stale.length ? "\n  delegated in entry.js but not exported: " + stale.join(", ") : ""),
    );
  }
}

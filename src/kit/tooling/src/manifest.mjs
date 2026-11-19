// Extracted from the author's production Apps Script apps; adapted.
//
// Component manifest generator. Reads every ui/src/components/*.js, finds the JSDoc blocks that
// carry @component and builds ui/components.json: the catalogue the gallery and the
// completeness test rely on. Node only, never served.
//
//   node manifest.mjs                 write packages/ui/components.json
//   node manifest.mjs --check         exit 1 when the committed file is stale
//   node manifest.mjs --help          print usage, exit 0, write nothing
//   --dir <componentsDir> --out <file> override the defaults (used by tests)
//
// Blocks: a folder "blocks" next to the components folder (packages/ui/src/blocks) is scanned the
// same way. Its entries carry "kind": "block" (components carry "component") and live in the same
// list. A block's cssDeps also name the stylesheets of every kit component it imports from
// ../components/<name>.js (each one's own shared and imported stylesheets first), so a page that
// shows the block can load it styled. A component's cssDeps follow its own ./<name>.js imports the
// same way, so a component built on another (filterPanel on facetList) lists that one's sheet.
//
// Any other flag or a positional argument is an error (exit 1), so a typo such as --chek can
// never rewrite the file and pass.
//
// Display metadata: @title (a Title Case name; defaults to the humanised @component name) and
// @category (required; the docs site groups by it) are copied to "title" and "category".
//
// Conventions the parser accepts, beyond the plain JSDoc grammar:
//   - An @example state is "name:" at the start of the example; it may be kebab-case
//     (disabled-option, word-hidden), because the states are labels, not code identifiers.
//     The same text must appear in @states, comma separated. A @component name stays a single
//     JS identifier.
//   - A block with no @states tag has the one state ["default"], and then needs one @example
//     with no "name:" prefix (or "default:").
//   - Export forms: function declarations (also async and generator), `export default function`,
//     and `export const|let|var x = <function expression | arrow | parenthesised or cast
//     function>` are classified. `export { a as b }`, `export * from` and `export default <value>`
//     cannot be tied to a doc block, so they throw "cannot classify" instead of passing silently.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * @typedef {{ type: string, name: string, description: string[] }} ManifestParam
 * @typedef {{ state: string, code: string }} ManifestExample
 * @typedef {{
 *   name: string, title: string, category: string, kind: "component" | "block", module: string, export: string, summary: string, params: ManifestParam[],
 *   emits: string[], states: string[], a11y: string, examples: ManifestExample[], css: string | null,
 *   cssDeps: string[],
 * }} ManifestComponent
 * @typedef {{ version: 1, components: ManifestComponent[] }} Manifest
 */

/**
 * Split a JSDoc block into its text lines (gutter stripped) grouped by tag.
 * Text before the first tag is returned under the tag name "".
 * @param {string} block the full block text including the comment delimiters
 * @returns {{ tag: string, lines: string[] }[]}
 */
function parseTags(block) {
  const body = block.replace(/^\/\*\*/, "").replace(/\*\/\s*$/, "");
  /** @type {{ tag: string, lines: string[] }[]} */
  const tags = [{ tag: "", lines: [] }];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/^\s*\*? ?/, "").replace(/\s+$/, "");
    const m = /^@([A-Za-z][A-Za-z0-9]*)\b ?(.*)$/.exec(line);
    if (m) tags.push({ tag: m[1], lines: [m[2]] });
    else tags[tags.length - 1].lines.push(line);
  }
  return tags;
}

/**
 * Split on commas at parenthesis depth 0, so a note like "(data-a, data-b)" stays whole.
 * @param {string} text
 * @returns {string[]}
 */
function splitTop(text) {
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")" && depth > 0) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** Collapse text lines into one trimmed run. @param {string[]} lines */
function joinLines(lines) {
  return lines.map((l) => l.trim()).filter(Boolean).join(" ");
}

/** Drop leading and trailing blank lines. @param {string[]} lines */
function trimBlank(lines) {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

/**
 * Parse one @param tag: a balanced-brace type, an optional name, then description lines.
 * @param {string[]} lines
 * @returns {ManifestParam}
 */
function parseParam(lines) {
  const text = lines.join("\n");
  let type = "";
  let rest = text.trimStart();
  if (rest.startsWith("{")) {
    let depth = 0;
    let i = 0;
    for (; i < rest.length; i++) {
      if (rest[i] === "{") depth++;
      else if (rest[i] === "}" && --depth === 0) break;
    }
    type = rest.slice(1, i).trim();
    rest = rest.slice(i + 1).trimStart();
  }
  const nm = /^(\[[^\]]*\]|[A-Za-z_$][\w$.]*)/.exec(rest);
  const name = nm ? nm[1] : "";
  const description = trimBlank(rest.slice(name.length).replace(/^\s*-?\s*/, "").split("\n")).map((l) => l.trim());
  return { type, name, description };
}

/**
 * A display name from an identifier: split camelCase and capitalise each word ("kpiTile" is "Kpi Tile").
 * @param {string} name
 */
export function humanise(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Parse a block that carries @component.
 * @param {string} block
 * @returns {Omit<ManifestComponent, "kind" | "module" | "export" | "css" | "cssDeps">}
 */
function parseComponent(block) {
  const tags = parseTags(block);
  const first = (/** @type {string} */ t) => tags.find((x) => x.tag === t);
  const name = joinLines(first("component")?.lines ?? []);
  const title = joinLines(first("title")?.lines ?? []) || humanise(name);
  const category = joinLines(first("category")?.lines ?? []);
  // @emits may repeat (one act per line); every occurrence is read, in order.
  const emits = tags
    .filter((x) => x.tag === "emits")
    .map((x) => joinLines(x.lines))
    .filter((t) => t && t.toLowerCase() !== "none")
    .flatMap((t) => splitTop(t));
  const statesText = joinLines(first("states")?.lines ?? []);
  const states = statesText ? statesText.split(",").map((s) => s.trim()).filter(Boolean) : ["default"];
  const examples = tags.filter((t) => t.tag === "example").map((t) => {
    const code = trimBlank(t.lines).join("\n");
    const m = /^([A-Za-z_$][\w$-]*)\s*:(?!:)\s*([\s\S]*)$/.exec(code);
    return m ? { state: m[1], code: m[2].trim() } : { state: "default", code: code.trim() };
  });
  return {
    name,
    title,
    category,
    summary: joinLines(first("summary")?.lines ?? []),
    params: tags.filter((t) => t.tag === "param").map((t) => parseParam(t.lines)),
    emits,
    states,
    a11y: joinLines(first("a11y")?.lines ?? []),
    examples,
  };
}

// @component at the start of a line (after an optional gutter star) or right after "/**" on one line.
// The negative lookahead keeps "@component-free" or "@components" from counting as the tag.
const HAS_COMPONENT = /(?:^|\n)\s*(?:\/\*\*|\*)?\s*@component(?![\w-])/;

/** Drop leading whitespace and comments. @param {string} t */
function stripLead(t) {
  let r = t;
  for (;;) {
    const n = r.replace(/^\s+/, "").replace(/^\/\*[\s\S]*?\*\/|^\/\/[^\n]*/, "");
    if (n === r) return r;
    r = n;
  }
}

/**
 * True when an initializer expression is a function: a function expression, an arrow with any
 * parameter list (nested parens included), or one of those wrapped in parentheses (a JSDoc cast).
 * @param {string} init the text after "="
 * @param {string} where for the error message
 * @returns {boolean}
 */
function isFunctionInit(init, where) {
  const t = stripLead(init);
  if (/^(?:async\s+)?function\b/.test(t)) return true;
  if (/^(?:async\s+)?[A-Za-z_$][\w$]*\s*=>/.test(t)) return true;
  const open = /^(?:async\s*)?\(/.exec(t);
  if (!open) return false;
  const start = open[0].length - 1;
  let depth = 0;
  let i = start;
  for (; i < t.length; i++) {
    if (t[i] === "(") depth++;
    else if (t[i] === ")" && --depth === 0) break;
  }
  if (depth !== 0) throw new Error(where + ": cannot classify this export (unbalanced parentheses)");
  if (/^\s*=>/.test(t.slice(i + 1))) return true;
  // "(function ...)" or "/** @type {T} */ ((p) => ...)": a parenthesised function.
  return !open[0].startsWith("async") && isFunctionInit(t.slice(start + 1, i), where);
}

/**
 * Every top-level exported function in a module: its name and the index of the "export".
 * Throws "cannot classify" for an export form that cannot be tied to a doc block.
 * @param {string} text @param {string} rel
 * @returns {{ name: string, index: number }[]}
 */
function findExports(text, rel) {
  /** @type {{ name: string, index: number }[]} */
  const out = [];
  for (const m of text.matchAll(/^export\s+/gm)) {
    const index = m.index ?? 0;
    const rest = text.slice(index + m[0].length);
    const where = rel + " (offset " + index + ")";
    let f = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(rest);
    if (f) {
      out.push({ name: f[1], index });
      continue;
    }
    if (/^default\b/.test(rest)) {
      f = /^default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)?/.exec(rest);
      if (!f) throw new Error(where + ": cannot classify \"export default\" of a non-function; use a named export");
      out.push({ name: f[1] || "default", index });
      continue;
    }
    if (/^[{*]/.test(rest)) {
      throw new Error(where + ": cannot classify \"export " + rest.slice(0, 1) + " ...\"; export the declaration itself so its @component block sits above it");
    }
    const d = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=/.exec(rest);
    if (d) {
      if (isFunctionInit(rest.slice(d[0].length), where)) out.push({ name: d[1], index });
      continue;
    }
    if (/^(?:const|let|var)\s+[{[]/.test(rest)) throw new Error(where + ": cannot classify a destructuring export");
  }
  return out;
}

/**
 * The JSDoc block directly above an export (blank lines and line comments may intervene).
 * @param {string} text @param {number} index
 * @returns {{ start: number, text: string } | null}
 */
function blockAbove(text, index) {
  let head = text.slice(0, index).trimEnd();
  for (;;) {
    // A trailing line comment after the closing "*/" is allowed.
    head = head.replace(/\*\/[ \t]*\/\/[^\n]*$/, "*/");
    const nl = head.lastIndexOf("\n");
    const lastLine = head.slice(nl + 1).trim();
    if (lastLine.startsWith("//")) head = head.slice(0, Math.max(nl, 0)).trimEnd();
    else break;
  }
  if (!head.endsWith("*/")) return null;
  const start = head.lastIndexOf("/**");
  if (start < 0) return null;
  const block = head.slice(start);
  // A "/**" that is really inside an earlier, already closed block would contain a "*/" mid-way.
  if (block.indexOf("*/") !== block.length - 2) return null;
  return { start, text: block };
}

/**
 * Shared classes a component's markup may use, and the sibling stylesheet that defines each.
 * A data-tip attribute needs tip.css, which styles the card the client tip layer draws.
 * @type {Array<[RegExp, string]>}
 */
export const SHARED_CSS = [
  [/\bgk-btn\b/, "button.css"],
  [/\bgk-input\b/, "input.css"],
  [/\bgk-sheet\b/, "sheet.css"],
  [/\bgk-chart(\b|__)/, "chartParts.css"],
  [/\bgk-table\b/, "table.css"],
  [/\bgk-inputGroup\b/, "inputGroup.css"],
  [/\bdata-tip\b/, "tip.css"],
];

/**
 * The shared stylesheets a components module relies on (its own CSS excluded), as paths
 * relative to the ui package, in SHARED_CSS order.
 * @param {string} text module source @param {string} file absolute path @param {string} root
 * @returns {string[]}
 */
export function sharedCssDeps(text, file, root) {
  const dir = path.dirname(file);
  const own = path.basename(file).replace(/\.js$/, ".css");
  /** @type {string[]} */ const out = [];
  for (const [re, name] of SHARED_CSS) {
    const dep = path.join(dir, name);
    if (name === own || !re.test(text) || !fs.existsSync(dep)) continue;
    out.push(path.relative(root, dep).split(path.sep).join("/"));
  }
  return out;
}

/**
 * The stylesheets a kit component needs, depth first: the components it imports with a relative
 * path, its shared stylesheets, then its own. Each path once, relative to the ui package.
 * @param {string} name component module name without ".js"
 * @param {string} componentsDir @param {string} root @param {string[]} out @param {Set<string>} seen
 */
function componentCss(name, componentsDir, root, out, seen) {
  const file = path.join(componentsDir, name + ".js");
  if (seen.has(name) || !fs.existsSync(file)) return;
  seen.add(name);
  const text = fs.readFileSync(file, "utf8");
  for (const m of text.matchAll(/from\s+["']\.\/([A-Za-z0-9_-]+)\.js["']/g)) componentCss(m[1], componentsDir, root, out, seen);
  const add = (/** @type {string} */ abs) => {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    // A stylesheet holding only comments (tableModel.css) adds nothing, so it is not listed.
    if (fs.existsSync(abs) && !out.includes(rel) && fs.readFileSync(abs, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").trim() !== "") out.push(rel);
  };
  for (const d of sharedCssDeps(text, file, root)) if (!out.includes(d)) out.push(d);
  add(file.replace(/\.js$/, ".css"));
}

/**
 * The cssDeps of a component: the stylesheets of the kit components it imports with a relative
 * path (depth first) and the shared ones it uses, without its own stylesheet.
 * @param {string} file absolute path @param {string} root @param {string} componentsDir
 * @returns {string[]}
 */
export function componentCssDeps(file, root, componentsDir) {
  /** @type {string[]} */ const out = [];
  componentCss(path.basename(file).replace(/\.js$/, ""), path.dirname(file) || componentsDir, root, out, new Set());
  const own = path.relative(root, file.replace(/\.js$/, ".css")).split(path.sep).join("/");
  return out.filter((d) => d !== own);
}

/**
 * The cssDeps of a block: the stylesheets of the components it imports from ../components/, and
 * the shared ones its own markup uses.
 * @param {string} text block source @param {string} file absolute path @param {string} root @param {string} componentsDir
 * @returns {string[]}
 */
export function blockCssDeps(text, file, root, componentsDir) {
  /** @type {string[]} */ const out = [];
  const seen = new Set();
  for (const m of text.matchAll(/from\s+["']\.\.\/components\/([A-Za-z0-9_-]+)\.js["']/g)) componentCss(m[1], componentsDir, root, out, seen);
  // The shared stylesheets sit in the components folder, so look there, as if the block lived beside them.
  for (const d of sharedCssDeps(text, path.join(componentsDir, path.basename(file)), root)) if (!out.includes(d)) out.push(d);
  return out;
}

/**
 * Parse one components or blocks file.
 * @param {string} file absolute path
 * @param {string} root the ui package root
 * @param {"component" | "block"} kind
 * @param {string} componentsDir
 * @returns {{ components: ManifestComponent[], missing: string[], dangling: string[] }}
 */
function parseFile(file, root, kind, componentsDir) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).split(path.sep).join("/");
  const cssFile = file.replace(/\.js$/, ".css");
  const css = fs.existsSync(cssFile) ? path.relative(root, cssFile).split(path.sep).join("/") : null;
  const cssDeps = kind === "block" ? blockCssDeps(text, file, root, componentsDir) : componentCssDeps(file, root, componentsDir);
  /** @type {ManifestComponent[]} */
  const components = [];
  /** @type {string[]} */
  const missing = [];
  const claimed = new Set();
  for (const e of findExports(text, rel)) {
    const fn = e.name;
    const block = blockAbove(text, e.index);
    const hasComponent = block !== null && HAS_COMPONENT.test(block.text);
    if (block && hasComponent) {
      claimed.add(block.start);
      const parsed = parseComponent(block.text);
      components.push({ ...parsed, kind, module: rel, export: fn, css, cssDeps });
    } else if (fn.startsWith("_") || (block !== null && /@internal\b/.test(block.text))) {
      continue;
    } else {
      missing.push(rel + ": " + fn);
    }
  }
  /** @type {string[]} */
  const dangling = [];
  for (const m of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    if (HAS_COMPONENT.test(m[0]) && !claimed.has(m.index)) {
      dangling.push(rel + ": @component block not followed by an exported function");
    }
  }
  return { components, missing, dangling };
}

/**
 * Build the manifest from every *.js file in a components directory and, when it exists, in the
 * sibling blocks directory (default: ../blocks next to the components directory).
 * @param {{ componentsDir: string, blocksDir?: string }} opts
 * @returns {Manifest}
 */
export function buildManifest({ componentsDir, blocksDir }) {
  const dir = path.resolve(componentsDir);
  const root = path.resolve(dir, "..", "..");
  const blocks = path.resolve(blocksDir ?? path.join(dir, "..", "blocks"));
  /** @type {Array<[string, "component" | "block"]>} */
  const dirs = [[dir, "component"]];
  if (fs.existsSync(blocks) && fs.statSync(blocks).isDirectory()) dirs.push([blocks, "block"]);
  /** @type {ManifestComponent[]} */
  const components = [];
  /** @type {string[]} */
  const problems = [];
  for (const [d, kind] of dirs) {
    for (const f of fs.readdirSync(d).filter((x) => x.endsWith(".js")).sort()) {
      const r = parseFile(path.join(d, f), root, kind, dir);
      components.push(...r.components);
      problems.push(...r.missing.map((x) => x + " is exported without an @component block (or @internal)"), ...r.dangling);
    }
  }
  const seen = new Set();
  for (const c of components) {
    if (!c.name) problems.push(c.module + ": " + c.export + " has an empty @component name");
    else if (!/^[A-Za-z_$][\w$]*$/.test(c.name)) problems.push(c.module + ": @component name must be a single identifier, got \"" + c.name + "\"");
    if (!c.category) problems.push(c.module + ": " + c.name + " has no @category tag");
    if (seen.has(c.name)) problems.push("duplicate @component name: " + c.name);
    seen.add(c.name);
  }
  if (problems.length) throw new Error("component manifest: " + problems.length + " problem(s):\n  " + problems.join("\n  "));
  components.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { version: 1, components };
}

/** The exact text committed to disk. @param {Manifest} manifest */
export function renderManifest(manifest) {
  return JSON.stringify(manifest, null, 2) + "\n";
}

/**
 * Write the manifest as pretty JSON with a trailing newline.
 * @param {{ componentsDir: string, blocksDir?: string, out: string }} opts
 * @returns {Manifest}
 */
export function writeManifest({ componentsDir, blocksDir, out }) {
  const manifest = buildManifest({ componentsDir, blocksDir });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, renderManifest(manifest));
  return manifest;
}

/**
 * Compare the file on disk with a fresh build, by exact text.
 * @param {{ componentsDir: string, blocksDir?: string, out: string }} opts
 * @returns {{ ok: boolean, message: string }}
 */
export function checkManifest({ componentsDir, blocksDir, out }) {
  const fresh = renderManifest(buildManifest({ componentsDir, blocksDir }));
  if (!fs.existsSync(out)) return { ok: false, message: out + " is missing. Run: npm run manifest" };
  if (fs.readFileSync(out, "utf8") !== fresh) return { ok: false, message: out + " is stale. Run: npm run manifest" };
  return { ok: true, message: out + " is up to date" };
}

/**
 * CLI entry. Returns the process exit code.
 * @param {string[]} argv
 * @returns {number}
 */
export function main(argv) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const usage = "usage: manifest.mjs [--check] [--dir <componentsDir>] [--out <file>] [--help]";
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(usage);
    return 0;
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") continue;
    if (a === "--dir" || a === "--out") {
      i++;
      continue;
    }
    console.error("manifest: unknown argument " + a + "\n" + usage);
    return 1;
  }
  const arg = (/** @type {string} */ k, /** @type {string} */ d) => {
    const i = argv.indexOf(k);
    if (i < 0) return d;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error("manifest: " + k + " needs a value");
    return path.resolve(v);
  };
  try {
    const componentsDir = arg("--dir", path.resolve(here, "..", "..", "ui", "src", "components"));
    const out = arg("--out", path.resolve(here, "..", "..", "ui", "components.json"));
    if (argv.includes("--check")) {
      const r = checkManifest({ componentsDir, out });
      (r.ok ? console.log : console.error)(r.message);
      return r.ok ? 0 : 1;
    }
    const m = writeManifest({ componentsDir, out });
    const nb = m.components.filter((c) => c.kind === "block").length;
    console.log("wrote " + out + " (" + (m.components.length - nb) + " components, " + nb + " blocks)");
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

/** The real path of the entry script, so a run through a workspace symlink still matches. */
function entryUrl() {
  if (!process.argv[1]) return "";
  try {
    return pathToFileURL(fs.realpathSync(process.argv[1])).href;
  } catch {
    return pathToFileURL(path.resolve(process.argv[1])).href;
  }
}

if (import.meta.url === entryUrl()) {
  process.exitCode = main(process.argv.slice(2));
}

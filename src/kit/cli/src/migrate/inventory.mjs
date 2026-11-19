// Scans a source tree with the migrate scanners and fills the Inventory (the shape of
// .migrate/inventory.json): files, the findings per file, server globals and what kind of entry each
// is, the rpc names, routes and shortcuts, the config to carry into the target and the score of every
// profile. Reading only: every byte comes through the SourceTree. Deterministic: every list is sorted
// or in source order, so two runs over the same source render the same JSON. A secret suspect is the
// name of an identifier that is assigned a string literal; the literal is never recorded.
import { checkAccent, checkPrefix, checkProduct, checkTz, titleFromSlug } from "../values.mjs";
import { tokenizeJs, scanJs } from "./scan/js.mjs";
import { scanHtml } from "./scan/html.mjs";
import { scanCss } from "./scan/css.mjs";
import { scanClasp, scanManifest } from "./scan/manifest.mjs";
import { INVENTORY_SCHEMA } from "./schema.mjs";
import * as kitShaped from "./profiles/kitShaped.mjs";
import * as elBuilder from "./profiles/elBuilder.mjs";
import * as classic from "./profiles/classic.mjs";

/** The profiles, in the order their scores are listed. */
export const PROFILES = [kitShaped, elBuilder, classic];

/** @typedef {{ key: string, line: number, name: string }} SecretSuspect */
/** @typedef {Required<import("./schema.mjs").Inventory> & { secretSuspects: SecretSuspect[] }} FullInventory what buildInventory returns: every optional list filled */

const SECRETISH = /(api[_-]?key|secret|token|password)/i;
const MENU = new Set(["onOpen", "onEdit", "onInstall"]);
const MIN_SCORE = 40;
const TIE = 10;

/**
 * The profile the scores point at. Throws when none is clear: the best under 40 or within 10 of the
 * runner-up. A forced name wins without a look at the scores.
 * @param {{ name: string, score: number, evidence?: string[] }[]} scores
 * @param {string | null | undefined} [forced]
 * @returns {string}
 */
export function chooseProfile(scores, forced) {
  if (forced && forced !== "auto") {
    if (!PROFILES.some((p) => p.name === forced)) throw new Error("unknown profile " + JSON.stringify(forced) + " (kit-shaped, el-builder or classic)");
    return forced;
  }
  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const best = sorted[0];
  const next = sorted[1];
  const list = scores.map((s) => s.name + " " + s.score).join(", ");
  if (!best || best.score < MIN_SCORE) throw new Error("cannot tell the profile (" + list + "); pass --profile");
  if (next && best.score - next.score < TIE) throw new Error("cannot tell the profile, " + best.name + " and " + next.name + " are too close (" + list + "); pass --profile");
  return best.name;
}

/**
 * @param {import("./sourceTree.mjs").SourceTree} tree
 * @param {import("./schema.mjs").Inventory} [inv]
 */
export function scoreProfiles(tree, inv) {
  return PROFILES.map((p) => ({ name: p.name, ...p.detect(tree, inv) }));
}

/** @param {string} key */
const base = (key) => key.slice(key.lastIndexOf("/") + 1);

/**
 * Sum two findings objects: lists are joined, counts added.
 * @param {any} a @param {any} b
 */
function mergeFindings(a, b) {
  for (const k of Object.keys(b)) {
    if (Array.isArray(b[k])) a[k] = (a[k] ?? []).concat(b[k]);
    else if (typeof b[k] === "number") a[k] = (a[k] ?? 0) + b[k];
  }
  return a;
}

/**
 * Identifiers named like a credential that are assigned a string literal. Names and places only.
 * @param {string} text @param {string} key @param {number} lineBase
 * @returns {SecretSuspect[]}
 */
function secretSuspects(text, key, lineBase) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  /** @type {SecretSuspect[]} */
  const out = [];
  for (let i = 0; i + 2 < toks.length; i++) {
    const t = /** @type {any} */ (toks[i]);
    const op = /** @type {any} */ (toks[i + 1]);
    const v = /** @type {any} */ (toks[i + 2]);
    if (t.type !== "ident" || !SECRETISH.test(t.value) || v.type !== "string") continue;
    const empty = v.value.length <= 2;
    if (empty) continue;
    const prev = toks[i - 1];
    const assigned = op.type === "punct" && op.value === "=";
    const member = op.type === "punct" && op.value === ":" && prev && prev.type === "punct" && (prev.value === "{" || prev.value === ",");
    if (assigned || member) out.push({ key, line: lineBase + t.line - 1, name: t.value });
  }
  return out;
}

/**
 * The first title worth carrying: an index page first, no scriptlet or placeholder in it.
 * @param {Map<string, import("./scan/html.mjs").HtmlFindings>} html
 */
function pageTitle(html) {
  const keys = [...html.keys()].sort((a, b) => Number(!/^index/i.test(base(a))) - Number(!/^index/i.test(base(b))) || (a < b ? -1 : 1));
  for (const k of keys) {
    const t = html.get(k)?.docTitle?.trim();
    if (t && !/<\?|\{\{/.test(t)) return t;
  }
  return null;
}

/** @param {string} key a file key @returns {number} 0 for the source root, 1 for a shared one */
const rootOf = (key) => (key.startsWith("@") ? 1 : 0);

/**
 * The top-level keys of the first PAGES = { ... } object literal, whatever its values hold (a page
 * entry is often an object itself). Strings, templates and comments are stepped over, so a brace in
 * one does not end the table; an unbalanced table gives the keys read so far.
 * @param {string} src
 * @returns {string[]}
 */
export function pagesKeys(src) {
  const m = /\bPAGES\s*=\s*\{/.exec(src);
  if (!m) return [];
  /** @type {string[]} */
  const keys = [];
  let depth = 0;
  let expectKey = true;
  for (let i = m.index + m[0].length; i < src.length; i++) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      if (depth === 0 && expectKey && c !== "`" && /^\s*:/.test(src.slice(j + 1, j + 40))) {
        keys.push(src.slice(i + 1, j));
        expectKey = false;
      }
      i = j;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      if (depth === 0) break;
      depth--;
    } else if (c === "," && depth === 0) expectKey = true;
    else if (depth === 0 && expectKey && c !== undefined && /[A-Za-z_$]/.test(c)) {
      const id = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))?.[0] ?? c;
      if (/^\s*:/.test(src.slice(i + id.length, i + id.length + 40))) keys.push(id);
      expectKey = false;
      i += id.length - 1;
    }
  }
  return keys;
}

/** A test file, by its name or its folder. */
const TEST_FILE = /(?:^|\/)(?:test|tests|__tests__|e2e)\/|\.(?:test|spec)\.[cm]?[jt]s$/;
/** Server code by its place: a server folder, a .gs file, a built server bundle. */
const SERVER_FILE = /(?:^|\/)server\/|(?:^|\/)(?:dist|build)\/(?:server|entry|Code)\.[cm]?js$/;

/**
 * Whether a script's RPC-shaped calls name endpoints: browser code only, never a test, a server module
 * or a file that defines doGet.
 * @param {string} key
 * @param {{ functions: { name: string }[] }} f
 * @param {string | undefined} kind
 */
export function rpcCaller(key, f, kind) {
  const bare = key.replace(/^@[^/]+\//, "");
  if (kind === "gs" || TEST_FILE.test(bare) || SERVER_FILE.test(bare)) return false;
  return !f.functions.some((fn) => fn.name === "doGet" || fn.name === "doPost");
}

/**
 * @param {import("./sourceTree.mjs").SourceTree} tree
 * @param {{ profile?: string | null, fidelity?: string }} [opts] profile: "auto" (default) chooses and throws
 *   when it cannot; a name forces it; null leaves profile null and never throws
 * @returns {FullInventory}
 */
export function buildInventory(tree, { profile = "auto" } = {}) {
  const keys = [...tree.files.keys()].sort();
  /** @type {import("./schema.mjs").InventoryFile[]} */
  const files = keys.map((k) => {
    const f = /** @type {import("./sourceTree.mjs").SourceFile} */ (tree.files.get(k));
    return { key: k, bytes: f.bytes, sha256: f.sha256, kind: f.kind };
  });
  /** @type {Record<string, import("./scan/js.mjs").JsFindings>} */
  const js = {};
  /** @type {Record<string, import("./scan/html.mjs").HtmlFindings>} */
  const html = {};
  /** @type {Record<string, import("./scan/css.mjs").CssFindings>} */
  const css = {};
  /** @type {SecretSuspect[]} */
  const suspects = [];
  /** @type {Record<string, string>} */
  const text = {};
  /** @type {import("./scan/manifest.mjs").ManifestFindings | null} */
  let manifest = null;
  /** @type {import("./scan/manifest.mjs").ClaspFindings | null} */
  let clasp = null;
  /** @type {string | null} */
  let packageName = null;

  const manifestKey = keys.filter((k) => base(k) === "appsscript.json").sort((a, b) => rootOf(a) - rootOf(b) || a.split("/").length - b.split("/").length || (a < b ? -1 : 1))[0];
  const claspKey = keys.find((k) => k === ".clasp.json") ?? keys.find((k) => k === ".clasp.json.example");
  if (manifestKey) manifest = scanManifest(tree.read(manifestKey));
  if (claspKey) clasp = scanClasp(tree.read(claspKey));

  for (const key of keys) {
    const kind = /** @type {import("./sourceTree.mjs").SourceFile} */ (tree.files.get(key)).kind;
    if (kind === "js" || kind === "ts" || kind === "gs") {
      const t = tree.read(key);
      text[key] = t;
      js[key] = scanJs(t);
      suspects.push(...secretSuspects(t, key, 1));
    } else if (kind === "html") {
      const t = tree.read(key);
      text[key] = t;
      const h = scanHtml(t);
      for (const s of h.scripts) {
        if (s.src || !s.inline.trim()) continue;
        const inline = scanJs(s.inline);
        // a hash link finding names its line in the page, so the person can find it
        inline.hashLinks = inline.hashLinks.map((l) => ({ ...l, line: l.line + s.line - 1 }));
        inline.relativeLinks = inline.relativeLinks.map((l) => ({ ...l, line: l.line + s.line - 1 }));
        inline.scriptProps = inline.scriptProps.map((l) => ({ ...l, line: l.line + s.line - 1 }));
        js[key] = mergeFindings(js[key] ?? scanJs(""), inline);
        suspects.push(...secretSuspects(s.inline, key, s.line));
      }
      if (h.styles.length) css[key] = scanCss(h.styles.map((s) => s.inline).join("\n"));
      // The inventory holds findings, not the source: inline script and style text stays in the
      // source (it may hold a credential), and a scriptlet that assigns one is kept without its code.
      h.scripts = h.scripts.map((s) => ({ ...s, inline: "" }));
      h.styles = h.styles.map((s) => ({ ...s, inline: "" }));
      h.scriptlets = h.scriptlets.map((s) => {
        const bad = secretSuspects(s.code, key, s.line);
        suspects.push(...bad);
        return bad.length ? { ...s, code: "" } : s;
      });
      html[key] = h;
    } else if (kind === "css") {
      css[key] = scanCss(tree.read(key));
    } else if (key === "package.json" && !packageName) {
      try {
        const n = JSON.parse(tree.read(key)).name;
        if (typeof n === "string") packageName = n;
      } catch {
        packageName = null;
      }
    }
  }

  // ---- rpc, routes, keyboard
  // Only browser code calls the server: a test, a server module or a built server bundle that calls a
  // function named like a wrapper (a server read-model cache called cached, say) names no endpoint.

  /** @type {Set<string>} */
  const rpc = new Set();
  /** @type {Set<string>} */
  const routeSet = new Set();
  /** @type {Set<string>} */
  const keyboard = new Set();
  /** @type {string[]} */
  const pageRoutes = [];
  for (const key of keys) {
    const f = js[key];
    if (!f) continue;
    const browser = rpcCaller(key, f, tree.files.get(key)?.kind);
    if (browser) for (const r of f.rpc) rpc.add(r.name);
    for (const r of f.routes) if (r.value !== "#/") routeSet.add(r.value.replace(/^(#\/[^?]*)\?.*$/, "$1"));
    for (const k of f.keys) keyboard.add(k.key);
    const src = text[key] ?? "";
    // el-builder: the PAGES table, in source order
    if (browser && !/(?:^|\/)(?:dev|tools|scripts)\//.test(key.replace(/^@[^/]+\//, ""))) for (const name of pagesKeys(src)) pageRoutes.push("#/" + name);
    // kit-shaped: ?r=<name> as the router writes it
    if (/google\.script\.(?:url|history)/.test(src) || /\bgo\s*\(/.test(src)) {
      for (const m of src.matchAll(/\b(?:r|route)\s*(?:===|:)\s*"([a-z][a-z0-9-]*)"/g)) routeSet.add("?r=" + m[1]);
    }
  }
  // classic: ?page=<name> in links and in the server's parameter checks
  for (const key of keys) {
    const src = text[key] ?? "";
    if (html[key] || /\.gs$/.test(key)) {
      for (const m of src.matchAll(/[?&]page=([A-Za-z0-9_-]+)/g)) routeSet.add("?page=" + m[1]);
      if (/\.gs$/.test(key)) for (const m of src.matchAll(/\bpage\s*===?\s*"([A-Za-z0-9_-]+)"/g)) routeSet.add("?page=" + m[1].toLowerCase());
    }
  }
  const routes = [...new Set([...pageRoutes, ...[...routeSet].sort()])];

  // ---- server globals
  const triggerNames = new Set();
  for (const key of keys) for (const m of (text[key] ?? "").matchAll(/newTrigger\(\s*["']([A-Za-z_$][\w$]*)["']/g)) triggerNames.add(m[1]);
  /** @type {{ name: string, kind: string, key: string, line: number }[]} */
  const globals = [];
  for (const key of keys) {
    const f = js[key];
    if (!f || html[key]) continue;
    const isGs = tree.files.get(key)?.kind === "gs";
    const serverEntry = f.functions.some((fn) => fn.name === "doGet" && !fn.exported);
    if (!isGs && !serverEntry) continue;
    for (const fn of f.functions) {
      if (fn.exported) continue;
      const name = fn.name;
      /** @type {string} */
      let kind;
      if (name === "doGet" || name === "doPost") kind = "doGet";
      else if (name === "include") kind = "include";
      else if (MENU.has(name)) kind = "menu";
      else if (name.startsWith("trigger_") || triggerNames.has(name)) kind = "trigger";
      else if (name.startsWith("api_") || rpc.has(name)) kind = "endpoint";
      else if (name.endsWith("_")) continue; // private to the script: not callable from outside
      else kind = "editor";
      globals.push({ name, kind, key, line: fn.line });
    }
  }
  globals.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.line - b.line));

  // ---- config
  /** @type {string[]} */
  const storageKeys = [];
  /** @type {{ key: string, raw: boolean | null }[]} */
  const stored = [];
  /** @type {Set<string>} keys named through a prefixing helper: already relative to the prefix */
  const relative = new Set();
  for (const key of keys) {
    if (TEST_FILE.test(key.replace(/^@[^/]+\//, ""))) continue;
    for (const s of js[key]?.storage ?? []) {
      if (!s.key) continue;
      stored.push({ key: s.key, raw: s.raw });
      if (s.keyVia) relative.add(s.key);
    }
  }
  for (const s of stored) if (!relative.has(s.key)) storageKeys.push(s.key);
  /** @type {string | null} */
  let prefix = null;
  // The app's own declaration wins over a shared lib's, and a test's never counts (a shared lib's
  // test config may declare a prefix of its own).
  const prefixKeys = [...keys.filter((k) => !k.startsWith("@")), ...keys.filter((k) => k.startsWith("@"))].filter((k) => !TEST_FILE.test(k.replace(/^@[^/]+\//, "")));
  for (const key of prefixKeys) {
    const m = /\bstoragePrefix\s*:\s*"([^"]*)"/.exec(text[key] ?? "");
    if (m && !checkPrefix(/** @type {string} */ (m[1]))) {
      prefix = /** @type {string} */ (m[1]);
      break;
    }
  }
  if (!prefix && storageKeys.length) {
    const firsts = new Set(storageKeys.map((k) => (k.includes(".") ? k.slice(0, k.indexOf(".") + 1) : "")));
    const only = firsts.size === 1 ? [...firsts][0] : null;
    if (only && !checkPrefix(only)) prefix = only;
  }
  // A key is raw when some write stores a plain string; a key only ever read is left out unless
  // its read compares to a string. Named-through-a-helper keys are relative already.
  const rawKeys = [...new Set(stored.filter((s) => s.raw === true || (s.raw === null && !stored.some((o) => o.key === s.key && o.raw === false))).map((s) => (relative.has(s.key) ? s.key : prefix && s.key.startsWith(prefix) ? s.key.slice(prefix.length) : s.key)))].sort();

  /** @type {string | null} */
  let product = null;
  /** @type {(string | null)[]} */
  const candidates = [];
  for (const key of keys) {
    const m = /\bproductName\s*:\s*"([^"]*)"/.exec(text[key] ?? "");
    if (m) {
      candidates.push(m[1] ?? null);
      break;
    }
  }
  candidates.push(pageTitle(new Map(Object.entries(html))));
  if (packageName) candidates.push(titleFromSlug(packageName.replace(/^@[^/]+\//, "")));
  for (const c of candidates) {
    if (c && !checkProduct(c)) {
      product = c;
      break;
    }
  }

  /** @type {string | null} */
  let accent = null;
  const cssKeys = Object.keys(css).sort((a, b) => rootOf(a) - rootOf(b) || Number(!/tokens/.test(base(a))) - Number(!/tokens/.test(base(b))) || (a < b ? -1 : 1));
  for (const k of cssKeys) {
    const d = css[k]?.defines.find((x) => x.name === "--accent" && !x.media && !checkAccent(x.value.trim()));
    if (d) {
      accent = d.value.trim();
      break;
    }
  }
  const tz = manifest?.timeZone ?? null;

  /** @type {FullInventory} */
  const inv = {
    schema: INVENTORY_SCHEMA,
    source: {
      roots: tree.roots.map((r) => ({ name: r.name })),
      digest: tree.digest(),
      git: { repo: tree.git.repo, clean: tree.git.clean, head: tree.git.head },
    },
    files,
    skipped: [...tree.skipped].map((s) => ({ key: s.key, why: s.why })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    profiles: [],
    profile: null,
    config: { product, timeZone: tz && !checkTz(tz) ? tz : null, accent, prefix, rawKeys },
    js,
    html,
    css,
    manifest,
    clasp,
    globals,
    rpc: [...rpc].sort(),
    routes,
    keyboard: [...keyboard].sort(),
    secretSuspects: suspects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.line - b.line)),
  };

  inv.profiles = scoreProfiles(tree, inv);
  inv.profile = profile === null ? null : chooseProfile(inv.profiles, profile);
  return inv;
}

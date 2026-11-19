// The copy-pages step of the kit-shaped profile, in two runs. The first (copy-pages) ports the
// source's page views (src/client/pages/*.js) and the client modules they and the entry import
// (outside lib/, which kit-imports mapped) to src/client/migrated/, through portClientJs: the same
// markup and classes as the source (so its CSS, kept in the legacy layer, styles them as before),
// imports pointed at the kit or the copies, html templates fitted to the kit's tag (a hash link
// gets target="_self"), parameters typed. A page that breaks a kit rule stays in .migrate/pending with an agent step port-page-<name>.
// The source's url-state module (one that drives google.script.url / google.script.history) is
// kept with the same exported functions, its two globals swapped for lib/scriptUrl.js, which speaks
// the kit's hash route instead: getLocation reads the hash back into the source's query parameters
// (on every hash change, so the module's state follows the router), and push writes the hash. What
// is lost: links the app builds become hash links (#/item/a1), and the top URL no longer carries the
// route, until the kit has a google.script.history bridge. The entry (main.js) is read, never run:
// its page switch (renderRegion(root, page(await call("rpc", args)))) gives each page its rpc, args
// and legacy route, which become plan.maps.routes (list, the default branch, is "/"; a page whose
// args take the route's id is "/<page>/:id"), so the routes step that follows translates old links
// to the same paths. Its other top-level statements (delegated actions, keyboard shortcuts) become
// wireLegacy(root) in src/client/migrated/entry.js, installed once on the router's region.
// The second run (page-routes, spawned to wait for routes and rpc-surface) writes, per page, the
// router mount src/client/migrated/pages/<page>.route.js (the source's switch for that page, with
// the endpoint's carried name from maps.rpc) and adds its line at the markers of routes.js.
// In reskin mode each page also gets a note naming kit components (packages/ui/components.json)
// that could stand in for its markup, for the agent; the port itself is the same in both modes.
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { kebab } from "../maps.mjs";
import { tokenizeJs, unquote } from "../scan/js.mjs";
import { jsHeader, pendingPath } from "./_common.mjs";
import { agentStep, domainTarget, importSites, listOf, relSpec, spawnId, stem } from "./copyDomain.mjs";
import { LIB, MIGRATED, clientRuleBreaks, closeOf, importLine, openOf, portClientJs, splitArgs } from "./kitImports.mjs";

/** @typedef {import("../apply.mjs").StepContext} StepContext */
/** @typedef {import("../apply.mjs").StepResult} StepResult */
/** @typedef {import("../scan/js.mjs").JsToken} JsToken */
/** @typedef {import("./copyDomain.mjs").Located} Located */
/** @typedef {import("./copyDomain.mjs").SpawnStep} SpawnStep */

const CLIENT = "src/client/";
const PAGES = "src/client/pages/";
const MAIN = "src/client/main.js";
const ROUTES_JS = "src/client/migrated/routes.js";
const ENTRY_OUT = "src/client/migrated/entry.js";
const SCRIPT_URL = "src/client/migrated/lib/scriptUrl.js";
const SPAWNED = "page-routes";
const URL_STATE = /(?<![\w$.])google\s*\.\s*script\s*\.\s*(?:url|history)\b/;
const KIT_DOM = "@gas-kit/client/dom.js";
const KIT_URL = "@gas-kit/client/url.js";

/**
 * What one renderRegion call of the entry's page switch draws.
 * @typedef {object} Dispatch
 * @property {string} view the page function's local name in the entry
 * @property {string} viewExport its exported name in the page module
 * @property {string} pageKey
 * @property {string | null} rpc the endpoint the source called for the page's data
 * @property {string | null} args the source text of the call's params
 * @property {string | null} opts the source text of renderRegion's options
 * @property {{ name: string, reader: string, readerExport: string, readerKey: string } | null} route the route variable and the url-state function that reads it
 * @property {{ key: string, value: string } | null} cond the branch condition (route.key === value); null for the default branch
 * @property {boolean} usesId whether args read route.id
 * @property {number} line
 */

/**
 * The model of the source's client: pages, helpers, their target paths, the entry's switch and wiring.
 * @param {StepContext} ctx
 */
export function clientModel(ctx) {
  const modules = /** @type {Record<string, string>} */ (ctx.plan.maps.modules ?? {});
  const jsKeys = new Set(ctx.inv.files.filter((f) => f.key.startsWith(CLIENT) && f.kind === "js").map((f) => f.key));
  const pages = [...jsKeys].filter((k) => k.startsWith(PAGES)).sort();
  const hasMain = jsKeys.has(MAIN);
  /** @type {Set<string>} */
  const helpers = new Set();
  const queue = [...pages, ...(hasMain ? [MAIN] : [])];
  /** @type {Set<string>} */
  const seen = new Set();
  while (queue.length) {
    const k = /** @type {string} */ (queue.shift());
    if (seen.has(k)) continue;
    seen.add(k);
    for (const site of importSites(ctx.tree.read(k))) {
      if (site.dynamic || !site.spec.startsWith(".")) continue;
      const r = ctx.tree.resolve(k, site.spec);
      if (!r || !jsKeys.has(r) || r.startsWith(LIB) || r.startsWith(PAGES) || r === MAIN) continue;
      if (!helpers.has(r)) {
        helpers.add(r);
        queue.push(r);
      }
    }
  }
  /** @type {Set<string>} */
  const urlState = new Set([...helpers].filter((k) => URL_STATE.test(ctx.tree.read(k))));
  /** @type {Map<string, string>} */
  const targets = new Map();
  /** @type {Set<string>} */
  const taken = new Set(Object.entries(modules).filter(([k, v]) => k.startsWith(LIB) && typeof v === "string" && v.startsWith("src/")).map(([, v]) => v));
  for (const k of [...jsKeys].filter((x) => x.startsWith(LIB))) taken.add(MIGRATED + "lib/" + k.slice(LIB.length));
  taken.add(SCRIPT_URL);
  for (const k of pages) targets.set(k, MIGRATED + "pages/" + k.slice(PAGES.length));
  for (const k of [...helpers].sort()) {
    if (!urlState.has(k)) {
      targets.set(k, MIGRATED + k.slice(CLIENT.length));
      continue;
    }
    let t = MIGRATED + "lib/" + (k.split("/").pop() ?? k);
    if (taken.has(t)) t = MIGRATED + "lib/" + k.slice(CLIENT.length).replace(/\//g, "-");
    taken.add(t);
    targets.set(k, t);
  }
  return { modules, pages, helpers: [...helpers].sort(), urlState, targets, entry: hasMain ? entryModel(ctx, pages, urlState) : null };
}

/** Whether a token can end an expression. @param {JsToken} t */
const canEnd = (t) => ["ident", "number", "string", "regex"].includes(t.type) || (t.type === "template" && t.value.endsWith("`")) || (t.type === "punct" && [")", "]", "}"].includes(t.value));
const CONTINUES = new Set([".", "?.", "(", "[", ",", "+", "-", "*", "/", "%", "=", "==", "===", "!=", "!==", "<", ">", "<=", ">=", "&&", "||", "??", "?", ":", "=>", "+=", "-=", "*=", "/=", "&", "|", "^", "**", "in", "instanceof"]);
const BLOCK_STMT = new Set(["function", "class", "if", "for", "while", "try", "switch"]);

/**
 * The top-level statements of a script as token ranges [lo, hi).
 * @param {JsToken[]} toks non-comment tokens
 * @returns {[number, number][]}
 */
export function topStatements(toks) {
  /** @type {[number, number][]} */
  const out = [];
  let lo = 0;
  let i = 0;
  while (i < toks.length) {
    const t = /** @type {JsToken} */ (toks[i]);
    const head = toks.slice(lo, i + 1).find((x) => !(x.type === "ident" && (x.value === "export" || x.value === "async" || x.value === "default")));
    const block = head && head.type === "ident" && BLOCK_STMT.has(head.value);
    if ((t.type === "punct" && ["(", "[", "{"].includes(t.value)) || (t.type === "template" && t.value.startsWith("`") && t.value.endsWith("${"))) {
      const c = closeOf(toks, i);
      if (c < 0) return [...out, [lo, toks.length]];
      i = c;
      const next = toks[i + 1];
      if (t.value === "{" && block && !(next && next.type === "ident" && ["else", "catch", "finally"].includes(next.value))) {
        out.push([lo, i + 1]);
        lo = i + 1;
        i++;
        continue;
      }
    }
    if (toks[i] === t && t.type === "punct" && t.value === ";") {
      out.push([lo, i + 1]);
      lo = i + 1;
      i++;
      continue;
    }
    const end = /** @type {JsToken} */ (toks[i]);
    const next = toks[i + 1];
    if (next && next.line > end.line && canEnd(end) && !CONTINUES.has(next.value) && next.type !== "template" && !block) {
      out.push([lo, i + 1]);
      lo = i + 1;
    }
    i++;
  }
  if (lo < toks.length) out.push([lo, toks.length]);
  return out.filter(([a, b]) => b > a);
}

/**
 * Read the entry: its imports, its page switch and the statements that wire the page.
 * @param {StepContext} ctx @param {string[]} pages @param {Set<string>} urlState
 */
function entryModel(ctx, pages, urlState) {
  const text = ctx.tree.read(MAIN);
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  /** @type {Map<string, { key: string | null, imported: string, site: import("./copyDomain.mjs").ImportSite }>} */
  const imported = new Map();
  for (const site of importSites(text)) {
    if (site.dynamic || !site.names) continue;
    const key = site.spec.startsWith(".") ? ctx.tree.resolve(MAIN, site.spec) : null;
    for (const n of site.names) imported.set(n.local, { key, imported: n.imported, site });
  }
  const pageSet = new Set(pages);
  /** @param {string} name */
  const isView = (name) => {
    const i = imported.get(name);
    return !!i && !!i.key && pageSet.has(i.key) && i.imported !== "*";
  };
  /** @param {string} name */
  const isCall = (name) => {
    const i = imported.get(name);
    return !!i && (i.key ? i.key.startsWith(LIB) : i.site.spec === "@gas-kit/client/rpc.js") && i.imported === "call";
  };
  /** @param {string} name */
  const isReader = (name) => {
    const i = imported.get(name);
    return !!i && !!i.key && urlState.has(i.key) && i.imported !== "*" && i.imported !== "default";
  };
  const stmts = topStatements(toks);
  /** @param {number} k */
  const lineOf = (k) => /** @type {JsToken} */ (toks[k]).line;
  /** @param {number} a @param {number} b */
  const src = (a, b) => text.slice(/** @type {JsToken} */ (toks[a]).start, /** @type {JsToken} */ (toks[b - 1]).end);
  /** @type {Dispatch[]} */
  const dispatch = [];
  /** @type {string[]} */
  const problems = [];
  let dispatcher = "";
  /** @type {[number, number] | null} */
  let dispatcherStmt = null;
  /** @type {Set<string>} */
  const roots = new Set();
  for (const st of stmts) {
    const [lo, hi] = st;
    let f = lo;
    if (toks[f]?.value === "async") f++;
    if (toks[f]?.value !== "function" || toks[f + 1]?.type !== "ident") continue;
    const name = String(toks[f + 1]?.value);
    const calls = [];
    for (let k = lo; k < hi; k++) if (toks[k]?.type === "ident" && toks[k]?.value === "renderRegion" && toks[k + 1]?.value === "(" && toks[k - 1]?.value !== ".") calls.push(k);
    if (!calls.length) continue;
    if (dispatcher) {
      problems.push("the entry draws pages from two functions (" + dispatcher + " and " + name + ")");
      continue;
    }
    dispatcher = name;
    dispatcherStmt = st;
    /** @type {{ name: string, reader: string } | null} */
    let routeVar = null;
    for (let k = lo; k < hi - 4; k++) {
      if (["const", "let", "var"].includes(String(toks[k]?.value)) && toks[k + 1]?.type === "ident" && toks[k + 2]?.value === "=" && toks[k + 3]?.type === "ident" && toks[k + 4]?.value === "(" && toks[k + 5]?.value === ")" && isReader(String(toks[k + 3]?.value))) {
        routeVar = { name: String(toks[k + 1]?.value), reader: String(toks[k + 3]?.value) };
        break;
      }
    }
    for (const k of calls) {
      const close = closeOf(toks, k + 1);
      const args = close < 0 ? [] : splitArgs(toks, k + 2, close);
      const line = lineOf(k);
      const d = readDispatch(toks, text, args, k, routeVar, { isView, isCall, imported });
      if (typeof d === "string") {
        problems.push("line " + line + ": " + d);
        continue;
      }
      roots.add(src(.../** @type {[number, number]} */ (args[0])));
      dispatch.push({ ...d, line });
    }
  }
  // The root the pages were drawn into: a top-level const from getElementById.
  /** @type {string | null} */
  let root = null;
  /** @type {[number, number] | null} */
  let rootStmt = null;
  if (roots.size > 1) problems.push("the entry draws pages into more than one element (" + [...roots].join(", ") + ")");
  const rootName = roots.size === 1 ? /** @type {string} */ ([...roots][0]) : null;
  for (const st of stmts) {
    const [lo, hi] = st;
    if (rootName && ["const", "let", "var"].includes(String(toks[lo]?.value)) && toks[lo + 1]?.value === rootName && toks[lo + 2]?.value === "=" && toks.slice(lo, hi).some((t) => t.value === "getElementById")) {
      root = rootName;
      rootStmt = st;
    }
  }
  if (rootName && !root) problems.push("the entry draws into " + rootName + ", which is not a top-level element it looks up by id");
  // Everything else at the top level wires the page: it moves into wireLegacy(root).
  /** @type {[number, number][]} */
  const wire = [];
  /** @type {string[]} */
  const dropped = [];
  for (const st of stmts) {
    const [lo, hi] = st;
    if (st === dispatcherStmt || st === rootStmt) continue;
    if (toks[lo]?.value === "import" && toks[lo + 1]?.value !== "(") continue;
    const body = toks.slice(lo, hi);
    if (dispatcher && body.some((t, n) => t.type === "ident" && t.value === dispatcher && body[n - 1]?.value !== ".")) {
      dropped.push(src(lo, hi).replace(/\s+/g, " ").replace(/;$/, "").slice(0, 80));
      continue;
    }
    if (toks[lo]?.value === "export") {
      problems.push("line " + lineOf(lo) + ": the entry exports something");
      continue;
    }
    if (body.some((t, n) => t.type === "ident" && t.value === "renderRegion" && body[n - 1]?.value !== ".")) {
      problems.push("line " + lineOf(lo) + ": the entry draws outside its page switch");
      continue;
    }
    wire.push(st);
  }
  /** @type {Set<string>} */
  const used = new Set();
  for (const [lo, hi] of wire) for (let k = lo; k < hi; k++) if (toks[k]?.type === "ident" && toks[k - 1]?.value !== "." && imported.has(String(toks[k]?.value))) used.add(String(toks[k]?.value));
  return { text, toks, imported, dispatch, dispatcher, problems, root: root ?? "root", wire: wire.map(([a, b]) => src(a, b)), used, dropped };
}

/**
 * One renderRegion call of the page switch, or why the step cannot read it.
 * @param {JsToken[]} toks @param {string} text @param {[number, number][]} args @param {number} k the renderRegion token
 * @param {{ name: string, reader: string } | null} routeVar
 * @param {{ isView: (n: string) => boolean, isCall: (n: string) => boolean, imported: Map<string, { key: string | null, imported: string }> }} is
 * @returns {Omit<Dispatch, "line"> | string}
 */
function readDispatch(toks, text, args, k, routeVar, is) {
  if (args.length < 2 || args.length > 3) return "renderRegion takes " + args.length + " arguments here";
  const [a0, a1] = /** @type {[[number, number], [number, number]]} */ ([args[0], args[1]]);
  if (a0[1] - a0[0] !== 1 || toks[a0[0]]?.type !== "ident") return "the region is not a plain variable";
  const [lo, hi] = a1;
  const view = String(toks[lo]?.value);
  if (!is.isView(view) || toks[lo + 1]?.value !== "(") return "it does not draw a page function the entry imports";
  const vClose = closeOf(toks, lo + 1);
  if (vClose !== hi - 1) return "the page is not drawn as page(...)";
  /** @param {number} a @param {number} b */
  const src = (a, b) => text.slice(/** @type {JsToken} */ (toks[a]).start, /** @type {JsToken} */ (toks[b - 1]).end);
  let rpc = null;
  /** @type {string | null} */
  let callArgs = null;
  let usesId = false;
  if (vClose > lo + 2) {
    const aw = lo + 2;
    if (toks[aw]?.value !== "await" || !is.isCall(String(toks[aw + 1]?.value)) || toks[aw + 2]?.value !== "(") return "the page's data is not await call(\"name\", params)";
    const cClose = closeOf(toks, aw + 2);
    if (cClose !== vClose - 1) return "the page's data is not await call(\"name\", params)";
    const cargs = splitArgs(toks, aw + 3, cClose);
    const first = cargs[0];
    if (!first || first[1] - first[0] !== 1 || toks[first[0]]?.type !== "string" || cargs.length > 2) return "the endpoint name is not a string literal, or call takes more than params";
    rpc = unquote(String(toks[first[0]]?.value));
    if (!/^[A-Za-z_$][\w$]*$/.test(rpc)) return "the endpoint name " + JSON.stringify(rpc.slice(0, 40)) + " is not an identifier";
    const second = cargs[1];
    if (second) {
      for (let j = second[0]; j < second[1]; j++) {
        const t = /** @type {JsToken} */ (toks[j]);
        if (t.type !== "ident") continue;
        if (toks[j - 1]?.value === "." || toks[j + 1]?.value === ":" || ["true", "false", "null", "undefined"].includes(t.value)) continue;
        if (routeVar && t.value === routeVar.name) {
          if (toks[j + 1]?.value === "." && toks[j + 2]?.value === "id") usesId = true;
          continue;
        }
        return "the endpoint's params use " + t.value + ", which only the entry knows";
      }
      callArgs = src(second[0], second[1]);
    }
  }
  // The branch: if (r.key === "value") renderRegion(...) or else renderRegion(...).
  let p = k - 1;
  if (toks[p]?.value === "{") p--;
  /** @type {{ key: string, value: string } | null} */
  let cond = null;
  if (toks[p]?.value === ")") {
    const open = openOf(toks, p);
    if (toks[open - 1]?.value !== "if") return "the page is drawn under a condition that is not an if";
    const c = toks.slice(open + 1, p);
    const lhs = c.length === 5 && c[0]?.type === "ident" && c[1]?.value === "." && (c[3]?.value === "===" || c[3]?.value === "==") && c[4]?.type === "string";
    const rhs = c.length === 5 && c[0]?.type === "string" && (c[1]?.value === "===" || c[1]?.value === "==") && c[2]?.type === "ident" && c[3]?.value === ".";
    if (!lhs && !rhs) return "the branch condition is not route.key === \"value\"";
    const v = lhs ? c[0]?.value : c[2]?.value;
    if (!routeVar || v !== routeVar.name) return "the branch condition does not read the route";
    cond = lhs ? { key: String(c[2]?.value), value: unquote(String(c[4]?.value)) } : { key: String(c[4]?.value), value: unquote(String(c[0]?.value)) };
  } else if (toks[p]?.value !== "else" && !(toks[p]?.value === ";" || toks[p]?.value === "{" || toks[p]?.value === "}")) return "the page is drawn inside an expression";
  const page = is.imported.get(view);
  const reader = routeVar ? is.imported.get(routeVar.reader) : null;
  return {
    view,
    viewExport: String(page?.imported),
    pageKey: String(page?.key),
    rpc,
    args: callArgs,
    opts: args[2] ? src(args[2][0], args[2][1]) : null,
    route: routeVar && (callArgs || cond) && reader ? { name: routeVar.name, reader: routeVar.reader, readerExport: reader.imported, readerKey: String(reader.key) } : null,
    cond,
    usesId,
  };
}

/** A page's short name: its file name. @param {string} key */
const pageName = (key) => stem(key);

/** A page name as a plan page field. @param {string} name */
const slug = (name) => kebab(name) ?? "page";

/**
 * The legacy route and the kit path of each page the switch draws.
 * @param {ReturnType<typeof clientModel>} model @param {Record<string, string>} given plan.maps.routes
 * @returns {Map<string, { legacy: string | null, path: string, d: Dispatch }>} by page key
 */
export function pageRoutes(model, given) {
  /** @type {Map<string, { legacy: string | null, path: string, d: Dispatch }>} */
  const out = new Map();
  const ds = model.entry?.dispatch ?? [];
  const keyName = ds.find((d) => d.cond)?.cond?.key ?? null;
  for (const d of ds) {
    if (out.has(d.pageKey)) continue;
    const name = pageName(d.pageKey);
    const legacy = d.cond ? "?" + d.cond.key + "=" + d.cond.value : keyName ? "?" + keyName + "=" + name : null;
    const had = legacy !== null ? given[legacy] : undefined;
    let path = typeof had === "string" && had.startsWith("/") ? had : d.cond ? "/" + encodeURIComponent(d.cond.value) + (d.usesId ? "/:id" : "") : "/";
    if (!/^\/[\w.~:%/-]*$/.test(path) || path.includes("//")) path = d.cond ? "/" + name : "/";
    out.set(d.pageKey, { legacy, path, d });
  }
  return out;
}

/**
 * Where a client module lives in the target, for the files this step ports.
 * @param {StepContext} ctx @param {ReturnType<typeof clientModel>} model @param {Set<string>} failed
 * @returns {(key: string) => Located}
 */
function locator(ctx, model, failed) {
  return (k) => {
    if (k.startsWith(LIB)) {
      const m = model.modules[k];
      if (typeof m === "string" && m.startsWith("@gas-kit/")) return { spec: m };
      if (typeof m === "string" && m.startsWith("src/")) return { path: m };
      return { problem: "imports " + k + ", which kit-imports left pending" };
    }
    if (k.startsWith("src/domain/")) return ctx.readTarget(domainTarget(k)) !== null ? { path: domainTarget(k) } : { problem: "imports " + k + ", which stays pending" };
    const t = model.targets.get(k);
    if (t) return failed.has(k) ? { problem: "imports " + k + ", which stays pending" } : { path: t };
    return { problem: "imports " + k + ", which the migration does not port" };
  };
}

/** The url-state module with its two google.script globals swapped for the hash-backed stand-ins. @param {string} text */
function swapUrlGlobals(text) {
  const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
  /** @type {{ start: number, end: number, text: string }[]} */
  const edits = [];
  /** @type {Set<string>} */
  const names = new Set();
  for (let i = 0; i + 4 < toks.length; i++) {
    const a = /** @type {JsToken} */ (toks[i]);
    if (a.value !== "google" || toks[i - 1]?.value === "." || toks[i + 1]?.value !== "." || toks[i + 2]?.value !== "script" || toks[i + 3]?.value !== ".") continue;
    const which = toks[i + 4]?.value;
    if (which !== "url" && which !== "history") continue;
    const name = which === "url" ? "scriptUrl" : "scriptHistory";
    names.add(name);
    edits.push({ start: a.start, end: /** @type {JsToken} */ (toks[i + 4]).end, text: name });
  }
  let out = text;
  for (const e of edits.sort((x, y) => y.start - x.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, names: [...names].sort() };
}

/**
 * The hash-backed google.script.url and google.script.history.
 * @param {string} stepId @param {string} from @param {{ key: string, value: string, path: string }[]} table
 */
export function scriptUrlJs(stepId, from, table) {
  return [
    jsHeader(stepId, from).trimEnd(),
    "// google.script.url and google.script.history as the source used them, over the kit's hash router.",
    "// The source kept its route in the query string (?r=item&id=a1); under the kit the route is the",
    "// hash (#/item/a1). getLocation reads the hash back into the source's query parameters, now and on",
    "// every hash change; push and replace write the hash the router follows. Lost on the way: the links",
    "// the app builds are hash links, and the top URL does not carry the route.",
    importLine(["buildHash", "parseHash"], KIT_URL),
    "",
    "/** The source's query routes and the kit paths they became (plan.maps.routes). @type {{ key: string, value: string, path: string }[]} */",
    "const ROUTES = " + JSON.stringify(table, null, 2) + ";",
    "",
    "/** @param {string} pattern @param {string} path @returns {Record<string, string> | null} */",
    "function match(pattern, path) {",
    "  const want = pattern.split(\"/\").filter(Boolean);",
    "  const have = path.split(\"/\").filter(Boolean);",
    "  if (want.length !== have.length) return null;",
    "  /** @type {Record<string, string>} */",
    "  const out = {};",
    "  for (let i = 0; i < want.length; i++) {",
    "    const w = String(want[i]);",
    "    const h = String(have[i]);",
    "    if (w.charAt(0) === \":\") {",
    "      try { out[w.slice(1)] = decodeURIComponent(h); } catch (e) { out[w.slice(1)] = h; }",
    "    } else if (w !== h) return null;",
    "  }",
    "  return out;",
    "}",
    "",
    "/** The current hash as the source's query parameters. @returns {Record<string, string>} */",
    "export function legacyParameters() {",
    "  const h = parseHash(window.location.hash);",
    "  /** @type {Record<string, string>} */",
    "  const out = {};",
    "  for (const k of Object.keys(h.query)) out[k] = String(h.query[k]);",
    "  for (const r of ROUTES) {",
    "    const m = match(r.path, h.path);",
    "    if (!m) continue;",
    "    for (const k of Object.keys(m)) out[k] = String(m[k]);",
    "    out[r.key] = r.value;",
    "    break;",
    "  }",
    "  return out;",
    "}",
    "",
    "/** The hash route for the source's query parameters. @param {Record<string, unknown>} params @returns {string} */",
    "export function hashForParameters(params) {",
    "  for (const r of ROUTES) {",
    "    if (String(params[r.key] == null ? \"\" : params[r.key]) !== r.value) continue;",
    "    /** @type {Record<string, unknown>} */",
    "    const rest = {};",
    "    for (const k of Object.keys(params)) if (k !== r.key) rest[k] = params[k];",
    "    let missing = false;",
    "    const path = r.path.replace(/:([A-Za-z_]\\w*)/g, (_m, name) => {",
    "      const v = rest[name];",
    "      delete rest[name];",
    "      if (v == null || v === \"\") missing = true;",
    "      return encodeURIComponent(String(v == null ? \"\" : v));",
    "    });",
    "    if (!missing) return buildHash(path, rest);",
    "  }",
    "  return buildHash(\"\", params);",
    "}",
    "",
    "/** @param {Record<string, string>} p */",
    "function locationOf(p) {",
    "  /** @type {Record<string, string[]>} */",
    "  const all = {};",
    "  for (const k of Object.keys(p)) all[k] = [String(p[k])];",
    "  return { hash: \"\", parameter: p, parameters: all };",
    "}",
    "",
    "/** @param {unknown} params @param {unknown} hash @param {boolean} replace */",
    "function go(params, hash, replace) {",
    "  /** @type {Record<string, unknown>} */",
    "  let p = {};",
    "  if (params && typeof params === \"object\") p = /** @type {Record<string, unknown>} */ (params);",
    "  else new URLSearchParams(String(hash || \"\").replace(/^[?#]/, \"\")).forEach((v, k) => { p[k] = v; });",
    "  const next = hashForParameters(p);",
    "  if (next === window.location.hash) return;",
    "  if (replace) window.location.replace(next);",
    "  else window.location.hash = next;",
    "}",
    "",
    "/** google.script.url: getLocation answers now and again on every hash change. */",
    "export const scriptUrl = {",
    "  /** @param {(location: { hash: string, parameter: Record<string, string>, parameters: Record<string, string[]> }) => void} cb */",
    "  getLocation(cb) {",
    "    const send = () => cb(locationOf(legacyParameters()));",
    "    window.addEventListener(\"hashchange\", send);",
    "    send();",
    "  },",
    "};",
    "",
    "/** google.script.history: push and replace write the hash route; setChangeHandler follows it. */",
    "export const scriptHistory = {",
    "  /** @param {unknown} _state @param {unknown} [params] @param {unknown} [hash] */",
    "  push(_state, params, hash) { go(params, hash, false); },",
    "  /** @param {unknown} _state @param {unknown} [params] @param {unknown} [hash] */",
    "  replace(_state, params, hash) { go(params, hash, true); },",
    "  /** @param {(e: { state: unknown, location: ReturnType<typeof locationOf> }) => void} fn */",
    "  setChangeHandler(fn) { window.addEventListener(\"hashchange\", () => fn({ state: null, location: locationOf(legacyParameters()) })); },",
    "};",
    "",
  ].join("\n");
}

/** Kit components a page's markup suggests, for a reskin. @param {string} text @param {Set<string>} have */
export function componentHints(text, have) {
  const want = /** @type {[RegExp, string[]][]} */ ([
    [/<button\b/i, ["button"]],
    [/<input\b[^>]*type="search"/i, ["input", "inputGroup"]],
    [/<input\b[^>]*type="checkbox"/i, ["checkbox", "switchRow"]],
    [/<input\b(?![^>]*type="(?:search|checkbox)")/i, ["input", "field"]],
    [/<select\b/i, ["select"]],
    [/<textarea\b/i, ["textarea"]],
    [/<table\b/i, ["table", "dataTable"]],
    [/<header\b|<h1\b/i, ["pageHeader"]],
    [/class="[^"]*\b(?:dot|status)\b/i, ["statusDot", "badge"]],
    [/<ul\b|<ol\b/i, ["table"]],
    [/not found|no items|nothing/i, ["emptyState"]],
    [/<label\b/i, ["label", "field"]],
    [/<dl\b/i, ["card"]],
  ]);
  /** @type {string[]} */
  const out = [];
  for (const [re, names] of want) if (re.test(text)) for (const n of names) if (have.has(n) && !out.includes(n)) out.push(n);
  return out;
}

/** The component names of the kit's catalogue, or none when it is not there. @param {string} kitRoot */
function catalogue(kitRoot) {
  const file = join(kitRoot, "packages", "ui", "components.json");
  if (!existsSync(file)) return new Set();
  try {
    const c = JSON.parse(readFileSync(file, "utf8"));
    return new Set(Array.isArray(c.components) ? c.components.map((/** @type {any} */ x) => String(x && x.name)) : []);
  } catch {
    return new Set();
  }
}

/** @param {StepContext} ctx @returns {StepResult} */
export function run(ctx) {
  return ctx.step.spawnedBy ? mountPages(ctx) : copyPages(ctx);
}

/** @param {StepContext} ctx @returns {StepResult} */
function copyPages(ctx) {
  const model = clientModel(ctx);
  const routes = pageRoutes(model, /** @type {Record<string, string>} */ (ctx.plan.maps.routes ?? {}));
  const ports = [...model.pages, ...model.helpers];
  /** @type {Set<string>} */
  const failed = new Set();
  /** @type {Map<string, { text: string, problems: string[], typed: number }>} */
  let results = new Map();
  for (let round = 0; round <= ports.length; round++) {
    results = new Map();
    let more = false;
    const locate = locator(ctx, model, failed);
    for (const key of ports) {
      const to = /** @type {string} */ (model.targets.get(key));
      const url = model.urlState.has(key);
      const swapped = url ? swapUrlGlobals(ctx.tree.read(key)) : { text: ctx.tree.read(key), names: [] };
      const r = portClientJs(ctx, { key, text: swapped.text, toRel: to, locate });
      if (url && swapped.names.length) {
        const nl = r.text.indexOf("\n") + 1;
        r.text = r.text.slice(0, nl) + importLine(swapped.names, relSpec(to, SCRIPT_URL, true)) + "\n" + r.text.slice(nl);
      }
      results.set(key, r);
      if (r.problems.length && !failed.has(key)) {
        failed.add(key);
        more = true;
      }
    }
    if (!more) break;
  }
  /** @type {string[]} */
  const notes = [];
  /** @type {SpawnStep[]} */
  const spawn = [];
  /** @type {Record<string, string>} */
  const moduleMap = {};
  const reskin = ctx.fidelity === "reskin";
  const have = reskin ? catalogue(ctx.kitRoot) : new Set();
  for (const key of ports) {
    const r = /** @type {{ text: string, problems: string[], typed: number, links: string[] }} */ (results.get(key));
    const to = /** @type {string} */ (model.targets.get(key));
    const isPage = key.startsWith(PAGES);
    if (failed.has(key)) {
      notes.push(key + " stays in .migrate/pending: " + listOf(r.problems));
      const name = pageName(key);
      spawn.push(agentStep(isPage
        ? { id: spawnId(ctx, "port-page", name), title: "Port the " + name + " page by hand", why: key + " breaks a kit rule or imports what stays pending: " + listOf(r.problems), reads: [key], writes: [to], page: slug(name), verify: ["check", "ui:" + slug(name)] }
        : { id: spawnId(ctx, "port-module", key.slice(CLIENT.length).replace(/\.js$/, "")), title: "Port the client module " + key + " by hand", why: key + " breaks a kit rule or imports what stays pending: " + listOf(r.problems), reads: [key], writes: [to] }));
      continue;
    }
    ctx.out.write(to, r.text);
    ctx.out.remove(pendingPath(key));
    moduleMap[key] = to;
    notes.push(key + " ported to " + to + (r.typed ? " (" + r.typed + " parameter" + (r.typed === 1 ? "" : "s") + " typed any)" : "") + (model.urlState.has(key) ? "; google.script.url and history now read and write the kit's hash route (" + SCRIPT_URL + ")" : ""));
    notes.push(...r.links);
    if (isPage && reskin) {
      const hints = componentHints(ctx.tree.read(key), have);
      notes.push("reskin " + pageName(key) + ": " + (hints.length ? "kit components that could stand in for its markup: " + hints.join(", ") + " (packages/ui/components.json)" : "no kit component matches its markup") + "; keep its routes, copy, keys and storage");
    }
  }
  const table = [...routes.values()].filter((r) => r.legacy !== null).map((r) => ({ key: /** @type {string} */ (r.legacy).slice(1).split("=")[0] ?? "", value: decodeURIComponent(/** @type {string} */ (r.legacy).split("=")[1] ?? ""), path: r.path }));
  const urlPorted = [...model.urlState].filter((k) => !failed.has(k));
  if (urlPorted.length) ctx.out.write(SCRIPT_URL, scriptUrlJs(ctx.step.id, urlPorted.join(", "), table));
  // The entry: its wiring becomes wireLegacy, its switch the route mounts of page-routes.
  const entry = model.entry;
  let entryDone = !entry;
  if (entry) {
    const problems = [...entry.problems];
    if (entry.wire.length) {
      /** @type {string[]} */
      const lines = [];
      /** @type {Map<string, string[]>} */
      const named = new Map();
      for (const [local, i] of entry.imported) {
        if (!entry.used.has(local)) continue;
        if (i.imported === "*") lines.push(["import * as", local, "from", JSON.stringify(i.site.spec) + ";"].join(" "));
        else if (i.imported === "default") lines.push(["import", local, "from", JSON.stringify(i.site.spec) + ";"].join(" "));
        else named.set(i.site.spec, [...(named.get(i.site.spec) ?? []), i.imported === local ? local : i.imported + " as " + local]);
      }
      for (const [spec, names] of named) lines.push(importLine(names, spec));
      const text = [
        "// The source entry's wiring (its delegated actions and keyboard shortcuts), installed once on the",
        "// region the kit router draws the pages into. Its page switch became the route mounts in pages/.",
        ...lines,
        "",
        "let wired = false;",
        "",
        "/**",
        " * Install the source's wiring on the router's region, once.",
        " * @param {HTMLElement} " + entry.root,
        " */",
        "export function wireLegacy(" + entry.root + ") {",
        "  if (wired) return;",
        "  wired = true;",
        ...entry.wire.map((s) => s.split("\n").map((l) => (l ? "  " + l : l)).join("\n")),
        "}",
        "",
      ].join("\n");
      const r = portClientJs(ctx, { key: MAIN, text, toRel: ENTRY_OUT, locate: locator(ctx, model, failed) });
      if (r.problems.length) problems.push(...r.problems.map((p) => "its wiring " + p));
      else ctx.out.write(ENTRY_OUT, r.text);
    }
    if (entry.dropped.length) notes.push(MAIN + ": the kit router now does what these did: " + listOf(entry.dropped));
    if (problems.length) {
      notes.push(MAIN + " stays in .migrate/pending: " + listOf(problems));
      spawn.push(agentStep({ id: spawnId(ctx, "port-entry", "main"), title: "Port what the step could not read of " + MAIN, why: MAIN + ": " + listOf(problems), reads: [MAIN], writes: [ENTRY_OUT, ROUTES_JS] }));
    } else entryDone = true;
  }
  if (entryDone && entry) ctx.out.remove(pendingPath(MAIN));
  // Pages the switch does not draw are ported views without a route.
  for (const key of model.pages) {
    if (failed.has(key) || routes.has(key)) continue;
    const name = pageName(key);
    spawn.push(agentStep({ id: spawnId(ctx, "port-page", name), title: "Give the ported " + name + " page a route", why: key + " is ported to " + model.targets.get(key) + ", but the entry's page switch does not draw it, so it has no route mount yet", reads: [key, MAIN], writes: [ROUTES_JS], page: slug(name), verify: ["check", "ui:" + slug(name)] }));
  }
  const mountable = [...routes.keys()].filter((k) => !failed.has(k));
  if (mountable.length) {
    const after = ["routes", "rpc-surface"].filter((id) => ctx.plan.steps.some((s) => s.id === id));
    spawn.push({
      id: SPAWNED,
      kind: "tool",
      run: "copyPages",
      title: "Mount the ported pages on the kit router",
      after: [ctx.step.id, ...after],
      files: { reads: [MAIN], writes: [ROUTES_JS, ...mountable.map((k) => adapterPath(/** @type {string} */ (model.targets.get(k))))] },
      verify: ["check", "build", "kit:verify"],
    });
  }
  /** @type {Record<string, string>} */
  const routeMap = {};
  for (const r of routes.values()) if (r.legacy !== null) routeMap[r.legacy] = r.path;
  notes.unshift((ports.length - failed.size) + " of " + ports.length + " client module" + (ports.length === 1 ? "" : "s") + " ported; " + mountable.length + " page" + (mountable.length === 1 ? "" : "s") + " to mount (page-routes)");
  return { notes, maps: { modules: moduleMap, routes: routeMap }, ...(spawn.length ? { spawn } : {}) };
}

/** The route mount file beside a ported page. @param {string} target */
const adapterPath = (target) => target.replace(/\.js$/, ".route.js");

/**
 * One page's route mount.
 * @param {StepContext} ctx @param {ReturnType<typeof clientModel>} model @param {Dispatch} d @param {string} handler
 */
function adapterJs(ctx, model, d, handler) {
  const page = /** @type {string} */ (model.targets.get(d.pageKey));
  const file = adapterPath(page);
  const rpc = d.rpc ? (/** @type {Record<string, string>} */ (ctx.plan.maps.rpc ?? {})[d.rpc] ?? d.rpc) : null;
  const wired = ctx.readTarget(ENTRY_OUT) !== null;
  const lines = [jsHeader(ctx.step.id, d.pageKey + " and " + MAIN).trimEnd(), importLine(["renderRegion"], KIT_DOM)];
  if (wired) lines.push(importLine(["wireLegacy"], relSpec(file, ENTRY_OUT, true)));
  if (d.route) {
    const readerAt = model.targets.get(d.route.readerKey);
    if (readerAt) lines.push(importLine([d.route.readerExport === d.route.reader ? d.route.reader : d.route.readerExport + " as " + d.route.reader], relSpec(file, readerAt, true)));
  }
  lines.push(importLine([d.viewExport === d.view ? d.view : d.viewExport + " as " + d.view], "./" + posix.basename(page)));
  lines.push(
    "",
    "/**",
    " * The kit router's mount for the source's " + pageName(d.pageKey) + " page: it reads the route the way the",
    " * source's entry did, asks the server for the page's data, then draws the source's view.",
    " * @param {{ rpc: (name: string, params?: unknown) => Promise<any> }} app",
    " * @returns {import(" + JSON.stringify("@gas-kit/client/router.js") + ").Route}",
    " */",
    "export function " + handler + "(app) {",
    "  return {",
    "    async mount(el, _params, ctx) {",
  );
  if (wired) lines.push("      wireLegacy(/** @type {HTMLElement} */ (el));");
  if (d.route) lines.push("      const " + d.route.name + " = " + d.route.reader + "();");
  if (rpc) {
    lines.push("      const data = await app.rpc(" + JSON.stringify(rpc) + (d.args ? ", " + d.args : "") + ");", "      if (!ctx.current()) return;");
    lines.push("      renderRegion(el, " + d.view + "(data)" + (d.opts ? ", " + d.opts : "") + ");");
  } else lines.push("      renderRegion(el, " + d.view + "()" + (d.opts ? ", " + d.opts : "") + ");");
  lines.push("    },", "  };", "}", "");
  return { file, text: lines.join("\n"), rpc };
}

/** @param {StepContext} ctx @returns {StepResult} */
function mountPages(ctx) {
  const model = clientModel(ctx);
  const routes = pageRoutes(model, /** @type {Record<string, string>} */ (ctx.plan.maps.routes ?? {}));
  const given = /** @type {Record<string, string>} */ (ctx.plan.maps.routes ?? {});
  if (ctx.readTarget(ROUTES_JS) === null) throw new Error(ctx.step.id + ": the template drifted: " + ROUTES_JS + " is missing (the routes step writes it)");
  /** @type {string[]} */
  const notes = [];
  /** @type {Set<string>} */
  const paths = new Set();
  for (const [key, r] of routes) {
    const page = /** @type {string} */ (model.targets.get(key));
    if (ctx.readTarget(page) === null) {
      notes.push(key + ": not ported, so not mounted");
      continue;
    }
    const mapped = r.legacy !== null ? given[r.legacy] : undefined;
    const path = typeof mapped === "string" && /^#?\/[\w.~:%/-]*$/.test(mapped) && !mapped.includes("//") ? mapped.replace(/^#/, "") : r.path;
    if (paths.has(path)) {
      notes.push(key + ": another page already takes " + path + "; not mounted");
      continue;
    }
    paths.add(path);
    const handler = r.d.viewExport + "Route";
    const a = adapterJs(ctx, model, r.d, handler);
    const bad = clientRuleBreaks(a.text, a.file);
    if (bad.length) {
      notes.push(key + ": its mount would break a kit rule (" + listOf(bad) + "); not mounted");
      continue;
    }
    ctx.out.write(a.file, a.text);
    const routesText = /** @type {string} */ (ctx.readTarget(ROUTES_JS));
    const line = JSON.stringify(path) + ": " + handler + "(app),";
    const taken = new RegExp("^\\s*" + JSON.stringify(path).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + ":", "m").test(routesText);
    if (!routesText.includes(line)) {
      if (taken) {
        notes.push(key + ": " + ROUTES_JS + " already mounts " + path + " with another handler; left as it is");
        continue;
      }
      ctx.patchTarget(ROUTES_JS, "/* migrate:routes */", (m) => line + "\n    " + m);
    }
    const imp = importLine([handler], relSpec(ROUTES_JS, a.file, true));
    if (!/** @type {string} */ (ctx.readTarget(ROUTES_JS)).includes(imp)) ctx.patchTarget(ROUTES_JS, "/* migrate:imports */", (m) => imp + "\n" + m);
    notes.push(pageName(key) + " mounted at " + path + (a.rpc ? " (its data from " + a.rpc + ")" : ""));
  }
  return { notes };
}

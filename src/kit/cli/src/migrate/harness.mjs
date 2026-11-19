// The migration harness: serves the ORIGINAL source app in a browser, offline, so a person (and the
// later compare script) sees the app as it looked before migration. Node only, no dependencies.
//
//   startHarness({ tree, config, port = 0, host = "127.0.0.1" }) -> { url, close, warnings }
//
// tree is a read-only SourceTree: every byte comes through tree.read / tree.readBytes, never from
// the source directory. config is the harness JSON: { entry, scriptlets, pages, rpc, rpcCalls }
// (rpcCalls: answers recorded with their parameters, { name, params, result }, matched by name and
// equal parameters before the per-name answer in rpc). A page may
// carry its own { entry, scriptlets } (a classic app's doGet serves a different file per ?page=): its
// scriptlets are laid over config.scriptlets. config.entry may be left out when every page has one.
//
// Routes (GET and HEAD only; anything else is 405):
//   /                      config.entry (else the first page) rendered (rules below), with the
//                          google.script shim injected.
//                          With a query string, the page whose query path it holds (every pair of the
//                          path present, the most pairs winning; else the first pair) is rendered
//                          instead, with its own entry and scriptlets, the way doGet picks a file
//   /__page/<name>/        that page's entry and scriptlets whatever the query (the compare script
//                          opens a page with its own entry here, since a hash path never reaches the
//                          server); an unknown name is 404
//   /__harness/shim.js     the browser shim (harnessShim.js): google.script.run answered from config.rpc
//   /__src/<key>           any tree file by its key (the key is URL-encoded segment by segment). A .js
//                          or .mjs file has its relative imports rewritten to /__src/<resolved key>
//                          through tree.resolve, so the ES module graph (also the shared roots, key
//                          "@name/...") loads as written. Keys not in the tree are 404; "..", ".",
//                          empty segments, backslash, NUL and a bad escape are 400.
//
// Rendering the entry. The code is NEVER evaluated: scriptlets are looked up, not run.
//   {{name}}               config.scriptlets[name], HTML-escaped; unknown -> empty plus a warning.
//   <?= expr ?>            config.scriptlets[expr] HTML-escaped; <?!= expr ?> the same, not escaped.
//                          An unknown expr -> empty plus a warning (so process.exit(1) is just unknown).
//   <?!= include('x') ?>   the source file whose basename without extension is x: .html first (rendered
//                          by these same rules, nested up to 8 deep, cycles refused), then .css, then
//                          .js/.mjs. When no such file exists the build-shaped names map by profile:
//                            styles               the stylesheet entry: styles.css, else the first of
//                                                 styles/{index,main,app,styles}.css (el-builder,
//                                                 kit-shaped). It is inlined as one <style> with every
//                                                 @import followed through tree.resolve (shared roots too).
//                            js_app / app / main  the client entry: the main/app/index .js sharing the
//                                                 longest directory with the entry page (kit-shaped
//                                                 src/client/main.js); el-builder finds js/app.js by name.
//                          A JS result is a <script type="module" src="/__src/<key>"> (a module graph
//                          cannot be inlined), a CSS result a <style>. When the include is the only
//                          content of a <script> or <style> wrapper, the wrapper is replaced by that
//                          result. classic apps include Stylesheet / JavaScript .html files as they are.
//   <? code ?>             the tags are dropped and everything between them is kept, so BOTH branches of
//                          an if/else show. That is the limit: no branch is chosen, no loop repeats.
// Everything the page asks of the network except the harness itself is refused by the CSP header
// (CDN scripts, fonts, fetches, form posts), so the page renders offline; the blocked URLs found in the
// entry are listed in warnings. The source's scripts DO run in the browser (that is what a baseline
// is): the CSP keeps their requests in the harness, but it cannot stop a navigation away, and the page
// can read every file the harness serves and the recorded answers. Every response is
// Cross-Origin-Resource-Policy same-origin, so another site cannot load a source file as a script.
//
// warnings: a live array of strings: unknown scriptlets, missing includes, unresolved imports, dropped
// code scriptlets, blocked external URLs.
//
// The server binds to 127.0.0.1 by default and answers only to loopback Host names (and the bound
// host), against DNS rebinding.

import { createServer } from "node:http";
import { posix } from "node:path";
import { readFileSync } from "node:fs";
import { tokenizeJs } from "./scan/js.mjs";

/** @typedef {import("./sourceTree.mjs").SourceTree} SourceTree */
/** @typedef {{ name: string, path: string, entry?: string, scriptlets?: Record<string, string>, root?: string, role?: string, rpc?: Record<string, unknown>, rpcCalls?: { name: string, params?: unknown, result?: unknown }[] }} HarnessPage */
/** @typedef {{ entry?: string, scriptlets?: Record<string, string>, pages?: HarnessPage[], rpc?: Record<string, unknown>, rpcCalls?: { name: string, params?: unknown, result?: unknown }[] }} HarnessConfig */
const PAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// The source's own scripts run in the page, so the policy is what keeps them in the harness: no
// request to anywhere else (default-src and connect-src), no form posted elsewhere (form-action, which
// default-src does not cover), no <base> to re-point relative URLs, no plugin, no framing by another
// origin. A top-level navigation away is the one way out a CSP cannot close.
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";
const SHIM = readFileSync(new URL("./harnessShim.js", import.meta.url), "utf8");
const MAX_DEPTH = 8;

/** @type {Record<string, string>} */
const TYPES = {
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** @param {unknown} s */
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** @param {string} key */
const extOf = (key) => {
  const b = key.slice(key.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1).toLowerCase() : "";
};
/** @param {string} key */
const stemOf = (key) => {
  const b = key.slice(key.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(0, i) : b;
};

/** The URL path of a tree key. @param {string} key */
function srcUrl(key) {
  return "/__src/" + key.split("/").map((s) => encodeURIComponent(s).replace(/%40/g, "@")).join("/");
}

/** Number of leading directory segments two keys share. @param {string} a @param {string} b */
function sharedDirs(a, b) {
  const x = a.split("/").slice(0, -1);
  const y = b.split("/").slice(0, -1);
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) n++;
  return n;
}

/**
 * Resolve the entry key: as written, or "../<shared name>/rest" -> "@name/rest".
 * @param {SourceTree} tree @param {string} entry
 */
function entryKey(tree, entry) {
  if (tree.files.has(entry)) return entry;
  const m = /^(?:\.\.\/)+([^/]+)\/(.+)$/.exec(entry);
  if (m) {
    const k = "@" + m[1] + "/" + m[2];
    if (tree.files.has(k)) return k;
  }
  const n = posix.normalize(entry);
  if (tree.files.has(n)) return n;
  throw new Error("harness entry is not in the source: " + entry);
}

/**
 * A map of strings (scriptlet values): absent is empty; a number or boolean value is its text; any
 * other value, and a list or a non-object, is refused.
 * @param {unknown} o @param {string} what
 * @returns {Record<string, string>}
 */
function plainStrings(o, what) {
  /** @type {Record<string, string>} */
  const out = Object.create(null);
  if (o === undefined || o === null) return out;
  if (typeof o !== "object" || Array.isArray(o)) throw new Error("harness " + what + " must be an object of strings");
  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") throw new Error("harness " + what + ": " + JSON.stringify(k) + " must be a string");
    out[k] = String(v);
  }
  return out;
}

/**
 * Where the first real <script tag starts, outside HTML comments (a comment that mentions
 * "<script>" is prose, and a shim put there would be commented out); -1 when there is none.
 * @param {string} text
 */
export function firstScriptTag(text) {
  const re = /<!--|<script\b/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] !== "<!--") return m.index;
    const end = text.indexOf("-->", m.index + 4);
    if (end < 0) return -1;
    re.lastIndex = end + 3;
  }
  return -1;
}

/**
 * Serve the original source app.
 * @param {{ tree: SourceTree, config: HarnessConfig, port?: number, host?: string }} opts
 * @returns {Promise<{ url: string, close: () => Promise<void>, warnings: string[] }>}
 */
export async function startHarness({ tree, config, port = 0, host = "127.0.0.1" }) {
  if (!config || typeof config !== "object") throw new Error("harness config needs an entry");
  const base = plainStrings(config.scriptlets, "scriptlets");
  const rpc = config.rpc && typeof config.rpc === "object" ? config.rpc : {};
  // Answers that depend on the call's parameters: { name, params, result }, matched before rpc[name].
  /** @param {unknown} list */
  const callsOf = (list) => (Array.isArray(list) ? list.filter((c) => c && typeof c === "object" && typeof c.name === "string").map((c) => ({ name: c.name, params: c.params ?? null, result: c.result })) : []);
  const rpcCalls = callsOf(config.rpcCalls);
  /** @param {unknown} o */
  const mapOf = (o) => (o && typeof o === "object" && !Array.isArray(o) ? /** @type {Record<string, unknown>} */ (o) : null);
  /** @type {{ name: string, path: string, entry: string | null, scriptlets: Record<string, string> | null, rpc: Record<string, unknown> | null, rpcCalls: { name: string, params: unknown, result: unknown }[] }[]} */
  const pages = [];
  for (const p of Array.isArray(config.pages) ? config.pages : []) {
    if (!p || typeof p !== "object" || typeof p.name !== "string" || typeof p.path !== "string") throw new Error("harness page needs a name and a path");
    if (!PAGE_NAME.test(p.name)) throw new Error("harness page name " + JSON.stringify(p.name) + " is not kebab-case");
    if (pages.some((x) => x.name === p.name)) throw new Error("harness page " + p.name + " is listed twice");
    if (p.entry !== undefined && typeof p.entry !== "string") throw new Error("harness page " + p.name + ": entry must be a source key");
    pages.push({ name: p.name, path: p.path, entry: typeof p.entry === "string" ? entryKey(tree, p.entry) : null, scriptlets: p.scriptlets === undefined ? null : plainStrings(p.scriptlets, "page " + p.name + " scriptlets"), rpc: mapOf(p.rpc), rpcCalls: callsOf(p.rpcCalls) });
  }
  if (typeof config.entry !== "string" && !(pages.length && pages.every((p) => p.entry))) throw new Error("harness config needs an entry (or one on every page)");
  const entry = typeof config.entry === "string" ? entryKey(tree, config.entry) : /** @type {string} */ (pages[0]?.entry);
  // With no top-level entry, the root shows the first page, its own scriptlets too.
  const fallback = typeof config.entry === "string" ? null : pages[0] ?? null;
  /** @type {string[]} */
  const warnings = [];
  const seen = new Set();
  /** @param {string} w */
  const warn = (w) => {
    if (seen.has(w)) return;
    seen.add(w);
    warnings.push(w);
  };
  const all = () => [...tree.files.keys()];
  /** @param {Record<string, unknown>} o @param {string} k */
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** The file an include name stands for, or null. @param {string} name @param {string} from */
  function findInclude(name, from) {
    const keys = all();
    /** @param {string} a @param {string} b */
    const order = (a, b) => (a.startsWith("@") ? 1 : 0) - (b.startsWith("@") ? 1 : 0) || a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0);
    for (const exts of [["html"], ["css"], ["js", "mjs"]]) {
      const hits = keys.filter((k) => stemOf(k) === name && exts.includes(extOf(k))).sort(order);
      if (hits[0]) return { key: /** @type {string} */ (hits[0]), kind: exts[0] === "html" ? "html" : exts[0] === "css" ? "css" : "js" };
    }
    if (name === "styles" || name === "style") {
      const hits = keys.filter((k) => /(^|\/)styles?\/(index|main|app|styles)\.css$/.test(k)).sort((a, b) => sharedDirs(b, from) - sharedDirs(a, from) || order(a, b));
      if (hits[0]) return { key: /** @type {string} */ (hits[0]), kind: "css" };
    }
    if (name === "js_app" || name === "app" || name === "main") {
      const rank = (/** @type {string} */ k) => ["main", "app", "index"].indexOf(stemOf(k));
      const hits = keys.filter((k) => rank(k) >= 0 && ["js", "mjs"].includes(extOf(k)) && !/(^|\/)(node_modules|dist|vendor|test|tests)\//.test(k)).sort((a, b) => sharedDirs(b, from) - sharedDirs(a, from) || rank(a) - rank(b) || order(a, b));
      if (hits[0]) return { key: /** @type {string} */ (hits[0]), kind: "js" };
    }
    return null;
  }

  /** One stylesheet with every import rule followed. @param {string} key @param {string[]} stack @returns {string} */
  function flattenCss(key, stack) {
    if (stack.includes(key) || stack.length > MAX_DEPTH) return "";
    const css = tree.read(key);
    return css
      .replace(/@import\s+(?:url\(\s*)?(["']?)([^"')\s;]+)\1\s*\)?[^;]*;/g, (whole, _q, spec) => {
        const k = /^\.{1,2}\//.test(spec) ? tree.resolve(key, spec) : null;
        if (!k) {
          warn("unresolved css import: " + spec + " (in " + key + ")");
          return "";
        }
        return flattenCss(k, [...stack, key]);
      })
      .replace(/<\/style/gi, "<\\/style");
  }

  /** @param {string} key */
  const moduleTag = (key) => '<script type="module" src="' + escapeHtml(srcUrl(key)) + '"></script>';

  /** @param {{ key: string, kind: string }} hit @param {string[]} stack */
  function includeBody(hit, stack) {
    if (hit.kind === "html") return render(hit.key, stack);
    if (hit.kind === "css") return "<style>" + flattenCss(hit.key, []) + "</style>";
    return moduleTag(hit.key);
  }

  /** The scriptlet values of the page being rendered. @type {Record<string, string>} */
  let scriptlets = base;

  /** @param {string} key @param {string[]} stack */
  function render(key, stack) {
    if (stack.includes(key)) {
      warn("include cycle: " + key);
      return "";
    }
    if (stack.length >= MAX_DEPTH) {
      warn("include nesting is too deep at " + key);
      return "";
    }
    const next = [...stack, key];
    let text = tree.read(key);
    text = text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, name) => {
      if (own(scriptlets, name)) return escapeHtml(scriptlets[name]);
      warn("unknown placeholder: " + name + " (in " + key + ")");
      return "";
    });
    text = text.replace(/<(script|style)\b([^>]*)>\s*<\?!=\s*include\(\s*(["'])([^"']+)\3\s*\)\s*;?\s*\?>\s*<\/\1\s*>/gi, (whole, tag, attrs, _q, name) => {
      const hit = findInclude(name, key);
      if (!hit) {
        warn("missing include: " + name + " (in " + key + ")");
        return "";
      }
      if (hit.kind === "js") return moduleTag(hit.key);
      if (hit.kind === "css") return "<style" + attrs + ">" + flattenCss(hit.key, []) + "</style>";
      return "<" + tag + attrs + ">" + render(hit.key, next) + "</" + tag + ">";
    });
    let dropped = 0;
    text = text.replace(/<\?(!?=)?([\s\S]*?)\?>/g, (_m, mark, code) => {
      if (!mark) {
        dropped++;
        return "";
      }
      const expr = String(code).trim();
      const inc = /^include\(\s*(["'])([^"']+)\1\s*\)\s*;?$/.exec(expr);
      if (inc && mark === "!=") {
        const hit = findInclude(/** @type {string} */ (inc[2]), key);
        if (!hit) {
          warn("missing include: " + inc[2] + " (in " + key + ")");
          return "";
        }
        return includeBody(hit, next);
      }
      if (own(scriptlets, expr)) return mark === "!=" ? String(scriptlets[expr]) : escapeHtml(scriptlets[expr]);
      warn("unknown scriptlet: " + expr + " (in " + key + ")");
      return "";
    });
    if (dropped) warn("code scriptlets are not evaluated, " + dropped + " dropped (in " + key + ")");
    return text;
  }

  /**
   * The page to serve for a request: its entry and scriptlets, and its answers: a page's own rpc
   * entries are laid over the shared ones, and its own rpcCalls are matched before the shared ones.
   * @param {{ name: string, path: string, entry: string | null, scriptlets: Record<string, string> | null, rpc?: Record<string, unknown> | null, rpcCalls?: { name: string, params: unknown, result: unknown }[] } | null} p
   */
  function page(p = null) {
    scriptlets = p && p.scriptlets ? { ...base, ...p.scriptlets } : base;
    let text = render(p?.entry ?? entry, []);
    const rpcJson = JSON.stringify(p && p.rpc ? { ...rpc, ...p.rpc } : rpc).replace(/</g, "\\u003c");
    const callsJson = JSON.stringify([...(p?.rpcCalls ?? []), ...rpcCalls]).replace(/</g, "\\u003c");
    const inject = '<script type="application/json" id="__harness-rpc">' + rpcJson + '</script><script type="application/json" id="__harness-calls">' + callsJson + '</script><script src="/__harness/shim.js"></script>';
    const at = firstScriptTag(text);
    if (at >= 0) text = text.slice(0, at) + inject + text.slice(at);
    else if (/<\/head>/i.test(text)) text = text.replace(/<\/head>/i, () => inject + "</head>");
    else text = inject + text;
    for (const m of text.matchAll(/<(?:script|link|img|iframe|source|video|audio)\b[^>]*?\b(?:src|href)\s*=\s*(["'])((?:https?:)?\/\/[^"']+)\1/gi)) warn("blocked external url: " + m[2]);
    for (const m of text.matchAll(/url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/g)) warn("blocked external url: " + m[1]);
    for (const m of text.matchAll(/@import\s+["']((?:https?:)?\/\/[^"']+)/g)) warn("blocked external url: " + m[1]);
    return text;
  }

  /** Relative imports of a module point at /__src/<key>. @param {string} key @param {string} text */
  function rewriteModule(key, text) {
    const toks = tokenizeJs(text).filter((t) => t.type !== "comment");
    let out = "";
    let at = 0;
    toks.forEach((t, i) => {
      if (t.type !== "string") return;
      const p = toks[i - 1];
      const pp = toks[i - 2];
      const isImport = !!p && ((p.type === "ident" && (p.value === "from" || p.value === "import")) || (p.type === "punct" && p.value === "(" && !!pp && pp.type === "ident" && pp.value === "import"));
      if (!isImport) return;
      const q = t.value[0] ?? '"';
      const spec = t.value.slice(1, t.value.endsWith(q) && t.value.length > 1 ? -1 : undefined);
      if (!/^\.{1,2}\//.test(spec)) {
        if (!/^\//.test(spec)) warn("unresolved import: " + spec + " (in " + key + ")");
        return;
      }
      const k = tree.resolve(key, spec);
      if (!k) {
        warn("unresolved import: " + spec + " (in " + key + ")");
        return;
      }
      out += text.slice(at, t.start) + q + srcUrl(k) + q;
      at = t.end;
    });
    return out + text.slice(at);
  }

  /**
   * The page with its own entry or scriptlets whose query path a request's query holds: every pair of
   * the path present with the same value, the most pairs winning; else the first page whose first pair
   * is there. Null when none is.
   * @param {string} search
   */
  function pageForQuery(search) {
    const got = new URLSearchParams(search);
    const own = pages.filter((x) => x.path.startsWith("?") && (x.entry || x.scriptlets));
    const pairs = (/** @type {string} */ path) => [...new URLSearchParams(path)];
    let best = null;
    let most = 0;
    for (const x of own) {
      const ps = pairs(x.path);
      if (ps.length > most && ps.every(([k, v]) => got.get(k) === v)) {
        best = x;
        most = ps.length;
      }
    }
    return best ?? own.find((x) => {
      const first = pairs(x.path)[0];
      return !!first && got.get(first[0]) === first[1];
    }) ?? null;
  }

  const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const wildcard = host === "0.0.0.0" || host === "::";

  /** @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
  function handle(req, res) {
    /** @param {number} status @param {string} type @param {string | Buffer} body @param {Record<string, string>} [extra] */
    const send = (status, type, body, extra = {}) => {
      res.writeHead(status, { "Content-Type": type, "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Cross-Origin-Resource-Policy": "same-origin", ...extra });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    const text = (/** @type {number} */ status, /** @type {string} */ msg, extra = {}) => send(status, "text/plain; charset=utf-8", msg + "\n", extra);
    if (req.method !== "GET" && req.method !== "HEAD") return text(405, "method not allowed", { Allow: "GET, HEAD" });
    if (!wildcard) {
      const h = String(req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
      if (!loopback.has(h) && h !== host.toLowerCase() && h !== "[" + host.toLowerCase() + "]") return text(403, "host not allowed");
    }
    const raw = (req.url ?? "").split("#")[0] ?? "";
    if (!raw.startsWith("/")) return text(400, "bad request");
    const q = raw.indexOf("?");
    const path = q < 0 ? raw : raw.slice(0, q);
    if (path === "/" || path.startsWith("/__page/")) {
      /** @type {typeof pages[number] | null} */
      let p = null;
      if (path !== "/") {
        const m = /^\/__page\/([a-z0-9-]+)\/?$/.exec(path);
        p = m ? pages.find((x) => x.name === m[1]) ?? null : null;
        if (!p) return text(404, "no such harness page");
      } else if (q >= 0) p = pageForQuery(raw.slice(q));
      if (!p && fallback) p = fallback;
      try {
        return send(200, "text/html; charset=utf-8", page(p));
      } catch (e) {
        return text(500, "harness: " + (e instanceof Error ? e.message : String(e)));
      }
    }
    if (path === "/__harness/shim.js") return send(200, TYPES.js ?? "text/javascript", SHIM);
    if (path.startsWith("/__src/")) {
      const segs = path.slice("/__src/".length).split("/");
      /** @type {string[]} */
      const decoded = [];
      for (const s of segs) {
        let d;
        try {
          d = decodeURIComponent(s);
        } catch {
          return text(400, "bad escape");
        }
        if (d === "" || d === "." || d === ".." || /[\0\\]/.test(d) || /[/]/.test(d)) return text(400, "bad path");
        decoded.push(d);
      }
      const key = decoded.join("/");
      const isText = tree.files.has(key);
      if (!isText && !tree.assets?.has(key)) return text(404, "not in the source");
      try {
        const ext = extOf(key);
        if (isText) {
          let body = tree.read(key);
          if (ext === "js" || ext === "mjs") body = rewriteModule(key, body);
          return send(200, TYPES[ext] ?? "text/plain; charset=utf-8", body);
        }
        return send(200, TYPES[ext] ?? "application/octet-stream", tree.readBytes(key));
      } catch (e) {
        return text(500, "harness: " + (e instanceof Error ? e.message : String(e)));
      }
    }
    return text(404, "not found");
  }

  page(fallback); // surface warnings (and a bad entry) before listening
  for (const p of pages) if (p.entry || p.scriptlets || p.rpc || p.rpcCalls.length) page(p);
  const server = createServer(handle);
  await new Promise((resolveP, rejectP) => {
    server.once("error", rejectP);
    server.listen(port, host, () => resolveP(undefined));
  });
  const addr = /** @type {import("node:net").AddressInfo} */ (server.address());
  const shown = host.includes(":") ? "[" + host + "]" : host;
  return {
    url: "http://" + shown + ":" + addr.port + "/",
    warnings,
    close() {
      return new Promise((resolveP) => {
        server.close(() => resolveP());
        server.closeAllConnections();
      });
    },
  };
}

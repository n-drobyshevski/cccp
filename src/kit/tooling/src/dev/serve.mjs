// Extracted from the author's production Apps Script apps; adapted.
//
// The dev server: serves an app build and the component gallery over node:http, no dependencies.
//
//   node packages/tooling/src/dev/serve.mjs [--root <dir>] [--port <n>] [--no-gallery] [--watch]
//
// With a root, the app is built once (defineBuild), the server bundle and entry.js are evaluated in
// this node realm over the GAS fakes, and
//   GET /                 doGet(e) with e.parameter from the query string, with the google.script.run
//                         shim injected as the first child of head
//   POST /__rpc/<name>    a JSON array of args in, the function's return value as JSON out, after the
//                         real bridge rules (illegal args fail the call, illegal results become null);
//                         a throw answers status 500 with {"__error": message}, which the shim maps to the
//                         failure handler (a 200 body is always a success, whatever it looks like)
//   GET /__events         server-sent events; "reload" after a rebuild (with watch)
//   GET /gallery          every component of packages/ui/components.json in every state, light and dark
// Behind a proxy (Google Cloud Shell Web Preview, a remote workstation, a port-forwarder) the browser
// asks for another host name over HTTPS. The Host guard answers only to localhost, the bound host and
// the exact names the environment gives (hosts.mjs): <port>-$WEB_HOST in Cloud Shell, and the names in
// DEV_HOSTS (comma-separated, "{port}" allowed). The public URL (https://<port>-$WEB_HOST, or
// DEV_PUBLIC_URL) is returned as publicUrl, printed beside the local one, and is what the fakes report
// as the web app's /exec URL. Everything the page asks for is a relative URL, so it works on any origin.
// The fakes are installed once and live as long as the server (state such as Script Properties and the
// cache survives between requests, in memory only). Each request evaluates the bundles afresh, so a
// memoized identity never leaks, and the flags of dev/dev.config.mjs and the page URL are applied
// around it and undone after. The script cache is keyed to the data flags (?empty, ?nosource, ?tz):
// it is cleared whenever a request's data-flag signature differs from the previous request's, so a
// cached read-model never carries data across a change of data flags. The script lock is released
// after every request. The app is built with the define __GK_DEV__ = true (production builds leave
// it undefined: guard with typeof __GK_DEV__ !== "undefined"), into <root>/dev/.cache/dist (or the
// appConfig.dist given to serve, or build.devDist of app.config.mjs), never into the dist/ that
// clasp pushes, and its server.js carries the dev marker that deploy and distId refuse. The title, meta tags and favicon the
// app set on its HtmlOutput are written into the served head, as the outer page has them in production.
//
// /__rpc refuses a request whose Origin is not the request's own (an allowed host, the Host
// header's name, the same scheme and effective port; "null" and userinfo are refused), or whose
// Sec-Fetch-Site is present and not same-origin; every response carries X-Frame-Options
// SAMEORIGIN. The dev build directory may not be, hold or sit inside a pushed directory. A bind
// to every interface (0.0.0.0 or ::) prints one warning: anyone on the network can then call
// every RPC as any dev identity.
//
// dev.config.mjs (optional, default export):
//   { owner, tz = "UTC", props = {}, identities = {owner, admin, viewer, denied, anonymous},
//     sheets = { <sheet id>: <csv path relative to root> }, sourceProp = "SOURCE_SHEET_ID",
//     adminsProp = "ALLOWED_ADMINS", usersProp = "ALLOWED_USERS", modeProp = "ACCESS_MODE",
//     auditProp, auditTab = "Audit" }
//   auditProp: the Script Property that holds an app's audit sheet id. When given, the dev server
//   makes an empty spreadsheet in the fakes and stores its id there, so an app that refuses a
//   change it cannot record works without running setup().

import { build as esbuild } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, watch as fsWatch } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineBuild } from "../build/defineBuild.mjs";
import { crossBridge, crossResult } from "../test/fakeScriptRun.js";
import { createGallery } from "./gallery.mjs";
import { parseFlags } from "./flags.mjs";
import { isHostName, previewHosts, publicUrl } from "./hosts.mjs";

export { parseFlags, previewHosts, publicUrl };

/** What a launcher prints before the public URL of the dev server. */
export const PUBLIC_URL_LABEL = "Cloud Shell / proxy: ";

const UI_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ui", "src");
const UI_MANIFEST = join(UI_SRC, "..", "components.json");
const GALLERY_SRC = join(dirname(fileURLToPath(import.meta.url)), "gallery");

const HERE = dirname(fileURLToPath(import.meta.url));
// The first line of shim.js is a type-check pragma; the served text starts at the block comment.
const SHIM = readFileSync(join(HERE, "shim.js"), "utf8").replace(/^\/\/ @ts-nocheck\n/, "");

/**
 * A TypeScript module of the kit: imported directly where the runtime can load TypeScript, else
 * bundled to a temp file (gasFakes.ts imports "./csv" without an extension), loaded and removed.
 * @param {string} rel path relative to this file
 * @param {boolean} [forceBundle] take the bundling path (for tests)
 * @returns {Promise<any>}
 */
export async function loadTs(rel, forceBundle = false) {
  const href = new URL(rel, import.meta.url).href;
  if (!forceBundle) {
    try {
      return await import(/* @vite-ignore */ href);
    } catch { /* a runtime without TypeScript: bundle it */ }
  }
  const dir = mkdtempSync(join(tmpdir(), "gas-kit-dev-"));
  try {
    const out = join(dir, basename(rel, ".ts") + ".mjs");
    await esbuild({
      entryPoints: [fileURLToPath(href)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "silent",
    });
    return await import(pathToFileURL(out).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string} text */
function parseList(text) {
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    if (Array.isArray(v)) return v.map((x) => String(x).toLowerCase());
  } catch { /* a plain delimited value */ }
  return text.split(/[\s,;]+/).filter(Boolean).map((x) => x.toLowerCase());
}

/**
 * A value of the kind the shim marked as illegal, built as the real thing so the bridge rule rejects it
 * with the real message.
 * @param {string} kind
 * @returns {any}
 */
function illegalOf(kind) {
  if (kind === "Date") return new Date(0);
  if (kind === "symbol") return Symbol("x");
  if (kind === "bigint") return BigInt(0);
  if (kind === "circular") { const o = /** @type {any} */ ({}); o.self = o; return o; }
  if (kind === "function") return () => undefined;
  return Object.create({ constructor: { name: kind } });
}

/** @param {any} v the JSON of a call's args, with illegal-value markers revived as the real thing
 * @returns {any} */
function revive(v) {
  if (Array.isArray(v)) return v.map(revive);
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (keys.length === 1 && typeof v.__illegal === "string") return illegalOf(v.__illegal);
    // A plain object that itself had an __illegal or __escaped key travels wrapped: unwrap, no marker check.
    const inner = keys.length === 1 && v.__escaped && typeof v.__escaped === "object" && !Array.isArray(v.__escaped) ? v.__escaped : v;
    // fromEntries defines own properties, so a "__proto__" key stays data.
    return Object.fromEntries(Object.keys(inner).map((k) => [k, revive(inner[k])]));
  }
  return v;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} v */
const escAttr = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The head tags of the outer page that the app asked for through its HtmlOutput. A tag the content
 * already carries is not repeated.
 * @param {string} html
 * @param {{ title?: string, meta?: Record<string, string>, faviconUrl?: string | null } | undefined} outer
 */
function outerHead(html, outer) {
  if (!outer) return "";
  let out = "";
  if (outer.title && !/<title[\s>]/i.test(html)) out += "<title>" + escAttr(outer.title) + "</title>";
  for (const [n, c] of Object.entries(outer.meta || {})) {
    const has = new RegExp("<meta\\s[^>]*name\\s*=\\s*[\"']?" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\"'\\s>]", "i");
    if (!has.test(html)) out += '<meta name="' + escAttr(n) + '" content="' + escAttr(c) + '">';
  }
  if (outer.faviconUrl && !/<link\s[^>]*rel\s*=\s*["']?(shortcut )?icon/i.test(html)) out += '<link rel="icon" href="' + escAttr(outer.faviconUrl) + '">';
  return out;
}

/**
 * @param {string} html
 * @param {string[]} names
 * @param {boolean} reload
 * @param {{ title?: string, meta?: Record<string, string>, faviconUrl?: string | null }} [outer] what the app set on its HtmlOutput
 */
export function injectShim(html, names, reload, outer) {
  const cfg = JSON.stringify({ names, reload }).replace(/</g, "\\u003c");
  const tag = "<script>window.__GK_DEV=" + cfg + ";\n" + SHIM + "\n</script>" + outerHead(html, outer);
  // Function replacements: the shim holds dollar signs that a string replacement would misread.
  if (/<head(\s[^>]*)?>/i.test(html)) return html.replace(/<head(\s[^>]*)?>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + "<head>" + tag + "</head>");
  return tag + html;
}

/**
 * Where the dev build goes: appConfig.dist given to serve, else build.devDist of app.config.mjs,
 * else <root>/dev/.cache/dist. Throws when that is the production dist (build.dist, default
 * <root>/dist) or the rootDir of .clasp.json, the directory clasp pushes.
 * @param {string} root
 * @param {{ dist?: string, devDist?: string }} fileCfg the build section of app.config.mjs
 * @param {{ dist?: string } | undefined} appConfigArg
 * @returns {string}
 */
export function devDistOf(root, fileCfg, appConfigArg) {
  const dist = resolve(root, (appConfigArg && appConfigArg.dist) || fileCfg.devDist || join("dev", ".cache", "dist"));
  const pushed = [resolve(root, fileCfg.dist || "dist")];
  const clasp = join(root, ".clasp.json");
  if (existsSync(clasp)) {
    try {
      const rootDir = JSON.parse(readFileSync(clasp, "utf8")).rootDir;
      if (typeof rootDir === "string" && rootDir) pushed.push(resolve(root, rootDir));
    } catch { /* an unreadable .clasp.json: the default dist is still refused */ }
  }
  // Compared on real paths (a symlink to dist is dist), and by containment both ways: a dev dist
  // inside a pushed directory is pushed with it, and one that contains a pushed directory (the
  // app root, say) would write the dev bundle over or beside what is pushed.
  const d = realish(dist);
  for (const p of pushed.map(realish)) {
    if (within(d, p) || within(p, d)) throw new Error("the dev build would be written to " + dist + ", which is, holds or sits inside " + p + ", which clasp pushes; give the dev server another directory (default dev/.cache/dist)");
  }
  return dist;
}

/** True when a is b or inside it. @param {string} a @param {string} b */
function within(a, b) {
  const r = relative(b, a);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}

/**
 * The real path of p, resolving symlinks of the part that exists (the rest is appended), so a
 * directory that is not made yet still compares by where it will be.
 * @param {string} p
 */
function realish(p) {
  /** @type {string[]} */ const rest = [];
  let cur = resolve(p);
  for (;;) {
    try { return join(realpathSync(cur), ...rest); } catch { /* not there yet */ }
    const up = dirname(cur);
    if (up === cur) return resolve(p);
    rest.unshift(basename(cur));
    cur = up;
  }
}

/**
 * @param {string} root
 * @param {any} appConfigArg
 * @param {() => string} getServiceUrl the dev server's own /exec URL, what ScriptApp.getService().getUrl() answers
 */
async function createApp(root, appConfigArg, getServiceUrl) {
  const fakesModule = await loadTs("../test/gasFakes.ts");
  const { parseCsv } = await loadTs("../test/csv.ts");
  const cfgFile = join(root, "app.config.mjs");
  const fileCfg = existsSync(cfgFile) ? ((await import(pathToFileURL(cfgFile).href)).default?.build ?? {}) : {};
  const dist = devDistOf(root, fileCfg, appConfigArg);
  // The dev build defines __GK_DEV__ and carries the dev marker; a production build has neither.
  const builder = defineBuild({
    root,
    appConfig: { log: false, ...fileCfg, ...appConfigArg, dist, devMarker: true, define: { ...fileCfg.define, ...(appConfigArg || {}).define, __GK_DEV__: "true" } },
  });
  const devFile = join(root, "dev", "dev.config.mjs");
  const dev = existsSync(devFile) ? ((await import(pathToFileURL(devFile).href)).default ?? {}) : {};
  const owner = String(dev.owner || "owner@example.org").toLowerCase();
  const keys = {
    source: dev.sourceProp || "SOURCE_SHEET_ID",
    admins: dev.adminsProp || "ALLOWED_ADMINS",
    users: dev.usersProp || "ALLOWED_USERS",
    mode: dev.modeProp || "ACCESS_MODE",
  };
  const identities = {
    owner, admin: "admin@example.org", viewer: "viewer@example.org", denied: "denied@example.org", anonymous: "",
    ...(dev.identities || {}),
  };
  const defaultTz = String(dev.tz || "UTC");

  /** @typedef {{ serverJs: string, entryJs: string, htmls: Record<string, string>, names: string[] }} Bundle */
  /** @type {Bundle} */
  let loaded = { serverJs: "", entryJs: "", htmls: {}, names: [] };
  /** @type {any} */
  let fakes = null;
  let fakesTz = "";
  /** The data-flag signature of the previous request (null before the first). */
  let lastSig = /** @type {string | null} */ (null);

  function ensureFakes(/** @type {string} */ tz, /** @type {Bundle} */ bundle) {
    if (fakes && fakesTz === tz) return;
    const old = fakes;
    // A time zone change reinstalls the fakes (the zone is fixed at install): carry the state over.
    // Lock state is not carried; every request releases its locks before it answers.
    const carry = old ? { props: new Map(old.props), cache: new Map(old.cache), triggers: old.triggers.slice() } : null;
    if (old) old.uninstall();
    fakes = fakesModule.installGasFakes({ owner, tz, now: () => Date.now(), htmlFiles: bundle.htmls, serviceUrl: getServiceUrl(), advanced: true });
    fakesTz = tz;
    if (carry) {
      carry.props.forEach((v, k) => fakes.props.set(k, v));
      carry.cache.forEach((v, k) => fakes.cache.set(k, v));
      fakes.triggers.push(...carry.triggers);
    } else {
      for (const [k, v] of Object.entries(dev.props || {})) fakes.props.set(k, String(v));
      const ids = Object.keys(dev.sheets || {});
      if (ids.length && !fakes.props.has(keys.source)) fakes.props.set(keys.source, ids[0]);
    }
    // The audit sheet lives in the fakes, so it is made again whenever they are reinstalled.
    if (dev.auditProp) {
      const made = /** @type {any} */ (globalThis).Sheets.Spreadsheets.create({ properties: { title: "Dev audit" }, sheets: [{ properties: { title: String(dev.auditTab || "Audit") } }] });
      fakes.props.set(String(dev.auditProp), made.spreadsheetId);
    }
  }

  function seedSheets(/** @type {string} */ tz, /** @type {boolean} */ empty) {
    for (const [id, rel] of Object.entries(dev.sheets || {})) {
      const text = readFileSync(resolve(root, String(rel)), "utf8");
      const tab = basename(String(rel), extname(String(rel)));
      const data = empty ? parseCsv(text).slice(0, 1) : text;
      fakes.addSheet(id, { name: tab, tz, tabs: { [tab]: data } });
    }
  }

  /** @type {Promise<any>} */
  let chain = Promise.resolve();
  /**
   * Run `fn` with the fakes installed, the flags applied and the app's globals defined, one request
   * at a time. Everything is undone before the next request starts.
   * @template T
   * @param {import("./flags.mjs").Flags} flags
   * @param {(added: string[]) => T} fn the globals the bundles defined or replaced are passed in
   * @param {Bundle} [bundle] default: the loaded one
   * @returns {Promise<T>}
   */
  function withApp(flags, fn, bundle) {
    const job = chain.then(() => exec(flags, fn, bundle || loaded));
    chain = job.catch(() => undefined);
    return job;
  }

  function exec(/** @type {import("./flags.mjs").Flags} */ flags, /** @type {(added: string[]) => any} */ fn, /** @type {Bundle} */ bundle) {
    const tz = flags.tz || defaultTz;
    ensureFakes(tz, bundle);
    for (const [k, v] of Object.entries(bundle.htmls)) fakes.setHtmlFile(k, v);
    seedSheets(tz, flags.empty);
    // The script cache holds data read under one set of data flags: never serve it under another.
    const sig = JSON.stringify([flags.empty, flags.nosource, tz]);
    if (lastSig !== null && sig !== lastSig) fakes.clearCache();
    lastSig = sig;
    /** @type {Map<string, { orig: string | undefined, set: string | undefined }>} */
    const touched = new Map();
    const setProp = (/** @type {string} */ k, /** @type {string | null} */ v) => {
      const prev = touched.get(k);
      touched.set(k, { orig: prev ? prev.orig : fakes.props.get(k), set: v === null ? undefined : v });
      if (v === null) fakes.props.delete(k); else fakes.props.set(k, v);
    };
    let email = owner;
    if (flags.as !== null) email = flags.as;
    else if (flags.role) email = String(identities[flags.role] ?? "").toLowerCase();
    if (flags.as === null && flags.role === "admin" && email) {
      setProp(keys.admins, JSON.stringify(Array.from(new Set([...parseList(fakes.props.get(keys.admins) ?? ""), email]))));
    }
    if (flags.as === null && flags.role === "viewer" && email) {
      setProp(keys.users, JSON.stringify(Array.from(new Set([...parseList(fakes.props.get(keys.users) ?? ""), email]))));
    }
    if (flags.mode) setProp(keys.mode, flags.mode);
    if (flags.nosource) setProp(keys.source, null);
    fakes.as(email);
    if (flags.coldcache) fakes.clearCache();
    // Page outputs would pile up over a long dev session.
    if (Array.isArray(fakes.outputs)) fakes.outputs.length = 0;

    const g = /** @type {any} */ (globalThis);
    // Every global's descriptor before the bundles run: afterwards a new global is deleted and a
    // replaced one (an entry.js function named like a node global) is put back.
    /** @type {Map<string, PropertyDescriptor | undefined>} */
    const before = new Map(Object.getOwnPropertyNames(globalThis).map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]));
    const sameDesc = (/** @type {PropertyDescriptor | undefined} */ a, /** @type {PropertyDescriptor | undefined} */ b) =>
      !!a && !!b && a.value === b.value && a.get === b.get && a.set === b.set;
    const changed = () => Object.getOwnPropertyNames(globalThis).filter((n) => !before.has(n) || !sameDesc(before.get(n), Object.getOwnPropertyDescriptor(globalThis, n)));
    try {
      // The server bundle is strict, so its var stays local to a function; take the global it names.
      g.Server = new Function(bundle.serverJs + "\n;return Server;")();
      // Indirect eval: entry.js's function declarations land on globalThis and can be deleted.
      (0, eval)(bundle.entryJs);
      if (typeof g.doGet !== "function" && /^\s*["']use strict["']/.test(bundle.entryJs)) {
        throw new Error('entry.js starts with "use strict": its function declarations stay local to the evaluation, so doGet and the api_ functions are not defined. Remove the directive (Apps Script runs entry.js sloppy).');
      }
      return fn(changed());
    } finally {
      for (const n of changed()) {
        try {
          const d = before.get(n);
          if (d) Object.defineProperty(globalThis, n, d); else delete g[n];
        } catch { /* keep going */ }
      }
      // A flag's prop is put back only if the app did not write it meanwhile (a saved access mode
      // or source binding is the app's, not the flag's).
      touched.forEach((t, k) => {
        if (fakes.props.get(k) !== t.set) return;
        if (t.orig === undefined) fakes.props.delete(k); else fakes.props.set(k, t.orig);
      });
      // Apps Script releases the script lock when an execution ends.
      fakes.resetLocks();
    }
  }

  async function load() {
    const { dist } = await builder.build();
    const read = (/** @type {string} */ f) => readFileSync(join(dist, f), "utf8");
    /** @type {Record<string, string>} */
    const htmls = {};
    for (const f of ["index", "styles", "js_app"]) if (existsSync(join(dist, f + ".html"))) htmls[f] = read(f + ".html");
    /** @type {Bundle} */
    const next = { serverJs: read("server.js"), entryJs: read("entry.js"), htmls, names: [] };
    // The public functions are what entry.js defines, minus private (trailing underscore) names. They are
    // found on the new bundle before it replaces the old one, so a request during a rebuild still
    // sees a complete bundle, and an entry.js that throws leaves the previous one serving.
    next.names = await withApp(parseFlags(""), (added) => {
      const g = /** @type {any} */ (globalThis);
      return added.filter((n) => typeof g[n] === "function" && !n.endsWith("_"));
    }, next);
    loaded = next;
  }

  function close() {
    if (fakes) { fakes.uninstall(); fakes = null; }
  }

  /** @param {URL} url */
  async function page(url) {
    const flags = parseFlags(url.searchParams);
    // Apps Script documents e.parameter as the first value of a repeated name; parameters keeps them all.
    const parameter = /** @type {Record<string, string>} */ ({});
    for (const [k, v] of url.searchParams) if (!Object.prototype.hasOwnProperty.call(parameter, k)) parameter[k] = v;
    const parameters = {};
    for (const k of new Set(url.searchParams.keys())) /** @type {any} */ (parameters)[k] = url.searchParams.getAll(k);
    const ev = { parameter, parameters, queryString: url.search.replace(/^\?/, ""), contextPath: "", contentLength: -1 };
    return withApp(flags, () => {
      const g = /** @type {any} */ (globalThis);
      if (typeof g.doGet !== "function") throw new Error("entry.js defines no doGet");
      const out = g.doGet(ev);
      if (typeof out === "string") return { html: out };
      return { html: String(out.getContent()), title: out.title, meta: out.meta, faviconUrl: out.faviconUrl };
    });
  }

  /**
   * @param {string} name
   * @param {any} body
   * @param {import("./flags.mjs").Flags} flags
   * @returns {Promise<{ error: string } | { value: any }>} a thrown error is out of band, never a value
   */
  async function rpc(name, body, flags) {
    let args;
    try {
      args = crossBridge(revive(body));
    } catch (e) {
      return { error: /** @type {Error} */ (e).message };
    }
    return withApp(flags, () => {
      try {
        const g = /** @type {any} */ (globalThis);
        return { value: crossResult(g[name](...args)) };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
  }

  return { load, page, rpc, close, hasName: (/** @type {string} */ n) => loaded.names.includes(n), names: () => loaded.names };
}

/** The largest request body the dev server reads. */
const MAX_BODY = 8 * 1024 * 1024;

/** @param {any} req @returns {Promise<string | null>} the body, or null when it is over MAX_BODY */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    /** @type {Buffer[]} */
    const parts = [];
    let size = 0;
    let over = false;
    req.on("data", (/** @type {Buffer} */ c) => {
      size += c.length;
      if (over) return;
      if (size > MAX_BODY) { over = true; parts.length = 0; resolveBody(null); return; }
      parts.push(c);
    });
    req.on("end", () => { if (!over) resolveBody(Buffer.concat(parts).toString("utf8")); });
    req.on("error", reject);
  });
}

/**
 * Start the dev server.
 *
 * `env` (default process.env) is read for WEB_HOST, DEV_HOSTS and DEV_PUBLIC_URL (see hosts.mjs);
 * `allowedHosts` adds exact host names the Host header may carry. `url` is always the local URL;
 * `publicUrl` is the one a browser behind a proxy uses, or null when none is known. `warn`
 * (default console.warn) prints the one-line warning of a wildcard bind.
 * @param {{ root?: string, port?: number, host?: string, gallery?: boolean, watch?: boolean, appConfig?: any,
 *   env?: Record<string, string | undefined>, allowedHosts?: string[], warn?: (line: string) => void }} [opts]
 * @returns {Promise<{ url: string, publicUrl: string | null, port: number, close: () => Promise<void>, rebuild: () => Promise<void> }>}
 */
export async function serve(opts = {}) {
  const { root, port = 0, host = "127.0.0.1", gallery = true, watch = false, appConfig, env = process.env, allowedHosts: extraHosts = [], warn = (/** @type {string} */ l) => console.warn(l) } = opts;
  /** @type {Awaited<ReturnType<typeof createApp>> | null} */
  let app = null;
  let serviceUrl = "";
  const gal = gallery ? createGallery({ cache: !watch, reload: watch }) : null;
  /** @type {Set<any>} */
  const sse = new Set();
  let boundPort = 0;
  const wildcard = host === "0.0.0.0" || host === "::";
  /** How a client reaches this server: a wildcard bind answers on loopback, an IPv6 literal is bracketed. */
  const urlHost = wildcard ? (host === "::" ? "[::1]" : "127.0.0.1") : host.includes(":") ? "[" + host + "]" : host;
  /** Names the Host header may carry: a request for any other name is a rebound DNS name. */
  const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]", urlHost.toLowerCase()]);
  // The caller's own proxy names, exact. The environment's are added once the port is bound.
  for (const h of extraHosts) if (typeof h === "string" && h.trim()) allowedHosts.add(h.trim().toLowerCase());
  /** @param {string | undefined} h */
  const hostAllowed = (h) => {
    const m = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec((h || "").toLowerCase());
    if (!m) return false;
    // Bound to every interface on purpose: any IP literal is a LAN address of this machine, a name is not.
    const lan = wildcard && (/^\d{1,3}(\.\d{1,3}){3}$/.test(m[1]) || /^\[[0-9a-f:.]+\]$/.test(m[1]));
    if (!allowedHosts.has(m[1]) && !lan) return false;
    // A proxy name normally carries no port; one that does must still name the bound port.
    return !m[2] || Number(m[2]) === boundPort;
  };
  /** @param {string | undefined} h the refused Host header */
  const forbidden = (h) => {
    const name = (h || "").toLowerCase().replace(/:\d+$/, "");
    // Only a well-formed name is echoed back.
    const hint = isHostName(name) ? "DEV_HOSTS=" + name : "DEV_HOSTS to its host name";
    return "Forbidden host: use localhost or " + urlHost + ". Behind a proxy or a port-forwarder, start the dev server with " + hint
      + " (comma-separated exact names, {port} stands for the port).";
  };

  async function rebuild() {
    if (!app) return;
    await app.load();
    for (const res of sse) res.write("event: reload\ndata: 1\n\n");
  }

  /** Refusal text for a cross-site RPC, or null when the request may proceed. @param {any} req */
  const crossSite = (req) => {
    // A browser marks every fetch: only the page's own origin sends same-origin. same-site (another
    // port of localhost, say), cross-site and none are refused; a request without the header (a
    // local process, an older browser) is judged by its Origin below.
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && String(site).toLowerCase() !== "same-origin") return "Cross-site requests are refused: call the dev server from its own page";
    const origin = req.headers.origin;
    if (origin === undefined) return null;
    return sameOrigin(String(origin), req) ? null : "Forbidden origin: call the dev server from its own page";
  };

  /**
   * True when origin is this request's own origin: an allowed host, the same host name as the
   * Host header, the same scheme and the same effective port. The request's scheme is http, or the
   * proxy's X-Forwarded-Proto (a browser cannot set that header on a cross-origin fetch without a
   * preflight, which the dev server never answers). A Host with no port is a proxy name: its
   * effective port is the default of the forwarded scheme, or, with no forwarded scheme, the
   * origin must use the default port of its own scheme.
   * @param {string} origin @param {any} req
   */
  const sameOrigin = (origin, req) => {
    /** @type {URL} */ let o;
    try { o = new URL(origin); } catch { return false; }
    if ((o.protocol !== "http:" && o.protocol !== "https:") || o.username || o.password || !hostAllowed(o.host)) return false;
    const m = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(String(req.headers.host || "").toLowerCase());
    if (!m || m[1] !== o.hostname.toLowerCase()) return false;
    const fwd = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    const scheme = fwd === "http" || fwd === "https" ? fwd + ":" : m[2] ? "http:" : null;
    const dflt = (/** @type {string} */ p) => (p === "https:" ? 443 : 80);
    const originPort = o.port ? Number(o.port) : dflt(o.protocol);
    if (scheme === null) return !o.port;
    if (o.protocol !== scheme) return false;
    return originPort === (m[2] ? Number(m[2]) : dflt(scheme));
  };

  const send = (/** @type {any} */ res, /** @type {number} */ status, /** @type {string} */ type, /** @type {string} */ body) => {
    res.writeHead(status, { "content-type": type + "; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN" });
    res.end(body);
  };

  const server = createServer(async (req, res) => {
    if (!hostAllowed(req.headers.host)) return send(res, 403, "text/plain", forbidden(req.headers.host));
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "localhost"));
    const path = url.pathname;
    try {
      if (root && !app) return send(res, 503, "text/plain", "The app is still building");
      if (path === "/__events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-frame-options": "SAMEORIGIN" });
        res.write(": open\n\n");
        sse.add(res);
        req.on("close", () => sse.delete(res));
        return;
      }
      if (path === "/favicon.ico") { res.writeHead(204, { "x-frame-options": "SAMEORIGIN" }); res.end(); return; }
      if (gal && (path === "/gallery" || path === "/gallery/")) return send(res, 200, "text/html", gal.page());
      if (gal && path === "/gallery.js") return send(res, 200, "text/javascript", await gal.js());
      if (gal && path === "/gallery-stub.js") return send(res, 200, "text/javascript", "");
      if (gal && path === "/gallery.json") return send(res, 200, "application/json", gal.manifestText());
      if (gal && path === "/gallery.css") return send(res, 200, "text/css", await gal.css());
      if (app && req.method === "POST" && path.startsWith("/__rpc/")) {
        let name;
        try { name = decodeURIComponent(path.slice("/__rpc/".length)); } catch { return send(res, 400, "text/plain", "The function name is not valid percent-encoding"); }
        const refused = crossSite(req);
        if (refused) return send(res, 403, "text/plain", refused);
        if (!app.hasName(name)) return send(res, 404, "text/plain", "No such server function: " + name);
        // A cross-site form post cannot send application/json without a preflight.
        if (!/^application\/json\s*(;|$)/i.test(String(req.headers["content-type"] || ""))) return send(res, 415, "text/plain", "Send the arguments as application/json");
        let body;
        const text = await readBody(req);
        if (text === null) { res.writeHead(413, { "content-type": "text/plain", connection: "close", "x-frame-options": "SAMEORIGIN" }); res.end("The request body is too large"); return; }
        try { body = JSON.parse(text || "[]"); } catch { return send(res, 400, "text/plain", "The body must be a JSON array of arguments"); }
        if (!Array.isArray(body)) return send(res, 400, "text/plain", "The body must be a JSON array of arguments");
        const flags = parseFlags(url.searchParams);
        const result = await app.rpc(name, body, flags);
        if (flags.slow) await sleep(flags.slow);
        if ("error" in result) return send(res, 500, "application/json", JSON.stringify({ __error: result.error }));
        return send(res, 200, "application/json", JSON.stringify(result.value === undefined ? null : result.value));
      }
      if (req.method === "GET" && (path === "/" || path === "/exec")) {
        if (!app) return send(res, 404, "text/plain", gal ? "No app root was given. See /gallery." : "No app root was given.");
        const p = await app.page(url);
        return send(res, 200, "text/html", injectShim(p.html, app.names(), watch, p));
      }
      send(res, 404, "text/plain", "Not found: " + path);
    } catch (e) {
      send(res, 500, "text/plain", "dev server error: " + (e instanceof Error ? e.message : String(e)));
    }
  });

  await new Promise((ok, fail) => { server.once("error", fail); server.listen(port, host, () => ok(undefined)); });
  const bound = /** @type {import("node:net").AddressInfo} */ (server.address()).port;
  boundPort = bound;
  const localUrl = "http://" + urlHost + ":" + bound;
  if (wildcard) warn("dev server: listening on every interface (" + host + "); anyone who can reach port " + bound + " can call every RPC as any dev identity");
  for (const h of previewHosts(env, bound)) allowedHosts.add(h);
  // Where a browser behind a proxy finds this server; the fakes report it as the web app's URL.
  const proxyUrl = publicUrl(env, bound);
  serviceUrl = (proxyUrl || localUrl) + "/exec";
  try {
    if (root) {
      app = await createApp(resolve(root), appConfig, () => serviceUrl);
      await app.load();
    }
  } catch (e) {
    if (app) app.close();
    server.closeAllConnections();
    await new Promise((ok) => server.close(() => ok(undefined)));
    throw e;
  }

  /** @type {ReturnType<typeof fsWatch> | null} */
  let watcher = null;
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  if (app && watch && root) {
    const trigger = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { rebuild().catch((e) => console.error("rebuild failed: " + e.message)); }, 100);
    };
    watcher = fsWatch(join(resolve(root), "src"), { recursive: true }, trigger);
  }
  /** @type {ReturnType<typeof fsWatch>[]} */
  const uiWatchers = [];
  if (gal && watch) {
    // The gallery rebuilds its bundles per request in watch mode; tell open gallery pages to reload.
    let galTimer = /** @type {NodeJS.Timeout | null} */ (null);
    const galTrigger = () => {
      if (galTimer) clearTimeout(galTimer);
      galTimer = setTimeout(() => { for (const res of sse) res.write("event: reload\ndata: 1\n\n"); }, 150);
    };
    for (const p of [UI_SRC, UI_MANIFEST, GALLERY_SRC]) {
      try { uiWatchers.push(fsWatch(p, { recursive: true }, galTrigger)); } catch { /* a missing path: nothing to watch */ }
    }
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    if (watcher) watcher.close();
    uiWatchers.forEach((w) => w.close());
    for (const res of sse) res.end();
    sse.clear();
    server.closeAllConnections();
    await new Promise((ok) => server.close(() => ok(undefined)));
    if (app) app.close();
  }

  return { url: localUrl, publicUrl: proxyUrl, port: bound, close, rebuild };
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const o = { root: /** @type {string | undefined} */ (undefined), port: 0, host: "127.0.0.1", gallery: true, watch: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") o.root = argv[++i];
    else if (a === "--port") o.port = Number(argv[++i]);
    else if (a === "--host") o.host = String(argv[++i] ?? "");
    else if (a === "--no-gallery") o.gallery = false;
    else if (a === "--watch") o.watch = true;
    else throw new Error("unknown flag: " + a);
  }
  if (o.root === undefined && argv.includes("--root")) throw new Error("--root needs a directory");
  if (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535) throw new Error("--port needs a number from 0 to 65535");
  if (!o.host || o.host.startsWith("--")) throw new Error("--host needs an address, for example 127.0.0.1 or 0.0.0.0");
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(/** @type {Error} */ (e).message);
    console.error("usage: serve.mjs [--root <dir>] [--port <n>] [--host <address>] [--no-gallery] [--watch]");
    process.exit(1);
  }
  const root = o.root ?? (existsSync(join(process.cwd(), "src", "gas", "entry.js")) ? process.cwd() : undefined);
  const s = await serve({ ...o, root });
  if (root) console.log(s.url);
  if (o.gallery) console.log(s.url + "/gallery");
  if (s.publicUrl) {
    if (root) console.log(PUBLIC_URL_LABEL + s.publicUrl);
    if (o.gallery) console.log(PUBLIC_URL_LABEL + s.publicUrl + "/gallery");
  }
}

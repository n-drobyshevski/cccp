// The routes step: the files and the main.js patches the page-porting steps build on.
// src/client/migrated/routes.js exports migratedRoutes(app), the routes of the migrated pages; main.js
// spreads it after the template's routes, so a path used there ("/", "/settings") replaces the
// template's page. Page steps add `"<path>": <handler>,` lines at the /* migrate:routes */ marker and
// their imports above /* migrate:imports */. Every route there goes through legacyScoped
// (src/client/migrated/legacyScope.js): while a migrated page is shown the html element carries
// LEGACY_ATTR (data-legacy, from _css.mjs), which css-import scopes the legacy CSS under, and a kit
// page is shown without it.
// src/client/migrated/legacyRoutes.js exports legacyHashFor(search), which turns an old query link
// (?r=item&id=a1, ?page=item) into the hash route plan.maps.routes names, and legacyHashFromHash(hash),
// which does the same for an old hash form (#/item?id=a1 to #/item/a1, an alias #/items to #/list).
// main.js follows the one at boot (the query when the address has no hash, else the hash) and the
// hash one on every hashchange, before the router sees it. A query parameter the kit path does not
// take stays in the hash as its query (the router passes it to the page); nothing is appended to a
// path without a :param. maps.routes entries are {"<legacy pattern>": "/<kit path with :params>"};
// the step writes every inventory route into it (a seeded "#/x" value becomes "/x") and the person
// may edit them.
import { LEGACY_ATTR } from "./_css.mjs";
import { drift, jsHeader } from "./_common.mjs";

const ROUTES_JS = "src/client/migrated/routes.js";
const LEGACY_JS = "src/client/migrated/legacyRoutes.js";
const MAIN = "src/client/main.js";
const SEARCH = /^\?[A-Za-z_][\w-]*=[^&#\s"'\\/]*(?:&[A-Za-z_][\w-]*=[^&#\s"'\\/]*)*$/;
const PATH = /^\/(?:[A-Za-z0-9_.~:%-]+(?:\/[A-Za-z0-9_.~:%-]+)*)?$/;

/**
 * The kit path a legacy pattern becomes by default: ?r=item to /item, #/list to /list.
 * @param {string} pattern
 */
export function defaultPath(pattern) {
  const q = /^\?[A-Za-z_][\w-]*=([^&#]*)/.exec(pattern);
  if (q) {
    let v = q[1] ?? "";
    try {
      v = decodeURIComponent(v);
    } catch {
      // a malformed escape stays as written
    }
    return "/" + v.replace(/^\/+/, "");
  }
  return pattern.replace(/^#/, "").replace(/\?.*$/, "") || "/";
}

/**
 * Every inventory route with its kit path, then the plan's own entries. A leading "#" on a value is
 * dropped (the plan is seeded with "#/x").
 * @param {string[]} routes inv.routes @param {Record<string, string>} mapped plan.maps.routes
 * @returns {{ table: Record<string, string>, bad: string[] }}
 */
export function routeTable(routes, mapped) {
  /** @type {Record<string, string>} */
  const table = {};
  /** @type {string[]} */
  const bad = [];
  for (const r of routes) {
    const given = typeof mapped[r] === "string" ? mapped[r] : defaultPath(r);
    table[r] = given.replace(/^#/, "") || "/";
  }
  for (const [k, v] of Object.entries(mapped)) if (typeof v === "string" && !(k in table)) table[k] = v.replace(/^#/, "") || "/";
  for (const [k, v] of Object.entries(table)) {
    const ok = (k.startsWith("?") ? SEARCH.test(k) : /^#\/[^\s"'\\]*$/.test(k) && !k.includes("//")) && PATH.test(v);
    if (!ok) {
      bad.push(k);
      delete table[k];
    }
  }
  return { table, bad };
}

/** The query patterns (the ones legacyHashFor translates). @param {Record<string, string>} table */
export const searchRoutes = (table) => Object.entries(table).filter(([k]) => k.startsWith("?"));

/**
 * The hash patterns (the ones legacyHashFromHash translates), the ones without a :param segment
 * first, so a literal "#/item/new" wins over "#/item/:id".
 * @param {Record<string, string>} table
 */
export const hashRoutes = (table) => {
  const out = Object.entries(table).filter(([k]) => k.startsWith("#"));
  const params = (/** @type {string} */ k) => (k.match(/\/:/g) ?? []).length;
  return out.map((e, i) => ({ e, i })).sort((x, y) => params(x.e[0]) - params(y.e[0]) || x.i - y.i).map((x) => x.e);
};

/** @param {Record<string, string>} table */
function legacyJs(table) {
  const search = Object.fromEntries(searchRoutes(table));
  const hash = Object.fromEntries(hashRoutes(table));
  return (
    jsHeader("routes", "plan.maps.routes") +
    "// Old links arrive as a query string (?r=item&id=a1, ?page=item) or an old hash form (#/item?id=a1);\n" +
    "// the router speaks the kit's hash routes. legacyHashFor and legacyHashFromHash turn the one into\n" +
    "// the other, from the tables below (edit the paths freely). :name in a kit path takes the parameter\n" +
    "// of that name (a :name value in a query pattern, a :name segment of a hash pattern, else the query);\n" +
    "// any other query parameter stays in the hash as its query, which the router passes to the page.\n" +
    "\n/** The legacy query pattern to the kit path. @type {Record<string, string>} */\n" +
    "const ROUTES = " + JSON.stringify(search, null, 2) + ";\n" +
    "\n/** The legacy hash pattern to the kit path. @type {Record<string, string>} */\n" +
    "const HASH_ROUTES = " + JSON.stringify(hash, null, 2) + ";\n" +
    "\n" +
    "/**\n" +
    " * A kit path with each :name filled by get, or null when one has no value. The names it used are\n" +
    " * pushed onto used.\n" +
    " * @param {string} path @param {(name: string) => string | null} get @param {string[]} used\n" +
    " * @returns {string | null}\n" +
    " */\n" +
    "function fill(path, get, used) {\n" +
    "  let missing = false;\n" +
    "  const out = path.replace(/:([A-Za-z_]\\w*)/g, (_m, name) => {\n" +
    "    const v = get(String(name));\n" +
    "    if (!v) missing = true;\n" +
    "    used.push(String(name));\n" +
    "    return encodeURIComponent(v || \"\");\n" +
    "  });\n" +
    "  return missing ? null : out;\n" +
    "}\n" +
    "\n" +
    "/** The parameters no :name took, as a query (empty when none is left). @param {URLSearchParams} params @param {string[]} used */\n" +
    "function rest(params, used) {\n" +
    "  const left = new URLSearchParams();\n" +
    "  params.forEach((v, k) => {\n" +
    "    if (used.indexOf(k) < 0) left.append(k, v);\n" +
    "  });\n" +
    "  const q = left.toString();\n" +
    "  return q ? \"?\" + q : \"\";\n" +
    "}\n" +
    "\n" +
    "/** @param {string} s */\n" +
    "function decodeSafe(s) {\n" +
    "  try {\n" +
    "    return decodeURIComponent(s);\n" +
    "  } catch (_e) {\n" +
    "    return s;\n" +
    "  }\n" +
    "}\n" +
    "\n" +
    "/**\n" +
    " * The hash route an old query link stands for, or null when it is none of the known ones.\n" +
    " * @param {string} search location.search, for example ?r=item&id=a1\n" +
    " * @returns {string | null}\n" +
    " */\n" +
    "export function legacyHashFor(search) {\n" +
    "  const text = String(search || \"\");\n" +
    "  if (text.charAt(0) !== \"?\") return null;\n" +
    "  const params = new URLSearchParams(text);\n" +
    "  for (const pattern of Object.keys(ROUTES)) {\n" +
    "    const pairs = pattern.slice(1).split(\"&\").map((p) => p.split(\"=\"));\n" +
    "    /** @type {Record<string, string>} */\n" +
    "    const named = {};\n" +
    "    const hit = pairs.every((p) => {\n" +
    "      const want = p[1] || \"\";\n" +
    "      const got = params.get(String(p[0]));\n" +
    "      if (want.charAt(0) !== \":\") return got === want;\n" +
    "      if (got) named[want.slice(1)] = got;\n" +
    "      return !!got;\n" +
    "    });\n" +
    "    if (!hit) continue;\n" +
    "    const used = pairs.map((p) => String(p[0]));\n" +
    "    const out = fill(ROUTES[pattern] || \"/\", (n) => (Object.prototype.hasOwnProperty.call(named, n) ? named[n] || null : params.get(n)), used);\n" +
    "    return out === null ? null : \"#\" + out + rest(params, used);\n" +
    "  }\n" +
    "  return null;\n" +
    "}\n" +
    "\n" +
    "/** One step of legacyHashFromHash. @param {string} hash @returns {string | null} */\n" +
    "function translateHash(hash) {\n" +
    "  const text = String(hash || \"\");\n" +
    "  if (text.slice(0, 2) !== \"#/\") return null;\n" +
    "  const at = text.indexOf(\"?\");\n" +
    "  const segs = (at < 0 ? text : text.slice(0, at)).split(\"/\");\n" +
    "  const params = new URLSearchParams(at < 0 ? \"\" : text.slice(at + 1));\n" +
    "  for (const pattern of Object.keys(HASH_ROUTES)) {\n" +
    "    const ps = pattern.split(\"?\")[0].split(\"/\");\n" +
    "    if (ps.length !== segs.length) continue;\n" +
    "    /** @type {Record<string, string>} */\n" +
    "    const caught = {};\n" +
    "    let ok = true;\n" +
    "    ps.forEach((p, i) => {\n" +
    "      const seg = segs[i] || \"\";\n" +
    "      if (p.charAt(0) === \":\") {\n" +
    "        if (seg) caught[p.slice(1)] = decodeSafe(seg);\n" +
    "        else ok = false;\n" +
    "      } else if (p !== seg) ok = false;\n" +
    "    });\n" +
    "    if (!ok) continue;\n" +
    "    /** @type {string[]} */\n" +
    "    const used = [];\n" +
    "    const out = fill(HASH_ROUTES[pattern] || \"/\", (n) => (Object.prototype.hasOwnProperty.call(caught, n) ? caught[n] || null : params.get(n)), used);\n" +
    "    if (out === null) return null;\n" +
    "    const next = \"#\" + out + rest(params, used);\n" +
    "    return next === text ? null : next;\n" +
    "  }\n" +
    "  return null;\n" +
    "}\n" +
    "\n" +
    "/**\n" +
    " * The kit hash route an old hash form stands for (#/item?id=a1 to #/item/a1), or null when the hash\n" +
    " * is already a kit route or none of the known ones. A translation never leads to a second one, so\n" +
    " * two entries that point at each other cannot loop.\n" +
    " * @param {string} hash location.hash, for example #/item?id=a1\n" +
    " * @returns {string | null}\n" +
    " */\n" +
    "export function legacyHashFromHash(hash) {\n" +
    "  const once = translateHash(hash);\n" +
    "  if (once === null) return null;\n" +
    "  return translateHash(once) === null ? once : null;\n" +
    "}\n"
  );
}

const SCOPE_JS = "src/client/migrated/legacyScope.js";
const SCOPE_TEXT =
  jsHeader("routes", "the migration plan") +
  "// While a migrated page is shown the html element carries data-legacy (an empty value), and the\n" +
  "// legacy CSS, scoped under html[data-legacy], applies; a kit page (access, settings, the register)\n" +
  "// is shown without it. Each migrated route's mount sets it and its teardown takes it off, through\n" +
  "// the router's own lifecycle (no listener of its own). A mount that throws, or one the router\n" +
  "// discards because a newer navigation began, takes it off too, unless a newer migrated page holds\n" +
  "// it. The one gap: while a slow migrated mount is still loading and a kit page is shown, the\n" +
  "// attribute stays until that mount settles (the router runs its teardown then).\n" +
  "\n" +
  "const ATTR = " + JSON.stringify(LEGACY_ATTR) + ";\n" +
  "let holder = 0;\n" +
  "let count = 0;\n" +
  "\n" +
  "/** @returns {Element | null} */\n" +
  "function rootEl() {\n" +
  "  return typeof document === \"undefined\" || !document ? null : document.documentElement;\n" +
  "}\n" +
  "\n" +
  "/** Set the attribute for a new migrated mount; returns its ticket. */\n" +
  "function claim() {\n" +
  "  count += 1;\n" +
  "  holder = count;\n" +
  "  const el = rootEl();\n" +
  "  if (el) el.setAttribute(ATTR, \"\");\n" +
  "  return holder;\n" +
  "}\n" +
  "\n" +
  "/** Take the attribute off, unless a newer mount holds it. @param {number} ticket */\n" +
  "function release(ticket) {\n" +
  "  if (holder !== ticket) return;\n" +
  "  holder = 0;\n" +
  "  const el = rootEl();\n" +
  "  if (el) el.removeAttribute(ATTR);\n" +
  "}\n" +
  "\n" +
  "/**\n" +
  " * A migrated route whose page is shown with data-legacy on the html element.\n" +
  " * @param {import(\"@gas-kit/client/router.js\").Route} route\n" +
  " * @returns {import(\"@gas-kit/client/router.js\").Route}\n" +
  " */\n" +
  "export function legacyRoute(route) {\n" +
  "  return {\n" +
  "    mount(el, params, ctx) {\n" +
  "      const ticket = claim();\n" +
  "      /** @param {unknown} out @returns {() => void} */\n" +
  "      const stop = (out) => () => {\n" +
  "        try {\n" +
  "          if (typeof out === \"function\") out();\n" +
  "        } finally {\n" +
  "          release(ticket);\n" +
  "        }\n" +
  "      };\n" +
  "      /** @type {unknown} */\n" +
  "      let out;\n" +
  "      try {\n" +
  "        out = route.mount(el, params, ctx);\n" +
  "      } catch (e) {\n" +
  "        release(ticket);\n" +
  "        throw e;\n" +
  "      }\n" +
  "      if (out && typeof (/** @type {{ then?: unknown }} */ (out)).then === \"function\") {\n" +
  "        return Promise.resolve(out).then(stop, (e) => {\n" +
  "          release(ticket);\n" +
  "          throw e;\n" +
  "        });\n" +
  "      }\n" +
  "      return stop(out);\n" +
  "    },\n" +
  "  };\n" +
  "}\n" +
  "\n" +
  "/**\n" +
  " * Every route of a table through legacyRoute.\n" +
  " * @param {Record<string, import(\"@gas-kit/client/router.js\").Route>} routes\n" +
  " * @returns {Record<string, import(\"@gas-kit/client/router.js\").Route>}\n" +
  " */\n" +
  "export function legacyScoped(routes) {\n" +
  "  /** @type {Record<string, import(\"@gas-kit/client/router.js\").Route>} */\n" +
  "  const out = {};\n" +
  "  for (const path of Object.keys(routes)) {\n" +
  "    const route = routes[path];\n" +
  "    if (route) out[path] = legacyRoute(route);\n" +
  "  }\n" +
  "  return out;\n" +
  "}\n";

const ROUTES_TEXT =
  jsHeader("routes", "the migration plan") +
  "// The routes of the migrated pages. main.js spreads them after the template's, so a path used here\n" +
  "// (\"/\", \"/settings\") replaces the template's page. A page step adds its handler at the markers.\n" +
  "// legacyScoped shows each of them with data-legacy on the html element (see legacyScope.js).\n" +
  "import { legacyScoped } from \"./legacyScope.js\";\n" +
  "/* migrate:imports */\n" +
  "\n" +
  "/**\n" +
  " * @param {any} app the app main.js made with createApp\n" +
  " * @returns {Record<string, import(\"@gas-kit/client/router.js\").Route>}\n" +
  " */\n" +
  "export function migratedRoutes(app) {\n" +
  "  void app;\n" +
  "  return legacyScoped({\n" +
  "    /* migrate:routes */\n" +
  "  });\n" +
  "}\n";

/** The boot line main.js had before the hash forms were translated. */
const OLD_BOOT = "const legacy = window.location.hash ? null : legacyHashFor(window.location.search);";
const NEW_BOOT = "const legacy = window.location.hash ? legacyHashFromHash(window.location.hash) : legacyHashFor(window.location.search);";
const OLD_IMPORT = 'import { legacyHashFor } from "./migrated/legacyRoutes.js";';
const NEW_IMPORT = 'import { legacyHashFor, legacyHashFromHash } from "./migrated/legacyRoutes.js";';

/**
 * A routes.js from before legacyScoped, with its return wrapped; null when its shape is not the
 * generated one (a person rewrote it).
 * @param {string} text
 */
export function wrapRoutesJs(text) {
  if (text.includes("legacyScoped(")) return text;
  const re = /(export function migratedRoutes\(app\) \{[\s\S]*?\n {2}return )\{([\s\S]*)\n {2}\};\n\}/;
  if (!re.test(text) || !text.includes("/* migrate:imports */")) return null;
  return text.replace(re, (_m, head, body) => head + "legacyScoped({" + body + "\n  });\n}").replace("/* migrate:imports */", 'import { legacyScoped } from "./legacyScope.js";\n/* migrate:imports */');
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const { table, bad } = routeTable(ctx.inv.routes ?? [], ctx.plan.maps.routes ?? {});
  /** @type {string[]} */
  const notes = [];
  // The page steps' lines live in routes.js: keep the file as it is once it exists.
  const had = ctx.readTarget(ROUTES_JS);
  if (had === null) ctx.out.write(ROUTES_JS, ROUTES_TEXT);
  else {
    const wrapped = wrapRoutesJs(had);
    if (wrapped === null) notes.push(ROUTES_JS + " is not in the generated shape: wrap its routes in legacyScoped (from ./legacyScope.js) by hand, or the legacy CSS never applies");
    else if (wrapped !== had) ctx.out.write(ROUTES_JS, wrapped);
  }
  ctx.out.write(SCOPE_JS, SCOPE_TEXT);
  ctx.out.write(LEGACY_JS, legacyJs(table));

  const main = ctx.readTarget(MAIN);
  if (main === null) drift("routes", MAIN + " is missing");
  if (!main.includes("migratedRoutes")) {
    ctx.patchTarget(MAIN, 'import { accessRoute } from "./pages/access.js";', (m) => NEW_IMPORT + '\nimport { migratedRoutes } from "./migrated/routes.js";\n' + m);
    ctx.patchTarget(MAIN, '"/access": accessRoute(app),', (m) => m + "\n      ...migratedRoutes(app),");
  }
  if ((ctx.readTarget(MAIN) ?? "").includes(OLD_IMPORT)) ctx.patchTarget(MAIN, OLD_IMPORT, () => NEW_IMPORT);
  if ((ctx.readTarget(MAIN) ?? "").includes(OLD_BOOT)) ctx.patchTarget(MAIN, OLD_BOOT, () => NEW_BOOT);
  if (!ctx.readTarget(MAIN)?.includes("legacyHashFor(")) {
    ctx.patchTarget(MAIN, /^([ \t]*)router\.start\(\);/m, (_m, pad) => pad + "// An old link (?r=item&id=a1, #/item?id=a1) becomes its kit hash route first.\n" + pad + NEW_BOOT + "\n" + pad + "if (legacy) window.location.replace(legacy);\n" + pad + "router.start();");
  }
  if (!ctx.readTarget(MAIN)?.includes("ev.stopImmediatePropagation();")) {
    // Registered before the router starts, so it runs first and the router never draws the old form.
    ctx.patchTarget(MAIN, /^([ \t]*)const router = createRouter\(\{/m, (m, pad) =>
      pad + "// An old hash form (#/item?id=a1) followed later becomes its kit route before the router sees it.\n" +
      pad + 'window.addEventListener("hashchange", (ev) => {\n' +
      pad + "  const next = legacyHashFromHash(window.location.hash);\n" +
      pad + "  if (!next) return;\n" +
      pad + "  ev.stopImmediatePropagation();\n" +
      pad + "  window.location.replace(next);\n" +
      pad + "});\n" + m);
  }
  const q = searchRoutes(table).length;
  const h = hashRoutes(table).length;
  notes.unshift(q + " query route" + (q === 1 ? "" : "s") + " translated by legacyHashFor; " + h + " hash route" + (h === 1 ? "" : "s") + " by legacyHashFromHash (a hash already in the kit form is left alone); migrated routes are shown with data-legacy on the html element (legacyScope.js)");
  for (const b of bad) notes.push("route " + JSON.stringify(b.slice(0, 60)) + " is not a plain pattern or its path is not a plain kit path: left out of legacyRoutes.js");
  return { notes, maps: { routes: table } };
}

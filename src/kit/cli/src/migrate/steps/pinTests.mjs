// The pin-tests step: test/client/migrated/legacy.test.js pins what the source had, so a later port
// cannot drop it silently. Every query route of the inventory must translate through legacyHashFor to
// its hash route (a :param filled from a sample value; nothing is appended to a path without one),
// every hash pattern through legacyHashFromHash (its old form, with the query keys the source page
// reads from maps.pages, to the kit form, or left alone when it is the kit form already), and every
// storage key must read and write through legacyStorage as the source stored it (a raw key stays a
// plain string, a JSON key round-trips). It lives under test/client, which the target's client test
// tsconfig covers with the DOM lib. The file is generated from the plan's maps, so editing a map and
// running the step again re-pins.
import { readFileSync } from "node:fs";
import { jsHeader } from "./_common.mjs";
import { hashRoutes, routeTable, searchRoutes } from "./routes.mjs";
import { storageModel } from "./storage.mjs";

export const OUT = "test/client/migrated/legacy.test.js";
/** Where the file was before it moved under test/client (the server tsconfig, no DOM lib). */
const OLD_OUT = "test/migrated/legacy.test.js";
// Generated-file text that imports a non-kit package is kept as data (a .txt the import scan of the vendored kit ignores).
const HEAD = readFileSync(new URL("./templates/legacyTestHead.txt", import.meta.url), "utf8");

/** @param {unknown} v */
const lit = (v) => JSON.stringify(v);

/**
 * The query link a query pattern is pinned with, and the hash it must give: each :name of the kit
 * path (or :name value of the pattern) gets the sample value a1.
 * @param {string} pattern @param {string} path
 * @returns {[string, string]}
 */
export function searchSample(pattern, path) {
  const pairs = pattern.slice(1).split("&").map((p) => p.split("="));
  const named = new Set(pairs.filter(([, v]) => (v ?? "").startsWith(":")).map(([, v]) => String(v).slice(1)));
  const link = "?" + pairs.map(([k, v]) => k + "=" + ((v ?? "").startsWith(":") ? "a1" : v ?? "")).join("&");
  const extra = [...path.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => /** @type {string} */ (m[1])).filter((n) => !named.has(n) && !pairs.some(([k]) => k === n));
  return [link + extra.map((n) => "&" + n + "=a1").join(""), "#" + path.replace(/:([A-Za-z_]\w*)/g, "a1")];
}

/**
 * The old hash form a hash pattern is pinned with, and what legacyHashFromHash must give (null when
 * it is the kit form already): each :name segment and each :name of the kit path the pattern does
 * not catch, plus the query keys the source page reads, get the sample value a1.
 * @param {string} pattern @param {string} path @param {string[]} query the page's query keys (maps.pages)
 * @returns {[string, string | null]}
 */
export function hashSample(pattern, path, query) {
  const segs = pattern.split("?")[0] ?? pattern;
  const caught = new Set([...segs.matchAll(/\/:([A-Za-z_]\w*)/g)].map((m) => /** @type {string} */ (m[1])));
  const want = [...path.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => /** @type {string} */ (m[1]));
  const keys = [...new Set([...want.filter((n) => !caught.has(n)), ...query.filter((k) => /^[A-Za-z_][\w-]*$/.test(k) && !caught.has(k))])];
  const old = segs.replace(/:([A-Za-z_]\w*)/g, "a1") + (keys.length ? "?" + keys.map((k) => k + "=a1").join("&") : "");
  const left = keys.filter((k) => !want.includes(k));
  const next = "#" + path.replace(/:([A-Za-z_]\w*)/g, "a1") + (left.length ? "?" + left.map((k) => k + "=a1").join("&") : "");
  return [old, next === old ? null : next];
}

/** The query keys the source page behind a hash pattern reads (maps.pages from hash-routes). @param {unknown} pages @param {string} pattern */
function pageQuery(pages, pattern) {
  const name = (pattern.split("?")[0] ?? "").replace(/^#\//, "").split("/")[0] ?? "";
  const p = pages && typeof pages === "object" ? /** @type {Record<string, any>} */ (pages)[name] : undefined;
  return p && Array.isArray(p.query) ? p.query.filter((/** @type {unknown} */ k) => typeof k === "string") : [];
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const { table } = routeTable(ctx.inv.routes ?? [], ctx.plan.maps.routes ?? {});
  const search = searchRoutes(table);
  const hashes = hashRoutes(table);
  const hash = hashes.map(([k]) => k);
  const pages = /** @type {Record<string, unknown>} */ (ctx.plan.maps).pages;
  const store = storageModel(ctx);
  const hasStorage = typeof (/** @type {any} */ (ctx.plan.maps.storage ?? {}).file) === "string";

  /** @type {string[]} */
  const pairs = [];
  for (const [pattern, path] of search) {
    const [link, want] = searchSample(pattern, path);
    pairs.push("    [" + lit(link) + ", " + lit(want) + "],");
  }
  /** @type {string[]} */
  const hashPairs = [];
  for (const [pattern, path] of hashes) {
    const [old, want] = hashSample(pattern, path, pageQuery(pages, pattern));
    hashPairs.push("    [" + lit(old) + ", " + lit(want) + "],");
  }

  let t = jsHeader("pin-tests", ".migrate/inventory.json and the plan's maps");
  t += "// What the source had, pinned: every old link (a query, an old hash form) reaches its kit hash route and every storage key keeps its form.\n";
  t += HEAD;
  t += 'import { legacyHashFor, legacyHashFromHash } from "../../../src/client/migrated/legacyRoutes.js";\n';
  if (hasStorage) {
    t += 'import { legacyStorage' + (store.prefix && store.foreign.length ? ", legacyForeignStorage" : "") + ' } from "../../../src/client/migrated/legacyStorage.js";\n';
    t += 'import { installLocalStorage } from "../helpers.js";\n';
  }
  t += '\ndescribe("legacy routes", () => {\n';
  t += "  /** @type {[string, string][]} */\n  const LINKS = [\n" + pairs.join("\n") + (pairs.length ? "\n" : "") + "  ];\n";
  t += '  it("turns every old query link into its hash route", () => {\n';
  t += "    for (const [search, hash] of LINKS) expect(legacyHashFor(search), search).toBe(hash);\n";
  t += "  });\n";
  t += '  it("leaves an address that is not an old link alone", () => {\n';
  t += '    for (const search of ["", "?", "?r=no-such-page", "?x=1"]) expect(legacyHashFor(search), search).toBeNull();\n';
  t += "  });\n";
  t += "  /** @type {string[]} */\n  const HASH_ROUTES = " + lit(hash) + ";\n";
  t += '  it("keeps the source hash routes as hash routes", () => {\n';
  t += "    for (const route of HASH_ROUTES) {\n";
  t += '      expect(route.startsWith("#/"), route).toBe(true);\n';
  t += '      expect(legacyHashFor(route), route).toBeNull();\n';
  t += "    }\n";
  t += "  });\n";
  t += "  /** @type {[string, string | null][]} */\n  const HASH_LINKS = [\n" + hashPairs.join("\n") + (hashPairs.length ? "\n" : "") + "  ];\n";
  t += '  it("turns every old hash form into its kit hash route, and leaves the kit form alone", () => {\n';
  t += "    for (const [hash, want] of HASH_LINKS) expect(legacyHashFromHash(hash), hash).toBe(want);\n";
  t += '    for (const hash of ["", "#", "#/no-such-page/x/y"]) expect(legacyHashFromHash(hash), hash).toBeNull();\n';
  t += "  });\n";
  t += "});\n";

  if (hasStorage) {
    /** @param {string} name @param {string} prefix @param {{ name: string, raw: boolean }[]} keys */
    const group = (name, prefix, keys) => {
      const raw = keys.filter((k) => k.raw).map((k) => k.name);
      const json = keys.filter((k) => !k.raw).map((k) => k.name);
      let s = "  {\n";
      s += "    name: " + lit(name) + ",\n    store: " + name + ",\n    prefix: " + lit(prefix) + ",\n    raw: " + lit(raw) + ",\n    json: " + lit(json) + ",\n  },\n";
      return s;
    };
    t += '\ndescribe("legacy storage", () => {\n  /** @type {{ name: string, store: { get: (key: string) => any, set: (key: string, value: unknown) => boolean }, prefix: string, raw: string[], json: string[] }[]} */\n  const GROUPS = [\n';
    if (store.prefix) {
      t += group("legacyStorage", store.prefix, store.inPrefix);
      if (store.foreign.length) t += group("legacyForeignStorage", "", store.foreign);
    } else t += group("legacyStorage", "", store.foreign);
    t += "  ];\n";
    t += '  it("reads and writes a raw key as the plain string the source kept", () => {\n';
    t += "    const ls = installLocalStorage();\n    try {\n";
    t += "      for (const g of GROUPS) {\n        for (const key of g.raw) {\n";
    t += '          ls.data.set(g.prefix + key, "plain value");\n';
    t += '          expect(g.store.get(key), g.name + " " + key).toBe("plain value");\n';
    t += '          expect(g.store.set(key, "other"), key).toBe(true);\n';
    t += '          expect(ls.data.get(g.prefix + key), key).toBe("other");\n';
    t += "        }\n      }\n    } finally {\n      ls.uninstall();\n    }\n  });\n";
    t += '  it("round-trips a JSON key", () => {\n';
    t += "    const ls = installLocalStorage();\n    try {\n";
    t += "      for (const g of GROUPS) {\n        for (const key of g.json) {\n";
    t += '          expect(g.store.set(key, { n: 1 }), key).toBe(true);\n';
    t += '          expect(ls.data.get(g.prefix + key), key).toBe(\'{"n":1}\');\n';
    t += '          expect(g.store.get(key), key).toEqual({ n: 1 });\n';
    t += "        }\n      }\n    } finally {\n      ls.uninstall();\n    }\n  });\n";
    t += "});\n";
  }
  ctx.out.write(OUT, t);
  // The old place is in the server tsconfig, which has no DOM lib: the step moves its own file.
  if (ctx.readTarget(OLD_OUT) !== null && ctx.plan.steps.some((x) => x.id === ctx.step.id && Object.prototype.hasOwnProperty.call(x.outputs ?? {}, OLD_OUT))) ctx.out.remove(OLD_OUT);
  return { notes: [search.length + " query route" + (search.length === 1 ? "" : "s") + ", " + hash.length + " hash route" + (hash.length === 1 ? "" : "s") + (hasStorage ? ", " + (store.inPrefix.length + store.foreign.length) + " storage key" + (store.inPrefix.length + store.foreign.length === 1 ? "" : "s") : "") + " pinned"] };
}

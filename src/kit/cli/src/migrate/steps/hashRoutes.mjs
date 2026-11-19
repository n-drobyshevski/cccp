// The hash-routes step (el-builder): the source's hash router (#/<route>?k=v) maps almost one to one
// onto the kit router. It records plan maps only: maps.routes for every PAGES route, alias and
// literal "#/..." link of the client ("#/list" to "/list"), and maps.pages, the path each page
// takes with its source module, its export and the query keys it reads. src/client/migrated/routes.js
// is left alone: the page-porting steps add their routes there once a page is ported.
import { analyze, isId, isP } from "../codemod/js.mjs";
import { hashRouteMap, mergeSeeded, readRouteTable } from "../codemod/config.mjs";
import { guessHashRoute } from "../plan.mjs";
import { scanJs } from "../scan/js.mjs";
import { clientFiles } from "./manifestCarry.mjs";

/** The query keys a page function reads from its first parameter (params.x). @param {string} text @param {string} fn */
function queryKeys(text, fn) {
  const f = scanJs(text).functions.find((x) => x.name === fn);
  const p = f?.params[0];
  if (!p || !/^[A-Za-z_$][\w$]*$/.test(p)) return [];
  const J = analyze(text);
  /** @type {string[]} */
  const out = [];
  for (let k = 0; k < J.toks.length; k++) if (isId(J, k, p) && !isP(J, k - 1, ".") && isP(J, k + 1, ".") && isId(J, k + 2)) out.push(/** @type {string} */ (J.toks[k + 2]?.value));
  return [...new Set(out)].sort();
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const files = clientFiles(ctx);
  const table = readRouteTable(files);
  if (!table.from) return { notes: ["no PAGES route table in the client scripts: no routes to map"] };
  const from = /** @type {string} */ (table.from);
  const want = hashRouteMap(table);
  for (const f of files) {
    for (const r of scanJs(f.text).routes) {
      const m = /^#\/([A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)(?:\?.*)?$/.exec(r.value);
      if (m && !want["#/" + m[1]]) want["#/" + m[1]] = "/" + m[1];
    }
  }
  // which module each page function comes from
  const imports = scanJs(/** @type {string} */ (files.find((f) => f.key === from)?.text)).imports;
  // the default route: a string literal the shared router falls back to (route || "list")
  let home = table.pages[0]?.name ?? null;
  for (const f of ctx.inv.files) {
    if (!f.key.startsWith("@") || !/\.m?js$/.test(f.key)) continue;
    const text = ctx.tree.read(f.key);
    if (!/\bPAGES\b/.test(text)) continue;
    const m = /\|\|\s*["']([A-Za-z0-9_-]+)["']/.exec(text);
    if (m && table.pages.some((p) => p.name === m[1])) home = /** @type {string} */ (m[1]);
  }
  /** @type {Record<string, unknown>} */
  const pages = {};
  for (const p of table.pages) {
    const imp = p.fn ? imports.find((i) => (i.locals ?? (Array.isArray(i.names) ? i.names : [])).includes(/** @type {string} */ (p.fn))) : undefined;
    const source = imp ? ctx.tree.resolve(from, imp.spec) : null;
    const text = source && ctx.tree.files.has(source) ? ctx.tree.read(source) : null;
    pages[p.name] = {
      path: "/" + p.name,
      source,
      export: p.fn,
      query: text && p.fn ? queryKeys(text, p.fn) : [],
      aliases: Object.entries(table.aliases).filter(([, to]) => to === p.name).map(([a]) => "/" + a),
      ...(p.name === home ? { home: true } : {}),
    };
  }
  const merged = mergeSeeded(/** @type {Record<string, unknown> | undefined} */ (ctx.plan.maps.routes), want, guessHashRoute);
  return {
    notes: [
      "routes: " + Object.entries(merged.out).map(([k, v]) => k + " -> " + v).join(", ") + (merged.kept.length ? "; kept the ones a person set: " + merged.kept.join(", ") : ""),
      "pages: " + Object.entries(pages).map(([k, v]) => k + " (" + /** @type {any} */ (v).source + ")").join(", ") + (home ? "; the source opens " + home + " by default" : ""),
      "src/client/migrated/routes.js is left alone: each page's route is added there when the page is ported",
    ],
    maps: { routes: merged.out, pages },
  };
}

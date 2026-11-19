// The manifest-carry step (el-builder): reads the app's `const MANIFEST = {...}` literal by tokens
// (literal values only; nothing is run) into plan.maps.manifest, and records the PAGES and
// ROUTE_ALIASES route table in plan.maps.routes ("#/list" to "/list", an alias to its target). The
// product name and the storage prefix go live only when the target still holds a value create
// would have written without them (the template's, the folder's or the inventory's): then every
// place create wrote it is moved, so the target's own consistency tests stay green. A value a
// person chose is kept.
import { basename } from "node:path";
import { checkPrefix, checkProduct, slugFromDir, TEMPLATE, titleFromSlug } from "../../values.mjs";
import { carryPrefix, carryProduct, hashRouteMap, mergeSeeded, readObjectLiteral, readRouteTable } from "../codemod/config.mjs";
import { guessHashRoute } from "../plan.mjs";

/**
 * The source's client scripts (root 0), in key order.
 * @param {import("../apply.mjs").StepContext} ctx
 */
export function clientFiles(ctx) {
  return ctx.inv.files.filter((f) => !f.key.startsWith("@") && /^src\/client\/.*\.m?js$/.test(f.key)).map((f) => ({ key: f.key, text: ctx.tree.read(f.key) }));
}

/** @param {string | null} text @param {RegExp} re */
const field = (text, re) => (text === null ? null : (re.exec(text)?.[1] ?? null));

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const files = clientFiles(ctx);
  /** @type {string[]} */
  const notes = [];
  /** @type {Record<string, Record<string, unknown>>} */
  const maps = {};
  const found = files.map((f) => ({ key: f.key, lit: readObjectLiteral(f.text, "MANIFEST") })).find((x) => x.lit);
  if (found?.lit) {
    /** @type {Record<string, unknown>} */
    const manifest = {};
    for (const [k, v] of Object.entries(found.lit.values)) if (v === null || typeof v !== "object") manifest[k] = v;
    maps["manifest"] = manifest;
    const refs = Object.entries(found.lit.values).filter(([, v]) => v && typeof v === "object").map(([k]) => k);
    notes.push("read MANIFEST from " + found.key + ":" + found.lit.line + " (" + Object.keys(manifest).join(", ") + ")" + (refs.length || found.lit.skipped.length ? "; not literal, so not carried: " + [...refs, ...found.lit.skipped].join(", ") : ""));
    const pkg = ctx.readTarget("package.json");
    let slug = "";
    try {
      slug = pkg === null ? "" : String(JSON.parse(pkg).name ?? "");
    } catch {
      slug = "";
    }
    const config = ctx.readTarget("app.config.mjs");
    const product = manifest["productName"];
    if (typeof product === "string") {
      const now = field(config, /^\s*product: "([^"]*)",/m);
      // what create writes with no --product: the template's, the target folder's, the inventory's
      const defaults = new Set([TEMPLATE.product, titleFromSlug(slugFromDir(basename(ctx.target))), ctx.inv.config.product ?? ""].filter(Boolean));
      const bad = checkProduct(product);
      if (now === null) throw new Error(ctx.step.id + ": the template drifted: app.config.mjs has no product line");
      if (now === product) notes.push("product: already " + JSON.stringify(product));
      else if (bad) notes.push("product: " + JSON.stringify(product) + " is not one the kit takes (" + bad + "); kept " + JSON.stringify(now));
      else if (defaults.has(now)) {
        carryProduct(ctx, now, product);
        notes.push("product: " + JSON.stringify(now) + " -> " + JSON.stringify(product));
      } else notes.push("product: kept " + JSON.stringify(now) + " (set by hand; the source says " + JSON.stringify(product) + ")");
    }
    const prefix = manifest["storagePrefix"];
    if (typeof prefix === "string") {
      const now = field(config, /^\s*storagePrefix: "([^"]*)",/m);
      // what create writes with no --prefix: the template's, the package name's, the folder's, the inventory's
      const defaults = new Set([TEMPLATE.prefix, slug ? slug.replace(/-/g, "") + "." : "", slugFromDir(basename(ctx.target)).replace(/-/g, "") + ".", ctx.inv.config.prefix ?? ""].filter(Boolean));
      const bad = checkPrefix(prefix);
      if (now === null) throw new Error(ctx.step.id + ": the template drifted: app.config.mjs has no storagePrefix line");
      if (now === prefix) notes.push("storage prefix: already " + JSON.stringify(prefix));
      else if (bad) notes.push("storage prefix: " + JSON.stringify(prefix) + " is not a kit prefix (" + bad + "); kept " + JSON.stringify(now) + ", the storage step carries the old keys");
      else if (defaults.has(now)) {
        carryPrefix(ctx, now, prefix);
        notes.push("storage prefix: " + JSON.stringify(now) + " -> " + JSON.stringify(prefix));
      } else notes.push("storage prefix: kept " + JSON.stringify(now) + " (set by hand; the source says " + JSON.stringify(prefix) + ")");
    }
  } else notes.push("no const MANIFEST = {...} literal in the client scripts: nothing to carry");
  const table = readRouteTable(files);
  if (table.from) {
    const merged = mergeSeeded(/** @type {Record<string, unknown> | undefined} */ (ctx.plan.maps.routes), hashRouteMap(table), guessHashRoute);
    maps["routes"] = merged.out;
    notes.push("routes from " + table.from + ": " + Object.entries(merged.out).map(([k, v]) => k + " -> " + v).join(", ") + (merged.kept.length ? "; kept the ones a person set: " + merged.kept.join(", ") : ""));
  }
  return { notes, maps };
}

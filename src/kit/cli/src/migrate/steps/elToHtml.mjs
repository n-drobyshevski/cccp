// The el-to-html step (el-builder): each client page module is rewritten by the el() codemod
// (codemod/el.mjs) and the result replaces its parked copy at .migrate/pending/<key>: a page still
// needs an agent's judgment (its route, its regions, its handlers' data), so nothing goes live and
// the target stays green. The source is read, not the parked copy, so a second run writes the same
// bytes. The el() name of each page comes from its imports of the shared lib's builder module. The
// first note (which migrate:apply prints) says how many calls were converted of how many, and how
// many were left as el() for each reason. A literal ?page= href to one of the app's pages becomes
// its hash route (frameLinks.mjs pageRewrite).
import { convertElFile } from "../codemod/el.mjs";
import { kebab } from "../maps.mjs";
import { scanJs } from "../scan/js.mjs";
import { pagesFor } from "./_common.mjs";

/** How many barrels (export ... from) are followed from an import to the builder. */
const MAX_BARRELS = 8;

/**
 * True when el, imported from module key, is the builder's el: key is the builder, or a barrel that
 * re-exports el (by name or with export *) from a module that reaches it. A page that imports el from
 * the app's own ui.js, which re-exports the shared lib's barrel, uses the builder all the same.
 * @param {import("../sourceTree.mjs").SourceTree} tree
 * @param {string} key
 * @param {Set<string>} builders
 */
export function reachesBuilder(tree, key, builders) {
  const seen = new Set();
  /** @type {string[]} */
  let level = [key];
  for (let depth = 0; depth <= MAX_BARRELS && level.length; depth++) {
    /** @type {string[]} */
    const next = [];
    for (const k of level) {
      if (builders.has(k)) return true;
      if (seen.has(k) || !tree.files.has(k)) continue;
      seen.add(k);
      for (const imp of scanJs(tree.read(k)).imports) {
        if (imp.kind !== "reexport" || !(imp.names === "*" || (Array.isArray(imp.names) && imp.names.includes("el")))) continue;
        const to = tree.resolve(k, imp.spec);
        if (to) next.push(to);
      }
    }
    level = next;
  }
  return false;
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const known = pagesFor(ctx);
  // the builder: a module that exports el and makes elements
  const builders = new Set(
    ctx.inv.files
      .filter((f) => f.kind === "js" && (f.key.startsWith("@") || /ui\/dom\.js$/.test(f.key)))
      .map((f) => f.key)
      .filter((k) => {
        const text = ctx.tree.read(k);
        return scanJs(text).exports.includes("el") && /createElement/.test(text);
      }),
  );
  let pages = ctx.step.files.reads.filter((k) => !k.startsWith("@") && /\.m?js$/.test(k) && ctx.tree.files.has(k));
  if (!pages.length) pages = ctx.inv.files.filter((f) => /^src\/client\/.*\/pages\/[^/]+\.m?js$/.test(f.key)).map((f) => f.key);
  /** @type {string[]} */
  const notes = [];
  /** @type {Record<string, number>} */
  const reasons = {};
  let total = 0;
  let converted = 0;
  for (const key of pages.sort()) {
    const text = ctx.tree.read(key);
    /** @type {string[]} */
    const elNames = [];
    for (const imp of scanJs(text).imports) {
      if (imp.kind === "reexport") continue;
      const to = ctx.tree.resolve(key, imp.spec);
      if (!to || !Array.isArray(imp.names)) continue;
      imp.names.forEach((n, i) => {
        if (n === "el" && reachesBuilder(ctx.tree, to, builders)) elNames.push(imp.locals?.[i] ?? n);
      });
    }
    if (!elNames.length) {
      notes.push(key + ": imports no el() builder; left as parked");
      continue;
    }
    const page = kebab((key.split("/").pop() ?? "").replace(/\.m?js$/, "")) ?? "page";
    const r = convertElFile(text, { elNames, page, sourceKey: key, stepId: ctx.step.id, pages: known });
    ctx.out.write(".migrate/pending/" + key, r.text);
    total += r.total;
    converted += r.converted;
    /** @type {Record<string, number>} */
    const mine = {};
    for (const b of r.bailed) {
      mine[b.code] = (mine[b.code] ?? 0) + 1;
      reasons[b.code] = (reasons[b.code] ?? 0) + 1;
    }
    notes.push(key + ": " + r.converted + " of " + r.total + " el() call(s) converted" + (r.acts.length ? ", " + r.acts.length + " act(s) wired by " + r.actsFn : "") + (Object.keys(mine).length ? "; not converted: " + Object.entries(mine).map(([k, n]) => k + " " + n).join(", ") : ""), ...r.notes);
  }
  const why = Object.entries(reasons).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  notes.unshift(converted + " of " + total + " el() call(s) converted in " + pages.length + " page module(s)" + (total - converted ? "; " + (total - converted) + " left as el(): " + why.map(([k, n]) => k + " " + n).join(", ") : "") + "; the pages wait in .migrate/pending for the page steps (each call left as el() says why in a migrate: comment)");
  return { notes, maps: { elToHtml: { converted, total, notConverted: reasons } } };
}

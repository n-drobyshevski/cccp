// The classic-html step: on each flattened page in .migrate/pending/pages, title becomes data-tip
// (plus aria-label when the element shows no text), a simple inline handler becomes data-act with a
// delegate line in the script that defines it, each remaining scriptlet gets a marker for the
// scriptlets-to-boot step, a CDN script is removed (vendor it), a ?page= link to one of the pages
// becomes a hash route (#/item?id=a1), recorded in plan.maps.routes (a link to another page is left
// with a migrate: marker, another relative link is reported), and every hash link gets target="_self" (it stays in the
// frame under <base target="_top">). Style blocks are left to css-import. It reads the pages as
// the earlier steps left them, so a person's edit (or a skipped step) is respected, and its own
// output is a fixed point: a second run writes the same bytes.
import { classicPage } from "../codemod/classic.mjs";
import { mergeSeeded } from "../codemod/config.mjs";
import { pagesOf } from "../codemod/markup.mjs";
import { guessHashRoute } from "../plan.mjs";
import { pagesFor } from "./_common.mjs";
import { pagePath } from "./flattenIncludes.mjs";

/**
 * The template variables doGet sets (t.user = ...), read from the .gs files.
 * @param {import("../apply.mjs").StepContext} ctx
 */
export function templateVars(ctx) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const f of ctx.inv.files) {
    if (f.kind !== "gs" || f.key.startsWith("@")) continue;
    const text = ctx.tree.read(f.key);
    for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*HtmlService\.createTemplateFromFile\b/g)) {
      for (const v of text.matchAll(new RegExp("\\b" + m[1] + "\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)", "g"))) out.add(/** @type {string} */ (v[1]));
    }
  }
  return [...out].sort();
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const pages = pagesOf(ctx.tree);
  const known = pagesFor(ctx);
  /** @type {string[]} */
  const notes = [];
  /** @type {Record<string, string>} */
  const routes = {};
  for (const { page } of pages) {
    const rel = pagePath(page);
    const text = ctx.readTarget(rel);
    if (text === null) {
      notes.push(page + ": " + rel + " is not there (flatten-includes skipped?); nothing to rewrite");
      continue;
    }
    const r = classicPage(text, { stepId: ctx.step.id, pages: known });
    ctx.out.write(rel, r.text);
    Object.assign(routes, r.routes);
    const c = r.counts;
    notes.push(page + ": " + c["titles"] + " title(s) to data-tip, " + c["handlers"] + " handler(s) to data-act, " + c["links"] + " link(s) to hash routes, " + c["targets"] + " hash link(s) given target _self, " + c["cdn"] + " CDN script(s) removed, " + c["scriptlets"] + " scriptlet(s) marked for boot data" + (r.bails.length ? "; left as they were: " + r.bails.map((b) => "line " + b.line + " " + b.reason).join("; ") : ""));
    notes.push(...r.notes.map((n) => page + ": " + n));
  }
  const vars = templateVars(ctx);
  if (vars.length) notes.push("doGet template variables (scriptlets-to-boot moves them into the boot data): " + vars.join(", "));
  const merged = mergeSeeded(/** @type {Record<string, unknown> | undefined} */ (ctx.plan.maps.routes), routes, guessHashRoute);
  if (merged.kept.length) notes.push("kept the routes a person set: " + merged.kept.join(", "));
  return { notes, maps: Object.keys(merged.out).length ? { routes: merged.out } : undefined };
}

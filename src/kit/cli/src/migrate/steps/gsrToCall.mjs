// The gsr-to-call step: in the inline scripts of each flattened page, a simple google.script.run
// chain (withSuccessHandler and withFailureHandler in any order, a named server function, at most
// one argument) becomes call("name", arg).then(ok, fail), with the endpoint's final name (the rule
// rpc-surface uses, steps/_rpcName.mjs, so it does not matter which of the two runs first); the script becomes a module that imports call from the kit. A positional argument
// keeps its shape, with a note for port-server (whose endpoints take one object); withUserObject, a
// computed name or two or more arguments keep the chain after a marker. The pages stay pending.
import { gsrPage } from "../codemod/classic.mjs";
import { pagesOf } from "../codemod/markup.mjs";
import { finalRpcNames, templateNames } from "./_rpcName.mjs";
import { pagePath } from "./flattenIncludes.mjs";

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  /** @type {Record<string, string[]>} */
  const params = {};
  for (const [key, f] of Object.entries(ctx.inv.js ?? {})) {
    if (!/\.gs$/.test(key)) continue;
    for (const fn of f.functions) params[fn.name] = fn.params;
  }
  let rpc;
  try {
    rpc = finalRpcNames(ctx.inv, /** @type {Record<string, unknown>} */ (ctx.plan.maps.rpc ?? {}), templateNames(ctx.kitRoot)).names;
  } catch (e) {
    throw new Error("gsr-to-call: " + /** @type {Error} */ (e).message);
  }
  /** @type {string[]} */
  const notes = [];
  let total = 0;
  for (const { page } of pagesOf(ctx.tree)) {
    const rel = pagePath(page);
    const text = ctx.readTarget(rel);
    if (text === null) {
      notes.push(page + ": " + rel + " is not there; nothing to rewrite");
      continue;
    }
    const r = gsrPage(text, { rpc, params });
    ctx.out.write(rel, r.text);
    total += r.converted.length;
    notes.push(page + ": " + r.converted.length + " google.script.run chain(s) to call()" + (r.converted.length ? " (" + r.converted.join(", ") + ")" : "") + (r.bailed.length ? "; left as they were: " + r.bailed.map((b) => "line " + b.line + " " + b.reason).join("; ") : ""));
    notes.push(...r.notes.map((n) => page + ": " + n));
  }
  if (total) notes.push("call() expects the kit envelope ({ ok, data }): port-server returns it from each endpoint (the run() wrapper does)");
  return { notes };
}

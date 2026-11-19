// The classic profile: a plain clasp project (Code.gs globals, many .html files, scriptlets, inline
// handlers, innerHTML, hard-coded colours, direct google.script.run). detect scores the evidence;
// steps lists the profile's own steps (steps/<run>.mjs).
import { kebab, keysUnder, makeStep, moved } from "../maps.mjs";

export const name = "classic";

/**
 * @param {import("../sourceTree.mjs").SourceTree} tree
 * @param {import("../schema.mjs").Inventory} [_inv]
 * @returns {{ score: number, evidence: string[] }}
 */
export function detect(tree, _inv) {
  let score = 0;
  /** @type {string[]} */
  const evidence = [];
  /** @param {number} n @param {string} why */
  const hit = (n, why) => {
    score += n;
    evidence.push(why);
  };
  const keys = [...tree.files.keys()];
  const gs = keys.filter((k) => k.endsWith(".gs"));
  const html = keys.filter((k) => k.endsWith(".html") && !k.startsWith("@"));
  const htmlText = html.map((k) => tree.read(k));
  if (gs.length) hit(30, gs.length + " .gs file(s)");
  if (htmlText.some((t) => /google\.script\.run\b/.test(t))) hit(20, "google.script.run called straight from html");
  if (htmlText.some((t) => /<\?!?=?\s/.test(t))) hit(10, "scriptlets in html");
  if (htmlText.some((t) => /<\?!=\s*include\s*\(/.test(t))) hit(10, "include() scriptlets");
  if (htmlText.some((t) => /\son(?:click|change|input|submit|load)\s*=/.test(t))) hit(5, "inline on* handlers");
  if (keys.some((k) => k.split("/").pop() === "appsscript.json")) hit(5, "an appsscript.json");
  if (tree.files.has(".clasp.json")) hit(5, "a .clasp.json");
  if (!tree.files.has("package.json") && (gs.length || html.length)) hit(5, "no package.json (no build)");
  return { score: Math.min(100, score), evidence };
}

/**
 * The pages doGet can serve: html files no other file includes, index first.
 * @param {import("../schema.mjs").Inventory} inv
 * @returns {{ page: string, key: string }[]}
 */
function pages(inv) {
  /** @type {Set<string>} */
  const included = new Set();
  for (const h of Object.values(inv.html ?? {})) for (const n of h.includes) included.add(n.replace(/\.html$/, ""));
  const keys = Object.keys(inv.html ?? {}).filter((k) => !k.startsWith("@") && k.endsWith(".html") && !included.has(k.replace(/\.html$/, "").split("/").pop() ?? ""));
  keys.sort((a, b) => Number(!/^index\b/i.test(a)) - Number(!/^index\b/i.test(b)) || (a < b ? -1 : 1));
  /** @type {{ page: string, key: string }[]} */
  const out = [];
  for (const key of keys) {
    const p = kebab((key.split("/").pop() ?? "").replace(/\.html$/, ""));
    if (p && !out.some((o) => o.page === p)) out.push({ page: p, key });
  }
  return out;
}

/**
 * @param {import("../schema.mjs").Inventory} inv
 * @param {{ fidelity?: string }} [_opts]
 * @returns {import("../schema.mjs").Step[]}
 */
export function steps(inv, _opts) {
  const html = keysUnder(inv, "", ["html"]);
  const flat = pages(inv).map((p) => ".migrate/pending/pages/" + p.page + ".html");
  const gs = inv.files.filter((f) => f.key.endsWith(".gs")).map((f) => f.key);
  /** @type {import("../schema.mjs").Step[]} */
  const list = [
    makeStep({
      id: "flatten-includes", kind: "tool", run: "flattenIncludes", title: "Flatten the include graph into one page per entry",
      files: { reads: html, writes: flat },
    }),
    makeStep({
      id: "classic-html", kind: "tool", run: "classicHtml", title: "Rewrite title, inline handlers and CSS partials",
      after: ["flatten-includes"],
      files: { reads: html, writes: flat },
    }),
    makeStep({
      id: "gsr-to-call", kind: "tool", run: "gsrToCall", title: "Turn simple google.script.run chains into call()",
      after: ["classic-html"],
      files: { reads: html, writes: flat },
    }),
    makeStep({
      id: "scriptlets-to-boot", kind: "agent", title: "Turn the remaining scriptlets into boot data",
      after: ["gsr-to-call"],
      files: { reads: html, writes: ["src/client/migrated/boot.js"] },
    }),
    makeStep({
      id: "innerhtml-to-html", kind: "agent", title: "Replace innerHTML with html and renderRegion",
      after: ["scriptlets-to-boot"],
      files: { reads: html, writes: ["src/client/migrated/render.js"] },
    }),
    makeStep({
      id: "port-server", kind: "agent", title: "Move Code.gs into api.ts and the domain",
      after: ["gsr-to-call"],
      files: { reads: gs, writes: moved(gs, "", "src/server/migrated/") },
    }),
    makeStep({
      id: "editor-globals", kind: "agent", title: "Put editor-callable globals in ALLOWED_GLOBALS, each with a reason",
      after: ["port-server"],
      files: { reads: gs, writes: ["src/gas/entry.js"] },
    }),
  ];
  // A page waits for the tool steps (pin-tests waits for every one) and port-server, the data it
  // draws; the pilot comes first, then the rest, each after the pilot only. The triggers (a common
  // step) and editor-globals never hold a page up.
  pages(inv).forEach(({ page, key }, i) => {
    const pilot = i === 0;
    list.push(
      makeStep({
        id: pilot ? "pilot-page" : "port-page-" + page, kind: "agent", title: (pilot ? "Port the pilot page " : "Port the page ") + page,
        after: pilot ? ["port-server"] : ["pilot-page"], page, pilot,
        files: { reads: [key], writes: ["src/client/migrated/pages/" + page + ".js"] },
        verify: ["check", "ui:" + page],
      }),
    );
  });
  return list;
}

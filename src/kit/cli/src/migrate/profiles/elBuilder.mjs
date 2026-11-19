// The el()-builder profile: pages built with an imperative el() DOM builder from a shared sibling
// lib, a hash router with a stale-while-revalidate store, a committed dist/entry.js, and a generated
// index.html. detect scores the evidence; steps lists the profile's own steps (steps/<run>.mjs).
// Without a shared root the steps that read the shared lib are blocked.
import { keysUnder, kebab, makeStep, moved } from "../maps.mjs";

export const name = "el-builder";

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
  const code = keys.filter((k) => /\.(?:js|mjs)$/.test(k) && !k.startsWith("dist/"));
  /** @type {Map<string, string>} */
  const cache = new Map();
  /** @param {string} k */
  const text = (k) => {
    let t = cache.get(k);
    if (t === undefined) cache.set(k, (t = tree.read(k)));
    return t;
  };
  if (tree.roots.length > 1) hit(10, "a shared root was passed");
  const el = code.filter((k) => /\bel\(\s*(?:"|'|[A-Za-z_$])/.test(text(k)) && /\bimport\b/.test(text(k)) && /\bel\b/.test(text(k)));
  if (el.length) hit(20, "el() builder calls in " + el.length + " file(s)");
  if (tree.files.has("dist/entry.js") && /\bfunction\s+api_\w+/.test(text("dist/entry.js"))) hit(15, "a committed dist/entry.js with api_ delegators");
  if (tree.files.has("dist/appsscript.json")) hit(5, "a committed dist/appsscript.json");
  const pages = code.find((k) => /\bexport\s+const\s+PAGES\s*=/.test(text(k)));
  if (pages) hit(15, "a PAGES route table in " + pages);
  if (code.some((k) => /\bswrCall\b/.test(text(k)))) hit(10, "swrCall (a stale-while-revalidate store over localStorage)");
  if (code.some((k) => /\bconfigureApp\s*\(/.test(text(k)) && /\bMANIFEST\b/.test(text(k)))) hit(15, "configureApp(MANIFEST ...) in the entry");
  if (code.some((k) => !k.startsWith("@") && [...text(k).matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)].some((m) => (tree.resolve(k, /** @type {string} */ (m[1])) ?? "").startsWith("@")))) hit(10, "imports that reach the shared lib");
  return { score: Math.min(100, score), evidence };
}

/**
 * The page names of the route table, in source order.
 * @param {import("../schema.mjs").Inventory} inv
 */
function pageNames(inv) {
  /** @type {string[]} */
  const out = [];
  for (const r of inv.routes ?? []) {
    if (!r.startsWith("#/")) continue;
    const k = kebab(r.slice(2).replace(/\?.*$/, ""));
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * @param {import("../schema.mjs").Inventory} inv
 * @param {{ fidelity?: string }} [_opts]
 * @returns {import("../schema.mjs").Step[]}
 */
export function steps(inv, _opts) {
  const hasShared = inv.source.roots.length > 1;
  const shared = hasShared ? { status: /** @type {const} */ ("pending") } : { status: /** @type {const} */ ("blocked"), why: "pass --shared <dir>" };
  const sharedKeys = inv.files.filter((f) => f.key.startsWith("@")).map((f) => f.key);
  const client = keysUnder(inv, "src/client/", ["js"]);
  const server = [...keysUnder(inv, "src/server/", ["ts", "js"]), ...keysUnder(inv, "dist/entry.js")];
  const pageFiles = client.filter((k) => /\/pages\//.test(k));
  /** @type {import("../schema.mjs").Step[]} */
  const list = [
    makeStep({
      id: "manifest-carry", kind: "tool", run: "manifestCarry", title: "Carry the MANIFEST into the app config",
      files: { reads: client.filter((k) => /app\.js$/.test(k)), writes: ["app.config.mjs", "src/client/config.js", "src/server/config.ts", "src/client/index.html"] },
    }),
    makeStep({
      id: "brand-carry", kind: "tool", run: "brandCarry", title: "Move the brand tokens into app.config.mjs brand.light",
      after: ["manifest-carry"],
      files: { reads: keysUnder(inv, "src/client/styles/tokens.css"), writes: ["app.config.mjs", "src/client/styles/brand.css"] },
    }),
    makeStep({
      id: "server-park", kind: "tool", run: "serverPark", title: "Park the endpoint bodies for porting",
      after: ["brand-carry"],
      files: { reads: server, writes: [".migrate/pending/SERVER-NOTES.md"] },
    }),
    makeStep({
      id: "port-server", kind: "agent", title: "Port the parked endpoint bodies into src/server/app (see .migrate/pending/SERVER-NOTES.md)",
      after: ["server-park"],
      files: { reads: server, writes: ["src/server/app", "src/server/api.ts"] },
      verify: ["check"],
    }),
    makeStep({
      id: "hash-routes", kind: "tool", run: "hashRoutes", title: "Map the hash routes onto the kit router",
      after: ["server-park"],
      files: { reads: [...client.filter((k) => /pages\.js$/.test(k)), ...sharedKeys.filter((k) => /store\.js$/.test(k))], writes: [] },
      ...shared,
    }),
    makeStep({
      id: "el-to-html", kind: "tool", run: "elToHtml", title: "Convert literal el() calls to html templates",
      after: ["hash-routes"],
      files: { reads: [...pageFiles, ...sharedKeys.filter((k) => /ui\/dom\.js$/.test(k))], writes: moved(pageFiles, "", ".migrate/pending/") },
      ...shared,
    }),
    makeStep({
      id: "swr-store", kind: "agent", title: "Move the store.js stale-while-revalidate cache onto the kit swr and app.dataStorage (revalidate on every hit; never draw stale data over fresh)",
      after: ["el-to-html"],
      files: { reads: sharedKeys.filter((k) => /store\.js$/.test(k)), writes: ["src/client/migrated/store.js"] },
    }),
  ];
  // A page waits for el-to-html (its parked, converted module) and port-server, the data it draws;
  // the pilot comes first, then the rest, each after the pilot only.
  pageNames(inv).forEach((p, i) => {
    const pilot = i === 0;
    list.push(
      makeStep({
        id: pilot ? "pilot-page" : "port-page-" + p, kind: "agent", title: (pilot ? "Port the pilot page " : "Port the page ") + p,
        after: pilot ? ["el-to-html", "port-server"] : ["pilot-page"], page: p, pilot,
        files: { reads: client.filter((k) => k.endsWith("/pages/" + p + ".js")), writes: ["src/client/migrated/pages/" + p + ".js"] },
        verify: ["check", "ui:" + p],
      }),
    );
  });
  return list;
}

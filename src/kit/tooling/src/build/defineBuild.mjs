// Extracted from the author's production Apps Script apps; adapted.
//
// defineBuild: the esbuild factory for an app.
//
//   const { build, watch } = defineBuild({ root, appConfig: { ... } });
//   await build();
//
// Outputs in dist/ (or appConfig.dist):
//   server.js     IIFE with global "Server", from src/server/index.ts, __BUILD_ID__ defined
//   js_app.html   the client bundle inside a script tag
//   styles.html   the CSS inside a style tag
//   index.html, entry.js, appsscript.json   copied from src/client and src/gas
//
// WHY THE CLIENT IS LOWERED. The Apps Script middlebox strips comments from served documents
// with a tokenizer that knows quotes but not template literals, so a backtick string holding a
// double slash is truncated. The client target supports no template literals (esbuild turns
// them into concatenation), and guardJs fails the build if a backtick or a surviving double
// slash is left anyway. Server code runs in V8 directly and is not served, so it is not lowered.
//
// THE PUSHED FILES ARE CHECKED HERE, on the output just written (guardOutput): the noSecrets
// patterns over every file in dist (a build define reaches both bundles, and the contracts may
// have run on an older dist or on none), and the server bundle's globals (only Server, no
// globalThis assignment; no public global in any other pushed .js or .gs file but entry.js,
// which the entryParity contract checks against api.ts). A violation fails the build.

import { build as esbuild } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { watch as fsWatch } from "node:fs";
import { delegatedNames, guardCss, guardEntryDrift, guardHtml, guardJs, guardNoTitle } from "./guards.mjs";
import { buildStamp } from "./stamp.mjs";
import { DEV_MARKER } from "./whichBuild.mjs";
import { checkPushedGlobals } from "../test/contracts/entryParity.js";
import { check as noSecrets } from "../test/contracts/noSecrets.js";

/**
 * @typedef {object} AppConfig
 * @property {string} [dist] output dir (default <root>/dist)
 * @property {string} [serverEntry] default src/server/index.ts
 * @property {string} [clientEntry] default src/client/main.js
 * @property {string} [cssEntry] default src/client/styles/index.css
 * @property {string[]} [cssFiles] concatenated in order, instead of cssEntry
 * @property {Record<string, string>} [alias] esbuild alias, paths relative to root
 * @property {Record<string, string>} [define] extra defines (values are JS source)
 * @property {"silent" | "error" | "info"} [logLevel] default "silent"
 * @property {number} [watchDebounceMs] watch() debounce (default 100)
 * @property {boolean} [log] print the "build ok" lines (default true)
 * @property {{ js?: number, css?: number, server?: number }} [budgets] byte caps for js_app.html,
 *   styles.html and server.js. Both bundles are inlined into every page, so their size is load
 *   time: a file over its cap fails the build with its size and the cap.
 * @property {import("./guards.mjs").ScriptletOpts} [scriptlets] the scriptlet allow-list of
 *   index.html (default: include('name') calls and the bootJson slot; see guardScriptlets)
 * @property {boolean} [devMarker] write DEV_MARKER after the build banner of server.js, so deploy
 *   and distId refuse the bundle (the dev server sets it; never set it in a production build)
 */

/** The file each budget key measures. */
const BUDGET_FILES = { js: "js_app.html", css: "styles.html", server: "server.js" };

/**
 * Throw when a built file is over its budget. Exported for its seeded test.
 * @param {Record<string, number>} sizes bytes per budget key
 * @param {{ js?: number, css?: number, server?: number } | undefined} budgets
 */
export function checkBudgets(sizes, budgets) {
  const over = [];
  for (const [k, cap] of Object.entries(budgets ?? {})) {
    if (typeof cap !== "number" || !(cap > 0)) throw new Error("build budget: " + k + " must be a positive number of bytes");
    const file = /** @type {Record<string, string>} */ (BUDGET_FILES)[k];
    if (!file) throw new Error("build budget: unknown key " + k + " (use js, css or server)");
    if (sizes[k] > cap) over.push(file + " is " + sizes[k] + " bytes, over its budget of " + cap);
  }
  if (over.length) throw new Error("build budget: " + over.join("; ") + ". Trim the bundle or raise appConfig.build.budgets.");
}

/**
 * Throw when the built files in dist hold a credential (the noSecrets patterns) or a public
 * global besides the server global and entry.js (checkPushedGlobals). Exported for its seeded test.
 * @param {string} dist
 */
export function guardOutput(dist) {
  const bad = [...noSecrets({ dirs: [dist] }), ...checkPushedGlobals({ distDir: dist })];
  if (bad.length) throw new Error("output guard: " + bad.join("; ") + ". Nothing in dist may be pushed like this.");
}

/** @param {number} n */
function kb(n) {
  return (n / 1024).toFixed(1) + " KB";
}

/**
 * @param {{ root: string, appConfig?: AppConfig }} opts
 */
export function defineBuild({ root, appConfig = {} }) {
  const cfg = appConfig;
  const dist = cfg.dist ? resolve(root, cfg.dist) : join(root, "dist");
  const logLevel = cfg.logLevel ?? "silent";
  const at = (/** @type {string} */ rel) => resolve(root, rel);
  const alias = Object.fromEntries(Object.entries(cfg.alias ?? {}).map(([k, v]) => [k, resolve(root, v)]));

  function stamp() {
    // Always the shared defaults: deploy and which-build hash the same inputs.
    return buildStamp(root);
  }

  /** The stamp define goes last so appConfig.define cannot disagree with the banner. @param {{ define: Record<string, string> }} st */
  function defines(st) {
    return { ...cfg.define, ...st.define };
  }

  /** @param {{ id: string, define: Record<string, string> }} st */
  function serverOptions(st, level = logLevel) {
    return {
      // The marker which-build and deploy read back (server.js is never served, so a comment is safe).
      banner: { js: "/* build " + st.id + " */" + (cfg.devMarker ? "\n" + DEV_MARKER : "") },
      entryPoints: [at(cfg.serverEntry ?? "src/server/index.ts")],
      bundle: true,
      format: /** @type {const} */ ("iife"),
      globalName: "Server",
      target: "es2019",
      alias,
      define: defines(st),
      outfile: join(dist, "server.js"),
      logLevel: level,
    };
  }

  async function build() {
    mkdirSync(dist, { recursive: true });
    const st = stamp();

    await esbuild(serverOptions(st));

    const clientResult = await esbuild({
      entryPoints: [at(cfg.clientEntry ?? "src/client/main.js")],
      alias,
      bundle: true,
      format: "iife",
      target: "es2017",
      define: defines(st),
      supported: { "template-literal": false },
      minify: true,
      legalComments: "none",
      write: false,
      logLevel,
    });
    const clientJs = clientResult.outputFiles[0].text;
    guardJs("client bundle", clientJs);
    guardNoTitle("client bundle", clientJs);
    writeFileSync(join(dist, "js_app.html"), "<script>\n" + clientJs + "\n</script>\n");

    const cssOpts = cfg.cssFiles
      ? {
          stdin: {
            contents: cfg.cssFiles.map((f) => '@import "' + resolve(root, f).replace(/\\/g, "/") + '";').join("\n"),
            resolveDir: root,
            loader: /** @type {const} */ ("css"),
          },
        }
      : { entryPoints: [at(cfg.cssEntry ?? "src/client/styles/index.css")] };
    const cssResult = await esbuild({ ...cssOpts, alias, bundle: true, minify: true, write: false, logLevel });
    const css = cssResult.outputFiles[0].text;
    guardCss("the stylesheet", css);
    writeFileSync(join(dist, "styles.html"), "<style>\n" + css + "\n</style>\n");

    const indexHtml = readFileSync(at("src/client/index.html"), "utf8");
    guardNoTitle("src/client/index.html", indexHtml);
    guardHtml("src/client/index.html", indexHtml, { scriptlets: cfg.scriptlets ?? true });
    copyFileSync(at("src/client/index.html"), join(dist, "index.html"));
    copyFileSync(at("src/gas/entry.js"), join(dist, "entry.js"));
    copyFileSync(at("src/gas/appsscript.json"), join(dist, "appsscript.json"));

    const entryJs = readFileSync(at("src/gas/entry.js"), "utf8");
    if (existsSync(at("src/server/api.ts"))) {
      guardEntryDrift(entryJs, readFileSync(at("src/server/api.ts"), "utf8"));
    } else if (delegatedNames(entryJs).length) {
      throw new Error("entry.js guard: src/gas/entry.js declares api_ delegators but src/server/api.ts is missing");
    }

    guardOutput(dist);

    /** @type {Record<string, number>} */
    const sizes = {};
    for (const [k, f] of Object.entries(BUDGET_FILES)) sizes[k] = statSync(join(dist, f)).size;
    checkBudgets(sizes, cfg.budgets);

    if (cfg.log !== false) {
      console.log("build ok: " + readdirSync(dist).sort().join(", "));
      console.log("  sizes js_app " + kb(sizes.js) + ", styles " + kb(sizes.css) + ", server " + kb(sizes.server));
      console.log("  stamp " + st.id);
    }
    return { dist, stamp: st.id, sizes };
  }

  /** Build once, then rebuild everything (server, client, CSS, copies and all guards) when a
   *  file under src/ changes, debounced. The build id is re-stamped on every rebuild. Rebuild
   *  errors are printed and the watcher keeps running. */
  async function watch() {
    await build();
    let timer = /** @type {NodeJS.Timeout | null} */ (null);
    let running = false;
    let again = false;
    const run = async () => {
      if (running) { again = true; return; }
      running = true;
      try { await build(); } catch (e) { console.error("rebuild failed: " + (/** @type {Error} */ (e)).message); }
      running = false;
      if (again) { again = false; schedule(); }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, cfg.watchDebounceMs ?? 100);
    };
    const watcher = fsWatch(at("src"), { recursive: true }, schedule);
    return { dispose: () => { if (timer) clearTimeout(timer); watcher.close(); } };
  }

  return { build, watch, dist };
}

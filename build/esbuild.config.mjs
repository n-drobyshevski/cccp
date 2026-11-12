// Bundles the server into one IIFE (global `Server`), the client into an inline HtmlService
// partial, the CSS into another, and copies the hand-written GAS files. Derived from sidekick
// gas_hub/esbuild.config.mjs at commit 77bcf22 (see VENDOR.md). CCCP_DIST overrides the
// output directory (tests build into a temp dir).
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardCss, guardEntryDrift, guardJs } from "./guards.mjs";
import { stampFor } from "./stamp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = process.env.CCCP_DIST || join(root, "dist");
mkdirSync(dist, { recursive: true });

const STAMP = stampFor(root);

await build({
  entryPoints: [join(root, "src/server/index.ts")],
  bundle: true,
  format: "iife",
  globalName: "Server",
  target: "es2019",
  define: STAMP.define,
  outfile: join(dist, "server.js"),
  logLevel: "info",
});

// Template literals are lowered so no backtick reaches the served bundle.
const clientResult = await build({
  entryPoints: [join(root, "src/client/main.js")],
  // The vendored settingsForm contract asserts a specifier of the form '<dots>/gas_shared/ui/
  // settingsForm.js', so the settings draft imports it as 'gas_shared/ui/...'.
  alias: { gas_shared: join(root, "src/vendor/gas_shared") },
  bundle: true,
  format: "iife",
  target: "es2019",
  define: STAMP.define,
  supported: { "template-literal": false },
  minify: true,
  write: false,
  logLevel: "info",
});
const clientJs = clientResult.outputFiles[0].text;
guardJs("client bundle", clientJs);
writeFileSync(join(dist, "js_app.html"), "<script>\n" + clientJs + "\n</script>\n");

const cssResult = await build({
  entryPoints: [join(root, "src/client/styles/index.css")],
  bundle: true,
  minify: true,
  write: false,
  logLevel: "info",
});
const css = cssResult.outputFiles[0].text;
guardCss("the stylesheet", css);
writeFileSync(join(dist, "styles.html"), "<style>\n" + css + "\n</style>\n");

copyFileSync(join(root, "src/client/index.html"), join(dist, "index.html"));
copyFileSync(join(root, "src/gas/entry.js"), join(dist, "entry.js"));
copyFileSync(join(root, "src/gas/appsscript.json"), join(dist, "appsscript.json"));

guardEntryDrift(
  readFileSync(join(root, "src/gas/entry.js"), "utf8"),
  readFileSync(join(root, "src/server/api.ts"), "utf8"),
);

console.log("build ok: " + readdirSync(dist).sort().join(", "));
console.log("  stamp " + STAMP.id);

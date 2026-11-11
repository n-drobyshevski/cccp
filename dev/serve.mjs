// Local dev server: composes the page Apps Script would serve (index.html with the includes
// resolved) plus the service fakes, the fake workbook, the real Server bundle, the hand-written
// entry.js and the boot script.
//
//   npm run dev  ->  http://localhost:8791
//
// Derived from sidekick gas_hub/dev/serve.mjs at commit 77bcf22 (see VENDOR.md). Every load of
// "/" reruns the build, so editing src and refreshing is the whole loop. PORT overrides 8791.
//
// Page order: gas-shims.js, workbook data, dist/server.js, dist/entry.js, dev/boot.js, then the
// client bundle. Flags are documented in dev/boot.js.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { genWorkbook } from "./genTabs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8791);
const dist = (f) => readFileSync(join(root, "dist", f), "utf8");

function workbookScript() {
  // "</" is escaped so the JSON can never close its own script element.
  const json = JSON.stringify(genWorkbook()).replace(/</g, "\\u003c");
  return "window.__CCCP_WORKBOOK__ = " + json + ";\n";
}

const SCRIPTS = {
  "/gas-shims.js": () => readFileSync(join(root, "dev/gas-shims.js"), "utf8"),
  "/workbook.js": workbookScript,
  "/server.js": () => dist("server.js"),
  "/entry.js": () => dist("entry.js"),
  "/boot.js": () => readFileSync(join(root, "dev/boot.js"), "utf8"),
};
const PARTIALS = {
  "/_partial/styles": () => dist("styles.html"),
  "/_partial/js_app": () => dist("js_app.html"),
};

function composeIndex() {
  execFileSync(process.execPath, ["build/esbuild.config.mjs"], { cwd: root, stdio: "pipe" });
  let html = dist("index.html");
  // Function replacements: the minified client bundle contains "$" sequences that a string
  // replacement would misread as patterns.
  html = html.replace(/<\?!=\s*include\('styles'\);?\s*\?>/, () => dist("styles.html"));
  html = html.replace(/<\?!=\s*bootJson\s*\?>/, "");
  html = html.replace(/<\?!=\s*include\('js_app'\);?\s*\?>/, () =>
    [
      '<script src="/gas-shims.js"></script>',
      '<script src="/workbook.js"></script>',
      '<script src="/server.js"></script>',
      '<script src="/entry.js"></script>',
      '<script src="/boot.js"></script>',
      dist("js_app.html"),
    ].join("\n"),
  );
  return html;
}

const send = (res, type, body) => {
  res.writeHead(200, { "content-type": type + "; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
};

createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  try {
    if (path === "/") return send(res, "text/html", composeIndex());
    if (SCRIPTS[path]) return send(res, "text/javascript", SCRIPTS[path]());
    if (PARTIALS[path]) return send(res, "text/plain", PARTIALS[path]());
    if (path === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  } catch (e) {
    const detail = [e.stdout, e.stderr, e.message].map((b) => (b ? String(b) : "")).filter(Boolean).join("\n");
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("dev server error:\n" + detail);
  }
}).listen(PORT, () => {
  console.log("CCCP local dev: http://localhost:" + PORT);
  console.log("Each page load rebuilds. Flags: as, mode=org, admins, nosource, empty, coldcache, slow, tz.");
});

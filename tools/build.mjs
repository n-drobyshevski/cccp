// Build dist/: server.js, js_app.html, styles.html, index.html, entry.js, appsscript.json.
// The guards run inside the build, so a bad bundle fails here and not in production.
//
//   node tools/build.mjs            build once
//   node tools/build.mjs --watch    rebuild on a change under src/
//   CCCP_DIST=<dir> node tools/build.mjs    build into another directory (the tests do)
import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { APP_ROOT, kitImport } from "./kitPaths.mjs";
import config from "../app.config.mjs";

const { defineBuild } = await kitImport("tooling", "build/defineBuild.mjs");

const appConfig = { ...config.build, log: true, ...(process.env.CCCP_DIST ? { dist: process.env.CCCP_DIST } : {}) };

// clasp pushes every .js/.gs/.ts/.html/appsscript.json under dist, and `clasp create --rootDir
// dist` pulls the new project's starter files there. Drop any such top-level file first, so a
// push sends exactly the six files the build writes. Only files, only those types.
function cleanDist() {
  const dist = resolve(APP_ROOT, appConfig.dist ?? "dist");
  let names = [];
  try { names = readdirSync(dist); } catch { return; }
  for (const name of names) {
    const p = join(dist, name);
    if (/\.(js|gs|ts|html|json)$/.test(name) && statSync(p).isFile()) unlinkSync(p);
  }
}

const { build, watch } = defineBuild({ root: APP_ROOT, appConfig });
cleanDist();
if (process.argv.includes("--watch")) {
  await watch();
} else {
  await build();
}

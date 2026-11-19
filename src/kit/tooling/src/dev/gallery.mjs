// Extracted from the author's production Apps Script apps; adapted.
//
// The component gallery served at /gallery. It reads packages/ui/components.json and renders every
// example in every listed state, twice: in a wrapper with data-theme="light" and in one with
// data-theme="dark". The browser bundle (gallery/main.js plus every component module) is built with
// esbuild on first use; the CSS is the kit tokens, brand and base styles, then each component's CSS
// in manifest order (deduped), then gallery/gallery.css.
//
// Why generated theme rules: the kit tokens switch on :root[data-theme=dark], which only an element
// that is the root can match. The gallery needs both themes side by side, so it copies the light and
// dark token blocks of tokens.base.css and brand.css onto .gal-card[data-theme] at serve time (the
// light blocks on every card, then the dark blocks on the dark cards).
// Nothing is written by hand, so no colour literal lives outside the token files.

import { build as esbuild } from "esbuild";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The packages directory of the kit. */
export const PACKAGES = resolve(HERE, "..", "..", "..");
const UI = join(PACKAGES, "ui");
const STYLES = ["src/styles/tokens.base.css", "src/styles/brand.css", "src/styles/base.css"];

/** @returns {{ version: number, components: Array<any> }} */
export function readManifest() {
  return JSON.parse(readFileSync(join(UI, "components.json"), "utf8"));
}

/** The stylesheet paths (relative to packages/ui) in load order, each once. */
export function cssPaths() {
  const out = [...STYLES];
  // Shared stylesheets (button, input, sheet, chartParts) go before the component that uses them.
  for (const c of readManifest().components) {
    for (const d of c.cssDeps || []) if (!out.includes(d)) out.push(d);
    if (c.css && !out.includes(c.css)) out.push(c.css);
  }
  return out;
}

/**
 * The theme rules for the gallery cards, from the token stylesheets. Every light block goes on any
 * .gal-card[data-theme] first (so derived tokens such as --accent, declared only in the light block
 * as var(--brand-accent), resolve on the card itself), then every dark block on the dark cards.
 * @param {string[]} texts
 */
export function scopedThemes(texts) {
  const light = texts.map((t) => (/^:root\s*\{([^}]*)\}/m.exec(t) || [])[1] || "").join("\n");
  const dark = texts.map((t) => (/^:root\[data-theme="dark"\]\s*\{([^}]*)\}/m.exec(t) || [])[1] || "").join("\n");
  return '.gal-card[data-theme] {' + light + "}\n" + '.gal-card[data-theme="dark"] {' + dark + "}\n";
}

/**
 * @param {{ cache?: boolean, reload?: boolean }} [opts] cache false rebuilds the bundles on every
 *   request (watch mode, so edits to the kit packages show on reload); reload adds the /__events listener
 */
export function createGallery(opts = {}) {
  const { cache = true, reload = false } = opts;
  /** @type {Promise<string> | null} */
  let jsP = null;
  /** @type {Promise<string> | null} */
  let cssP = null;

  /** The generated module the browser entry imports: every component module namespace, by index.
   *  The manifest is fetched at run time (its prose holds backticks, which served code may not). */
  function dataModule() {
    const manifest = readManifest();
    /** @type {string[]} */
    const mods = [];
    for (const c of manifest.components) if (!mods.includes(c.module)) mods.push(c.module);
    const lines = mods.map((m, i) => "import * as m" + i + " from " + JSON.stringify(join(UI, m)) + ";");
    lines.push("export const modules = [" + mods.map((_, i) => "m" + i).join(", ") + "];");
    lines.push("export const moduleIndex = " + JSON.stringify(Object.fromEntries(mods.map((m, i) => [m, i]))) + ";");
    return lines.join("\n");
  }

  /** @type {import("esbuild").Plugin} */
  const dataPlugin = {
    name: "gallery-data",
    setup(b) {
      b.onResolve({ filter: /^gallery:data$/ }, () => ({ path: "gallery-data", namespace: "gallery-data" }));
      b.onLoad({ filter: /.*/, namespace: "gallery-data" }, () => ({ contents: dataModule(), loader: "js", resolveDir: UI }));
    },
  };

  function js() {
    if (!cache) jsP = null;
    if (!jsP) {
      jsP = esbuild({
        entryPoints: [join(HERE, "gallery", "main.js")],
        bundle: true,
        format: "iife",
        target: "es2017",
        supported: { "template-literal": false },
        alias: Object.fromEntries(["client", "server", "ui", "tooling"].map((p) => ["@gas-kit/" + p, join(PACKAGES, p, "src")])),
        // Whitespace and syntax only: names stay readable, and comments (some hold backticks) go.
        minifyWhitespace: true,
        minifySyntax: true,
        plugins: [dataPlugin],
        write: false,
        logLevel: "silent",
      }).then((r) => r.outputFiles[0].text);
      jsP.catch(() => { jsP = null; });
    }
    return jsP;
  }

  function css() {
    if (!cache) cssP = null;
    if (!cssP) {
      const paths = cssPaths();
      cssP = esbuild({
        stdin: {
          contents: paths.map((p) => '@import "' + join(UI, p).replace(/\\/g, "/") + '";').join("\n"),
          resolveDir: UI,
          loader: "css",
        },
        bundle: true,
        write: false,
        logLevel: "silent",
      }).then((r) => {
        const themes = scopedThemes([STYLES[0], STYLES[1]].map((p) => readFileSync(join(UI, p), "utf8")));
        return r.outputFiles[0].text + "\n" + themes + "\n" + readFileSync(join(HERE, "gallery", "gallery.css"), "utf8");
      });
      cssP.catch(() => { cssP = null; });
    }
    return cssP;
  }

  function page() {
    return [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>Component gallery</title>",
      '<link rel="stylesheet" href="/gallery.css">',
      "</head>",
      "<body>",
      '<div id="app"></div>',
      '<script src="/gallery.js"></script>',
      ...(reload ? ['<script>new EventSource("/__events").addEventListener("reload", function () { location.reload(); });</script>'] : []),
      "</body>",
      "</html>",
      "",
    ].join("\n");
  }

  const manifestText = () => readFileSync(join(UI, "components.json"), "utf8");

  return { js, css, page, manifestText };
}

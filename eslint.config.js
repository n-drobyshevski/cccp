// The app lints itself with the kit's preset (src/kit/tooling/src/eslint/preset.mjs): the rules
// the kit obeys are the rules the app gets. What the preset does not cover stays below.
//  - The app has no markup sink of its own: renderRegion is the kit's (src/kit/client/src/dom.js, never
//    linted), so no app file may write innerHTML and `sinks` is empty (it was src/client/lib/dom.js).
//  - dev/*.js are classic scripts loaded in order by the dev page; they share window globals.
//  - src/kit is the vendored kit: never linted or edited.
import { kitDirs } from "./tools/kitPaths.mjs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const { gasKitPreset } = await import(pathToFileURL(join(kitDirs().tooling, "eslint/preset.mjs")).href);

const readonly = (names) => Object.fromEntries(names.map((k) => [k, "readonly"]));
const browserGlobals = readonly([
  "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "console", "fetch",
  "URL", "URLSearchParams", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "Promise", "Uint8Array",
  "Intl", "XMLHttpRequest", "Buffer", "process", "TextEncoder", "TextDecoder", "atob", "btoa",
]);

export default [
  ...gasKitPreset({
    client: ["src/client/**/*.js"],
    sinks: [],
    node: ["tools/**/*.mjs", "dev/**/*.mjs", "*.config.js", "*.config.mjs"],
    tests: ["test/**/*.js", "test/**/*.mjs"],
    // Each use of raw() (or html() as a function) is a reviewed decision with its reason. The same
    // list, with the same reasons, is the noRaw contract's allow in test/contracts.test.ts.
    rawAllowed: [
      "src/client/lib/icons.js", // the one icon the kit lacks (bang): a static, hard-coded SVG; no interpolated data
      "src/client/components/table.js", // raw(icon): the output of icons.js, a static SVG in a header cell
    ],
    ignores: [
      "src/kit/**", "src/gas/**", "dist/**", "node_modules/**", "mockups/**", "test-results/**",
      "playwright-report/**", "dev/server.dev.js",
    ],
  }),
  {
    // Classic scripts loaded in order by the dev page; they share window globals.
    files: ["dev/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...browserGlobals, google: "readonly", __BUILD_ID__: "readonly", Server: "readonly", PropertiesService: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
];

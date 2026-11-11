// Guards for the vanilla-JS client and the tooling.
//  - no-undef over client, dev and tools (catches a deleted import that nothing else notices).
//  - innerHTML / outerHTML / insertAdjacentHTML are banned everywhere except
//    src/client/lib/dom.js, whose renderRegion is the single sink for markup.
//  - a literal title attribute is banned (tooltips go through lib/tip.js, hover and focus).
// src/vendor is verbatim sidekick code and is never linted or edited.
const browserGlobals = Object.fromEntries(
  [
    "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
    "console", "performance", "fetch", "URL", "URLSearchParams", "crypto", "Blob", "File",
    "FileReader", "FormData", "Event", "CustomEvent", "MutationObserver", "ResizeObserver",
    "IntersectionObserver", "AbortController", "Node", "Element", "HTMLElement", "Image",
    "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "setInterval",
    "clearInterval", "queueMicrotask", "structuredClone", "globalThis", "self", "atob", "btoa",
    "DOMParser", "TextEncoder", "TextDecoder", "getComputedStyle", "Uint8Array", "Promise",
  ].map((k) => [k, "readonly"]),
);
const nodeGlobals = Object.fromEntries(
  ["process", "console", "Buffer", "URL", "URLSearchParams", "setTimeout", "clearTimeout", "TextEncoder", "TextDecoder"].map((k) => [k, "readonly"]),
);
const platformGlobals = { google: "readonly", __BUILD_ID__: "readonly" };

const MARKUP_SINKS = [
  { selector: "MemberExpression[property.name='innerHTML']", message: "innerHTML is only allowed in src/client/lib/dom.js (renderRegion)." },
  { selector: "MemberExpression[property.name='outerHTML']", message: "outerHTML is only allowed in src/client/lib/dom.js (renderRegion)." },
  { selector: "MemberExpression[property.name='insertAdjacentHTML']", message: "insertAdjacentHTML is only allowed in src/client/lib/dom.js (renderRegion)." },
  { selector: "Literal[value=/\\stitle\\s*=/]", message: "No title attributes: use data-tip (lib/tip.js)." },
  { selector: "TemplateElement[value.raw=/\\stitle\\s*=/]", message: "No title attributes: use data-tip (lib/tip.js)." },
];

export default [
  { ignores: ["src/vendor/**", "dist/**", "node_modules/**", "mockups/**", "test-results/**", "playwright-report/**", "dev/server.dev.js"] },
  {
    files: ["src/client/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...browserGlobals, ...platformGlobals } },
    rules: { "no-undef": "error", "no-restricted-syntax": ["error", ...MARKUP_SINKS] },
  },
  {
    // The one place allowed to write markup.
    files: ["src/client/lib/dom.js"],
    rules: { "no-restricted-syntax": ["error", MARKUP_SINKS[3], MARKUP_SINKS[4]] },
  },
  {
    // Classic scripts loaded in order by the dev page; they share window globals.
    files: ["dev/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: { ...browserGlobals, ...platformGlobals, Server: "readonly", PropertiesService: "readonly", Buffer: "readonly", process: "readonly", XMLHttpRequest: "readonly", Intl: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
  {
    files: ["tools/**/*.mjs", "build/**/*.mjs", "dev/**/*.mjs", "*.config.js", "*.config.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: nodeGlobals },
    rules: { "no-undef": "error" },
  },
  {
    files: ["test/**/*.js", "test/**/*.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: nodeGlobals },
    rules: { "no-undef": "error" },
  },
];

// Extracted from the author's production Apps Script apps; adapted.
// The gas-kit ESLint preset (flat config, core ESLint only: no TypeScript parser, because
// typescript-eslint does not support TypeScript 7). Browser code is JavaScript with JSDoc
// types (typechecked by tsc checkJs), so every AST rule below sees it. Server code is
// TypeScript: tsc checks it, so "**/*.ts" is ignored here. The UserProperties ban therefore
// only reaches JS files given as client or node; for server TS code it needs a static
// contract in @gas-kit/tooling/test (see the contracts list in docs/ARCHITECTURE.md).
//
// Only no-undef is on as a general rule: no-unused-vars was tried and is too noisy.

/** @param {string[]} names @returns {Record<string, "readonly">} */
const ro = (names) => Object.fromEntries(names.map((k) => [k, "readonly"]));

const browserGlobals = ro([
  "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
  "console", "performance", "fetch", "Headers", "Request", "Response", "XMLHttpRequest", "URL",
  "URLSearchParams", "crypto", "Blob", "File", "FileReader", "FormData", "Event", "CustomEvent",
  "MutationObserver", "ResizeObserver", "IntersectionObserver", "AbortController", "AbortSignal",
  "Node", "Element", "HTMLElement", "Image", "requestAnimationFrame", "cancelAnimationFrame",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "queueMicrotask", "structuredClone",
  "globalThis", "self", "atob", "btoa", "DOMParser", "TextEncoder", "TextDecoder",
  "getComputedStyle", "matchMedia", "CompressionStream", "DecompressionStream", "Uint8Array",
  "Promise", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "HTMLButtonElement",
  "HTMLTemplateElement", "HTMLAnchorElement", "KeyboardEvent", "MouseEvent", "PointerEvent",
  "FocusEvent", "InputEvent", "DocumentFragment", "ShadowRoot", "EventTarget", "customElements",
  "getSelection", "scrollTo", "scrollBy", "innerWidth", "innerHeight", "alert", "confirm", "prompt",
  "open", "close", "print", "addEventListener", "removeEventListener", "dispatchEvent",
  "HTMLDialogElement", "HTMLFormElement", "HTMLImageElement", "HTMLCanvasElement", "SVGElement",
  "Document", "Window", "Text", "Range", "NodeFilter", "DOMException", "CSS", "screen",
  "devicePixelRatio", "StorageEvent", "Storage", "PopStateEvent", "MediaQueryList", "DOMRect",
  "UIEvent", "WheelEvent", "HTMLDivElement", "HTMLOptionElement", "HTMLDetailsElement",
  "ClipboardItem",
]);
const nodeGlobals = ro([
  "process", "console", "Buffer", "URL", "URLSearchParams", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "structuredClone",
  "globalThis", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal", "fetch",
  "performance", "crypto", "Blob", "Response", "Request", "Headers", "FormData", "atob", "btoa",
  "EventTarget", "Event", "global", "MessageChannel", "BroadcastChannel", "clearImmediate",
]);
const platformGlobals = ro(["google", "__BUILD_ID__"]);

// An attribute may follow whitespace, "/" or a closing quote, or start the text.
const TITLE_RE = "/(^|[\\s\\/\"'])title\\s*=/i";
// Quoted, braced or end-of-text value.
const HANDLER_RE = "/(^|[\\s\\/\"'])on[a-z]+\\s*=\\s*($|[\"'{])/i";
// Unquoted value: an on*= that sits inside a tag in the same text. Quoted attribute values are
// skipped whole, so data-k="once=1" is a value, not a handler; the separator is whitespace, "/" or
// the end of a closing quote (class="x"onclick=go())...
const HANDLER_IN_TAG_RE = "/<[a-z](?:\"[^\"]*\"|'[^']*'|[^>\"'])*?(?:[\\s\\/]|(?<=[\"']))on[a-z]+\\s*=/i";
// ...or in text that starts inside a tag after an interpolation.
const HANDLER_AFTER_INTERP_RE = "/^[^<>]*[\\s\\/\"']on[a-z]+\\s*=[^<>]*>/i";
// Any of the three handler shapes in one regex, so a node is tested (and reported) once.
const HANDLER_ANY_RE = "/" + [HANDLER_RE, HANDLER_IN_TAG_RE, HANDLER_AFTER_INTERP_RE].map((r) => "(?:" + r.slice(1, -2) + ")").join("|") + "/i";
const SLASHES_RE = "/\\/\\//";
/** A selector list matching a string literal and both text forms of a template piece. @param {string} re */
const textSel = (re) => "Literal[value=" + re + "], TemplateElement[value.raw=" + re + "], TemplateElement[value.cooked=" + re + "]";
// srcdoc as an attribute inside markup text (it is a markup sink even through html``).
const SRCDOC_RE = "/(^|[\\s\\/\"'])srcdoc\\s*=/i";
const SINK_RE = "/^(innerHTML|outerHTML|insertAdjacentHTML)$/";

const YMD_RE = "/^\\d{4}-\\d{2}-\\d{2}$/";
const dateMsg = "Never pass a date-only yyyy-MM-dd string to new Date or Date.parse: it parses as UTC midnight. Split it into parts: new Date(y, m - 1, d).";
const titleMsg = "No title attributes: use data-tip (shown on hover and focus).";
const srcdocMsg = "srcdoc is a markup sink: render through the html template and renderRegion.";
const handlerMsg = "No inline on*= handlers: use delegation on data-* attributes.";
const slashMsg = "No literal double slash in client strings: join the URL from parts or take it from the server.";
const userPropsMsg = "UserProperties is banned: under USER_DEPLOYING it is the deployer's store. Use localStorage on the client.";

/** Banned in every client file, including the sinks. */
const ALWAYS = [
  { selector: "MemberExpression[property.name='outerHTML']", message: "outerHTML is banned everywhere: render through the html template and renderRegion." },
  { selector: "MemberExpression[property.name='insertAdjacentHTML']", message: "insertAdjacentHTML is banned everywhere: render through the html template and renderRegion." },
  { selector: "MemberExpression[computed=true][property.value=" + SINK_RE + "]", message: "Computed access to a markup sink is banned." },
  // One entry per concern, with every node form in one selector list: ESLint reports a node once
  // however many of the alternatives match, so raw and cooked text do not double the message.
  { selector: textSel(TITLE_RE), message: titleMsg },
  { selector: textSel(HANDLER_ANY_RE), message: handlerMsg },
  { selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(title|srcdoc|on.*)$/i], CallExpression[callee.property.name='setAttribute'][arguments.0.quasis.0.value.cooked=/^(title|srcdoc|on.*)$/i]", message: "setAttribute of title, srcdoc or on* is banned: use data-tip, delegation and the html template." },
  // Not caught, on purpose: Object.assign(el, { title: x }) and Reflect.set(el, 'title', x), which
  // set a title the same way but are indistinguishable from plain data writes by syntax.
  // el.title = x sets a title attribute; document.title (and ownerDocument.title) is the page title
  // and stays allowed. Computed access is covered only for a literal key. Known false positive: a
  // plain data object (row.title = v) is indistinguishable from an element by syntax; build the
  // object literal ({ title: v }) or use a differently named field.
  { selector: "AssignmentExpression > MemberExpression.left[computed=false][property.name='title']:not([object.name='document']):not([object.property.name=/^(document|ownerDocument)$/])", message: titleMsg },
  { selector: "AssignmentExpression > MemberExpression.left[computed=true][property.value=/^title$/i]:not([object.name='document']):not([object.property.name=/^(document|ownerDocument)$/])", message: titleMsg },
  { selector: textSel(SRCDOC_RE), message: srcdocMsg },
  { selector: "MemberExpression[property.name='srcdoc'], MemberExpression[computed=true][property.value='srcdoc'], Property[key.name='srcdoc'], Property[key.value='srcdoc']", message: srcdocMsg },
  // A string naming a sink, as in Reflect.set(el, 'outerHTML', x) (innerHTML has its own rule).
  { selector: "Literal[value=/^(outerHTML|insertAdjacentHTML)$/]", message: "The string outerHTML or insertAdjacentHTML is banned everywhere: it hides a markup sink." },
  { selector: textSel(SLASHES_RE), message: slashMsg },
  // A regex ending in an escaped slash has raw text "\\//", which the middlebox reads as a comment.
  { selector: "Literal[regex][raw=" + SLASHES_RE + "]", message: slashMsg },
  { selector: "MemberExpression[computed=true][property.type='TemplateLiteral']", message: "Computed template-literal member access is banned: it can hide a markup sink." },
  { selector: "Property[key.name=/^(outerHTML|insertAdjacentHTML)$/]", message: "outerHTML and insertAdjacentHTML are banned everywhere." },
  { selector: "Property[key.value=" + SINK_RE + "]", message: "Computed access to a markup sink is banned." },
  { selector: "MemberExpression[object.name='document'][property.name=/^(write|writeln)$/]", message: "document.write is banned: render through the html template and renderRegion." },
  // The same through any receiver that names a document (window.document, top.document, el.ownerDocument).
  { selector: "MemberExpression[object.property.name=/^(document|ownerDocument)$/][property.name=/^(write|writeln)$/], MemberExpression[object.name=/^(document|ownerDocument)$/][computed=true][property.value=/^(write|writeln)$/], MemberExpression[object.property.name=/^(document|ownerDocument)$/][computed=true][property.value=/^(write|writeln)$/]", message: "document.write is banned: render through the html template and renderRegion." },
  { selector: "CallExpression[callee.property.name='postMessage'][arguments.1.value='*'], CallExpression[callee.name='postMessage'][arguments.1.value='*']", message: "postMessage with the target origin \"*\" sends the data to any page that frames or opens this one: name the origin." },
  { selector: "CallExpression[callee.property.name='addEventListener'][arguments.0.value='message'], CallExpression[callee.name='addEventListener'][arguments.0.value='message'], AssignmentExpression > MemberExpression.left[property.name='onmessage'], AssignmentExpression > Identifier.left[name='onmessage']", message: "message listeners are banned: any framing or opening page can post to them. The app talks to its server through google.script.run." },
  { selector: "Identifier[name='UserProperties']", message: userPropsMsg },
  { selector: "MemberExpression[property.name='getUserProperties']", message: userPropsMsg },
  { selector: "MemberExpression[computed=true][property.value='getUserProperties']", message: userPropsMsg },
  { selector: "Property[key.name='getUserProperties']", message: userPropsMsg },
  { selector: "Property[key.value='getUserProperties']", message: userPropsMsg },
  // A date-only string parses as UTC midnight, so it shows the previous day west of UTC. Only a
  // literal yyyy-MM-dd argument is caught (new Date(x) with a variable cannot be told by syntax).
  { selector: "NewExpression[callee.name='Date'][arguments.0.value=" + YMD_RE + "], NewExpression[callee.name='Date'][arguments.0.quasis.length=1][arguments.0.quasis.0.value.cooked=" + YMD_RE + "], CallExpression[callee.object.name='Date'][callee.property.name='parse'][arguments.0.value=" + YMD_RE + "], CallExpression[callee.object.name='Date'][callee.property.name='parse'][arguments.0.quasis.length=1][arguments.0.quasis.0.value.cooked=" + YMD_RE + "]", message: dateMsg },
];
/** Additionally banned outside the sinks. */
const OUTSIDE_SINKS = [
  { selector: "MemberExpression[property.name='innerHTML']", message: "innerHTML is only allowed in the markup sinks (renderRegion, islands): render through the html template." },
  { selector: "Property[key.name='innerHTML']", message: "innerHTML is only allowed in the markup sinks (renderRegion, islands): render through the html template." },
  { selector: "Literal[value='innerHTML']", message: "The string innerHTML is only allowed in the markup sinks (renderRegion, islands): it hides a markup sink." },
  { selector: "MemberExpression[property.name=/^(setHTMLUnsafe|parseHTMLUnsafe|createContextualFragment)$/]", message: "Unsafe markup parsing is only allowed in the markup sinks (renderRegion, islands)." },
  { selector: "MemberExpression[property.name='parseFromString'], NewExpression[callee.name='DOMParser']", message: "DOMParser is a markup sink: render through the html template and renderRegion." },
];

const scriptMsg = "Creating a script element is banned: the client is one bundle. A reviewed loader is listed in the preset's scriptAllowed.";
const rawMsg = "raw() and html() called as a function turn any string into SafeHtml: render through the html tag. A reviewed use is listed in the preset's rawAllowed (or carries an eslint-disable line with its reason).";

/** A module specifier that exports raw: the html module or the client package (as noRaw's HTML_MODULE_RE). */
const HTML_MODULE_RE = /(?:^|\/)html(?:\.m?js)?$|^@gas-kit\/client(?:\/index\.js)?$|(?:^|\/)client\/src(?:\/index\.js)?$/;

/** @param {any} n the name node of a specifier (an Identifier, or a string Literal) */
const specName = (n) => (n ? (n.type === "Identifier" ? n.name : n.value) : undefined);

/**
 * gas-kit/no-raw bans the raw binding, not only the call: once a file holds raw under any name it
 * can pass it on (cells.map(raw), const trusted = raw) or re-export it, and no call of raw is left
 * to see. Reported: a call of raw (bare, optional or as a member, except String.raw) and html()
 * called as a function; any import or export specifier named raw; export * of the html module or
 * the client package; and on a namespace import, a member raw (k.raw, k?.raw, k["raw"]) or a
 * destructuring of raw out of it or out of an import() expression. Other .raw properties pass.
 */
const noRawRule = {
  meta: { type: /** @type {const} */ ("problem"), schema: [] },
  /** @param {any} context */
  create(context) {
    /** @type {Set<string>} */ const namespaces = new Set();
    /** @param {any} node */ const report = (node) => context.report({ node, message: rawMsg });
    /** @param {any} pattern */
    const takesRaw = (pattern) => pattern && pattern.type === "ObjectPattern" && pattern.properties.some((/** @type {any} */ p) => p.type === "Property" && !p.computed && specName(p.key) === "raw");
    return {
      /** @param {any} node */
      Program(node) {
        for (const st of node.body) {
          if (st.type !== "ImportDeclaration") continue;
          for (const sp of st.specifiers) if (sp.type === "ImportNamespaceSpecifier") namespaces.add(sp.local.name);
        }
      },
      /** @param {any} node */
      CallExpression(node) {
        const c = node.callee;
        if (c.type === "Identifier" && (c.name === "raw" || c.name === "html")) report(node);
        else if (c.type === "MemberExpression" && !c.computed && c.property.name === "raw" && !(c.object.type === "Identifier" && c.object.name === "String")) report(node);
      },
      /** @param {any} node */
      ImportSpecifier(node) {
        if (specName(node.imported) === "raw" || node.local.name === "raw") report(node);
      },
      /** @param {any} node */
      ExportSpecifier(node) {
        if (specName(node.local) === "raw" || specName(node.exported) === "raw") report(node);
      },
      /** @param {any} node */
      ExportAllDeclaration(node) {
        if (node.source && typeof node.source.value === "string" && HTML_MODULE_RE.test(node.source.value)) report(node);
      },
      /** @param {any} node */
      MemberExpression(node) {
        if (!(node.object.type === "Identifier" && namespaces.has(node.object.name))) return;
        const name = node.computed ? (node.property.type === "Literal" ? node.property.value : undefined) : node.property.name;
        if (name === "raw") report(node);
      },
      /** @param {any} node */
      VariableDeclarator(node) {
        if (!takesRaw(node.id) || !node.init) return;
        const init = node.init.type === "AwaitExpression" ? node.init.argument : node.init;
        if ((init.type === "Identifier" && namespaces.has(init.name)) || init.type === "ImportExpression") report(node);
      },
      /** @param {any} node */
      AssignmentExpression(node) {
        if (!takesRaw(node.left)) return;
        const init = node.right.type === "AwaitExpression" ? node.right.argument : node.right;
        if ((init.type === "Identifier" && namespaces.has(init.name)) || init.type === "ImportExpression") report(node);
      },
    };
  },
};

/**
 * The kit's own rules, as a local plugin so each one can be switched off for its allow-list
 * without touching the shared no-restricted-syntax list.
 * @param {Record<string, string>} selectors selector to message
 */
const selectorRule = (selectors) => ({
  meta: { type: /** @type {const} */ ("problem"), schema: [] },
  /** @param {any} context */
  create(context) {
    /** @type {Record<string, (node: any) => void>} */ const out = {};
    for (const [sel, message] of Object.entries(selectors)) out[sel] = (node) => context.report({ node, message });
    return out;
  },
});
const plugin = {
  meta: { name: "gas-kit" },
  rules: {
    "no-script-element": selectorRule({
      "CallExpression[callee.property.name='createElement'][arguments.0.value=/^script$/i], CallExpression[callee.property.name='createElement'][arguments.0.quasis.0.value.cooked=/^script$/i]": scriptMsg,
    }),
    "no-raw": noRawRule,
  },
};

/**
 * The kit's reviewed raw() uses (icons and the router's empty region), and the client package's
 * index, whose export * of the html module is how the package exposes raw. The index entry is the
 * kit repository's own path, so it matches no app file.
 */
export const DEFAULT_RAW_ALLOWED = ["**/client/src/icons.js", "**/client/src/router.js", "packages/client/src/index.js"];
/** The kit's reviewed script loader (the chart island, which pins integrity). */
export const DEFAULT_SCRIPT_ALLOWED = ["**/ui/src/components/chartIsland.js"];

const NODE_BANS = [
  { selector: "Identifier[name='UserProperties']", message: userPropsMsg },
  { selector: "MemberExpression[property.name='getUserProperties']", message: userPropsMsg },
  { selector: "MemberExpression[computed=true][property.value='getUserProperties']", message: userPropsMsg },
  { selector: "Property[key.name='getUserProperties']", message: userPropsMsg },
  { selector: "Property[key.value='getUserProperties']", message: userPropsMsg },
];

/**
 * @param {object} [o]
 * @param {string[]} [o.client]   globs of browser JS (client kernel, ui, app client)
 * @param {string[]} [o.node]     globs of node tooling (.mjs build/dev/cli scripts, configs)
 * @param {string[]} [o.tests]    globs of JS test files
 * @param {string[]} [o.sinks]    the files allowed to write markup (renderRegion, islands)
 * @param {string[]} [o.ignores]
 * @param {string[]} [o.rawAllowed] client files that may call raw() or html() as a function
 *   (default DEFAULT_RAW_ALLOWED, the kit's own reviewed uses); each one is a reviewed decision
 * @param {string[]} [o.scriptAllowed] client files that may create a script element (default
 *   DEFAULT_SCRIPT_ALLOWED)
 * @returns {import("eslint").Linter.Config[]}
 */
export function gasKitPreset(o = {}) {
  /** @type {any[]} */
  const cfg = [{ ignores: [...(o.ignores || []), "**/*.ts"] }];
  if (o.client && o.client.length) {
    cfg.push({
      files: o.client,
      languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...browserGlobals, ...platformGlobals } },
      plugins: { "gas-kit": plugin },
      rules: {
        "no-undef": "error", "no-eval": "error", "no-implied-eval": "error", "no-new-func": "error",
        "no-restricted-syntax": ["error", ...OUTSIDE_SINKS, ...ALWAYS],
        "gas-kit/no-raw": "error", "gas-kit/no-script-element": "error",
      },
    });
    const rawAllowed = o.rawAllowed ?? DEFAULT_RAW_ALLOWED;
    if (rawAllowed.length) cfg.push({ files: rawAllowed, plugins: { "gas-kit": plugin }, rules: { "gas-kit/no-raw": "off" } });
    const scriptAllowed = o.scriptAllowed ?? DEFAULT_SCRIPT_ALLOWED;
    if (scriptAllowed.length) cfg.push({ files: scriptAllowed, plugins: { "gas-kit": plugin }, rules: { "gas-kit/no-script-element": "off" } });
  }
  if (o.sinks && o.sinks.length) {
    cfg.push({
      files: o.sinks,
      rules: { "no-restricted-syntax": ["error", ...ALWAYS] },
    });
  }
  if (o.node && o.node.length) {
    cfg.push({
      files: o.node,
      languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: nodeGlobals },
      rules: { "no-undef": "error", "no-restricted-syntax": ["error", ...NODE_BANS] },
    });
  }
  if (o.tests && o.tests.length) {
    cfg.push({
      files: o.tests,
      languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...nodeGlobals, __dirname: "readonly" } },
      rules: { "no-undef": "error" },
    });
  }
  return cfg;
}

// The bare-shell step: a preserve-mode migration keeps the original's plain page, so the kit's app shell
// (sidebar, inset header, theme and motion toggles) is swapped for a bare skeleton. It reads the source
// entry page through ctx.tree, finds the element that holds the app (id app, root, main, content or
// page, or a main element) and the wrapper elements around it, and writes
// src/client/migrated/shell.js: mountShell(app, el, win) with the template's signature, which draws
// only that skeleton: the app element keeps its own id (main.js is patched to find it) with tabindex -1,
// and the page's static siblings from a short allow list ride along. Only tags from a short
// list, sanitised ids and class names, static text and safe links are carried; never a script, handler, title, style,
// target or scriptlet. A carried hash link gets target="_self", so it stays in Apps Script's frame
// under <base target="_top">; a carried ?page= link to a page the app has becomes that page's hash
// route first (frameLinks.mjs pageRewrite), one to another page is kept after a "migrate: page
// link not rewritten" comment, and another relative link is kept and named in the notes. main.js is patched once to import it; the template's shell.js stays in place, unused.
// The app element's selector goes into plan.maps.shellRoot ({ selector: "#<id>" }): the
// finish-migration compare takes it as the default region to compare, the same element on both
// sides, so the kit's skip link and toast regions outside it are left out.
import { SELF_ATTR, isHashUrl, pageMarkComment, pageRewrite } from "../frameLinks.mjs";
import { jsHeader, pagesFor } from "./_common.mjs";

const SHELL_JS = "src/client/migrated/shell.js";
const MAIN = "src/client/main.js";
const OLD_IMPORT = 'import { mountShell } from "./shell.js";';
const NEW_IMPORT = 'import { mountShell } from "./migrated/shell.js";';
const FALLBACK = '<main id="main" tabindex="-1"></main>';

/** Tags a skeleton may carry. */
const LAYOUT_TAGS = new Set(["div", "main", "section", "article"]);
/** The ids that mark the element holding the app. */
const APP_IDS = new Set(["app", "root", "main", "content", "page"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const TAG_RE = /<(\/?)([A-Za-z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;

/**
 * The source key of the entry page: the html file with a body, preferring a name that starts with
 * "index", an app mount element, and the source root over a shared one.
 * @param {import("../sourceTree.mjs").SourceTree} tree
 * @returns {string | null}
 */
export function findEntry(tree) {
  /** @type {{ key: string, score: number }[]} */
  const scored = [];
  for (const [key, f] of tree.files) {
    if (f.kind !== "html") continue;
    let text = "";
    try {
      text = tree.read(key);
    } catch {
      continue;
    }
    if (!/<body[\s>]/i.test(text)) continue;
    const base = key.split("/").pop() ?? key;
    let score = 4;
    if (/^index/i.test(base)) score += 3;
    if (/\bid\s*=\s*["'](?:app|root|main)["']/i.test(text)) score += 2;
    if (!key.startsWith("@")) score += 1;
    scored.push({ key, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  return scored[0]?.key ?? null;
}

/** @param {string} v @returns {string | null} an id that is safe to write into a template */
const safeId = (v) => (/^[A-Za-z][\w-]{0,63}$/.test(v) ? v : null);
/** @param {string} v @returns {string} the class names that are plain tokens, joined */
const safeClasses = (v) => v.split(/\s+/).filter((c) => /^[A-Za-z_][\w-]{0,63}$/.test(c)).join(" ");
/** A link target that may be carried: a hash route or a relative path, never a scheme or a double slash. @param {string} v */
const safeHref = (v) => /^[\w./?=&%#-]{1,200}$/.test(v) && !v.includes("//") && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(v);

/** Tags a carried sibling or wrapper may have. */
const CARRY_TAGS = new Set(["header", "nav", "footer", "div", "span", "h1", "h2", "h3", "p", "a", "strong", "em", "small", "section", "article", "main"]);
const MAX_NODES = 60;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * @typedef {{ tag: string, attrs: string, kids: Node[] }} Elem
 * @typedef {Elem | string} Node an element, or a text run
 */

/** @param {string} attrs @param {string} name @returns {string} */
function attrOf(attrs, name) {
  const m = new RegExp("(?:^|\\s)" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))", "i").exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
}

/** The body of a page as a tree of elements and text, with scripts, styles, comments and scriptlets gone. @param {string} page @returns {Elem} */
function parseBody(page) {
  let text = page.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  text = text.replace(/<(script|style|template|head)\b[\s\S]*?<\/\1\s*>/gi, "");
  const body = /<body\b[^>]*>/i.exec(text);
  if (body) text = text.slice(body.index + body[0].length);
  /** @type {Elem} */
  const root = { tag: "body", attrs: "", kids: [] };
  /** @type {Elem[]} */
  const stack = [root];
  let at = 0;
  const top = () => /** @type {Elem} */ (stack[stack.length - 1]);
  for (const m of text.matchAll(TAG_RE)) {
    if (m.index > at) top().kids.push(text.slice(at, m.index));
    at = m.index + m[0].length;
    const tag = (m[2] ?? "").toLowerCase();
    const attrs = m[3] ?? "";
    if (m[1]) {
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      continue;
    }
    /** @type {Elem} */
    const el = { tag, attrs, kids: [] };
    top().kids.push(el);
    if (!VOID.has(tag) && !attrs.trimEnd().endsWith("/")) stack.push(el);
  }
  if (at < text.length) top().kids.push(text.slice(at));
  return root;
}

/** @param {Node[]} kids @param {Elem} target @returns {Elem[] | null} the elements from the body's child down to the one that holds target, target last */
function pathTo(kids, target) {
  for (const k of kids) {
    if (typeof k === "string") continue;
    if (k === target) return [k];
    const inner = pathTo(k.kids, target);
    if (inner) return [k, ...inner];
  }
  return null;
}

/** @param {Node[]} kids @returns {Elem | null} the first element, in document order, that holds the app */
function findApp(kids) {
  for (const k of kids) {
    if (typeof k === "string") continue;
    if (APP_IDS.has(attrOf(k.attrs, "id")) || k.tag === "main") return k;
    const inner = findApp(k.kids);
    if (inner) return inner;
  }
  return null;
}

/**
 * The skeleton of an entry page: the wrappers around the app element, the static siblings the
 * allow list lets through, and the app element itself (its own id kept, tabindex -1).
 * @param {string} page the entry page's text
 * @param {import("../frameLinks.mjs").AppPages} [pages] the app's pages, for its ?page= links (none: each is left, marked)
 * @returns {{ markup: string, appId: string, ownId: boolean, tag: string, product: boolean, carried: string[], dropped: string[], links: string[] } | null} null when the page names no app element;
 *   ownId: the source's app element has that id itself; tag: its tag; links: the relative links carried as written, and why
 */
export function skeletonOf(page, pages = new Map()) {
  const root = parseBody(page);
  const app = findApp(root.kids);
  if (!app) return null;
  const path = /** @type {Elem[]} */ (pathTo(root.kids, app));
  const appId = safeId(attrOf(app.attrs, "id")) ?? "main";
  const used = new Set([appId, "main"]);
  /** @type {string[]} */
  const carried = [];
  /** @type {string[]} */
  const dropped = [];
  /** @type {string[]} */
  const links = [];
  let product = false;
  let budget = MAX_NODES;
  const label = (/** @type {Elem} */ e) => e.tag + (safeClasses(attrOf(e.attrs, "class")) ? "." + safeClasses(attrOf(e.attrs, "class")).split(" ").join(".") : "");

  /** @param {string} t */
  const textOf = (t) => {
    const plain = t.replace(/&(#\d+|#x[\da-f]+|\w+);/gi, (_m, n) => {
      const v = /** @type {Record<string, string>} */ (ENTITIES)[String(n).toLowerCase()];
      return v ?? "";
    }).replace(/\s+/g, " ").trim();
    if (!plain) return "";
    return plain.split(/(\{\{[^{}]*\}\})/).map((piece) => {
      const ph = /^\{\{\s*([\w.]+)\s*\}\}$/.exec(piece);
      if (ph) {
        if (/product|app|title|name/i.test(ph[1] ?? "")) {
          product = true;
          return "${PRODUCT}";
        }
        dropped.push("placeholder " + ph[1]);
        return "";
      }
      const clean = piece.replace(/[^\p{L}\p{N} .,:;!?()'"&@#%+*=\u00a9\u00b7\u2013\u2014-]/gu, "").replace(/\/{2,}/g, "/");
      return clean ? "${" + JSON.stringify(clean) + "}" : "";
    }).join("");
  };

  /** @param {Elem} e @param {string} inner */
  const wrap = (e, inner) => {
    const id = safeId(attrOf(e.attrs, "id"));
    const keepId = id && !used.has(id) ? id : null;
    if (keepId) used.add(keepId);
    const href = e.tag === "a" ? attrOf(e.attrs, "href") : "";
    const okHref = href && safeHref(href);
    if (href && !okHref) dropped.push("href on " + label(e));
    // A relative ?page= link becomes its page's hash route, or is kept with a marker (frameLinks.mjs).
    const rel = okHref ? pageRewrite(href, pages) : null;
    const to = rel?.fix === "route" && rel.href && safeHref(rel.href) ? rel.href : href;
    let mark = "";
    if (rel?.fix === "left") {
      mark = pageMarkComment(rel.why);
      links.push("the page link " + JSON.stringify(href) + " is kept as written: " + rel.why);
    } else if (rel && to === href) links.push("the link " + JSON.stringify(href) + " " + rel.why + ": make it a hash route, or a full reload with the service URL and target _top");
    // A hash link stays in the frame (frameLinks.mjs): the source's own target is never carried.
    const self = okHref && isHashUrl(to) ? " " + SELF_ATTR : "";
    return mark + openTag(e.tag, keepId, safeClasses(attrOf(e.attrs, "class"))) + (okHref ? ' href="' + to + '"' + self : "") + ">" + inner + "</" + e.tag + ">";
  };

  /** A carried sibling, with its allowed descendants; empty when dropped. @param {Node} n @returns {string} */
  const carry = (n) => {
    if (typeof n === "string") return textOf(n);
    if (!CARRY_TAGS.has(n.tag) || budget <= 0) {
      dropped.push(label(n));
      return "";
    }
    budget--;
    const inner = n.kids.map(carry).join("");
    carried.push(label(n));
    return wrap(n, inner);
  };

  /** @param {Elem[]} rest the path from here down @param {Node[]} kids the children of the current level @returns {string} */
  const level = (rest, kids) => {
    const [here, ...below] = rest;
    return kids
      .map((k) => {
        if (k !== here) return carry(k);
        if (!below.length) return openTag(LAYOUT_TAGS.has(app.tag) ? app.tag : "main", appId, safeClasses(attrOf(app.attrs, "class"))) + ' tabindex="-1"></' + (LAYOUT_TAGS.has(app.tag) ? app.tag : "main") + ">";
        if (!CARRY_TAGS.has(k.tag)) {
          dropped.push(label(k) + " (wrapper, its siblings too)");
          return level(below, [/** @type {Elem} */ (below[0])]);
        }
        return wrap(k, level(below, k.kids));
      })
      .join("");
  };
  const markup = level(path, root.kids);
  return { markup, appId, ownId: safeId(attrOf(app.attrs, "id")) !== null, tag: app.tag, product, carried, dropped, links };
}

/** @param {string} tag @param {string | null} id @param {string} cls */
const openTag = (tag, id, cls) => "<" + tag + (id ? ' id="' + id + '"' : "") + (cls ? ' class="' + cls + '"' : "");

/** @param {string} from @param {string} markup @param {boolean} product */
function shellJs(from, markup, product) {
  return (
    jsHeader("bare-shell", from) +
    "// The bare shell of a preserve-mode migration: the page skeleton the source had, and nothing else.\n" +
    "// It has the same signature as the template's shell.js, which stays in place unused. main.js looks\n" +
    "// the app element up by its id, and it must stay focusable (tabindex -1).\n" +
    'import { renderRegion } from "@gas-kit/client/dom.js";\n' +
    'import { html } from "@gas-kit/client/html.js";\n' +
    (product ? 'import { PRODUCT } from "../config.js";\n' : "") +
    "\n" +
    "/** The skeleton: the source page's containers around the region the router fills. */\n" +
    "export function shellView() {\n" +
    "  return html`" + markup + "`;\n" +
    "}\n" +
    "\n" +
    "/**\n" +
    " * Draw the skeleton once. Returns a function that stops nothing (there is nothing to stop).\n" +
    " * @param {import(\"../app.js\").App} app\n" +
    " * @param {Element} el\n" +
    " * @param {unknown} win\n" +
    " */\n" +
    "export function mountShell(app, el, win) {\n" +
    "  void app;\n" +
    "  void win;\n" +
    "  renderRegion(el, shellView());\n" +
    "  return () => {};\n" +
    "}\n"
  );
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const key = findEntry(ctx.tree);
  const sk = key ? skeletonOf(ctx.tree.read(key), pagesFor(ctx)) : null;
  const from = key ? key.replace(/[^\w./@-]/g, "_").replace(/\/{2,}/g, "/") : "no entry page found";
  ctx.out.write(SHELL_JS, shellJs(from, sk ? sk.markup : FALLBACK, !!sk?.product));

  const id = sk ? sk.appId : "main";
  const main = ctx.readTarget(MAIN);
  if (main === null) throw new Error("bare-shell: the template drifted: " + MAIN + " is missing");
  if (!main.includes(NEW_IMPORT)) ctx.patchTarget(MAIN, OLD_IMPORT, () => NEW_IMPORT);
  if (id !== "main") {
    // main.js finds the region by id: the source's own id replaces the template's, at both places.
    for (const [was, now] of [
      ["focusFallback: () => document.getElementById(\"main\")", "focusFallback: () => document.getElementById(\"" + id + "\")"],
      ["(document.getElementById(\"main\"));", "(document.getElementById(\"" + id + "\"));"],
    ]) {
      const cur = ctx.readTarget(MAIN) ?? "";
      if (!cur.includes(was) && cur.includes(now)) continue;
      ctx.patchTarget(MAIN, /** @type {string} */ (was), () => /** @type {string} */ (now));
    }
  }

  /** @type {string[]} */
  const notes = [];
  notes.push(sk ? "skeleton taken from " + from + ", app element kept as id " + id + ": " + sk.markup : "no app container found in " + from + ": the fallback " + FALLBACK + " is used");
  if (sk) {
    notes.push("carried: " + (sk.carried.length ? sk.carried.join(", ") : "nothing besides the app element"));
    notes.push(...sk.links);
    if (sk.dropped.length) notes.push("dropped (not static layout, or not safe to carry): " + [...new Set(sk.dropped)].join(", "));
    if (id !== "main") notes.push("src/client/main.js now looks the app region up as #" + id + " (two places); the router, the focus on a route change and the skip link use that element");
  }
  notes.push("src/client/shell.js (the kit's shell) is kept but unused; to go back, run migrate:plan --shell kit and point the import in src/client/main.js at ./shell.js again" + (id !== "main" ? " (and getElementById back to main)" : ""));
  notes.push("for the retire-register step: the kit's access and settings pages have no nav link in the bare shell but stay reachable by URL (#/access, #/settings)");
  // The selector must find the same element in the source page and in the shell: its own id, else
  // a main element (the shell draws the app element as main then), else nothing is recorded.
  const selector = sk && sk.ownId ? "#" + id : sk && sk.tag === "main" ? "main" : null;
  if (!selector) return { notes };
  notes.push("plan.maps.shellRoot is " + selector + ": the compare script checks that element on both sides unless a page names its own root");
  return { notes, maps: { shellRoot: { selector, from } } };
}

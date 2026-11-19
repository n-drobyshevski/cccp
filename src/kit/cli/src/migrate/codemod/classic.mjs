// The classic codemods over one flattened page: title becomes data-tip, plus aria-label when the
// element shows no text (the title was its name), or, when it has a name of its own (text or an
// aria-label), aria-describedby pointing at a hidden span just inside its end tag that holds the
// same text (the title was a description; the id is unique in the page; the text is escaped, a print
// scriptlet in it is kept, and a title holding a raw or code scriptlet gets no span, only a note).
// An inline on<event>="fn('literal')" becomes data-act and data-arg with a
// generated delegate line in the script that defines fn, every remaining scriptlet gets a marker
// for the scriptlets-to-boot step, a CDN script is removed (it must be vendored), a ?page=x&id=y
// link to a page the app has becomes #/x?id=y (frameLinks.mjs pageRewrite; another page link is
// left with a marker, another relative link is reported), and every hash link (rewritten or
// written so) carries target="_self", so it stays in Apps Script's frame under
// <base target="_top"> (another target is kept with a note); and simple google.script.run chains
// become call(). Anything less simple
// keeps its original form after a "migrate:" comment. Each transform is idempotent on its own
// output, so a step that runs twice writes the same bytes.
import { tokenizeJs } from "../scan/js.mjs";
import { HOLE, SELF_ATTR, isHashUrl, leaveReason, linkAttrOf, pageMarkText, pageRewrite, targetFix } from "../frameLinks.mjs";
import { TEMPLATES, analyze, applyEdits, commentSafe, isId, isP, lastImportEnd, slice, splitArgs } from "./js.mjs";
import { closeTagAt, htmlComment, rawAt, scanTags, showsText, tagAt } from "./markup.mjs";

/** @typedef {{ fn: string, event: string, arg: "none" | "string" | "number" }} ClassicAct */
/** @typedef {{ start: number, end: number, text: string }} Edit */

const CDN = /^(?:https?:)?\/\//i;
/** Elements a hidden span may not sit in (the parser moves or drops it, or it is content). */
const NO_SPAN = new Set("select option optgroup datalist textarea table thead tbody tfoot tr colgroup ul ol dl picture audio video".split(" "));
const MODULE_MARK = "/* migrate: this script is a module now (it imports the kit), so its functions are not globals any more";

/** @param {string} s */
const decode = (s) => s.replace(/&quot;|&#34;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** A value with each scriptlet masked as one hole, so a computed part is never read as a URL. @param {string} s */
const holes = (s) => s.replace(/<\?[\s\S]*?(?:\?>|$)/g, HOLE);
/** @param {string} s */
const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** @param {string} s */
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** @param {string} s */
const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A handler attribute value that is one call of a named function with at most one literal
 * argument, or why not.
 * @param {string} value the attribute value as written (entities still encoded)
 * @returns {{ fn: string, arg: { kind: "none" | "string" | "number", value: string } } | { why: string }}
 */
export function simpleHandler(value) {
  const toks = tokenizeJs(decode(value)).filter((t) => t.type !== "comment");
  const t0 = toks[0];
  const end = toks.length && toks[toks.length - 1]?.value === ";" && toks[toks.length - 1]?.type === "punct" ? toks.length - 1 : toks.length;
  if (!t0 || t0.type !== "ident" || ["this", "event", "return", "void", "new", "function"].includes(t0.value)) return { why: "it is not a call of a named function" };
  let depth = 0;
  let closes = -1;
  for (let i = 1; i < end && closes < 0; i++) {
    const v = toks[i]?.type === "punct" ? toks[i]?.value : "";
    if (v === "(" || v === "[" || v === "{") depth++;
    else if ((v === ")" || v === "]" || v === "}") && --depth === 0) closes = i;
  }
  if (toks[1]?.value !== "(" || closes !== end - 1) return { why: "it is not a single call" };
  if (end === 3) return { fn: t0.value, arg: { kind: "none", value: "" } };
  if (end === 4) {
    const a = /** @type {import("../scan/js.mjs").JsToken} */ (toks[2]);
    if (a.type === "string") {
      const v = a.value.slice(1, -1);
      if (/\\/.test(v)) return { why: "its argument holds an escape" };
      return { fn: t0.value, arg: { kind: "string", value: v } };
    }
    if (a.type === "number" && /^\d+(?:\.\d+)?$/.test(a.value)) return { fn: t0.value, arg: { kind: "number", value: a.value } };
    return { why: "its argument is not a string or number literal" };
  }
  return { why: "it is not a call with at most one literal argument" };
}

/** The leading whitespace of the first line of a script body that holds code. @param {string} s */
function indentOf(s) {
  const m = /\n([ \t]*)\S/.exec(s);
  return m ? /** @type {string} */ (m[1]) : "";
}

/** The names of a script's top-level function declarations. @param {string} code */
export function topFunctions(code) {
  const J = analyze(code);
  /** @type {string[]} */
  const out = [];
  for (let k = 0; k < J.toks.length; k++) if (isId(J, k, "function") && J.depth[k] === 0 && isId(J, k + 1)) out.push(/** @type {string} */ (J.toks[k + 1]?.value));
  return out;
}

/**
 * A script body as a module: the import added (once, first) and a note that its functions are no
 * longer globals (once).
 * @param {string} body @param {string} importLine
 */
export function moduleBody(body, importLine) {
  const pad = indentOf(body);
  let out = body;
  if (!out.includes(MODULE_MARK)) {
    const fns = topFunctions(out);
    const note = MODULE_MARK + (fns.length ? ": " + fns.join(", ") : "") + ". Move what calls them from other scripts or attributes into it. */";
    out = "\n" + pad + note + out;
  }
  if (!out.split("\n").some((l) => l.trim() === importLine)) {
    const J = analyze(out);
    const hasImport = J.toks.some((t, k) => t.type === "ident" && t.value === "import" && J.depth[k] === 0 && !isP(J, k + 1, "("));
    if (hasImport) {
      const at = lastImportEnd(J);
      out = out.slice(0, at) + "\n" + pad + importLine + out.slice(at);
    } else out = "\n" + pad + importLine + out;
  }
  return out;
}

/**
 * The edit that makes a script tag a module, or null when it is one; throws a reason when its type
 * is something else.
 * @param {string} text @param {import("./markup.mjs").Tag} tag
 * @returns {Edit | null}
 */
export function moduleTag(text, tag) {
  const type = tag.attrs.find((a) => a.name === "type");
  if (type) {
    const v = type.value.trim().toLowerCase();
    if (v === "module") return null;
    if (v && !/^(?:text|application)\/(?:x-)?(?:javascript|ecmascript)$/.test(v)) throw new Error("its type is " + v);
    return { start: type.start, end: type.end, text: 'type="module"' };
  }
  const at = text[tag.end - 2] === "/" ? tag.end - 2 : tag.end - 1;
  return { start: at, end: at, text: ' type="module"' };
}

/**
 * The classic-html rewrite of one flattened page. counts.targets: the hash links given target _self;
 * counts.links: the ?page= links made hash routes. routes: each "?page=<name>" rewritten to its kit path.
 * @param {string} text
 * @param {{ stepId: string, pages: import("../frameLinks.mjs").AppPages }} opts pages: the app's pages (appPages)
 * @returns {{ text: string, routes: Record<string, string>, acts: ClassicAct[], notes: string[], bails: { line: number, code: string, reason: string }[], counts: Record<string, number> }}
 */
export function classicPage(text, { stepId, pages }) {
  const scan = scanTags(text);
  /** @type {Edit[]} */
  const edits = [];
  /** @type {Map<number, string[]>} markers to insert before a position */
  const before = new Map();
  /** @type {Record<string, string>} */
  const routes = {};
  /** @type {ClassicAct[]} */
  const acts = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {{ line: number, code: string, reason: string }[]} */
  const bails = [];
  /** @type {Record<string, number>} */
  const counts = { titles: 0, handlers: 0, scriptlets: 0, cdn: 0, links: 0, targets: 0 };
  /** @param {number} pos */
  const lineAt = (pos) => text.slice(0, pos).split("\n").length;
  /** @param {number} pos @param {string} m */
  const mark = (pos, m) => {
    const list = before.get(pos) ?? [];
    if (!list.includes(m)) list.push(m);
    before.set(pos, list);
  };
  /** @type {Set<import("./markup.mjs").Tag>} */
  const removed = new Set();
  const ids = new Set(scan.tags.flatMap((t) => t.attrs.filter((a) => a.name === "id").map((a) => a.value)));
  let tipCount = 0;
  const tipId = () => {
    let id = "";
    do id = "migrate-tip-" + ++tipCount;
    while (ids.has(id));
    ids.add(id);
    return id;
  };

  scan.tags.forEach((tag, i) => {
    if (tag.closing) return;
    // a CDN script: removed, to be vendored
    const src = tag.attrs.find((a) => a.name === "src");
    if (tag.name === "script" && src && CDN.test(src.value.trim())) {
      const raw = scan.raws.find((r) => r.tag === tag);
      const where = src.value.trim().replace(CDN, "");
      edits.push({ start: tag.start, end: raw ? raw.closeEnd : tag.end, text: htmlComment("migrate: removed the CDN script " + where + ": vendor it (a copy in the app, imported by the bundle)") });
      notes.push("removed the CDN script " + where + ": vendor it");
      counts["cdn"] = (counts["cdn"] ?? 0) + 1;
      removed.add(tag);
      return;
    }
    const has = (/** @type {string} */ n) => tag.attrs.some((a) => a.name === n);
    /** @type {string | null} the URL this tag's link attribute holds once its ?page= form is rewritten */
    let linkUrl = null;
    for (const a of tag.attrs) {
      if (a.name === "title") {
        if (has("data-tip")) {
          mark(tag.start, "migrate: title not converted: the element has a data-tip already");
          bails.push({ line: lineAt(tag.start), code: "title", reason: "the element has a data-tip already" });
          continue;
        }
        const q = a.quoted ? text[a.valueStart - 1] : '"';
        let rep = "data-tip" + text.slice(a.start + 5, a.end);
        if (!a.quoted && a.valueEnd > a.valueStart) rep = 'data-tip="' + escAttr(a.value) + '"';
        const close0 = closeTagAt(scan, i);
        const shown = close0 === null ? "" : scan.masked.slice(tag.end, close0).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, " ");
        const same = !has("aria-label") && !/<\?/.test(text.slice(tag.end, close0 ?? tag.end)) && norm(decode(shown)) === norm(decode(a.value));
        if (!has("aria-label") && !showsText(text, scan, i)) rep += " aria-label=" + q + a.value + q;
        else if (same) {
          // the title only repeats the text the element shows: nothing more to say
        } else {
          // The element has a name of its own: the title described it.
          const close = closeTagAt(scan, i);
          // A print scriptlet (<?= x ?>) is escaped by Apps Script for where it lands, so it may move
          // from the attribute into the span; a raw (<?!= ?>) or code scriptlet may not.
          const unsafe = [...a.value.matchAll(/<\?([\s\S]*?)(?:\?>|$)/g)].some((m) => !/^=(?!=)/.test(String(m[1])) || !m[0].endsWith("?>"));
          if (close === null || NO_SPAN.has(tag.name) || has("aria-describedby") || unsafe) {
            const why = has("aria-describedby") ? "it has an aria-describedby already" : close === null ? "it has no end tag to hold the hidden description span" : unsafe ? "the title holds a raw or code scriptlet, which is not copied into markup" : "a <" + tag.name + "> cannot hold the hidden description span";
            notes.push("line " + lineAt(tag.start) + ": the title of a <" + tag.name + "> describes it, but " + why + ": give screen readers the text by hand");
          } else {
            const id = tipId();
            rep += ' aria-describedby="' + id + '"';
            // The text between scriptlets is escaped: the title's own markup ("<img ...>" written
            // in an attribute) must never become an element in the span. The print scriptlets stay.
            const body = a.value.split(/(<\?=[\s\S]*?\?>)/).map((part, k) => (k % 2 ? part : escText(decode(part)))).join("");
            edits.push({ start: close, end: close, text: '<span id="' + id + '" hidden>' + body + "</span>" });
          }
        }
        edits.push({ start: a.start, end: a.end, text: rep });
        counts["titles"] = (counts["titles"] ?? 0) + 1;
      } else if (/^on[a-z]+$/.test(a.name)) {
        const h = simpleHandler(a.value);
        const event = a.name.slice(2);
        const clash = "fn" in h ? acts.find((x) => x.fn === h.fn && (x.event !== event || x.arg !== h.arg.kind)) : undefined;
        const taken = has("data-act") || tag.attrs.filter((x) => /^on[a-z]+$/.test(x.name)).length > 1;
        const why = "why" in h ? h.why : taken ? "the element has another handler or a data-act" : clash ? h.fn + " is delegated with another event or argument kind on this page" : null;
        if (why || !("fn" in h)) {
          mark(tag.start, "migrate: " + a.name + " not converted: " + why + "; make it a data-act with a delegate");
          bails.push({ line: lineAt(tag.start), code: "handler", reason: a.name + ": " + why });
          continue;
        }
        edits.push({ start: a.start, end: a.end, text: 'data-act="' + escAttr(h.fn) + '"' + (h.arg.kind === "none" ? "" : ' data-arg="' + escAttr(h.arg.value) + '"') });
        if (!acts.some((x) => x.fn === h.fn)) acts.push({ fn: h.fn, event, arg: h.arg.kind });
        counts["handlers"] = (counts["handlers"] ?? 0) + 1;
      } else if (a.name === linkAttrOf(tag.name)) {
        // A relative link: a page the app has becomes its hash route; anything else stays (frameLinks.mjs).
        const rel = pageRewrite(holes(a.value), pages);
        if (!rel) continue;
        if (rel.fix === "route" && rel.prefix && rel.href) {
          edits.push({ start: a.valueStart, end: a.valueStart + rel.prefix.len, text: rel.prefix.text });
          linkUrl = rel.href;
          routes["?page=" + rel.page] = /** @type {string} */ (rel.path);
          counts["links"] = (counts["links"] ?? 0) + 1;
        } else if (rel.fix === "left") {
          mark(tag.start, pageMarkText(rel.why));
          bails.push({ line: lineAt(tag.start), code: "page-link", reason: "the page link " + JSON.stringify(a.value) + " is not rewritten: " + rel.why });
        } else bails.push({ line: lineAt(tag.start), code: "relative-link", reason: "the link " + JSON.stringify(a.value) + " " + rel.why + ": make it a hash route, or a full reload with the service URL and target _top" });
      }
    }
    // A hash link (written so, or rewritten from ?page= above) stays in the frame: target _self.
    const urlName = linkAttrOf(tag.name);
    const url = urlName ? tag.attrs.find((a) => a.name === urlName) : undefined;
    if (url && url.valueEnd > url.valueStart && isHashUrl(linkUrl ?? holes(url.value))) {
      const target = tag.attrs.find((a) => a.name === "target");
      const fix = targetFix(target ? holes(target.value) : null);
      if (fix === "add") {
        edits.push({ start: url.end, end: url.end, text: " " + SELF_ATTR + (/[\s/>]/.test(text.charAt(url.end)) ? "" : " ") });
        counts["targets"] = (counts["targets"] ?? 0) + 1;
      } else if (fix === "replace" && target) {
        edits.push({ start: target.start, end: target.end, text: SELF_ATTR });
        counts["targets"] = (counts["targets"] ?? 0) + 1;
      } else if (fix === "keep" && target) {
        const why = "the hash link " + leaveReason(target.value) + "; make it _self unless it opens a new window on purpose";
        mark(tag.start, "migrate: target not changed: " + why);
        bails.push({ line: lineAt(tag.start), code: "target", reason: why });
      }
    }
  });

  // scriptlets: a marker each, for scriptlets-to-boot. A hidden description span this codemod wrote
  // repeats its element's title, whose scriptlets are marked at the element already.
  /** @type {[number, number][]} */
  const tipSpans = scan.tags.flatMap((t, k) => {
    if (t.closing || t.name !== "span" || !t.attrs.some((x) => x.name === "hidden") || !t.attrs.some((x) => x.name === "id" && /^migrate-tip-\d+$/.test(x.value))) return [];
    const end = closeTagAt(scan, k);
    return end === null ? [] : [[t.end, end]];
  });
  for (const s of scan.scriptlets) {
    if (scan.tags.some((t) => removed.has(t) && s.start >= t.start && s.start < (scan.raws.find((r) => r.tag === t)?.closeEnd ?? t.end))) continue;
    if (tipSpans.some(([a, b]) => s.start >= a && s.start < b)) continue;
    const code = commentSafe(s.code).replace(/--+/g, "-").slice(0, 80);
    const what = s.kind === "code" ? "code scriptlet " + JSON.stringify(code) + " must become client logic over boot data" : "scriptlet " + JSON.stringify(code) + " must become boot data";
    const inTag = tagAt(scan.tags, s.start);
    const raw = rawAt(scan.raws, s.start);
    if (inTag) mark(inTag.start, "migrate: " + what);
    else if (raw) {
      // at the start of its line inside the script or style, unless that is inside a string
      const pos = Math.max(raw.contentStart, text.lastIndexOf("\n", s.start) + 1);
      const lead = /^[ \t]*/.exec(text.slice(pos))?.[0].length ?? 0;
      const m = "/* migrate: " + what + " */ ";
      if (safeCommentAt(text, raw, pos + lead)) {
        if (!text.slice(0, pos + lead).endsWith(m) && !text.slice(pos + lead).startsWith(m)) edits.push({ start: pos + lead, end: pos + lead, text: m });
      } else mark(raw.tag.start, "migrate: " + what);
    } else mark(s.start, "migrate: " + what);
    counts["scriptlets"] = (counts["scriptlets"] ?? 0) + 1;
  }

  for (const [pos, list] of before) {
    const m = list.map((x) => htmlComment(x)).join("");
    if (!text.slice(0, pos).endsWith(m)) edits.push({ start: pos, end: pos, text: m });
  }

  const done = applyEdits(text, edits);
  if (!acts.length) return { text: done, routes, acts, notes, bails, counts };
  return { text: delegatePass(done, acts, stepId, notes), routes, acts, notes, bails, counts };
}

/**
 * The delegate lines, in the script that defines each function (made a module that imports
 * delegate), or in a new module script before the end of the body.
 * @param {string} text @param {ClassicAct[]} acts @param {string} stepId @param {string[]} notes
 */
function delegatePass(text, acts, stepId, notes) {
  const scan = scanTags(text);
  /** @type {Edit[]} */
  const edits = [];
  /** @param {number} pos */
  const lineAt = (pos) => text.slice(0, pos).split("\n").length;
  {
    const scripts = scan.raws.filter((r) => r.tag.name === "script" && !r.tag.attrs.some((a) => a.name === "src"));
    /** @type {Map<import("./markup.mjs").RawElement | null, ClassicAct[]>} */
    const byScript = new Map();
    for (const act of acts) {
      const owner = scripts.find((r) => topFunctions(text.slice(r.contentStart, r.contentEnd)).includes(act.fn)) ?? null;
      byScript.set(owner, [...(byScript.get(owner) ?? []), act]);
    }
    for (const [script, list] of byScript) {
      if (script) {
        const body = text.slice(script.contentStart, script.contentEnd);
        const pad = indentOf(body);
        let tagEdit = null;
        try {
          tagEdit = moduleTag(text, script.tag);
        } catch (e) {
          notes.push("the script at line " + lineAt(script.tag.start) + " cannot become a module (" + /** @type {Error} */ (e).message + "): " + list.map((x) => x.fn).join(", ") + " are not delegated");
          continue;
        }
        const block = delegateBlock(list, stepId, pad);
        const next = moduleBody(body.replace(/\s*$/, "") + "\n" + block + "\n", TEMPLATES["importDelegate"] ?? "");
        edits.push({ start: script.contentStart, end: script.contentEnd, text: next });
        if (tagEdit) edits.push(tagEdit);
      } else {
        const block = moduleBody("\n" + delegateBlock(list, stepId, "  ") + "\n", TEMPLATES["importDelegate"] ?? "");
        const el = htmlComment("migrate: " + list.map((x) => x.fn).join(", ") + " " + (list.length === 1 ? "is" : "are") + " not defined in a script of this page: define them in this module") + '\n<script type="module">' + block + "</script>\n";
        const bodyEnd = scan.tags.find((t) => t.closing && t.name === "body");
        edits.push({ start: bodyEnd ? bodyEnd.start : text.length, end: bodyEnd ? bodyEnd.start : text.length, text: el });
      }
    }
  }
  return applyEdits(text, edits);
}

/**
 * Whether a comment can go at pos inside a script or style element without landing in a string,
 * template or comment (scriptlets read as null).
 * @param {string} text @param {import("./markup.mjs").RawElement} raw @param {number} pos
 */
function safeCommentAt(text, raw, pos) {
  const body = text.slice(raw.contentStart, raw.contentEnd).replace(/<\?[\s\S]*?\?>/g, (m) => m.replace(/[^\n]/g, " "));
  const at = pos - raw.contentStart;
  if (raw.tag.name !== "script") return !/\/\*(?:(?!\*\/)[\s\S])*$/.test(body.slice(0, at)) && !/["'][^"'\n]*$/.test(body.slice(0, at).split("\n").pop() ?? "");
  return !tokenizeJs(body).some((t) => t.start < at && at < t.end);
}

/**
 * The delegate lines for some inline handlers.
 * @param {ClassicAct[]} list @param {string} stepId @param {string} pad
 */
function delegateBlock(list, stepId, pad) {
  const lines = [pad + "/* Generated by gas-kit migrate (" + stepId + "): the page's inline handlers, delegated. */"];
  for (const a of list) {
    const arg = a.arg === "none" ? "" : a.arg === "number" ? 'Number(el.getAttribute("data-arg"))' : 'el.getAttribute("data-arg")';
    const fn = a.arg === "none" ? "() => " + a.fn + "()" : "(_ev, el) => " + a.fn + "(" + arg + ")";
    lines.push(pad + "delegate(document, " + JSON.stringify(a.event) + ", " + JSON.stringify('[data-act="' + a.fn + '"]') + ", " + fn + ");");
  }
  return lines.join("\n");
}

/**
 * Simple google.script.run chains of one script body as call(). A chain converts when it has at
 * most one withSuccessHandler and one withFailureHandler (any order), no withUserObject, a named
 * server function and at most one argument; nested chains inside its handlers convert too.
 * @param {string} code
 * @param {{ rpc: Record<string, unknown>, params: Record<string, string[]> }} opts rpc: the plan's rename map;
 *   params: the server function's parameter names (for the positional-argument note)
 * @returns {{ text: string, converted: string[], bailed: { line: number, reason: string }[] }}
 */
export function gsrToCall(code, opts) {
  const J = analyze(code);
  /** @type {Edit[]} */
  const edits = [];
  /** @type {string[]} */
  const converted = [];
  /** @type {{ line: number, reason: string }[]} */
  const bailed = [];
  let floor = -1;
  for (let k = 0; k < J.toks.length; k++) {
    if (k <= floor) continue;
    if (!(isId(J, k, "google") && isP(J, k + 1, ".") && isId(J, k + 2, "script") && isP(J, k + 3, ".") && isId(J, k + 4, "run")) || isP(J, k - 1, ".")) continue;
    const line = J.toks[k]?.line ?? 0;
    /** @type {Map<string, [number, number]>} */
    const withs = new Map();
    let why = null;
    let j = k + 5;
    /** @type {{ name: string, open: number, close: number } | null} */
    let fin = null;
    for (;;) {
      if (isP(J, j, ".") && isId(J, j + 1) && isP(J, j + 2, "(") && J.match[j + 2] > j + 2) {
        const name = /** @type {string} */ (J.toks[j + 1]?.value);
        const close = J.match[j + 2];
        if (/^with[A-Z]/.test(name)) {
          const args = splitArgs(J, j + 2);
          if (name === "withUserObject") why = why ?? "it passes a user object (withUserObject)";
          else if (name !== "withSuccessHandler" && name !== "withFailureHandler") why = why ?? "it calls " + name;
          else if (withs.has(name)) why = why ?? "it sets " + name + " twice";
          else if (args.length !== 1) why = why ?? name + " takes one handler";
          else withs.set(name, /** @type {[number, number]} */ (args[0]));
          j = close + 1;
          continue;
        }
        fin = { name, open: j + 2, close };
        break;
      }
      if (isP(J, j, "[")) why = why ?? "the server function is computed";
      break;
    }
    if (!fin) {
      why = why ?? "the chain names no server function";
    }
    const args = fin ? splitArgs(J, fin.open) : [];
    if (!why && args.length > 1) why = args.length + " positional arguments (port-server makes " + (fin?.name ?? "it") + " take one object; then pass that object here)";
    if (why || !fin) {
      const m = "/* migrate: google.script.run not converted: " + commentSafe(why ?? "") + " */ ";
      if (!code.slice(0, J.toks[k]?.start ?? 0).endsWith(m)) edits.push({ start: /** @type {any} */ (J.toks[k]).start, end: /** @type {any} */ (J.toks[k]).start, text: m });
      bailed.push({ line, reason: /** @type {string} */ (why) });
      continue;
    }
    converted.push(fin.name);
    const sub = (/** @type {[number, number]} */ [x, y]) => {
      const r = gsrToCall(slice(J, x, y), opts);
      converted.push(...r.converted);
      bailed.push(...r.bailed);
      return r.text;
    };
    const to = opts.rpc[fin.name];
    const name = typeof to === "string" && /^[A-Za-z_$][\w$]*$/.test(to) ? to : fin.name;
    let argText = "";
    const a = args[0];
    if (a) {
      const obj = isP(J, a[0], "{") && J.match[a[0]] === a[1] - 1;
      const params = opts.params[fin.name] ?? [];
      argText = ", " + (obj ? "" : "/* migrate: a positional argument: port-server makes " + fin.name + "(" + params.join(", ") + ") take one object" + (params.length === 1 ? " p (p." + params[0] + ")" : "") + "; pass that object here then */ ") + sub(a);
    }
    const ok = withs.get("withSuccessHandler");
    const bad = withs.get("withFailureHandler");
    const tail = ok && bad ? ".then(" + sub(ok) + ", " + sub(bad) + ")" : ok ? ".then(" + sub(ok) + ")" : bad ? ".catch(" + sub(bad) + ")" : "";
    edits.push({ start: /** @type {any} */ (J.toks[k]).start, end: /** @type {any} */ (J.toks[fin.close]).end, text: "call(" + JSON.stringify(name) + argText + ")" + tail });
    floor = fin.close;
  }
  return { text: applyEdits(code, edits), converted, bailed };
}

/**
 * The gsr-to-call rewrite of one page: each inline script whose chains convert becomes a module
 * that imports call.
 * @param {string} text
 * @param {{ rpc: Record<string, unknown>, params: Record<string, string[]> }} opts
 */
export function gsrPage(text, opts) {
  const scan = scanTags(text);
  /** @type {Edit[]} */
  const edits = [];
  /** @type {string[]} */
  const converted = [];
  /** @type {{ line: number, reason: string }[]} */
  const bailed = [];
  /** @type {string[]} */
  const notes = [];
  for (const r of scan.raws) {
    if (r.tag.name !== "script" || r.tag.attrs.some((a) => a.name === "src")) continue;
    const body = text.slice(r.contentStart, r.contentEnd);
    const line0 = text.slice(0, r.contentStart).split("\n").length - 1;
    const res = gsrToCall(body, opts);
    bailed.push(...res.bailed.map((b) => ({ line: b.line + line0, reason: b.reason })));
    if (!res.converted.length) {
      if (res.text !== body) edits.push({ start: r.contentStart, end: r.contentEnd, text: res.text });
      continue;
    }
    let tagEdit;
    try {
      tagEdit = moduleTag(text, r.tag);
    } catch (e) {
      notes.push("the script at line " + (line0 + 1) + " cannot become a module (" + /** @type {Error} */ (e).message + "), so its google.script.run calls stay");
      continue;
    }
    converted.push(...res.converted);
    edits.push({ start: r.contentStart, end: r.contentEnd, text: moduleBody(res.text, TEMPLATES["importCall"] ?? "") });
    if (tagEdit) edits.push(tagEdit);
  }
  return { text: applyEdits(text, edits), converted, bailed, notes };
}

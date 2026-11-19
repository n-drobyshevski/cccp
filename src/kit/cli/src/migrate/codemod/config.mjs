// What the el()-builder config carries read from tokens, never run: the literal values of an object
// literal (const MANIFEST = {...}, PAGES, ROUTE_ALIASES), the five brand colours of an app's
// tokens.css mapped onto the kit's brand contract, the template's brand.css text, and the edits
// that move a product name or a storage prefix from the value create wrote to the carried one in
// every place create wrote it (so the target's own consistency tests stay green).
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { contrast, deriveBrand, mix, pickInk } from "../../color.mjs";
import { tokenizeJs } from "../scan/js.mjs";
import { analyze, isId, isP, isStr, splitArgs, strOf } from "./js.mjs";

/** @typedef {{ accent: string, accentInk: string, accentSoft: string, mark: string, markInk: string }} BrandTokens */
/** @typedef {{ light: BrandTokens, dark: BrandTokens }} Brand */

/**
 * The entries of the object literal bound by `const <name> = {...}` at the top level: literal
 * values as they are (strings, numbers, booleans, null), a bare identifier value as { ref: name },
 * anything else listed in skipped. A value that is an object literal is also read one level down into
 * objects (its entries with a string or a bare identifier value); order holds every key in source
 * order. Null when there is no such literal.
 * @param {string} text @param {string} name
 * @returns {{ values: Record<string, string | number | boolean | null | { ref: string }>, skipped: string[], objects: Record<string, Record<string, string | { ref: string }>>, order: string[], line: number } | null}
 */
export function readObjectLiteral(text, name) {
  const J = analyze(text);
  for (let k = 0; k < J.toks.length; k++) {
    if (!isId(J, k, name) || J.depth[k] !== 0 || !isP(J, k + 1, "=") || !isP(J, k + 2, "{")) continue;
    if (!(isId(J, k - 1, "const") || isId(J, k - 1, "let") || isId(J, k - 1, "var"))) continue;
    /** @type {Record<string, string | number | boolean | null | { ref: string }>} */
    const values = {};
    /** @type {string[]} */
    const skipped = [];
    /** @type {Record<string, Record<string, string | { ref: string }>>} */
    const objects = {};
    /** @type {string[]} */
    const order = [];
    for (const [s, e] of splitArgs(J, k + 2)) {
      const key = isId(J, s) ? J.toks[s]?.value : J.toks[s]?.type === "string" ? strOf(J, s) : null;
      if (!key || ["__proto__", "constructor", "prototype"].includes(key)) {
        skipped.push(J.text.slice(J.toks[s]?.start ?? 0, J.toks[e - 1]?.end ?? 0).slice(0, 40));
        continue;
      }
      order.push(key);
      if (e - s === 1 && isId(J, s)) {
        values[key] = { ref: key };
        continue;
      }
      if (isP(J, s + 1, ":") && isP(J, s + 2, "{") && isP(J, e - 1, "}")) {
        // a nested object: its direct entries with a bare identifier or a string value
        /** @type {Record<string, string | { ref: string }>} */
        const inner = {};
        for (const [is, ie] of splitArgs(J, s + 2)) {
          const ik = isId(J, is) ? J.toks[is]?.value : isStr(J, is) ? strOf(J, is) : null;
          if (!ik || ie - is !== 3 || !isP(J, is + 1, ":")) continue;
          if (isStr(J, is + 2)) inner[ik] = strOf(J, is + 2);
          else if (isId(J, is + 2) && !["true", "false", "null"].includes(J.toks[is + 2]?.value ?? "")) inner[ik] = { ref: /** @type {string} */ (J.toks[is + 2]?.value) };
        }
        objects[key] = inner;
        skipped.push(key);
        continue;
      }
      if (!isP(J, s + 1, ":") || e - s !== 3) {
        skipped.push(key);
        continue;
      }
      const v = s + 2;
      const t = J.toks[v];
      if (isStr(J, v)) values[key] = strOf(J, v);
      else if (t?.type === "number" && Number.isFinite(Number(t.value))) values[key] = Number(t.value);
      else if (isId(J, v, "true") || isId(J, v, "false")) values[key] = t?.value === "true";
      else if (isId(J, v, "null")) values[key] = null;
      else if (isId(J, v)) values[key] = { ref: /** @type {string} */ (t?.value) };
      else skipped.push(key);
    }
    return { values, skipped, objects, order, line: J.toks[k]?.line ?? 0 };
  }
  return null;
}

/**
 * The route table of an el()-builder app: PAGES keys (with the page function each names) and
 * ROUTE_ALIASES, read from whichever file of the list declares them.
 * @param {{ key: string, text: string }[]} files
 * @returns {{ pages: { name: string, fn: string | null }[], aliases: Record<string, string>, from: string | null }}
 */
export function readRouteTable(files) {
  for (const f of files) {
    const p = readObjectLiteral(f.text, "PAGES");
    if (!p) continue;
    // A page is name: renderFn, or name: { title, render: renderFn, ... } (the function under render,
    // view or page, else the only bare identifier the entry holds); source order either way.
    /** @param {Record<string, string | { ref: string }>} o */
    const fnOf = (o) => {
      for (const k of ["render", "view", "page"]) {
        const v = o[k];
        if (v && typeof v === "object") return v.ref;
      }
      const refs = Object.values(o).filter((v) => v && typeof v === "object");
      return refs.length === 1 ? /** @type {{ ref: string }} */ (refs[0]).ref : null;
    };
    const pages = p.order.filter((name) => name in p.values || name in p.objects).map((name) => {
      const v = p.values[name];
      if (v !== undefined) return { name, fn: v && typeof v === "object" ? v.ref : null };
      return { name, fn: fnOf(/** @type {Record<string, string | { ref: string }>} */ (p.objects[name])) };
    });
    const a = readObjectLiteral(f.text, "ROUTE_ALIASES") ?? files.map((g) => readObjectLiteral(g.text, "ROUTE_ALIASES")).find(Boolean) ?? null;
    /** @type {Record<string, string>} */
    const aliases = {};
    for (const [k, v] of Object.entries(a?.values ?? {})) if (typeof v === "string") aliases[k] = v;
    return { pages, aliases, from: f.key };
  }
  return { pages: [], aliases: {}, from: null };
}

/**
 * The kit routes of a route table: "#/<page>" to "/<page>", "#/<alias>" to "/<target>". A path
 * segment is kept only when it is a plain name.
 * @param {{ pages: { name: string }[], aliases: Record<string, string> }} table
 * @returns {Record<string, string>}
 */
export function hashRouteMap(table) {
  /** @type {Record<string, string>} */
  const out = {};
  const ok = (/** @type {string} */ s) => /^[A-Za-z0-9_-]+$/.test(s);
  for (const p of table.pages) if (ok(p.name)) out["#/" + p.name] = "/" + p.name;
  for (const [a, to] of Object.entries(table.aliases)) if (ok(a) && ok(to)) out["#/" + a] = "/" + to;
  return out;
}

/**
 * Merge seeds into a plan map without overriding a person's edit: a key is set when it is absent
 * or still holds the value the plan seeded it with.
 * @param {Record<string, unknown> | undefined} current @param {Record<string, string>} want
 * @param {(key: string) => unknown} seed what the plan seeded a key with
 */
export function mergeSeeded(current, want, seed) {
  /** @type {Record<string, string>} */
  const out = {};
  /** @type {string[]} */
  const kept = [];
  for (const [k, v] of Object.entries(want)) {
    const had = current?.[k];
    if (had === undefined || had === seed(k) || had === v) out[k] = v;
    else kept.push(k);
  }
  return { out, kept };
}

/** #rgb or #rrggbb in lower case and six digits, or null. @param {string} v */
export function hex6(v) {
  const s = v.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + [...s.slice(1)].map((c) => c + c).join("");
  return null;
}

/**
 * The kit brand from the five el()-builder brand tokens. --accent is the brand accent (or
 * --accent-text, then a darker accent, when it is not readable as text on white, as the kit
 * requires); --on-accent its ink when that is readable on it; the soft tint is derived (the
 * source has no fill token); the mark is the accent. Dark is derived with deriveBrand.
 * @param {Record<string, string>} tokens custom property name to value (light, :root)
 * @returns {{ brand: Brand | null, notes: string[] }}
 */
export function brandFromTokens(tokens) {
  /** @type {string[]} */
  const notes = [];
  const accent0 = tokens["--accent"] !== undefined ? hex6(tokens["--accent"]) : null;
  if (!accent0) return { brand: null, notes: ["no #rrggbb --accent in the source tokens: the brand create derived stays"] };
  let accent = accent0;
  if (contrast(accent, "#ffffff") < 4.5) {
    const text = tokens["--accent-text"] !== undefined ? hex6(tokens["--accent-text"]) : null;
    accent = text && contrast(text, "#ffffff") >= 4.5 ? text : deriveBrand(accent0).light.accent;
    notes.push("--accent " + accent0 + " is under 4.5:1 on white, so the kit accent is " + accent + (text === accent ? " (--accent-text)" : " (darkened)"));
  }
  const on = tokens["--on-accent"] !== undefined ? hex6(tokens["--on-accent"]) : null;
  let ink = on ?? pickInk(accent);
  if (contrast(ink, accent) < 4.5) {
    notes.push("--on-accent " + ink + " is under 4.5:1 on the accent; the ink is " + pickInk(accent));
    ink = pickInk(accent);
  }
  const light = { accent, accentInk: ink, accentSoft: mix(accent, "#ffffff", 0.875), mark: accent, markInk: ink };
  const rest = ["--accent-hover", "--accent-text", "--accent-edge"].filter((n) => tokens[n] !== undefined);
  if (rest.length) notes.push(rest.join(", ") + " have no slot in the kit brand: they stay legacy tokens");
  return { brand: { light, dark: /** @type {BrandTokens} */ (/** @type {unknown} */ (deriveBrand(accent).dark)) }, notes };
}

/** @param {BrandTokens} t @param {string} pad */
function tokenLines(t, pad) {
  return [
    pad + "--brand-accent: " + t.accent + ";",
    pad + "--brand-accent-ink: " + t.accentInk + ";",
    pad + "--brand-accent-soft: " + t.accentSoft + ";",
    pad + "--brand-mark: " + t.mark + ";",
    pad + "--brand-mark-ink: " + t.markInk + ";",
  ].join("\n");
}

/**
 * The template's brand.css for a brand, byte for byte what templates/register/tools/brandCss.mjs
 * renders (a test holds the two equal): the CLI never imports the target's copy.
 * @param {Brand} brand
 */
export function renderBrandCss(brand) {
  return [
    "/* Generated from app.config.mjs by tools/brandCss.mjs: edit the config, not this file.",
    "   The five brand tokens; tokens.base.css maps --accent and --mark to them. */",
    ":root {",
    tokenLines(brand.light, "  "),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root:not([data-theme=\"light\"]) {",
    tokenLines(brand.dark, "    "),
    "  }",
    "}",
    "",
    ":root[data-theme=\"dark\"] {",
    tokenLines(brand.dark, "  "),
    "}",
    "",
  ].join("\n");
}

/** The app.config.mjs brand line, as create writes it. @param {BrandTokens} t */
export function brandLine(t) {
  const q = JSON.stringify;
  return "{ accent: " + q(t.accent) + ", accentInk: " + q(t.accentInk) + ", accentSoft: " + q(t.accentSoft) + ", mark: " + q(t.mark) + ", markInk: " + q(t.markInk) + " }";
}

/**
 * The text files below a target directory (relative, posix), never through a symlink.
 * @param {string} root @param {string} dir
 */
export function targetFiles(root, dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} rel */
  const go = (rel) => {
    let names;
    try {
      if (!lstatSync(join(root, ...rel.split("/"))).isDirectory()) return;
      names = readdirSync(join(root, ...rel.split("/"))).sort();
    } catch {
      return;
    }
    for (const n of names) {
      const sub = rel + "/" + n;
      const st = lstatSync(join(root, ...sub.split("/")));
      if (st.isSymbolicLink() || n === "node_modules") continue;
      if (st.isDirectory()) go(sub);
      else if (st.isFile()) out.push(sub);
    }
  };
  go(dir);
  return out;
}

/** @param {string} s */
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Move a product name from the value create wrote to a new one, in every place create wrote it.
 * @param {import("../apply.mjs").StepContext} ctx @param {string} from @param {string} to
 */
export function carryProduct(ctx, from, to) {
  const q = JSON.stringify;
  ctx.patchTarget("app.config.mjs", new RegExp("^(\\s*product: )" + reEsc(q(from)) + ",", "m"), (_m, a) => a + q(to) + ",");
  if (new RegExp("^\\s*name: " + reEsc(q(from)) + ",", "m").test(ctx.readTarget("app.config.mjs") ?? "")) ctx.patchTarget("app.config.mjs", new RegExp("^(\\s*name: )" + reEsc(q(from)) + ",", "m"), (_m, a) => a + q(to) + ",");
  ctx.patchTarget("src/server/config.ts", /^(export const PRODUCT = )"[^"]*";/m, (_m, a) => a + q(to) + ";");
  ctx.patchTarget("src/client/config.js", /^(export const PRODUCT = )"[^"]*";/m, (_m, a) => a + q(to) + ";");
  ctx.patchTarget("src/client/index.html", /<title>[^<]*<\/title>/, () => "<title>" + to + "</title>");
  ctx.patchTarget("src/client/index.html", /(<b class="boot__name">)[^<]*(<\/b>)/, (_m, a, b) => a + to + b);
  // In the tests only inside quoted string literals, where create wrote it: from may be a short
  // title made from the folder name ("App"), which also occurs in code (useApp), and to is source
  // data, so a replacement anywhere else would write that data into test code npm run check runs.
  for (const rel of targetFiles(ctx.target, "test").filter((f) => /\.(?:m?[jt]s)$/.test(f))) {
    const t = ctx.readTarget(rel);
    if (t === null || !t.includes(from)) continue;
    const next = replaceInStrings(t, from, to);
    if (next !== t) ctx.out.write(rel, next);
  }
  const readme = ctx.readTarget("README.md");
  // Whole words only: a short from ("App") is also part of other words ("Apps Script").
  const word = new RegExp("(?<![\\w-])" + reEsc(from) + "(?![\\w-])", "g");
  if (readme !== null && word.test(readme)) ctx.out.write("README.md", readme.replace(word, () => to));
}

/**
 * Replace from with to inside the single- and double-quoted string literals of a script, and nowhere
 * else: not in code, a comment, a regex or a template literal (where a "${" in to would open an
 * expression). The caller keeps quotes, backslashes and control characters out of to
 * (checkProduct), so the replacement cannot end the literal it sits in.
 * @param {string} text @param {string} from @param {string} to
 */
export function replaceInStrings(text, from, to) {
  if (!from) return text;
  let out = "";
  let at = 0;
  for (const t of tokenizeJs(text)) {
    if (t.type !== "string" || !t.value.includes(from)) continue;
    out += text.slice(at, t.start) + t.value.split(from).join(to);
    at = t.end;
  }
  return out + text.slice(at);
}

/**
 * Move a storage prefix from the value create wrote to a new one, in every place create wrote it.
 * @param {import("../apply.mjs").StepContext} ctx @param {string} from @param {string} to
 */
export function carryPrefix(ctx, from, to) {
  const q = JSON.stringify;
  ctx.patchTarget("app.config.mjs", /^(\s*storagePrefix: )"[^"]*",/m, (_m, a) => a + q(to) + ",");
  ctx.patchTarget("src/server/config.ts", /^(export const CACHE_PREFIX = )"[^"]*";/m, (_m, a) => a + q(to.slice(0, -1)) + ";");
  ctx.patchTarget("src/client/config.js", /^(export const PREFIX = )"[^"]*";/m, (_m, a) => a + q(to) + ";");
  ctx.patchTarget("src/client/index.html", /localStorage\.getItem\("[^"]*\.theme"\)/, () => 'localStorage.getItem("' + to + 'theme")');
  ctx.patchTarget("src/client/index.html", /localStorage\.getItem\("[^"]*\.motion"\)/, () => 'localStorage.getItem("' + to + 'motion")');
  const readme = ctx.readTarget("README.md");
  if (readme !== null && readme.includes("`" + from + "`")) ctx.out.write("README.md", readme.split("`" + from + "`").join("`" + to + "`"));
}

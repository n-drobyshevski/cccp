// The css-import step: every source stylesheet that has rules to keep (a css file, or the <style> text of
// an html file) goes to src/client/styles/legacy/<name>.css with its colour literals replaced by the
// --legacy-cN tokens the tokens step named, its theme custom properties left to legacy-tokens.css, and
// everything that points outside the app removed and reported (an external @import, a url() with a
// double slash or http). Every rule is scoped to html[data-legacy] at no added specificity (scopeLegacy),
// so the old element rules (body, button, h1) apply only while the routes step marks a migrated route
// on <html>, never on the kit's own pages. It fails closed: a stylesheet the scoper cannot vouch for
// (one a browser would read with error recovery, an @scope or other unknown block, a nested selector
// that can leave its parent, an escape that stands for "<", or an output that does not pass the
// scoper's own re-check) is not ported and stays in .migrate/pending with a note. The target's index.css then declares the layers, imports the
// kit and brand.css into layer(kit), legacy-tokens.css right after brand.css in the same layer (so its
// values override the kit's tokens: later wins within a layer), and each legacy file into layer(legacy),
// before app.css, which stays unlayered. Unlayered CSS beats layered CSS, so the app's own new styles win
// over the old ones, and the old ones lose only to nothing of the kit's.
// preserve also writes legacy/_ua.css into layer(legacy-ua), between kit and legacy: the source's CSS was
// written against the browser's defaults, which the kit's base.css resets, so it sets back to revert,
// under the legacy attribute, at zero specificity and never on the kit's own markup, every property the
// kit's element rules set (uaRevert reads them from the vendored kit, so it follows the kit).
import { guardCss } from "../../../../tooling/src/build/guards.mjs";
import { cssHeader, drift, legacyName, pendingPath } from "./_common.mjs";
import { LEGACY_ATTR, colourTokens, cssOrder, cssProblems, cssSources, dropOutside, escapedLt, hasPortableRules, kitExclusion, noDoubleSlash, replaceColours, resolveCss, scopeLegacy, stripRootDefines, uaRevert, unscopedRules } from "./_css.mjs";

const INDEX = "src/client/styles/index.css";
const CONFIG = "app.config.mjs";
/** The css cap in app.config.mjs build.budgets, as the template writes it. */
const BUDGET = /(\bbudgets:\s*\{[^}]*?\bcss:\s*)(\d[\d_]*)/;
const DIR = "src/client/styles/legacy/";
const SECTION = /(?:@layer kit,(?: legacy-ua,)? legacy;\s*)?@import "@gas-kit\/ui\/styles\/tokens\.base\.css"[\s\S]*?@import "\.\/app\.css";/;
const TOKENS_LINE = '@import "./legacy-tokens.css" layer(kit);';
/** An HTML end tag for style, in any case: what would end the inlined stylesheet early. */
export const STYLE_CLOSE = /<\/style/i;
/** The UA revert file, preserve only; no ported name starts with an underscore (legacyName). */
const UA = "_ua";
/** The kit's base stylesheets the UA revert reads, in the target. */
const KIT_BASE = ["src/kit/ui/src/styles/tokens.base.css", "src/kit/ui/src/styles/base.css"];
/** Stems a ported stylesheet never takes: the token files' names (older targets exempted them by suffix). */
const EXEMPT_STEM = /(?:brand|legacy-tokens)$/;

/**
 * The app config with its CSS budget raised to hold the ported stylesheets: the template's cap plus
 * their bytes, rounded up to 10 kB. Null when the config has no css budget line or it is already high
 * enough. Idempotent: on a config this already raised, the cap holds the bytes and nothing changes.
 * @param {string | null} config
 * @param {number} legacyBytes
 * @param {number} [templateCap] the cap the template ships (what the kit's own CSS was measured against)
 * @returns {{ text: string, from: number, to: number } | null}
 */
export function raiseCssBudget(config, legacyBytes, templateCap = 100_000) {
  if (!config || !legacyBytes) return null;
  const m = BUDGET.exec(config);
  if (!m) return null;
  const from = Number(String(m[2]).replace(/_/g, ""));
  const to = Math.ceil((templateCap + legacyBytes) / 10_000) * 10_000;
  if (!Number.isFinite(from) || from >= to) return null;
  const digits = String(to).replace(/\B(?=(\d{3})+$)/g, "_");
  return { text: config.replace(BUDGET, (_x, a) => a + digits), from, to };
}

/**
 * The import section of index.css, layered. Idempotent: run on its own output it returns it.
 * @param {string} section the text from the tokens.base import to the app.css import
 * @param {string[]} names the legacy files, in order (without extension)
 * @param {{ ua?: boolean }} [opts] ua: import legacy/_ua.css into layer(legacy-ua) (preserve)
 */
export function layerSection(section, names, { ua = false } = {}) {
  /** @type {string[]} */
  const out = [ua ? "@layer kit, legacy-ua, legacy;" : "@layer kit, legacy;"];
  let tokens = false;
  for (const raw of section.split("\n")) {
    const line = raw.trim();
    if (/^@layer\s+kit\s*,(?:\s*legacy-ua\s*,)?\s*legacy\s*;$/.test(line)) continue;
    if (/^@import\s+"\.\/legacy-tokens\.css"/.test(line) || /^@import\s+"\.\/legacy\//.test(line)) continue;
    const m = /^@import\s+"(@gas-kit\/[^"]+|\.\/brand\.css)"(?:\s+layer\([^)]*\))?\s*;(.*)$/.exec(line);
    if (m) {
      out.push('@import "' + m[1] + '" layer(kit);' + (m[2] ?? ""));
      if (m[1] === "./brand.css") {
        out.push(TOKENS_LINE);
        tokens = true;
      }
      continue;
    }
    if (/^@import\s+"\.\/app\.css"\s*;/.test(line)) {
      if (!tokens) out.push(TOKENS_LINE);
      if (ua) out.push('@import "./legacy/' + UA + '.css" layer(legacy-ua);');
      for (const n of names) out.push('@import "./legacy/' + n + '.css" layer(legacy);');
      out.push(line);
      continue;
    }
    out.push(raw);
  }
  return out.join("\n");
}

/**
 * The text of legacy/_ua.css, from the kit the target vendors and the component stylesheets its
 * index.css imports.
 * @param {import("../apply.mjs").StepContext} ctx
 * @returns {{ text: string, notes: string[] }}
 */
export function buildUa(ctx) {
  const index = ctx.readTarget(INDEX) ?? "";
  const kit = KIT_BASE.map((rel) => {
    const css = ctx.readTarget(rel);
    if (css === null) drift("css-import", rel + " is missing");
    return { label: rel.split("/").pop() ?? rel, css };
  });
  const imported = [...index.matchAll(/@import\s+"@gas-kit\/ui\/((?:components|blocks)\/[A-Za-z0-9_-]+\.css)"/g)].map((m) => "src/kit/ui/src/" + m[1]);
  const parts = imported.flatMap((rel) => {
    const css = ctx.readTarget(rel);
    return css === null ? [] : [css];
  });
  const { css, skipped } = uaRevert(kit, kitExclusion(parts));
  const text =
    cssHeader("css-import", "the kit's tokens.base.css and base.css") +
    "/* preserve: the browser's own styles back for the migrated pages. Each rule sets to revert what an element rule\n" +
    "   of the kit's base sets, only while <html> carries " + LEGACY_ATTR + ", at zero specificity and never on the kit's own\n" +
    "   markup (a gk- class, or a class the kit's stylesheets style on its own). Its layer sits after kit and before\n" +
    "   legacy, so the source's own rules always win over it. Regenerated by css-import: edit app.css instead. */\n" +
    css;
  return { text, notes: skipped.map((s) => "_ua.css: not reverted, " + s) };
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const sources = cssSources(ctx);
  const files = cssOrder(ctx, sources);
  const cssKeys = new Set(files);
  const ordered = [...files.map((k) => /** @type {NonNullable<typeof sources[number]>} */ (sources.find((s) => s.key === k))), ...sources.filter((s) => s.inline)];
  const { map } = colourTokens(sources);
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const names = [];
  /** @type {Set<string>} */
  const used = new Set();
  let legacyBytes = 0;
  let consumed = 0;
  for (const s of ordered) {
    /** A stylesheet that is not ported stays in .migrate/pending (an html file's stays for its page steps). */
    const refuse = (/** @type {string} */ why) => notes.push(s.key + ": " + why + "; not ported" + (s.inline ? "" : ", left in " + pendingPath(s.key)));
    // The build inlines the stylesheet in a <style> element, and esbuild keeps a "</style" outside a
    // string as written (in a selector or a value): it would close the element and make the rest
    // markup. It also writes an escape that stands for "<" (\3c, \00003c, \<) back as a bare "<"
    // outside strings, so "\3c/style" closes it too. Such a stylesheet is not ported.
    if (STYLE_CLOSE.test(s.css)) {
      refuse("holds </style, which would close the page's <style> element");
      continue;
    }
    const lt = escapedLt(s.css);
    if (lt.length) {
      refuse("holds an escape that stands for < (" + lt[0] + "), which the build writes back as a bare <, so it could close the page's <style> element");
      continue;
    }
    // Scoping reads blocks as a browser does only in a well-formed stylesheet: one a browser would
    // recover from (an escaped brace, a brace inside parentheses, a block left open) is not ported.
    const broken = cssProblems(s.css);
    if (broken.length) {
      refuse("cannot be scoped to " + LEGACY_ATTR + " safely (" + broken.slice(0, 3).join("; ") + (broken.length > 3 ? "; ..." : "") + ")");
      continue;
    }
    if (!hasPortableRules(s.css)) {
      if (!s.inline) ctx.out.remove(pendingPath(s.key));
      consumed++;
      continue;
    }
    /** @type {string[]} */
    const mine = [];
    const dropped = dropOutside(stripRootDefines(s.css), (spec) => {
      const k = resolveCss(ctx.tree, s.key, spec);
      if (!k || !cssKeys.has(k)) mine.push(s.key + ": @import " + spec.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").slice(0, 80) + " is not a stylesheet of the source and was dropped");
      return "";
    });
    for (const r of dropped.removed) mine.push(s.key + ": removed " + r);
    // Fail closed: what the scoper cannot vouch for, or an output its own check does not pass, is
    // not ported. The check runs again on the final text (after the middlebox edit), as written.
    const scoped = scopeLegacy(replaceColours(dropped.css, map));
    const out = cssHeader("css-import", s.key.replace(/\*\//g, "")) + noDoubleSlash(scoped.css).replace(/\n{3,}/g, "\n\n").trim() + "\n";
    const refused = scoped.refused.length ? scoped.refused : unscopedRules(out);
    if (refused.length) {
      refuse("cannot be scoped to " + LEGACY_ATTR + " safely (" + refused.slice(0, 3).join("; ") + (refused.length > 3 ? "; ..." : "") + ")");
      continue;
    }
    if (!s.inline) ctx.out.remove(pendingPath(s.key));
    notes.push(...mine);
    if (scoped.kept.length) notes.push(s.key + ": " + scoped.kept.join(", ") + " kept as written: " + (scoped.kept.length === 1 ? "it is" : "they are") + " global, so a name the kit also uses (a font family, a keyframes name, a custom property) changes the kit's pages too");
    // The target's colour contract exempts the two token files by exact path; a ported stylesheet still
    // never takes their names, so a target whose contract predates that (by suffix) stays safe too.
    const base = EXEMPT_STEM.test(legacyName(s.key)) ? legacyName(s.key) + "-sheet" : legacyName(s.key);
    let name = base;
    for (let i = 2; used.has(name); i++) name = base + "-" + i;
    used.add(name);
    guardCss(DIR + name + ".css", out);
    ctx.out.write(DIR + name + ".css", out);
    legacyBytes += Buffer.byteLength(out);
    names.push(name);
  }
  const skippedInline = /** @type {string[] | undefined} */ (sources.skippedInline) ?? [];
  for (const k of skippedInline) notes.push(k + ": the <style> holds a scriptlet and is left to the classic page steps");
  for (const k of sources.skippedBuilt ?? []) notes.push(k + ": a build output (its <style> is built from the source's css files, which are ported instead); not ported");
  if (consumed) notes.push(consumed + " stylesheet" + (consumed === 1 ? " holds" : "s hold") + " only theme custom properties or @imports: carried by legacy-tokens.css, no legacy file");

  if (ctx.readTarget(INDEX) === null) drift("css-import", INDEX + " is missing");
  const ua = ctx.fidelity === "preserve";
  if (ua) {
    const built = buildUa(ctx);
    guardCss(DIR + UA + ".css", built.text);
    ctx.out.write(DIR + UA + ".css", built.text);
    legacyBytes += Buffer.byteLength(built.text);
    notes.push(...built.notes);
    notes.push("preserve: legacy/_ua.css (layer legacy-ua) sets back the browser's defaults that the kit's base resets, color-scheme included, while " + LEGACY_ATTR + " is on <html>; a color-scheme the source sets itself wins");
  }
  ctx.patchTarget(INDEX, SECTION, (m) => layerSection(m, names, { ua }));
  const budget = raiseCssBudget(ctx.readTarget(CONFIG), legacyBytes);
  if (budget) {
    ctx.out.write(CONFIG, budget.text);
    notes.push("build.budgets.css in " + CONFIG + " raised from " + budget.from + " to " + budget.to + " bytes: the template's cap holds the kit's own CSS, and the ported stylesheets add " + legacyBytes + " bytes before minifying (the build fails above the cap, so a person may lower it once the build shows the real size)");
  } else if (legacyBytes && ctx.readTarget(CONFIG) !== null && !BUDGET.test(ctx.readTarget(CONFIG) ?? "")) notes.push(CONFIG + " has no build.budgets.css line: raise the CSS budget by hand if the build reports it over");
  notes.push("the ported rules apply only while <html> carries " + LEGACY_ATTR + " (the routes step sets it on a migrated route): the kit's own pages keep the kit's look");
  return { notes };
}

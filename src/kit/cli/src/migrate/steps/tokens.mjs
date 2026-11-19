// The tokens step: every custom property the source defines in a theme block (:root, the dark media
// block, [data-theme="dark"]) goes to src/client/styles/legacy-tokens.css, the one colour file besides
// brand.css that an app may have. preserve: a mapped old name overrides the kit token with the source's
// value and the old name becomes an alias of it; reskin: the alias only, the kit keeps its look. Names
// the map does not know keep their own value. Every colour literal of the source stylesheets that
// css-import ports is named --legacy-cN here (and the value-to-name map is recorded in maps.colours).
// Each dark block (the prefers-color-scheme media block and [data-theme="dark"]) repeats every name with
// its dark value, or in preserve its light one when the source has none, so the kit's dark blocks never
// mix into the old look. The file may hold nothing but custom properties in those blocks: the
// tokenFileShape contract, which this step registers in the target's contracts test, pins it. The
// exemption of the file (by its exact path) from the colour contract is a guard-list change, safe
// because of that pin.
import { cssHeader, drift } from "./_common.mjs";
import { colourTokens, cssOrder, cssSources, rootDefines } from "./_css.mjs";

const OUT = "src/client/styles/legacy-tokens.css";
const CONTRACTS = "test/contracts.test.ts";
const KIT_TOKENS = "src/kit/ui/src/styles/tokens.base.css";
// A "<" is refused too: esbuild keeps a custom property value as written, so "</style>" in one would
// close the page's <style> element and turn the rest of the value into markup. No token needs it.
const BAD_VALUE = /url\s*\(|@import|expression\s*\(|\\|[{}<]|\/\//i;
const NAME = /^--[A-Za-z0-9_-]+$/;

/** @param {string} s */
const clean = (s) => s.replace(/\*\//g, "").replace(/[\r\n]+/g, " ");

/** The names the kit's tokens.base.css defines, or null when the file cannot be read. @param {import("../apply.mjs").StepContext} ctx */
function kitTokenNames(ctx) {
  const text = ctx.readTarget(KIT_TOKENS);
  if (text === null) return null;
  return new Set([...text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => /** @type {string} */ (m[1])));
}

/**
 * The token file text.
 * @param {import("../apply.mjs").StepContext} ctx
 * @returns {{ text: string, notes: string[], colours: Record<string, string> }}
 */
export function buildTokens(ctx) {
  const sources = cssSources(ctx);
  const files = cssOrder(ctx, sources);
  const ordered = [...files.map((k) => /** @type {NonNullable<typeof sources[number]>} */ (sources.find((s) => s.key === k))), ...sources.filter((s) => s.inline)];
  /** @type {string[]} */
  const notes = [];
  /** @type {Record<string, Map<string, string>>} */
  const blocks = { light: new Map(), mediaDark: new Map(), dark: new Map() };
  /** @type {Map<string, string>} first source key that defined a name */
  const fromKey = new Map();
  for (const s of ordered) {
    for (const d of rootDefines(s.css)) {
      if (!NAME.test(d.name) || !d.value) continue;
      if (BAD_VALUE.test(d.value)) {
        notes.push(s.key + ":" + d.line + ": " + d.name + " left out (its value holds url(), a brace, a backslash, a < or a double slash; a token file takes plain values)");
        continue;
      }
      /** @type {Map<string, string>} */ (blocks[d.block]).set(d.name, d.value);
      if (!fromKey.has(d.name)) fromKey.set(d.name, s.key);
    }
  }
  const defined = new Set([...fromKey.keys()]);
  const kit = kitTokenNames(ctx);
  const preserve = ctx.fidelity === "preserve";
  /** @type {Record<string, string>} */
  const mapped = ctx.plan.maps.tokens ?? {};
  /** old name -> kit name, for the pairs this run honours */
  /** @type {Map<string, string>} */
  const pairs = new Map();
  // A kit token two or more old names stand for is ambiguous: none of them overrides it (they keep their
  // own values, which the legacy CSS reads), and the note says how to pick one.
  /** @type {Map<string, string[]>} */
  const byKit = new Map();
  for (const old of defined) {
    const kitName = mapped[old];
    if (typeof kitName !== "string") continue;
    if (!NAME.test(kitName) || (kit && !kit.has(kitName))) {
      notes.push(old + " is mapped to " + clean(String(kitName)) + ", which is not a kit token: it keeps its own value");
      continue;
    }
    byKit.set(kitName, [...(byKit.get(kitName) ?? []), old]);
  }
  for (const [kitName, olds] of byKit) {
    if (olds.length === 1) pairs.set(/** @type {string} */ (olds[0]), kitName);
    else notes.push(olds.join(", ") + " all map to " + kitName + ": none of them overrides it (drop all but one from maps.tokens to pick)");
  }

  const { map, values } = colourTokens(sources);
  /** @type {Record<"light" | "mediaDark" | "dark", string[]>} */
  const lines = { light: [], mediaDark: [], dark: [] };
  /** @param {string} name @param {string} value */
  const line = (name, value) => {
    const kitName = pairs.get(name);
    if (kitName === undefined) return name + ": " + value + ";";
    return preserve ? kitName + ": " + value + ";" : null;
  };
  const colourLines = Object.entries(values).map(([name, value]) => name + ": " + value + ";");
  const aliasLines = [...pairs].filter(([old, kitName]) => old !== kitName).map(([old, kitName]) => old + ": var(" + kitName + ");");
  lines.light.push(...colourLines);
  for (const [name, value] of blocks.light ?? []) {
    const l = line(name, value);
    if (l) lines.light.push(l);
  }
  lines.light.push(...aliasLines);
  // The dark blocks. The kit's tokens.base.css and brand.css redefine their tokens in both dark blocks,
  // which outrank :root, so an override written for light alone would give way to the kit's dark value
  // while an unmapped old name kept its light one: an unreadable mix. So each dark block carries every
  // name: the source's dark value (from either dark block) where it has one, else (preserve) its light
  // value, the overrides, aliases and --legacy-cN included. A light-only source thus keeps its light
  // look in both schemes; the dark-mode step decides whether to design a dark one.
  const darkSource = new Map([...(blocks.mediaDark ?? []), ...(blocks.dark ?? [])]);
  const names = [...new Set([...(blocks.light ?? new Map()).keys(), ...darkSource.keys()])];
  for (const b of /** @type {const} */ (["mediaDark", "dark"])) {
    const other = b === "dark" ? "mediaDark" : "dark";
    if (preserve) lines[b].push(...colourLines);
    for (const name of names) {
      const v = blocks[b]?.get(name) ?? blocks[other]?.get(name) ?? (preserve ? blocks.light?.get(name) : undefined);
      if (v === undefined) continue;
      const l = line(name, v);
      if (l) lines[b].push(l);
    }
    if (preserve) lines[b].push(...aliasLines);
  }
  if (!preserve && pairs.size) notes.push("reskin: " + pairs.size + " old token name" + (pairs.size === 1 ? "" : "s") + " alias the kit's tokens; the kit keeps its values");
  if (darkSource.size) {
    notes.push(
      "dark: the source's dark values are written to both dark blocks (the prefers-color-scheme media block and [data-theme=\"dark\"])" +
        (preserve ? ", the overrides of kit tokens included; a name with no dark value keeps its light value there" : "") +
        " (the dark-mode step reviews them)",
    );
  } else if (defined.size || colourLines.length) {
    notes.push(
      preserve
        ? "dark: the source defines no dark values, so its light values (overrides, aliases and --legacy-cN) are repeated in both dark blocks: the migrated pages keep the original's light look in either scheme, and so do the kit tokens they override, on the kit's own pages too. The dark-mode step decides whether to design a dark theme (the two dark blocks of legacy-tokens.css)"
        : "dark: the source defines no dark values: the kit's dark theme applies to the kit's tokens and the old names keep their light values (the dark-mode step reviews them)",
    );
  }

  /** @param {string[]} ls @param {string} pad */
  const body = (ls, pad) => ls.map((l) => pad + l + "\n").join("");
  const from = ordered.length ? clean(ordered.slice(0, 4).map((s) => s.key).join(", ")) + (ordered.length > 4 ? " and " + (ordered.length - 4) + " more" : "") : "no stylesheet";
  let text = cssHeader("tokens", from);
  text += "/* " + (preserve ? "preserve: a mapped old name overrides the kit token with the source value and aliases it" : "reskin: a mapped old name aliases the kit token, whose value stays") + "; the rest keep their value. --legacy-cN name the colours of the ported stylesheets. */\n";
  text += ":root {\n" + body(lines.light, "  ") + "}\n";
  if (lines.mediaDark.length) text += "@media (prefers-color-scheme: dark) {\n  :root:not([data-theme=\"light\"]) {\n" + body(lines.mediaDark, "    ") + "  }\n}\n";
  if (lines.dark.length) text += ":root[data-theme=\"dark\"] {\n" + body(lines.dark, "  ") + "}\n";
  const si = /** @type {string[] | undefined} */ (sources.skippedInline) ?? [];
  for (const k of si) notes.push(k + ": the <style> holds a scriptlet and is not read here (the classic page steps own it)");
  return { text, notes, colours: map };
}

const IMPORT_LINE = 'import * as viewerFreeCore from "@gas-kit/tooling/test/contracts/viewerFreeCore.js";';
const SHAPE_IMPORT = 'import * as tokenFileShape from "@gas-kit/tooling/test/contracts/tokenFileShape.js";';

const BRAND_EXEMPT = '.filter((f) => f !== join(SRC, "client/styles/brand.css"))';
const BOTH_EXEMPT = '.filter((f) => f !== join(SRC, "client/styles/brand.css") && f !== join(SRC, "client/styles/legacy-tokens.css"))';

/** Widen the target's contracts test: the exemption (by exact path) and the shape pin. @param {import("../apply.mjs").StepContext} ctx */
function patchContracts(ctx) {
  const text = ctx.readTarget(CONTRACTS);
  if (text === null) drift("tokens", CONTRACTS + " is missing");
  if (!text.includes(SHAPE_IMPORT)) ctx.patchTarget(CONTRACTS, IMPORT_LINE, (m) => SHAPE_IMPORT + "\n" + m);
  if (!text.includes("legacy-tokens.css")) {
    ctx.patchTarget(CONTRACTS, BRAND_EXEMPT, () => BOTH_EXEMPT);
    ctx.patchTarget(CONTRACTS, 'describe("no colour outside the tokens", () => {', (m) => m + "\n  // legacy-tokens.css is exempt by its exact path: it may hold colours only as custom properties, and tokenFileShape pins it (the block below).");
    ctx.patchTarget(
      CONTRACTS,
      'describe("no title attribute"',
      (m) =>
        'describe("token files keep to the token shape", () => {\n' +
        "  // legacy-tokens.css may hold colours only as custom properties: tokenFileShape pins brand.css and it to :root and the theme blocks.\n" +
        '  tokenFileShape.register(describe, it, expect, { files: [join(SRC, "client/styles/brand.css"), join(SRC, "client/styles/legacy-tokens.css")], minFiles: 2 });\n' +
        "});\n\n" +
        m,
    );
  }
}

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const { text, notes, colours } = buildTokens(ctx);
  ctx.out.write(OUT, text);
  patchContracts(ctx);
  return { notes, maps: { colours } };
}

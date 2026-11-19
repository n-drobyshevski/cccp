// The brand-carry step (el-builder): the five brand tokens of the app's tokens.css (--accent,
// --accent-hover, --accent-text, --accent-edge, --on-accent) become the kit's brand contract in
// app.config.mjs brand.light (accent, accentInk, accentSoft, mark, markInk), with brand.dark
// derived by deriveBrand, and src/client/styles/brand.css is rendered from it exactly as the
// template's tools/brandCss.mjs does (re-implemented: the target's code is never run). Both are live
// writes; the brand.css pin test (five --brand-* lines, #rrggbb) and the config test stay green.
import { brandFromTokens, brandLine, renderBrandCss } from "../codemod/config.mjs";
import { scanCss } from "../scan/css.mjs";

export const BRAND_CSS = "src/client/styles/brand.css";

/** @param {import("../apply.mjs").StepContext} ctx */
export function run(ctx) {
  const reads = ctx.step.files.reads.filter((k) => !k.startsWith("@") && k.endsWith(".css") && ctx.tree.files.has(k));
  const key = reads[0] ?? ctx.inv.files.map((f) => f.key).find((k) => /^src\/client\/(?:.*\/)?tokens\.css$/.test(k));
  if (!key) return { notes: ["no tokens.css in the source: the brand create derived from the accent stays"] };
  /** @type {Record<string, string>} */
  const tokens = {};
  for (const d of scanCss(ctx.tree.read(key)).defines) if (d.media === null && /(^|[\s,]):root\b/.test(d.selector)) tokens[d.name] = d.value;
  const { brand, notes } = brandFromTokens(tokens);
  if (!brand) return { notes };
  ctx.patchTarget("app.config.mjs", /^(\s*light: )\{[^}]*\},/m, (_m, a) => a + brandLine(brand.light) + ",");
  ctx.patchTarget("app.config.mjs", /^(\s*dark: )\{[^}]*\},/m, (_m, a) => a + brandLine(brand.dark) + ",");
  ctx.out.write(BRAND_CSS, renderBrandCss(brand));
  return {
    notes: ["brand from " + key + ": light accent " + brand.light.accent + " ink " + brand.light.accentInk + ", dark derived (" + brand.dark.accent + "); review it in the dark-mode step", ...notes],
    maps: { brand: { from: key, light: brand.light, dark: brand.dark } },
  };
}

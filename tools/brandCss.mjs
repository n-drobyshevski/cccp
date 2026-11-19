// Extracted from the author's production Apps Script apps; adapted.
// The app's brand.css, rendered from app.config.mjs. It declares the same three blocks as the
// kit's brand.css (light, system dark, explicit dark) and is loaded INSTEAD of it.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/** @param {Record<string, string>} t @param {string} pad */
function tokens(t, pad) {
  return [
    pad + "--brand-accent: " + t.accent + ";",
    pad + "--brand-accent-ink: " + t.accentInk + ";",
    pad + "--brand-accent-soft: " + t.accentSoft + ";",
    pad + "--brand-mark: " + t.mark + ";",
    pad + "--brand-mark-ink: " + t.markInk + ";",
  ].join("\n");
}

/**
 * @param {{ light: Record<string, string>, dark: Record<string, string> }} brand
 * @returns {string}
 */
export function renderBrandCss(brand) {
  return [
    "/* Generated from app.config.mjs by tools/brandCss.mjs: edit the config, not this file.",
    "   The five brand tokens; tokens.base.css maps --accent and --mark to them. */",
    ":root {",
    tokens(brand.light, "  "),
    "}",
    "",
    "@media (prefers-color-scheme: dark) {",
    "  :root:not([data-theme=\"light\"]) {",
    tokens(brand.dark, "    "),
    "  }",
    "}",
    "",
    ":root[data-theme=\"dark\"] {",
    tokens(brand.dark, "  "),
    "}",
    "",
  ].join("\n");
}

export const BRAND_CSS_PATH = "src/client/styles/brand.css";

/**
 * Write brand.css when it differs from what the config renders. Returns true when it wrote.
 * @param {string} root @param {{ light: Record<string, string>, dark: Record<string, string> }} brand
 */
export function syncBrandCss(root, brand) {
  const file = join(root, BRAND_CSS_PATH);
  const want = renderBrandCss(brand);
  if (existsSync(file) && readFileSync(file, "utf8") === want) return false;
  writeFileSync(file, want);
  return true;
}

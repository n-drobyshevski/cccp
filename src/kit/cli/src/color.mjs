// Brand colours derived from one accent: readable ink, a soft tint, and a dark-mode accent.

const LIGHT_INK = "#ffffff";
const DARK_INK = "#0e1117";
const LIGHT_SURFACE = "#ffffff";
export const DARK_SURFACE = "#0e1117";

/** @param {string} hex @returns {[number, number, number]} */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** @param {number[]} c @returns {string} */
function toHex(c) {
  return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** Mix a toward b: t = 0 is a, t = 1 is b. @param {string} a @param {string} b @param {number} t */
export function mix(a, b, t) {
  const x = rgb(a);
  const y = rgb(b);
  return toHex([0, 1, 2].map((i) => /** @type {number} */ (x[i]) * (1 - t) + /** @type {number} */ (y[i]) * t));
}

/** @param {string} hex @returns {number} relative luminance */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * /** @type {number} */ (r) + 0.7152 * /** @type {number} */ (g) + 0.0722 * /** @type {number} */ (b);
}

/** @param {string} a @param {string} b @returns {number} WCAG contrast ratio */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The more readable of white and near-black on a background. @param {string} bg */
export function pickInk(bg) {
  return contrast(LIGHT_INK, bg) >= contrast(DARK_INK, bg) ? LIGHT_INK : DARK_INK;
}

/**
 * The five brand tokens, light and dark, from one accent.
 * @param {string} accent #rrggbb
 * @returns {{ light: Record<string, string>, dark: Record<string, string> }}
 */
export function deriveBrand(accent) {
  let a = accent.toLowerCase();
  // The light accent is used as text and as the 2px focus ring on the white surface, so it must reach
  // 4.5:1 there (which also leaves white ink readable on it): darken it until it does.
  for (let t = 0.03; contrast(a, LIGHT_SURFACE) < 4.5 && t < 1; t += 0.03) a = mix(accent.toLowerCase(), "#000000", t);
  let dark = a;
  for (let t = 0; contrast(dark, DARK_SURFACE) < 7 && t <= 1; t += 0.05) dark = mix(a, "#ffffff", t);
  const lightInk = pickInk(a);
  const darkInk = pickInk(dark);
  return {
    light: { accent: a, accentInk: lightInk, accentSoft: mix(a, "#ffffff", 0.875), mark: a, markInk: lightInk },
    dark: { accent: dark, accentInk: darkInk, accentSoft: mix(DARK_SURFACE, dark, 0.15), mark: dark, markInk: darkInk },
  };
}

/**
 * The main colours the guided create offers. Each is a #rrggbb that reaches 4.5:1 on the white surface as it
 * stands (a test checks it), so the swatch shown is the colour the app gets. "Blue" is the template's accent.
 * Brand tokens still come from deriveBrand; these are only the starting accents.
 * They are kept here and not taken from tooling's brandPresets.mjs: that file has three presets, one of them
 * a vendor brand, and the guided create needs neutral colours it can show as swatches.
 */
export const ACCENT_PRESETS = [
  { id: "blue", label: "Blue", accent: "#2a4fb5" },
  { id: "green", label: "Green", accent: "#1e7a4d" },
  { id: "purple", label: "Purple", accent: "#6b3fa0" },
  { id: "orange", label: "Orange", accent: "#b45309" },
  { id: "teal", label: "Teal", accent: "#0f766e" },
];

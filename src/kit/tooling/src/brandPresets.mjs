// Brand presets: ready-made values for the brand block of app.config.mjs (the five brand tokens
// in light and dark) plus the two shape tokens an app sets in its own stylesheet. This is config
// data, like app.config.mjs, so it lives with the build tooling and not in a stylesheet; it has no
// imports, so the docs site may also bundle it for its Theming editor. Every preset keeps the ink
// colours at 4.5 to 1 or better on their accent, and the text colours on the soft accent, in both
// themes (test/brandPresets.test.ts).
//
//   import { BRAND_PRESETS } from "./src/kit/tooling/src/brandPresets.mjs";
//   export default { brand: BRAND_PRESETS.decathlon.brand, ... };

/**
 * @typedef {{ accent: string, accentInk: string, accentSoft: string, mark: string, markInk: string }} BrandMode
 * @typedef {{ id: string, label: string, note: string, brand: { light: BrandMode, dark: BrandMode }, shape: { btn: string, card: string } }} BrandPreset
 */

/** @type {Record<string, BrandPreset>} */
export const BRAND_PRESETS = {
  neutral: {
    id: "neutral",
    label: "Neutral",
    note: "The kit default: shadcn/ui's neutral theme, a near-black primary on white.",
    brand: {
      light: { accent: "#171717", accentInk: "#fafafa", accentSoft: "#f5f5f5", mark: "#0a0a0a", markInk: "#ffffff" },
      dark: { accent: "#e5e5e5", accentInk: "#171717", accentSoft: "#262626", mark: "#fafafa", markInk: "#0a0a0a" },
    },
    shape: { btn: "8px", card: "14px" },
  },
  blue: {
    id: "blue",
    label: "Blue",
    note: "The register template's example accent: a calm product blue.",
    brand: {
      light: { accent: "#2a4fb5", accentInk: "#ffffff", accentSoft: "#e4eafb", mark: "#2a4fb5", markInk: "#ffffff" },
      dark: { accent: "#8fa8f0", accentInk: "#0e1117", accentSoft: "#1f2a4d", mark: "#8fa8f0", markInk: "#0e1117" },
    },
    shape: { btn: "8px", card: "14px" },
  },
  // Values follow the open-source Vitamin design tokens of Decathlon (Apache-2.0): the digital
  // brand blue, its lightest tint, the deep navy, and the 4px and 8px radius steps. No logo,
  // typeface or other brand asset is included. Vitamin pairs these with Roboto and Roboto
  // Condensed; an app that wants them loads the fonts itself and sets --font-sans.
  decathlon: {
    id: "decathlon",
    label: "Decathlon",
    note: "Inspired by Decathlon's open-source Vitamin design system: a bright sport blue, deep navy and squarer corners.",
    brand: {
      light: { accent: "#007dbc", accentInk: "#ffffff", accentSoft: "#e7f3f9", mark: "#007dbc", markInk: "#ffffff" },
      dark: { accent: "#7ebee0", accentInk: "#012b49", accentSoft: "#012b49", mark: "#7ebee0", markInk: "#012b49" },
    },
    shape: { btn: "4px", card: "8px" },
  },
};

/** The presets in display order. */
export const BRAND_PRESET_LIST = [BRAND_PRESETS.neutral, BRAND_PRESETS.blue, BRAND_PRESETS.decathlon];

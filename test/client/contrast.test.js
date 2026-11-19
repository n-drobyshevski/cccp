// WCAG contrast of the tokens, in both themes: text at least 4.5:1, status colours at least 3:1.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The theme (kit token names with the Identity G values, plus the app tokens) and the generated brand
// stylesheet (the accent family as --brand-*): the accent, accent-ink and accent-soft of a theme are the
// brand tokens, as the kit's tokens.base.css maps them.
const read = (f) => readFileSync(resolve(__dirname, "../../src/client/styles/" + f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const themeCss = read("theme.css");
const brandCss = read("brand.css");

function blockOf(css, open) {
  const out = {};
  let i = css.indexOf(open);
  if (i < 0) throw new Error("no block " + open);
  for (; i >= 0; i = css.indexOf(open, i + 1)) {
    const end = css.indexOf("}", i);
    for (const m of css.slice(css.indexOf("{", i) + 1, end).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  }
  return out;
}

function block(open) {
  const out = blockOf(themeCss, open);
  const brand = blockOf(brandCss, open);
  for (const k of ["accent", "accent-ink", "accent-soft"]) out[k] = brand["brand-" + k];
  return out;
}

const light = block(":root {");
const dark = block(':root[data-theme="dark"]');
const media = block(':root:not([data-theme="light"])');

function srgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function rgbOf(v) {
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(v);
  if (!m) throw new Error("cannot read colour " + v);
  const [L, C, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const mm = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  const lin = [4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s];
  return lin.map((x) => Math.min(1, Math.max(0, srgb(x))));
}

function lum(v) {
  const [r, g, b] = rgbOf(v).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const textOk = (t) => ["bg", "surface", "surface-2"].every((bg) => ratio(t.text, t[bg]) >= 4.5 && ratio(t["text-muted"], t[bg]) >= 4.5);

for (const [name, t] of [["light", light], ["dark", dark]]) {
  describe("contrast, " + name, () => {
    it("body and muted text reach 4.5:1 on the page and on cards", () => {
      expect(textOk(t)).toBe(true);
    });
    it("the check fires on a seeded low-contrast pair", () => {
      expect(textOk({ ...t, "text-muted": name === "light" ? "#aaaaaa" : "#555555" })).toBe(false);
      expect(ratio(t["text-muted"], t.surface)).toBeGreaterThanOrEqual(4.5);
    });
    it("the accent reads as text on the page and cards, and the button label on the accent", () => {
      expect(ratio(t.accent, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t.accent, t["accent-soft"])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t["accent-ink"], t.accent)).toBeGreaterThanOrEqual(4.5);
    });
    it("status colours reach 3:1 on cards", () => {
      for (const s of ["ok-fg", "warn-fg", "bad-fg", "none-fg"]) expect(ratio(t[s], t.surface), s).toBeGreaterThanOrEqual(3);
    });
    it("small status text (the changed cue, result pills, tags) reaches 4.5:1", () => {
      const mix = (a, b, pct) => {
        const [x, y] = [rgbOf(a), rgbOf(b)];
        return "#" + x.map((c, i) => Math.round((c * pct + y[i] * (1 - pct)) * 255).toString(16).padStart(2, "0")).join("");
      };
      for (const bg of ["surface", "surface-2"]) {
        expect(ratio(t["warn-strong"], t[bg]), "warn-strong on " + bg).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t["ok-text"], t[bg]), "ok-text on " + bg).toBeGreaterThanOrEqual(4.5);
      }
      expect(ratio(t.teal, mix(t.teal, t.surface, 0.16))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t["warn-strong"], mix(t["warn-fg"], t.surface, 0.18))).toBeGreaterThanOrEqual(4.5);
    });
    it("pillar names and the muted 'none' text reach 4.5:1 on the page and cards", () => {
      for (const bg of ["bg", "surface", "surface-2"]) {
        for (const k of ["cy", "co", "ct", "pl", "none-fg", "accent"]) expect(ratio(t[k], t[bg]), k + " on " + bg).toBeGreaterThanOrEqual(4.5);
      }
    });
    it("the glyph marks reach 3:1 on their fills", () => {
      expect(ratio(t["destructive-ink"], t["bad-fg"])).toBeGreaterThanOrEqual(3);
      for (const [c, p] of [["ok-fg", 0.13], ["warn-fg", 0.16]]) {
        const mixed = "#" + rgbOf(t[c]).map((x, i) => Math.round((x * p + rgbOf(t.surface)[i] * (1 - p)) * 255).toString(16).padStart(2, "0")).join("");
        expect(ratio(t[c], mixed), c).toBeGreaterThanOrEqual(3);
      }
    });
    it("the tooltip text reads on its background", () => {
      expect(ratio(t["tip-fg"], t["tip-bg"])).toBeGreaterThanOrEqual(4.5);
    });
  });
}

describe("dark tokens", () => {
  it("the system-preference block carries the same values as the explicit dark block", () => {
    for (const k of Object.keys(dark)) if (k !== "color-scheme") expect(media[k], k).toBe(dark[k]);
  });
});

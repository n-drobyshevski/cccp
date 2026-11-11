// Colour literals live in src/client/styles/tokens.css only.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../src/client/");
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;
const FN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;

describe("no colour literals outside tokens.css", () => {
  const files = walk(root).filter((f) => !f.endsWith("styles/tokens.css") && /\.(js|css|html)$/.test(f));
  it("scans the client files", () => expect(files.length).toBeGreaterThan(10));
  for (const f of files) {
    it(f.slice(root.length), () => {
      const text = strip(readFileSync(f, "utf8"));
      if (f.endsWith(".css")) {
        for (const m of text.matchAll(/\{([^{}]*)\}/g)) {
          expect(m[1]).not.toMatch(HEX);
          expect(m[1]).not.toMatch(FN);
        }
      } else {
        expect(text).not.toMatch(HEX);
        expect(text).not.toMatch(FN);
      }
    });
  }
});

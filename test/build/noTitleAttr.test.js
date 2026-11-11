// No title attributes anywhere in the client: tooltips are data-tip (lib/tip.js).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../../");
function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("no title attributes", () => {
  const files = [...walk(join(root, "src/client")), ...walk(join(root, "e2e"))].filter((f) => /\.(js|html|css|ts)$/.test(f));
  it("scans the client files", () => expect(files.length).toBeGreaterThan(10));
  for (const f of files) {
    it(f.slice(root.length), () => {
      const text = readFileSync(f, "utf8");
      expect(text).not.toMatch(/[\s"'`]title\s*=\s*["'{$]/);
      expect(text).not.toMatch(/setAttribute\(\s*["']title["']/);
      expect(text).not.toMatch(/\.title\s*=[^=]/);
    });
  }
});

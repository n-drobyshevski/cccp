import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { guardJs } from "../../build/guards.mjs";

const root = new URL("../../", import.meta.url).pathname;

describe("html tag lowering", () => {
  it("bundles with no backtick and renders the expected escaped markup", async () => {
    const sample = [
      'import { html, raw } from "./src/client/lib/html.js";',
      "const evil = '<img src=x onerror=\"a\">&';",
      "globalThis.__out = String(html`<p class=\"${'a\"b'}\">${evil}${raw('<b>ok</b>')}${[1, html`<i>${'<'}</i>`]}${null}${false}</p>`);",
    ].join("\n");
    const res = await build({
      stdin: { contents: sample, resolveDir: root, loader: "js" },
      bundle: true, format: "iife", target: "es2019", write: false, minify: true,
      supported: { "template-literal": false },
    });
    const code = res.outputFiles[0].text;
    expect(code).not.toContain("`");
    expect(() => guardJs("sample", code)).not.toThrow();
    new Function(code)();
    expect(globalThis.__out).toBe(
      '<p class="a&quot;b">&lt;img src=x onerror=&quot;a&quot;&gt;&amp;<b>ok</b>1<i>&lt;</i></p>',
    );
  });

  it("html.js source itself has no backtick", () => {
    const src = readFileSync(root + "src/client/lib/html.js", "utf8");
    expect(src).not.toContain("`");
  });
});

describe("index.html", () => {
  const index = readFileSync(root + "src/client/index.html", "utf8");
  it("includes styles, the boot-data slot and js_app", () => {
    expect(index).toContain("include('styles')");
    expect(index).toContain("include('js_app')");
    expect(index).toMatch(/<script type="application\/json" id="boot-data"><\?!= bootJson \?><\/script>/);
  });
  it("has a pre-paint script free of double slashes and backticks, before the styles", () => {
    const m = /<script>([\s\S]*?)<\/script>/.exec(index);
    expect(m[1]).toContain("cccp.theme");
    expect(m[1]).not.toContain("//");
    expect(m[1]).not.toContain("`");
    expect(index.indexOf(m[0])).toBeLessThan(index.indexOf("include('styles')"));
  });
});

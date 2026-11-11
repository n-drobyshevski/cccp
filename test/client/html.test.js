import { describe, expect, it } from "vitest";
import { escapeHtml, html, isSafe, raw } from "../../src/client/lib/html.js";

describe("html tag", () => {
  it("escapes hostile strings", () => {
    const evil = '<script>alert("x")</script>&\'';
    const out = String(html`<p>${evil}</p>`);
    expect(out).toBe("<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;</p>");
    expect(out).not.toContain("<script>");
  });
  it("escapes inside attribute values", () => {
    expect(String(html`<a data-k="${'x" onclick="y'}">`)).toBe('<a data-k="x&quot; onclick=&quot;y">');
  });
  it("passes nested html and raw() through", () => {
    const inner = html`<b>${"<"}</b>`;
    expect(String(html`<p>${inner}${raw("<i>r</i>")}</p>`)).toBe("<p><b>&lt;</b><i>r</i></p>");
    expect(isSafe(inner)).toBe(true);
    expect(isSafe("<b>")).toBe(false);
  });
  it("joins arrays, escaping strings and keeping safe items", () => {
    expect(String(html`<ul>${["<a>", html`<li>x</li>`, 3]}</ul>`)).toBe("<ul>&lt;a&gt;<li>x</li>3</ul>");
  });
  it("renders null, undefined and false as empty, but keeps 0", () => {
    expect(String(html`[${null}${undefined}${false}]`)).toBe("[]");
    expect(String(html`[${0}]`)).toBe("[0]");
  });
  it("does not treat a string that looks like SafeHtml as safe", () => {
    expect(String(html`${{ s: "<b>" }}`)).toBe("[object Object]");
    expect(escapeHtml("<")).toBe("&lt;");
  });
});

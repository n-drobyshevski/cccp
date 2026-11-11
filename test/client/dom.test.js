// renderRegion in node, over a small fake element: it must reject anything but SafeHtml, and
// give back focus (by data-k) and scroll ([data-keep-scroll]) after the markup is replaced.
import { describe, expect, it } from "vitest";
import { delegate, renderRegion } from "../../src/client/lib/dom.js";
import { html, raw } from "../../src/client/lib/html.js";

/** A region whose children are described by `kids`; innerHTML assignment rebuilds them. */
function fakeRegion(kids, active) {
  const doc = { activeElement: null, body: {} };
  const mk = (spec) => {
    const el = {
      attrs: { ...spec.attrs }, scrollTop: 0, scrollLeft: 0, focused: false, selectionStart: spec.sel ? spec.sel[0] : undefined, selectionEnd: spec.sel ? spec.sel[1] : undefined,
      getAttribute: (k) => (k in el.attrs ? el.attrs[k] : null),
      hasAttribute: (k) => k in el.attrs,
      focus: () => { el.focused = true; doc.activeElement = el; },
      setSelectionRange: (a, b) => { el.selectionStart = a; el.selectionEnd = b; },
    };
    return el;
  };
  let children = kids.map(mk);
  const region = {
    ownerDocument: doc,
    attrs: {},
    hasAttribute: () => false,
    contains: (e) => children.indexOf(e) >= 0,
    querySelectorAll: (sel) => (sel === "[data-keep-scroll]" ? children.filter((c) => "data-keep-scroll" in c.attrs) : []),
    querySelector: (sel) => {
      const m = /^\[data-k="(.*)"\]$/.exec(sel);
      return m ? children.find((c) => c.attrs["data-k"] === m[1].replace(/\\(["\\])/g, "$1")) || null : null;
    },
    set innerHTML(_v) { children = kids.map(mk); this.writes = (this.writes || 0) + 1; },
    get children() { return children; },
  };
  if (active != null) doc.activeElement = children[active];
  return { region, doc };
}

describe("renderRegion", () => {
  it("rejects plain strings and anything that is not SafeHtml", () => {
    const { region } = fakeRegion([]);
    expect(() => renderRegion(region, "<b>x</b>")).toThrow(TypeError);
    expect(() => renderRegion(region, { toString: () => "<b>x</b>" })).toThrow(TypeError);
    expect(() => renderRegion(region, null)).toThrow(TypeError);
    expect(region.writes).toBeUndefined();
  });

  it("accepts html and raw output", () => {
    const { region } = fakeRegion([]);
    renderRegion(region, html`<p>${"a<b"}</p>`);
    renderRegion(region, raw("<p>ok</p>"));
    expect(region.writes).toBe(2);
  });

  it("restores focus by data-k, with the caret", () => {
    const { region, doc } = fakeRegion([{ attrs: { "data-k": "q" }, sel: [2, 4] }, { attrs: { "data-k": "other" } }], 0);
    doc.activeElement.selectionStart = 3;
    doc.activeElement.selectionEnd = 5;
    renderRegion(region, html`<input>`, { keepFocus: true });
    expect(doc.activeElement.getAttribute("data-k")).toBe("q");
    expect(doc.activeElement.focused).toBe(true);
    expect([doc.activeElement.selectionStart, doc.activeElement.selectionEnd]).toEqual([3, 5]);
  });

  it("does not move focus that was outside the region or has no data-k", () => {
    const { region, doc } = fakeRegion([{ attrs: {} }], 0);
    renderRegion(region, html`<i></i>`);
    expect(doc.activeElement.focused).toBe(false);
  });

  it("restores the scroll position of [data-keep-scroll] regions", () => {
    const { region } = fakeRegion([{ attrs: { "data-keep-scroll": "list" } }, { attrs: { "data-keep-scroll": "side" } }]);
    region.children[0].scrollTop = 340;
    region.children[1].scrollTop = 12;
    renderRegion(region, html`<div></div>`, { keepScroll: true });
    expect(region.children[0].scrollTop).toBe(340);
    expect(region.children[1].scrollTop).toBe(12);
  });

  it("lets both be switched off", () => {
    const { region, doc } = fakeRegion([{ attrs: { "data-k": "q", "data-keep-scroll": "x" } }], 0);
    region.children[0].scrollTop = 50;
    renderRegion(region, html`<i></i>`, { keepFocus: false, keepScroll: false });
    expect(doc.activeElement.focused).toBe(false);
    expect(region.children[0].scrollTop).toBe(0);
  });
});

describe("delegate", () => {
  it("calls back for targets inside the selector and returns an off function", () => {
    const listeners = [];
    const inner = { closest: (s) => (s === "[data-act]" ? btn : null) };
    const btn = { closest: () => btn };
    const root = { addEventListener: (t, f) => listeners.push([t, f]), removeEventListener: (t, f) => listeners.splice(listeners.findIndex((l) => l[1] === f), 1), contains: (e) => e === btn };
    const seen = [];
    const off = delegate(root, "click", "[data-act]", (ev, el) => seen.push(el));
    listeners[0][1]({ target: inner });
    listeners[0][1]({ target: { closest: () => null } });
    expect(seen).toEqual([btn]);
    off();
    expect(listeners).toHaveLength(0);
  });
});

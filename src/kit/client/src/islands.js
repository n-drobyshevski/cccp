// Extracted from the author's production Apps Script apps; adapted.
// Islands: imperative widgets (a chart, an editor) that a view marks with
//   data-mount="name" data-props='{"json":"here"}'
// and the app registers by name. This is the only module besides renderRegion that touches
// the DOM imperatively, and it never writes markup itself.

/**
 * @typedef {{ mount: (el: Element, data: any) => (void | (() => void)), unmount?: (el: Element) => void }} Island
 */

/**
 * @param {Element} el
 * @returns {any}
 */
function readProps(el) {
  const text = el.getAttribute("data-props");
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v == null ? {} : v;
  } catch (e) {
    return {};
  }
}

/**
 * Mount every [data-mount] element under `root` whose name is registered, once each.
 * mount(el, data) may return a teardown function; an island may also declare unmount(el).
 * Returns unmountAll(), which runs every teardown once, in reverse order of mounting. An
 * element that is already mounted (or whose mount threw) is not mounted again.
 * @param {Element} root
 * @param {Record<string, Island>} registry
 * @returns {() => void}
 */
export function mountIslands(root, registry) {
  /** @type {Array<() => void>} */
  const teardowns = [];
  // Only the elements this call marked are cleared by its unmountAll().
  /** @type {Element[]} */
  const mounted = [];
  const nodes = Array.prototype.slice.call(root.querySelectorAll("[data-mount]"));
  for (const el of nodes) {
    if (el.getAttribute("data-mounted") === "1") continue;
    const island = registry[el.getAttribute("data-mount")];
    if (!island || typeof island.mount !== "function") continue;
    el.setAttribute("data-mounted", "1");
    mounted.push(el);
    try {
      const done = island.mount(el, readProps(el));
      if (typeof done === "function") teardowns.push(done);
      else if (typeof island.unmount === "function") teardowns.push(() => island.unmount && island.unmount(el));
    } catch (e) {
      if (typeof console !== "undefined") console.warn("island failed to mount: " + el.getAttribute("data-mount"), e);
    }
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    // Clear the marker so the same DOM can be mounted again (a chart rebuilt after a theme change).
    for (const n of mounted) n.removeAttribute("data-mounted");
    for (let i = teardowns.length - 1; i >= 0; i--) {
      try { teardowns[i](); } catch (e) { if (typeof console !== "undefined") console.warn("island teardown failed", e); }
    }
  };
}

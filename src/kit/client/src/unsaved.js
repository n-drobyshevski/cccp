// Generic leave-the-page guard for an editor with unsaved edits.
// The browser shows its own prompt: a page cannot set the text, only ask for it.

/**
 * Ask the browser to confirm before the page unloads while isDirty() is true. The guard drops
 * itself once node leaves the document, and the returned function drops it at once. It fails
 * closed: an isDirty that throws counts as dirty. Outside a browser it does nothing.
 * @param {Node} node The editor root; the guard lives while it is connected.
 * @param {() => boolean} isDirty
 * @returns {() => void} Removes the guard; safe to call more than once.
 */
export function guardUnsaved(node, isDirty) {
  if (typeof window === "undefined") return () => {};
  const off = () => window.removeEventListener("beforeunload", onBeforeUnload);
  /** @param {BeforeUnloadEvent} e */
  function onBeforeUnload(e) {
    if (!node.isConnected) { off(); return; }
    let dirty;
    try { dirty = isDirty(); } catch { dirty = true; }
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = ""; // legacy browsers read the prompt from returnValue
  }
  window.addEventListener("beforeunload", onBeforeUnload);
  return off;
}

// Extracted from the author's production Apps Script apps; adapted.
// Copy text. The async clipboard API is refused inside some embedded frames, so a hidden
// textarea and execCommand are the fallback. Resolves true when the text was copied.

/**
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export function copyText(text) {
  const legacy = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  };
  const nav = /** @type {any} */ (globalThis).navigator;
  if (nav && nav.clipboard && typeof nav.clipboard.writeText === "function") {
    return nav.clipboard.writeText(text).then(() => true, () => legacy());
  }
  return Promise.resolve(legacy());
}

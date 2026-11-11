// Copy text. The async clipboard API is refused inside some embedded frames, so a hidden
// textarea and execCommand are the fallback. Resolves true when the text was copied.
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
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    return navigator.clipboard.writeText(text).then(() => true, () => legacy());
  }
  return Promise.resolve(legacy());
}

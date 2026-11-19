// Extracted from the author's production Apps Script apps; adapted.
// Hand the viewer a file built in the browser. A text download can carry a byte-order mark so
// Excel reads UTF-8 CSV correctly.

/**
 * @param {string} name
 * @param {Blob} blob
 */
function save(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * @param {string} name
 * @param {string} text
 * @param {string} [mime] default text/plain
 * @param {{ bom?: boolean }} [opts] bom: prefix a byte-order mark (CSV for Excel)
 */
export function downloadText(name, text, mime, opts) {
  const parts = opts && opts.bom ? ["\uFEFF", text] : [text];
  save(name, new Blob(parts, { type: (mime || "text/plain") + ";charset=utf-8" }));
}

/**
 * @param {string} name
 * @param {BlobPart} bytes
 * @param {string} [mime] default application/octet-stream
 */
export function downloadBytes(name, bytes, mime) {
  save(name, new Blob([bytes], { type: mime || "application/octet-stream" }));
}

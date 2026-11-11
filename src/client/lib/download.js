// Hand the viewer a file built in the browser. A text download can carry a byte-order mark so
// Excel reads UTF-8 CSV correctly.
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

export function downloadText(name, text, mime, opts) {
  const parts = opts && opts.bom ? ["\ufeff", text] : [text];
  save(name, new Blob(parts, { type: (mime || "text/plain") + ";charset=utf-8" }));
}

export function downloadBytes(name, bytes, mime) {
  save(name, new Blob([bytes], { type: mime || "application/octet-stream" }));
}

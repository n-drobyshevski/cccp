// Extracted from the author's production Apps Script apps; adapted.
// Minimal RFC 4180 CSV parser used by the source-sheet fake. Every cell is a string.

/** Parse CSV text into rows of strings. Handles quotes, doubled quotes, CRLF and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let any = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; any = true; }
    else if (ch === ",") { row.push(cell); cell = ""; any = true; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      if (any || cell !== "") { row.push(cell); rows.push(row); }
      row = []; cell = ""; any = false;
    } else { cell += ch; any = true; }
  }
  if (any || cell !== "") { row.push(cell); rows.push(row); }
  return rows;
}

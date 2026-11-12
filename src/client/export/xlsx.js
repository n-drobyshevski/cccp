// An Excel workbook with no dependency: a STORED zip (zip.js) holding the seven parts Excel
// needs. One sheet. Text cells are inline strings (no shared-string table), numbers are numeric
// cells, and there is no formula element anywhere, so text that starts with = stays text. The
// header row is bold, frozen and has an autofilter. Namespace and relationship URLs are joined
// from parts because the Apps Script middlebox cannot be trusted with a literal double slash.
import { zipStore } from "./zip.js";

const url = (...parts) => ["http:", ""].concat(parts).join("/");
const NS_MAIN = url("schemas.openxmlformats.org", "spreadsheetml", "2006", "main");
const NS_REL = url("schemas.openxmlformats.org", "officeDocument", "2006", "relationships");
const NS_PKG_REL = url("schemas.openxmlformats.org", "package", "2006", "relationships");
const NS_CT = url("schemas.openxmlformats.org", "package", "2006", "content-types");
const REL_BASE = NS_REL + "/";
const CT_SHEET_BASE = "application/vnd.openxmlformats-officedocument.spreadsheetml.";

export const XLSX_MIME = CT_SHEET_BASE + "sheet";
export const SHEET_NAME = "Applications";
export const CELL_MAX = 32767;
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/**
 * Text safe for element content and attribute values. XML 1.0 forbids most control characters,
 * U+FFFE, U+FFFF and unpaired surrogates: each becomes a space. Valid pairs pass through.
 */
export function xmlText(v) {
  const s = String(v);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { out += s[i] + s[i + 1]; i++; } else out += " ";
    } else if (c >= 0xdc00 && c <= 0xdfff) out += " ";
    else if ((c < 0x20 && c !== 9 && c !== 10 && c !== 13) || c === 0xfffe || c === 0xffff) out += " ";
    else out += ESC[s[i]] || s[i];
  }
  return out;
}

/** 0 -> 'A', 25 -> 'Z', 26 -> 'AA'. */
export function colName(i) {
  let n = i + 1;
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/** One cell: a finite number is numeric, anything else is an inline string. Null is skipped. */
export function cellXml(v, ref, style) {
  if (v === null || v === undefined || v === "") return style ? '<c r="' + ref + '" s="' + style + '"/>' : "";
  const s = style ? ' s="' + style + '"' : "";
  if (typeof v === "number" && Number.isFinite(v)) return '<c r="' + ref + '"' + s + "><v>" + String(v) + "</v></c>";
  const text = String(v).slice(0, CELL_MAX);
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xmlText(text) + "</t></is></c>";
}

function widths(matrix, cols) {
  const out = [];
  for (let c = 0; c < cols; c++) {
    let w = 8;
    for (let r = 0; r < matrix.length && r < 200; r++) {
      const v = matrix[r][c];
      const len = v == null ? 0 : String(v).split("\n")[0].length;
      if (len + 2 > w) w = len + 2;
    }
    out.push(Math.min(w, 60));
  }
  return out;
}

function sheetXml(matrix) {
  const cols = matrix.reduce((m, r) => Math.max(m, r.length), 1);
  const last = colName(cols - 1) + Math.max(matrix.length, 1);
  const rows = matrix.map((r, i) => {
    const cells = r.map((v, c) => cellXml(v, colName(c) + (i + 1), i === 0 ? 1 : 0)).join("");
    return '<row r="' + (i + 1) + '">' + cells + "</row>";
  }).join("");
  const cw = widths(matrix, cols).map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("");
  return XML_HEAD + '<worksheet xmlns="' + NS_MAIN + '"><dimension ref="A1:' + last + '"/>'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/><cols>' + cw + "</cols><sheetData>" + rows + "</sheetData>"
    + '<autoFilter ref="A1:' + last + '"/></worksheet>';
}

const STYLES = XML_HEAD + '<styleSheet xmlns="' + NS_MAIN + '">'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** The .xlsx file for a matrix (row 0 is the header), as a Uint8Array. */
export function buildXlsx(matrix) {
  const rows = matrix.length ? matrix : [[]];
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 1);
  const ref = SHEET_NAME + "!$A$1:$" + colName(cols - 1) + "$" + rows.length;
  const parts = [
    ["[Content_Types].xml", XML_HEAD + '<Types xmlns="' + NS_CT + '"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="' + CT_SHEET_BASE + 'sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="' + CT_SHEET_BASE + 'worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="' + CT_SHEET_BASE + 'styles+xml"/></Types>'],
    ["_rels/.rels", XML_HEAD + '<Relationships xmlns="' + NS_PKG_REL + '"><Relationship Id="rId1" Type="' + REL_BASE + 'officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ["xl/workbook.xml", XML_HEAD + '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '"><bookViews><workbookView/></bookViews><sheets><sheet name="' + SHEET_NAME + '" sheetId="1" r:id="rId1"/></sheets>'
      + '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' + ref + "</definedName></definedNames></workbook>"],
    ["xl/_rels/workbook.xml.rels", XML_HEAD + '<Relationships xmlns="' + NS_PKG_REL + '"><Relationship Id="rId1" Type="' + REL_BASE + 'worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="' + REL_BASE + 'styles" Target="styles.xml"/></Relationships>'],
    ["xl/styles.xml", STYLES],
    ["xl/worksheets/sheet1.xml", sheetXml(rows)],
  ];
  return zipStore(parts.map(([name, data]) => ({ name, data })));
}

// The Excel export: the zip's headers and CRCs verify, every XML part is well-formed, text is
// inline and numbers are numeric, special characters round-trip, nothing is a formula, and
// the built file survives the middlebox guard.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SHEET_NAME, buildXlsx, cellXml, colName, xmlText } from "../../src/client/export/xlsx.js";
import { crc32, zipStore } from "../../src/client/export/zip.js";

const dec = new TextDecoder("utf-8", { fatal: true });
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

/** Read every entry through the central directory, checking each local header and CRC. */
function readZip(b) {
  const eocd = b.length - 22;
  expect(u32(b, eocd)).toBe(0x06054b50);
  const n = u16(b, eocd + 10);
  expect(u16(b, eocd + 8)).toBe(n);
  const dirStart = u32(b, eocd + 16);
  expect(u32(b, eocd + 12)).toBe(eocd - dirStart);
  const out = {};
  let p = dirStart;
  for (let i = 0; i < n; i++) {
    expect(u32(b, p)).toBe(0x02014b50);
    const crc = u32(b, p + 16);
    const size = u32(b, p + 20);
    expect(u32(b, p + 24)).toBe(size);
    expect(u16(b, p + 10)).toBe(0);
    const nameLen = u16(b, p + 28);
    const off = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    expect(u32(b, off)).toBe(0x04034b50);
    expect(u32(b, off + 14)).toBe(crc);
    expect(u32(b, off + 18)).toBe(size);
    const lname = u16(b, off + 26);
    const lextra = u16(b, off + 28);
    expect(dec.decode(b.subarray(off + 30, off + 30 + lname))).toBe(name);
    const data = b.subarray(off + 30 + lname + lextra, off + 30 + lname + lextra + size);
    expect(crc32(data), name).toBe(crc);
    out[name] = data;
    p += 46 + nameLen + u16(b, p + 30) + u16(b, p + 32);
  }
  expect(p).toBe(eocd);
  return out;
}

/** A small well-formedness check: one root, balanced tags, quoted attributes, legal entities and characters. */
function wellFormed(xml) {
  const decl = /^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>\n/.exec(xml);
  expect(decl).toBeTruthy();
  const body = xml.slice(decl[0].length);
  // Characters XML 1.0 forbids.
  expect(body).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/);
  const stack = [];
  let roots = 0;
  let i = 0;
  while (i < body.length) {
    if (body[i] !== "<") {
      const j = body.indexOf("<", i);
      const text = body.slice(i, j < 0 ? body.length : j);
      expect(text, "text").not.toContain(">");
      for (const m of text.matchAll(/&([^;\s]*);?/g)) expect(m[0]).toMatch(/^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);$/i);
      if (!stack.length) expect(text.trim()).toBe("");
      i = j < 0 ? body.length : j;
      continue;
    }
    const j = body.indexOf(">", i);
    expect(j).toBeGreaterThan(i);
    const tag = body.slice(i + 1, j);
    if (tag[0] === "/") {
      expect(stack.pop()).toBe(tag.slice(1).trim());
    } else {
      const m = /^([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<&]*(?:&(?:amp|lt|gt|quot|#\d+);[^"<&]*)*")*)\s*(\/?)$/.exec(tag);
      expect(m, "tag <" + tag.slice(0, 60) + ">").toBeTruthy();
      const names = [...m[2].matchAll(/\s([\w:.-]+)=/g)].map((x) => x[1]);
      expect(new Set(names).size).toBe(names.length);
      if (!stack.length) roots++;
      if (!m[3]) stack.push(m[1]);
    }
    i = j + 1;
  }
  expect(stack).toEqual([]);
  expect(roots).toBe(1);
}

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");

/** Cells of sheet1 as {ref, t, s, v}, decoded. */
function cells(xml) {
  return [...xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => {
    const t = /t="(\w+)"/.exec(m[2]);
    const s = /s="(\d+)"/.exec(m[2]);
    const inner = m[3] || "";
    const text = /<t[^>]*>([\s\S]*)<\/t>/.exec(inner);
    const v = /<v>([^<]*)<\/v>/.exec(inner);
    return { ref: m[1], t: t ? t[1] : null, s: s ? s[1] : null, v: text ? unescape(text[1]) : v ? v[1] : null };
  });
}

const matrix = [
  ["Application", "Domain", "Completeness", "Note"],
  ["Alpha", "NORTH", 82, "plain"],
  ["Beta & <Co> \"q\" 'a'", "SOUTH", 0, "=HYPERLINK(1)"],
  ["Zoé 日本語 \u{1f600}", "", 100.5, "line1\nline2\ttab"],
  ["x\u0001y\u000bz", null, -3, "+SUM(1)"],
];

describe("zip", () => {
  it("crc32 matches the known check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it("round-trips entries with accents in the name and the data, headers and CRCs verify", () => {
    const z = readZip(zipStore([{ name: "a.txt", data: "hello" }, { name: "dir/é.bin", data: new Uint8Array([0, 255, 7]) }, { name: "empty", data: "" }]));
    expect(dec.decode(z["a.txt"])).toBe("hello");
    expect(Array.from(z["dir/é.bin"])).toEqual([0, 255, 7]);
    expect(z.empty.length).toBe(0);
  });
  it("is deterministic", () => {
    const a = zipStore([{ name: "a", data: "x" }]);
    expect(Array.from(zipStore([{ name: "a", data: "x" }]))).toEqual(Array.from(a));
  });
});

describe("buildXlsx", () => {
  const bytes = buildXlsx(matrix);
  const parts = readZip(bytes);
  const text = (n) => dec.decode(parts[n]);

  it("holds the parts Excel needs, with verified CRCs", () => {
    expect(Object.keys(parts)).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 3, 4]);
  });

  it("every part is well-formed XML", () => {
    for (const n of Object.keys(parts)) wellFormed(text(n));
  });

  it("writes text as inline strings and numbers as numeric cells", () => {
    const c = cells(text("xl/worksheets/sheet1.xml"));
    const by = Object.fromEntries(c.map((x) => [x.ref, x]));
    expect(by.A2).toMatchObject({ t: "inlineStr", v: "Alpha" });
    expect(by.C2).toMatchObject({ t: null, v: "82" });
    expect(by.C3).toMatchObject({ t: null, v: "0" });
    expect(by.C4).toMatchObject({ t: null, v: "100.5" });
    expect(by.C5).toMatchObject({ t: null, v: "-3" });
    expect(by.B4).toBeUndefined();
    expect(by.B5).toBeUndefined();
    expect(c.filter((x) => x.ref.endsWith("1")).every((x) => x.s === "1" && x.t === "inlineStr")).toBe(true);
  });

  it("round-trips special characters", () => {
    const by = Object.fromEntries(cells(text("xl/worksheets/sheet1.xml")).map((x) => [x.ref, x.v]));
    expect(by.A3).toBe("Beta & <Co> \"q\" 'a'");
    expect(by.A4).toBe("Zoé 日本語 \u{1f600}");
    expect(by.D4).toBe("line1\nline2\ttab");
    expect(by.A5).toBe("x y z");
    expect(by.D3).toBe("=HYPERLINK(1)");
  });

  it("has no formula element, and a text cell starting with = is an inline string", () => {
    const sheet = text("xl/worksheets/sheet1.xml");
    expect(sheet).not.toMatch(/<f[ >\/]/);
    expect(cells(sheet).find((x) => x.ref === "D3").t).toBe("inlineStr");
    expect(sheet).not.toContain("sharedStrings");
  });

  it("freezes and filters the header", () => {
    const sheet = text("xl/worksheets/sheet1.xml");
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A1:D5"/>');
    expect(sheet).toContain('<dimension ref="A1:D5"/>');
    expect(text("xl/workbook.xml")).toContain("<sheet name=\"" + SHEET_NAME + "\" sheetId=\"1\" r:id=\"rId1\"/>");
    expect(text("xl/styles.xml")).toContain("<b/>");
  });

  it("uses the standard namespaces", () => {
    expect(text("xl/worksheets/sheet1.xml")).toContain('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"');
    expect(text("_rels/.rels")).toContain("http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument");
    expect(text("[Content_Types].xml")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml");
  });

  it("handles an empty matrix and wide matrices", () => {
    wellFormed(dec.decode(readZip(buildXlsx([]))["xl/worksheets/sheet1.xml"]));
    const wide = [Array.from({ length: 30 }, (_, i) => "h" + i)];
    const p = readZip(buildXlsx(wide));
    expect(dec.decode(p["xl/worksheets/sheet1.xml"])).toContain('<autoFilter ref="A1:AD1"/>');
  });

  it("caps a cell at the Excel limit", () => {
    const c = cellXml("x".repeat(40000), "A1", 0);
    expect(c.length).toBeLessThan(33000);
  });
});

describe("helpers", () => {
  it("names columns", () => {
    expect([0, 25, 26, 27, 701, 702].map(colName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
  it("escapes markup and replaces illegal characters", () => {
    expect(xmlText('<a href="x">&</a>')).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
    expect(xmlText("a\u0000b\ud800c\udc00d￾")).toBe("a b c d ");
    expect(xmlText("\u{1f600}")).toBe("\u{1f600}");
  });
});

describe("the middlebox guard", () => {
  const srcs = ["csv.js", "zip.js", "xlsx.js"].map((f) => [f, readFileSync(new URL("../../src/client/export/" + f, import.meta.url), "utf8")]);
  it("finds no double slash or backtick in the export modules", () => {
    for (const [f, src] of srcs) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
      expect(code, f).not.toContain("//");
      expect(code, f).not.toContain("`");
    }
  });
  it("the URLs the workbook uses are joined, not written out", () => {
    const x = srcs.find(([f]) => f === "xlsx.js")[1];
    expect(x).not.toContain("http://");
  });
});

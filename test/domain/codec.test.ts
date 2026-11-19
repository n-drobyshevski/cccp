// The register row codec (src/domain/codec.ts, formerly vendored): decode(encode(x)) is what a JSON
// round trip of x gives, on rows chosen to break a columnar encoding.
import { describe, expect, it } from "vitest";
import { decodeRows, encodeRows } from "../../src/domain/codec";

const roundTrip = (rows: Record<string, unknown>[]) => {
  const strings: string[] = [];
  const t = encodeRows(rows, strings, new Map());
  return { out: decodeRows(JSON.parse(JSON.stringify(t)), JSON.parse(JSON.stringify(strings))), t, strings };
};

describe("row codec", () => {
  it("round-trips uniform rows and dictionary-encodes a repeating string column", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: "a" + i, domain: i % 2 ? "NORTH" : "SOUTH", tier: i }));
    const { out, t, strings } = roundTrip(rows);
    expect(out).toEqual(rows);
    expect(t.dict).toEqual([t.cols.indexOf("domain")]);
    expect(strings.filter((s) => s === "NORTH")).toHaveLength(1);
  });

  it("keeps null, an absent key and an undefined key distinct", () => {
    const rows = [{ a: "x", b: null }, { a: "x" }, { a: "x", b: undefined, c: 1 }, { b: "y", a: "x" }];
    const { out } = roundTrip(rows);
    expect(out).toEqual(JSON.parse(JSON.stringify(rows)));
    expect("b" in out[1]!).toBe(false);
    expect(out[0]!.b).toBeNull();
  });

  it("wraps a non-string that turns up in a dictionary column", () => {
    const rows = [{ a: "p" }, { a: "p" }, { a: "p" }, { a: 7 }, { a: null }, { a: ["z"] }];
    const { out } = roundTrip(rows);
    expect(out).toEqual(rows);
  });

  it("handles no rows and does not touch its input", () => {
    expect(roundTrip([]).out).toEqual([]);
    const rows = [{ a: "x" }, { a: "x" }];
    const copy = JSON.stringify(rows);
    encodeRows(rows, [], new Map());
    expect(JSON.stringify(rows)).toBe(copy);
  });
});

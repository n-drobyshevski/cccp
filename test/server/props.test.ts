import { describe, expect, it } from "vitest";
import { getJsonProp, getProp, putJsonProp, PROP_KEYS, PROP_MAX_BYTES, setProp } from "../../src/server/props";
import { useGasEnv } from "../gasEnv";

useGasEnv();

describe("putJsonProp", () => {
  it("stores JSON and getJsonProp reads it back", () => {
    putJsonProp("K", { a: [1, 2], b: "é" });
    expect(getProp("K")).toBe('{"a":[1,2],"b":"é"}');
    expect(getJsonProp("K", null)).toEqual({ a: [1, 2], b: "é" });
  });
  it("accepts exactly 8000 bytes and refuses 8001, writing nothing", () => {
    const pad = (n: number) => "x".repeat(n - 2); // two quote characters
    putJsonProp("OK", pad(PROP_MAX_BYTES));
    expect(getProp("OK")!.length).toBe(PROP_MAX_BYTES);
    expect(() => putJsonProp("BIG", pad(PROP_MAX_BYTES + 1))).toThrow(/too large/);
    expect(getProp("BIG")).toBeNull();
  });
  it("counts UTF-8 bytes, not characters", () => {
    // 4000 two-byte characters plus quotes is 8002 bytes but 4002 characters.
    expect(() => putJsonProp("U", "é".repeat(4000))).toThrow(/too large/);
    expect(getProp("U")).toBeNull();
    putJsonProp("U", "é".repeat(3999));
    expect(getProp("U")).not.toBeNull();
  });
  it("keeps the previous value when a larger one is refused", () => {
    putJsonProp("K", "small");
    expect(() => putJsonProp("K", "y".repeat(9000))).toThrow();
    expect(getJsonProp("K", "")).toBe("small");
  });
  it("refuses a value with no JSON form", () => {
    expect(() => putJsonProp("K", undefined)).toThrow();
  });
});

describe("getJsonProp", () => {
  it("falls back when unset, empty or malformed", () => {
    expect(getJsonProp("NONE", 5)).toBe(5);
    setProp("E", "");
    expect(getJsonProp("E", 6)).toBe(6);
    setProp("M", "{not json");
    expect(getJsonProp("M", 7)).toBe(7);
  });
});

describe("PROP_KEYS", () => {
  it("names the access and settings properties", () => {
    expect(PROP_KEYS).toMatchObject({
      allowedUsers: "ALLOWED_USERS", allowedAdmins: "ALLOWED_ADMINS", accessMode: "ACCESS_MODE",
      cfgSource: "CFG_SOURCE", cfgFields: "CFG_FIELDS", cfgRules: "CFG_RULES", cfgDisplay: "CFG_DISPLAY",
    });
  });
  it("never touches UserProperties", () => {
    expect(() => PropertiesService.getUserProperties()).toThrow();
  });
});

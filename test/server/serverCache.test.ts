import { describe, expect, it } from "vitest";
import {
  bumpCfgGen, bumpDataVersion, cacheGetJson, cacheKey, cachePutJson, cached, cfgGen, dataVersion, peekCached,
  primeCached, splitChunks, TTL_MAX_SEC, TTL_MIN_SEC,
} from "../../src/server/serverCache";
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();

describe("keys", () => {
  it("hold DATA_VERSION for the register and DATA_VERSION.CFG_GEN for the core", () => {
    expect(cacheKey("register", undefined)).toBe("cccp:1:0:register");
    expect(cacheKey("core", undefined, "cfg")).toBe("cccp:1:0.0:core");
    bumpDataVersion();
    bumpDataVersion();
    bumpCfgGen();
    expect(dataVersion()).toBe(2);
    expect(cfgGen()).toBe(1);
    expect(cacheKey("register", undefined)).toBe("cccp:1:2:register");
    expect(cacheKey("core", undefined, "cfg")).toBe("cccp:1:2.1:core");
  });
  it("hash params, and carry no identity", () => {
    const a = cacheKey("headers", { id: "x" });
    expect(a).toMatch(/^cccp:1:0:headers:[0-9a-f]{12}$/);
    expect(a).not.toBe(cacheKey("headers", { id: "y" }));
    expect(a).not.toMatch(/@/);
  });
  it("make an older entry unreachable after a bump", () => {
    primeCached("register", undefined, { n: 1 }, 600);
    expect(peekCached("register", undefined)).toEqual({ n: 1 });
    bumpDataVersion();
    expect(peekCached("register", undefined)).toBeUndefined();
  });
});

describe("cached", () => {
  it("computes once within the TTL and again after it, the TTL clamped to 60..21600", () => {
    let n = 0;
    const get = () => cached("x", undefined, () => ++n, 30);
    expect(get()).toBe(1);
    expect(get()).toBe(1);
    fakes().advance(TTL_MIN_SEC * 1000 + 1);
    expect(get()).toBe(2);
    let m = 0;
    cached("big", undefined, () => ++m, 999_999);
    fakes().advance((TTL_MAX_SEC - 1) * 1000);
    expect(cached("big", undefined, () => ++m, 1)).toBe(1);
    fakes().advance(2000);
    expect(cached("big", undefined, () => ++m, 1)).toBe(2);
  });
  it("takes a TTL function that is only called on a miss", () => {
    let calls = 0;
    const ttl = () => { calls++; return 120; };
    cached("t", undefined, () => 1, ttl);
    cached("t", undefined, () => 1, ttl);
    expect(calls).toBe(1);
  });
  it("degrades to compute when the cache is broken", () => {
    const saved = CacheService.getScriptCache;
    (CacheService as { getScriptCache: unknown }).getScriptCache = () => { throw new Error("down"); };
    try {
      let n = 0;
      expect(cached("x", undefined, () => ++n, 60)).toBe(1);
      expect(cached("x", undefined, () => ++n, 60)).toBe(2);
      expect(peekCached("x", undefined)).toBeUndefined();
    } finally {
      (CacheService as { getScriptCache: unknown }).getScriptCache = saved;
    }
  });
  it("computes every time when the cache accepts nothing", () => {
    fakes().setCacheDisabled(true);
    let n = 0;
    expect(cached("x", undefined, () => ++n, 60)).toBe(1);
    expect(cached("x", undefined, () => ++n, 60)).toBe(2);
  });
});

describe("chunking", () => {
  it("splits and rejoins a payload larger than one CacheService value", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const big = { rows: Array.from({ length: 20000 }, () => rnd().toString(36) + rnd().toString(36)) };
    const chars = cachePutJson("k", big, 600);
    expect(chars).toBeGreaterThan(200_000);
    expect(Number(CacheService.getScriptCache().get("k:m"))).toBeGreaterThan(1);
    expect(cacheGetJson("k")).toEqual(big);
  });
  it("reads a partial eviction as a miss", () => {
    cachePutJson("k", { a: "x".repeat(50) }, 600, 20);
    CacheService.getScriptCache().remove("k:1");
    expect(cacheGetJson("k")).toBeUndefined();
  });
  it("splitChunks is pure", () => {
    expect(splitChunks("abcde", 2)).toEqual(["ab", "cd", "e"]);
    expect(splitChunks("")).toEqual([""]);
  });
});

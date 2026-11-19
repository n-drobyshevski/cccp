import { describe, expect, it } from "vitest";
import {
  bumpDataVersion, bumpViewsGen, cache, cfgGen, coreKey, dataVersion, paramsKey, registerKey, viewsGen,
} from "../../src/server/serverCache";
import { CACHE_EPOCH, CACHE_PREFIX, PROP_KEYS } from "../../src/server/config";
import { setProp } from "@gas-kit/server";

const bumpCfgGen = () => setProp(PROP_KEYS.cfgGen, String(cfgGen() + 1));
import { useGasEnv } from "../gasEnv";

const fakes = useGasEnv();

describe("keys", () => {
  it("hold DATA_VERSION for the register and DATA_VERSION.CFG_GEN.VIEWS_GEN for the core", () => {
    expect(registerKey()).toBe("0");
    expect(coreKey()).toBe("0.0.0");
    bumpDataVersion();
    bumpDataVersion();
    bumpCfgGen();
    bumpViewsGen();
    bumpViewsGen();
    bumpViewsGen();
    expect(dataVersion()).toBe(2);
    expect(cfgGen()).toBe(1);
    expect(viewsGen()).toBe(3);
    expect(registerKey()).toBe("2");
    expect(coreKey()).toBe("2.1.3");
  });
  it("hash params into the key, and carry no identity", () => {
    const a = paramsKey({ id: "x" });
    expect(a).toMatch(/^0\.[0-9a-f]+\.[0-9a-z]+$/);
    expect(a).not.toBe(paramsKey({ id: "y" }));
    expect(a).not.toMatch(/@/);
    bumpDataVersion();
    expect(paramsKey({ id: "x" })).not.toBe(a);
  });
  it("uses the app prefix and epoch in the stored key, with a namespace ending in a digit", () => {
    cache.put("register1", registerKey(), { n: 1 }, 600);
    expect(CacheService.getScriptCache().get(CACHE_PREFIX + ".e" + CACHE_EPOCH + ".register1.0:m")).toBeTruthy();
    expect(() => cache.get("register", registerKey())).toThrow(/namespace/);
  });
  it("makes an older entry unreachable after a bump", () => {
    cache.put("register1", registerKey(), { n: 1 }, 600);
    expect(cache.peek("register1", registerKey())).toEqual({ n: 1 });
    bumpDataVersion();
    expect(cache.peek("register1", registerKey())).toBeUndefined();
  });
  it("makes the core unreachable after a settings or shared-views bump, but not the register", () => {
    cache.put("core1", coreKey(), { n: 1 }, 600);
    cache.put("register1", registerKey(), { n: 2 }, 600);
    bumpCfgGen();
    expect(cache.peek("core1", coreKey())).toBeUndefined();
    cache.put("core1", coreKey(), { n: 1 }, 600);
    bumpViewsGen();
    expect(cache.peek("core1", coreKey())).toBeUndefined();
    expect(cache.peek("register1", registerKey())).toEqual({ n: 2 });
  });
});

describe("the kit cache under the app's keys", () => {
  it("computes once within the TTL", () => {
    let n = 0;
    const get = () => cache.getOrCompute("x1", "k", 30, () => ++n);
    expect(get()).toBe(1);
    expect(get()).toBe(1);
  });
  it("takes a TTL function that is only called on a miss", () => {
    let calls = 0;
    const ttl = () => { calls++; return 120; };
    cache.getOrCompute("t1", "k", ttl, () => 1);
    cache.getOrCompute("t1", "k", ttl, () => 1);
    expect(calls).toBe(1);
  });
  it("splits and rejoins a register larger than one CacheService value", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const big = { rows: Array.from({ length: 20000 }, () => rnd().toString(36) + rnd().toString(36)) };
    cache.put("register1", registerKey(), big, 600);
    const head = JSON.parse(CacheService.getScriptCache().get(CACHE_PREFIX + ".e" + CACHE_EPOCH + ".register1.0:m")!) as { n: number };
    expect(head.n).toBeGreaterThan(1);
    expect(cache.get("register1", registerKey())).toEqual(big);
  });
  it("still answers when the cache accepts nothing", () => {
    fakes().setCacheDisabled(true);
    expect(cache.getOrCompute("x1", "k", 60, () => 7)).toBe(7);
  });
});

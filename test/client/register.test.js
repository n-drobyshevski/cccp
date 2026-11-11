import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeRegister } from "../../src/domain/payload";
import { DEFAULT_RULES } from "../../src/domain/rules";
import * as register from "../../src/client/state/register.js";
import { mk } from "../domain/mk";

const today = "2026-11-11";
const display = (o) => ({ opensOn: "list", theme: "system", hidePrefix: "", hideEol: false, ...o });
const apps = [
  mk({ id: "a", name: "Alpha", lifecycle: "PRODUCTION" }),
  mk({ id: "b", name: "TO DELETE old", lifecycle: "PRODUCTION" }),
  mk({ id: "c", name: "to delete too", lifecycle: "END_OF_LIFE" }),
  mk({ id: "d", name: "Delta", lifecycle: "End of support" }),
  mk({ id: "e", name: "Echo", lifecycle: null }),
];

describe("register derive", () => {
  it("derives a row per app and keeps everything visible by default", () => {
    const d = register.derive(apps, { rules: DEFAULT_RULES, display: display(), today });
    expect(d.rows).toHaveLength(5);
    expect(d.visible).toHaveLength(5);
    expect(d.hiddenCount).toBe(0);
    expect(d.byId.get("a").app.name).toBe("Alpha");
    expect(d.rows[0].status.worst).toMatch(/bad|warn|ok|none/);
    expect(typeof d.rows[0].pct).toBe("number");
  });

  it("hides by name prefix, case-insensitively and trimmed", () => {
    const d = register.derive(apps, { rules: DEFAULT_RULES, display: display({ hidePrefix: " to delete " }), today });
    expect(d.hiddenCount).toBe(2);
    expect(d.visible.map((r) => r.app.id)).toEqual(["a", "d", "e"]);
    expect(d.rows).toHaveLength(5);
  });

  it("hides end of life and end of support, and counts both filters once", () => {
    const eol = register.derive(apps, { rules: DEFAULT_RULES, display: display({ hideEol: true }), today });
    expect(eol.visible.map((r) => r.app.id)).toEqual(["a", "b", "e"]);
    expect(eol.hiddenCount).toBe(2);
    const both = register.derive(apps, { rules: DEFAULT_RULES, display: display({ hideEol: true, hidePrefix: "TO DELETE" }), today });
    expect(both.hiddenCount).toBe(3);
    expect(both.visible.map((r) => r.app.id)).toEqual(["a", "e"]);
  });

  it("a hidden app still resolves by id after load, and rederive follows a display save", () => {
    const payload = encodeRegister(apps, { loadedAt: "2026-11-11T08:00:00.000Z", dataVersion: 3 });
    register.reset();
    register.load(payload, { rules: DEFAULT_RULES, display: display({ hidePrefix: "echo" }), today });
    expect(register.isLoaded()).toBe(true);
    expect(register.hiddenCount()).toBe(1);
    expect(register.byId("e").app.name).toBe("Echo");
    expect(register.visibleRows()).toHaveLength(4);
    expect(register.loadedMeta().dataVersion).toBe(3);
    let n = 0;
    register.subscribe(() => n++);
    register.rederive({ display: display() });
    expect(register.hiddenCount()).toBe(0);
    expect(n).toBe(1);
  });

  it("derives the 60-app fixture, one row per record", () => {
    let rows;
    try { rows = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/apps60.json"), "utf8")); } catch { rows = null; }
    expect(rows).not.toBeNull();
    const d = register.derive(rows, { rules: DEFAULT_RULES, display: display(), today });
    expect(d.rows).toHaveLength(rows.length);
  });
});

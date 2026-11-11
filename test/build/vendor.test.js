// Pins src/vendor to tools/vendor.lock.json and proves the tooling notices tampering.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REPO_ROOT, VENDOR_SET, importProblems, readLock, sync, verify,
} from "../../tools/vendor.mjs";

const SIDEKICK = "/home/user/sidekick";
const COMMIT = "77bcf22";
const haveSidekick = existsSync(join(SIDEKICK, ".git"))
  && spawnSync("git", ["-C", SIDEKICK, "cat-file", "-e", `${COMMIT}^{commit}`]).status === 0;

/** A scratch repo root holding just the lock and src/vendor. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "cccp-vendor-"));
  cpSync(join(REPO_ROOT, "src", "vendor"), join(dir, "src", "vendor"), { recursive: true });
  cpSync(join(REPO_ROOT, "tools"), join(dir, "tools"), { recursive: true });
  return dir;
}

const cli = (args) => spawnSync(process.execPath, [join(REPO_ROOT, "tools", "vendor.mjs"), ...args], { encoding: "utf8" });

describe("vendored tree", () => {
  it("matches the sha256 lock exactly", () => {
    expect(verify(REPO_ROOT)).toEqual([]);
  });

  it("locks exactly the verbatim set at the pinned commit", () => {
    const lock = readLock(REPO_ROOT);
    expect(lock.commit).toBe(COMMIT);
    expect(lock.files.map((f) => f.from).sort()).toEqual([...VENDOR_SET].sort());
    for (const f of lock.files) expect(f.to).toBe(`src/vendor/${f.from}`);
  });

  it("is listed in VENDOR.md with a re-sync recipe", () => {
    const md = readFileSync(join(REPO_ROOT, "VENDOR.md"), "utf8");
    for (const f of readLock(REPO_ROOT).files) expect(md, f.from).toContain(f.from);
    expect(md).toMatch(/vendor:sync/);
    expect(md).toMatch(/vendor:diff/);
  });

  it("fails after a 1-byte edit to any vendored file", () => {
    for (const f of readLock(REPO_ROOT).files) {
      const dir = scratch();
      try {
        const p = join(dir, f.to);
        const buf = readFileSync(p);
        buf[0] ^= 1;
        writeFileSync(p, buf);
        const problems = verify(dir);
        expect(problems.some((m) => m.includes(f.to) && m.includes("sha256")), f.to).toBe(true);
        expect(cli(["verify", "--root", dir]).status, f.to).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("fails on a deleted or an extra file under src/vendor", () => {
    const dir = scratch();
    try {
      const first = readLock(REPO_ROOT).files[0].to;
      rmSync(join(dir, first));
      expect(verify(dir).some((m) => m.includes("missing vendored file"))).toBe(true);
      writeFileSync(join(dir, "src", "vendor", "stray.js"), "export {};\n");
      expect(verify(dir).some((m) => m.includes("unlocked file"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes the CLI on the real tree", () => {
    expect(cli(["verify"]).status).toBe(0);
  });
});

describe("import containment", () => {
  const known = new Set(["src/vendor/a/x.js", "src/vendor/a/y.ts"]);
  it("accepts relative imports inside the set and node builtins", () => {
    const text = 'import { a } from "./y";\nimport fs from "node:fs";\nimport p from "path";\nexport { b } from "./x.js";\n';
    expect(importProblems("src/vendor/a/x.js", text, known)).toEqual([]);
  });
  it("rejects imports that leave the set or name a package", () => {
    expect(importProblems("src/vendor/a/x.js", 'import q from "../../../outside.js";', known)).toHaveLength(1);
    expect(importProblems("src/vendor/a/x.js", 'import q from "lodash";', known)).toHaveLength(1);
    expect(importProblems("src/vendor/a/x.js", 'const m = require("lodash");', known)).toHaveLength(1);
    expect(importProblems("src/vendor/a/x.js", 'const m = await import("./nope.js");', known)).toHaveLength(1);
    expect(importProblems("src/vendor/a/x.js", "const m = await import(name);", known)).toHaveLength(1);
    expect(importProblems("src/vendor/a/x.js", 'import "./side-effect.js";', known)).toHaveLength(1);
  });
  it("ignores import-looking text inside whole-line and block comments", () => {
    expect(importProblems("src/vendor/a/x.js", '// import ("x")\n/* import "zzz" */\n', known)).toEqual([]);
  });
});

describe.skipIf(!haveSidekick)("sync from sidekick", () => {
  it("writes exactly the locked files, byte for byte, via git show", () => {
    const dir = mkdtempSync(join(tmpdir(), "cccp-sync-"));
    try {
      const lock = sync({ from: SIDEKICK, commit: COMMIT, root: dir });
      const want = readLock(REPO_ROOT);
      expect(lock.files).toEqual(want.files);
      const written = [];
      const walk = (d) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : written.push(join(d, e.name))));
      walk(join(dir, "src", "vendor"));
      expect(written.length).toBe(want.files.length);
      for (const f of want.files) {
        const upstream = execFileSync("git", ["-C", SIDEKICK, "show", `${COMMIT}:${f.from}`], { maxBuffer: 1 << 26 });
        expect(readFileSync(join(dir, f.to)).equals(upstream), f.to).toBe(true);
      }
      expect(verify(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits non-zero and writes nothing when a vendored file imports outside the set", () => {
    // A throwaway upstream whose one file imports a sibling that is not vendored.
    const up = mkdtempSync(join(tmpdir(), "cccp-up-"));
    const dir = mkdtempSync(join(tmpdir(), "cccp-sync-bad-"));
    try {
      const sh = (...a) => execFileSync("git", ["-C", up, ...a], { stdio: "pipe" });
      sh("init", "-q");
      sh("config", "user.email", "t@example.com");
      sh("config", "user.name", "t");
      for (const f of VENDOR_SET) {
        const p = join(up, f);
        execFileSync("mkdir", ["-p", join(p, "..")]);
        writeFileSync(p, f.endsWith("settingsForm.js") ? 'import { x } from "../other/notVendored.js";\nexport const y = x;\n' : "export {};\n");
      }
      sh("add", "-A");
      sh("commit", "-q", "-m", "x");
      const r = spawnSync(process.execPath, [join(REPO_ROOT, "tools", "vendor.mjs"), "sync", "--from", up, "--commit", "HEAD", "--root", dir], { encoding: "utf8" });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/outside the vendored set/);
      expect(existsSync(join(dir, "src", "vendor"))).toBe(false);
      expect(existsSync(join(dir, "tools", "vendor.lock.json"))).toBe(false);
    } finally {
      rmSync(up, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

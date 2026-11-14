import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runScan } from "../src/scanner.js";
import {
  temporary,
  testConfig,
  useTemporaryRepository,
  write,
} from "./helpers.js";

useTemporaryRepository();

it("finds an untested production module in a full scan", () => {
  write("src/orphan.ts", "export const orphan = 1;\n");
  const result = runScan({
    cwd: temporary,
    config: testConfig(),
    mode: "all",
    baselinePath: false,
  });
  expect(result.activeFindings[0]?.rule).toBe("missing-test");
});

it("rejects scanned symlinks that resolve outside the repository", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "test-guard-outside-"));
  try {
    const target = path.join(outside, "escape.ts");
    fs.writeFileSync(target, "export const escaped = true;\n");
    fs.mkdirSync(path.join(temporary, "src"), { recursive: true });
    fs.symlinkSync(target, path.join(temporary, "src/escape.ts"));
    expect(() =>
      runScan({
        cwd: temporary,
        config: testConfig(),
        mode: "all",
        baselinePath: false,
      }),
    ).toThrow(/resolves outside the repository root/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

it("allows a missing baseline whose parent stays inside the repository", () => {
  const result = runScan({
    cwd: temporary,
    config: testConfig(),
    mode: "all",
    baselinePath: "state/missing-baseline.json",
  });
  expect(result.activeFindings).toEqual([]);
});

it("rejects a baseline symlink that resolves outside the repository", () => {
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "test-guard-baseline-"),
  );
  try {
    const target = path.join(outside, "baseline.json");
    fs.writeFileSync(target, '{"version":2,"findings":[]}\n');
    fs.symlinkSync(target, path.join(temporary, ".testguard-baseline.json"));
    expect(() =>
      runScan({
        cwd: temporary,
        config: testConfig(),
        mode: "all",
      }),
    ).toThrow(/baseline.*resolves outside the repository root/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

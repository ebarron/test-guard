import { expect, it } from "vitest";
import { formatResult } from "../src/output.js";
import type { Finding, ScanResult } from "../src/types.js";

it("renders an empty deterministic JSON result", () => {
  const result: ScanResult = {
    mode: "all",
    auditedFiles: [],
    findings: [],
    activeFindings: [],
    staleBaseline: [],
    waiverDiagnostics: [],
  };
  const output = JSON.parse(formatResult(result, "json")) as {
    summary: { active: number };
  };
  expect(output.summary.active).toBe(0);
});

it("emits only escaped workflow commands in GitHub format", () => {
  const finding: Finding = {
    rule: "internal-mock",
    severity: "error",
    file: "src/a\n::warning::forged.test.ts",
    line: 1,
    column: 1,
    message: "unsafe\n::error::forged",
    evidence: "module:unsafe",
    fingerprint: "0123456789abcdef0123456789abcdef",
  };
  const result: ScanResult = {
    mode: "all",
    auditedFiles: [finding.file],
    findings: [finding],
    activeFindings: [finding],
    staleBaseline: [],
    waiverDiagnostics: [],
  };
  const output = formatResult(result, "github");
  expect(output).toContain("%0A%3A%3Aerror%3A%3Aforged");
  expect(output).not.toContain("\n::error::forged");
  expect(output.split("\n")).toHaveLength(2);
  expect(
    output
      .split("\n")
      .every((line) => /^::(?:error|warning|notice)(?: |::)/.test(line)),
  ).toBe(true);
  expect(output).toContain("title=test-guard summary");
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyBaseline,
  applyBaselineSource,
  updateBaseline,
} from "../src/baseline.js";
import { formatResult } from "../src/output.js";
import { createFinding } from "../src/rules.js";
import type { Finding, ScanResult } from "../src/types.js";
import { parsePrWaivers, prWaiverFor } from "../src/waivers.js";
import { temporary, testConfig, useTemporaryRepository } from "./helpers.js";

useTemporaryRepository();

function internalMock(module: string, occurrence = 1): Finding {
  const finding = createFinding(testConfig(), {
    rule: "internal-mock",
    file: "src/a.test.ts",
    line: occurrence,
    message: `internal ${module}`,
    evidence: `module:${module}`,
    occurrence,
  });
  if (!finding) throw new Error("internal-mock unexpectedly disabled");
  return finding;
}

describe("PR waivers", () => {
  it("accepts scoped, unexpired waivers", () => {
    const parsed = parsePrWaivers(
      `## test-guard waiver
- Files: src/a.ts
- Rules: missing-test
- Reason: declarations are exercised through generated clients
- Expires: 2030-01-01
`,
      3,
      new Date("2029-12-31T12:00:00Z"),
    );
    expect(parsed.diagnostics).toEqual([]);
    expect(
      prWaiverFor(parsed.waivers, "src/a.ts", "missing-test")?.expires,
    ).toBe("2030-01-01");
    expect(
      prWaiverFor(parsed.waivers, "src/a.ts", "internal-mock"),
    ).toBeUndefined();
  });

  it("does not suppress expired, malformed, or boilerplate waivers", () => {
    const expired = parsePrWaivers(
      `## test-guard waiver
- Files: src/a.ts
- Reason: generated declarations have no executable behavior
- Expires: 2028-01-01
`,
      3,
      new Date("2029-01-01T00:00:00Z"),
    );
    expect(expired.waivers.size).toBe(0);
    expect(expired.diagnostics[0]?.message).toMatch(/expired/);

    const malformed = parsePrWaivers(
      `## test-guard waiver
- Files: src/a.ts
- Reason: WIP
- Expires: next week
`,
      3,
    );
    expect(malformed.waivers.size).toBe(0);
    expect(malformed.diagnostics).toHaveLength(1);
  });
});

describe("baseline v2", () => {
  it("masks one internal mock without masking another new mock", () => {
    const baselinePath = path.join(temporary, ".testguard-baseline.json");
    const first = internalMock("../one");
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        version: 2,
        findings: [
          {
            fingerprint: first.fingerprint,
            rule: first.rule,
            file: first.file,
          },
        ],
      }),
    );
    const second = internalMock("../two");
    applyBaseline([first, second], baselinePath);
    expect(first.baseline).toBe(true);
    expect(second.baseline).toBeUndefined();
  });

  it("reports stale entries and rejects legacy coarse data", () => {
    const baselinePath = path.join(temporary, ".testguard-baseline.json");
    const first = internalMock("../one");
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        version: 2,
        findings: [
          {
            fingerprint: first.fingerprint,
            rule: first.rule,
            file: first.file,
          },
        ],
      }),
    );
    expect(applyBaseline([], baselinePath)).toEqual([first.fingerprint]);

    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        findings: [{ file: "src/a.test.ts", pattern: "internal-mock" }],
      }),
    );
    expect(() => applyBaseline([first], baselinePath)).toThrow(
      /legacy coarse baseline/,
    );
  });

  it("rejects an empty trusted baseline blob instead of treating it as absent", () => {
    expect(() =>
      applyBaselineSource([], "", "trusted:.testguard-baseline.json"),
    ).toThrow(/could not parse baseline/);
  });

  it("rejects duplicate fingerprints and mismatched fingerprint metadata", () => {
    const baselinePath = path.join(temporary, ".testguard-baseline.json");
    const first = internalMock("../one");
    const entry = {
      fingerprint: first.fingerprint,
      rule: first.rule,
      file: first.file,
    };
    fs.writeFileSync(
      baselinePath,
      JSON.stringify({ version: 2, findings: [entry, entry] }),
    );
    expect(() => applyBaseline([first], baselinePath)).toThrow(
      /duplicate fingerprint/,
    );

    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        version: 2,
        findings: [entry, { ...entry, file: "src/other.test.ts" }],
      }),
    );
    expect(() => applyBaseline([first], baselinePath)).toThrow(
      /conflicting fingerprint/,
    );

    fs.writeFileSync(
      baselinePath,
      JSON.stringify({
        version: 2,
        findings: [{ ...entry, file: "src/other.test.ts" }],
      }),
    );
    expect(() => applyBaseline([first], baselinePath)).toThrow(
      /metadata does not match/,
    );
  });

  it("refuses silent growth, writes deterministically, and removes stale entries", () => {
    const baselinePath = path.join(temporary, ".testguard-baseline.json");
    const first = internalMock("../one");
    expect(() =>
      updateBaseline(baselinePath, [first], {
        acceptNew: false,
        migrateV1: false,
      }),
    ).toThrow(/would grow by 1/);

    updateBaseline(baselinePath, [first], {
      acceptNew: true,
      migrateV1: false,
    });
    const once = fs.readFileSync(baselinePath, "utf8");
    updateBaseline(baselinePath, [first], {
      acceptNew: false,
      migrateV1: false,
    });
    expect(fs.readFileSync(baselinePath, "utf8")).toBe(once);

    const update = updateBaseline(baselinePath, [], {
      acceptNew: false,
      migrateV1: false,
    });
    expect(update.stale).toBe(1);
    expect(update.total).toBe(0);
  });
});

describe("output formats", () => {
  it("emits stable JSON, SARIF fingerprints, and GitHub annotations", () => {
    const finding = internalMock("../one");
    const result: ScanResult = {
      mode: "all",
      auditedFiles: ["src/a.test.ts"],
      findings: [finding],
      activeFindings: [finding],
      staleBaseline: [],
      waiverDiagnostics: [],
    };
    const json = JSON.parse(formatResult(result, "json")) as {
      schemaVersion: number;
    };
    expect(json.schemaVersion).toBe(1);
    expect(formatResult(result, "sarif")).toContain(finding.fingerprint);
    expect(formatResult(result, "github")).toContain(
      "::error file=src/a.test.ts",
    );
    expect(formatResult(result, "human")).toContain("1 active");
  });
});

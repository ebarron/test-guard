import { describe, expect, it } from "vitest";
import {
  scanDifferentialFile,
  summarizeTestSource,
} from "../src/differential.js";
import { testConfig } from "./helpers.js";

describe("differential JavaScript/TypeScript rules", () => {
  it("finds reduced tests, assertions, new modifiers, and weaker matchers", () => {
    const findings = scanDifferentialFile(
      {
        beforePath: "src/example.test.ts",
        beforeSource: `
          it("value", () => {
            expect(value).toEqual({ id: 1 });
            expect(() => run()).toThrow(TypeError);
          });
          it("second", () => {
            expect(value).toBe(1);
          });
        `,
        afterPath: "src/example.test.ts",
        afterSource: `
          it.only("value", () => {
            expect(value).toBeTruthy();
            expect(() => run()).toThrow();
          });
        `,
      },
      testConfig(),
    );

    expect(findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining([
        "test-count",
        "assertion-count",
        "test-modifier",
        "matcher-weakened",
      ]),
    );
    expect(
      findings.filter((finding) => finding.rule === "matcher-weakened"),
    ).toHaveLength(2);
  });

  it("counts AST constructs without matching comments or strings", () => {
    const summary = summarizeTestSource(
      "src/example.test.ts",
      `
        // it.skip("not a test")
        const text = "expect(value).toBeTruthy()";
        test("real", () => expect(value).toBe(1));
      `,
    );
    expect(summary.testCount).toBe(1);
    expect(summary.assertionCount).toBe(1);
    expect(summary.modifiers).toEqual([]);
  });

  it("uses occurrence-specific stable fingerprints for repeated modifiers", () => {
    const before = `it("same", () => { expect(1).toBe(1); });`;
    const after = `
      it.skip("same", () => { expect(1).toBe(1); });
      it.skip("same", () => { expect(1).toBe(1); });
    `;
    const findings = scanDifferentialFile(
      {
        beforePath: "src/example.test.ts",
        beforeSource: before,
        afterPath: "src/example.test.ts",
        afterSource: after,
      },
      testConfig(),
    ).filter((finding) => finding.rule === "test-modifier");
    expect(findings).toHaveLength(2);
    expect(findings[0]?.fingerprint).not.toBe(findings[1]?.fingerprint);

    const shifted = scanDifferentialFile(
      {
        beforePath: "src/example.test.ts",
        beforeSource: before,
        afterPath: "src/example.test.ts",
        afterSource: `\n\n${after}`,
      },
      testConfig(),
    ).filter((finding) => finding.rule === "test-modifier");
    expect(shifted.map((finding) => finding.fingerprint)).toEqual(
      findings.map((finding) => finding.fingerprint),
    );
  });

  it("does not confuse a newly inserted assertion with a weakened one", () => {
    const findings = scanDifferentialFile(
      {
        beforePath: "src/example.test.ts",
        beforeSource: `it("value", () => {
          expect(actual).toEqual({ id: 1 });
        });`,
        afterPath: "src/example.test.ts",
        afterSource: `it("value", () => {
          expect(ready).toBeTruthy();
          expect(actual).toEqual({ id: 1 });
        });`,
      },
      testConfig(),
    );
    expect(
      findings.some((finding) => finding.rule === "matcher-weakened"),
    ).toBe(false);
  });

  it("distinguishes in-scope renames from moves out of test scope", () => {
    const source = `it("kept", () => { expect(1).toBe(1); });`;
    expect(
      scanDifferentialFile(
        {
          beforePath: "src/example.test.ts",
          beforeSource: source,
          afterPath: "src/example.spec.ts",
          afterSource: source,
        },
        testConfig(),
      ).some((finding) => finding.rule === "test-removed"),
    ).toBe(false);

    expect(
      scanDifferentialFile(
        {
          beforePath: "src/example.test.ts",
          beforeSource: source,
          afterPath: "archive/example.ts",
          afterSource: source,
        },
        testConfig(),
      ).some((finding) => finding.rule === "test-removed"),
    ).toBe(true);
  });
});

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { runScan } from "../src/scanner.js";
import {
  commit,
  git,
  remove,
  temporary,
  testConfig,
  useTemporaryRepository,
  write,
} from "./helpers.js";

useTemporaryRepository();

function writeConfig(): void {
  write(".testguard.yml", YAML.stringify(testConfig()));
}

function emptyBaseline(): void {
  write(
    ".testguard-baseline.json",
    `${JSON.stringify({ version: 2, findings: [] }, null, 2)}\n`,
  );
}

describe("snapshot selection", () => {
  it("rejects staged source symlinks instead of scanning link text", () => {
    writeConfig();
    commit();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "test-guard-link-"));
    try {
      const target = path.join(outside, "escape.ts");
      fs.writeFileSync(target, "export const escaped = true;\n");
      fs.mkdirSync(path.join(temporary, "src"), { recursive: true });
      fs.symlinkSync(target, path.join(temporary, "src/escape.ts"));
      git("add", "src/escape.ts");
      expect(() =>
        runScan({
          cwd: temporary,
          mode: "staged",
          baselinePath: false,
        }),
      ).toThrow(/symbolic link and cannot be scanned/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("does not emit before/after rules in all mode", () => {
    writeConfig();
    write(
      "src/example.test.ts",
      `it("value", () => { expect(value).toEqual({ id: 1 }); });\n`,
    );
    const result = runScan({
      cwd: temporary,
      mode: "all",
      baselinePath: false,
    });
    expect(
      result.findings.some((finding) =>
        [
          "test-removed",
          "test-count",
          "assertion-count",
          "test-modifier",
          "matcher-weakened",
          "policy-change",
        ].includes(finding.rule),
      ),
    ).toBe(false);
  });

  it("compares HEAD to the index despite unstaged divergence", () => {
    writeConfig();
    emptyBaseline();
    write(
      "src/example.test.ts",
      `it("value", () => {
        expect(value).toBe(1);
        expect(other).toBe(2);
      });\n`,
    );
    commit();

    write(
      "src/example.test.ts",
      `it("value", () => { expect(value).toBe(1); });\n`,
    );
    git("add", "src/example.test.ts");
    write(
      "src/example.test.ts",
      `it("value", () => {
        expect(value).toBe(1);
        expect(other).toBe(2);
        expect(third).toBe(3);
      });\n`,
    );

    const result = runScan({
      cwd: temporary,
      mode: "staged",
    });
    expect(result.policySource).toBe("trusted");
    expect(
      result.activeFindings.some(
        (finding) => finding.rule === "assertion-count",
      ),
    ).toBe(true);
  });

  it("compares the merge base directly with the final worktree", () => {
    writeConfig();
    emptyBaseline();
    const original = `it("value", () => {
      expect(value).toBe(1);
      expect(other).toBe(2);
    });\n`;
    write("src/example.test.ts", original);
    commit();
    git("branch", "base");

    write(
      "src/example.test.ts",
      `it("value", () => { expect(value).toBe(1); });\n`,
    );
    commit("temporary weakening");
    write("src/example.test.ts", original);

    const result = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
    });
    expect(
      result.findings.some(
        (finding) =>
          finding.rule === "assertion-count" || finding.rule === "test-count",
      ),
    ).toBe(false);
  });

  it("handles in-scope renames and paths containing spaces", () => {
    writeConfig();
    emptyBaseline();
    write(
      "src/example old.test.ts",
      `it("kept", () => { expect(1).toBe(1); });\n`,
    );
    commit();
    git("branch", "base");
    git("mv", "src/example old.test.ts", "src/example new.spec.ts");

    const result = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
    });
    expect(
      result.findings.some((finding) => finding.rule === "test-removed"),
    ).toBe(false);
  });

  it("recognizes an unchanged unstaged delete/add pair as a test rename", () => {
    writeConfig();
    emptyBaseline();
    const source = `it("kept", () => { expect(1).toBe(1); });\n`;
    write("src/original.test.ts", source);
    commit();
    git("branch", "base");
    remove("src/original.test.ts");
    write("src/replacement.spec.ts", source);

    const result = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
    });
    expect(
      result.findings.some((finding) => finding.rule === "test-removed"),
    ).toBe(false);
  });

  it("does not parse an in-scope Go test rename as TypeScript", () => {
    writeConfig();
    emptyBaseline();
    write("pkg/old_test.go", "package pkg\nfunc TestOld() {}\n");
    commit();
    git("branch", "base");
    git("mv", "pkg/old_test.go", "pkg/new_test.go");

    const result = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
    });
    expect(
      result.findings.some((finding) => finding.rule === "test-removed"),
    ).toBe(false);
  });

  it("finds deletion and movement out of configured test scope", () => {
    writeConfig();
    emptyBaseline();
    const source = `it("kept", () => { expect(1).toBe(1); });\n`;
    write("src/deleted.test.ts", source);
    write("src/moved.test.ts", source);
    commit();
    git("branch", "base");
    remove("src/deleted.test.ts");
    git("mv", "src/moved.test.ts", "src/moved.ts");

    const result = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
    });
    expect(
      result.activeFindings.filter(
        (finding) => finding.rule === "test-removed",
      ),
    ).toHaveLength(2);
  });
});

describe("trusted policy and baseline", () => {
  it("takes the implicit default base from trusted policy", () => {
    writeConfig();
    emptyBaseline();
    write(
      "src/example.test.ts",
      `it("one", () => { expect(1).toBe(1); });
       it("two", () => { expect(2).toBe(2); });\n`,
    );
    commit();
    git("branch", "origin/main");

    const untrusted = testConfig();
    untrusted.defaultBase = "HEAD";
    untrusted.rules["test-count"] = "off";
    write(".testguard.yml", YAML.stringify(untrusted));
    write("src/example.test.ts", `it("one", () => { expect(1).toBe(1); });\n`);
    const output: string[] = [];
    const errors: string[] = [];
    const code = runCli(
      ["scan", "--diff", "--format", "json"],
      {
        stdout: (message) => output.push(message),
        stderr: (message) => errors.push(message),
      },
      temporary,
    );
    expect(errors).toEqual([]);
    expect(code).toBe(1);
    expect(output.join("")).toContain('"rule": "test-count"');
  });

  it("ignores untrusted rule weakening and baseline growth", () => {
    writeConfig();
    emptyBaseline();
    write(
      "src/example.test.ts",
      `it("one", () => { expect(1).toBe(1); });
       it("two", () => { expect(2).toBe(2); });\n`,
    );
    write("package.json", '{"scripts":{"test":"vitest run"}}\n');
    write(
      ".github/workflows/test.yml",
      "jobs:\n  test:\n    steps:\n      - run: npx test-guard scan --diff\n",
    );
    commit();
    git("branch", "base");

    const weakened = testConfig();
    weakened.rules["test-count"] = "off";
    weakened.rules["policy-change"] = "off";
    weakened.production.include = [];
    write(".testguard.yml", YAML.stringify(weakened));
    write("package.json", '{"scripts":{"test":"echo bypass"}}\n');
    write(
      ".github/workflows/test.yml",
      "jobs:\n  test:\n    steps:\n      - run: echo bypass\n",
    );
    write("src/example.test.ts", `it("one", () => { expect(1).toBe(1); });\n`);

    const first = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
    });
    const countFinding = first.activeFindings.find(
      (finding) => finding.rule === "test-count",
    );
    expect(countFinding).toBeDefined();
    expect(first.policySource).toBe("trusted");
    expect(
      first.activeFindings.some(
        (finding) =>
          finding.rule === "policy-change" && finding.file === ".testguard.yml",
      ),
    ).toBe(true);
    expect(
      first.activeFindings.filter(
        (finding) => finding.rule === "policy-change",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "package.json" }),
        expect.objectContaining({ file: ".github/workflows/test.yml" }),
      ]),
    );

    write(
      ".testguard-baseline.json",
      `${JSON.stringify(
        {
          version: 2,
          findings: countFinding
            ? [
                {
                  fingerprint: countFinding.fingerprint,
                  rule: countFinding.rule,
                  file: countFinding.file,
                },
              ]
            : [],
        },
        null,
        2,
      )}\n`,
    );
    const second = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
    });
    expect(
      second.activeFindings.some((finding) => finding.rule === "test-count"),
    ).toBe(true);
    expect(
      second.activeFindings.some(
        (finding) =>
          finding.rule === "policy-change" &&
          finding.file === ".testguard-baseline.json",
      ),
    ).toBe(true);
  });

  it("reports initial adoption and does not trust its baseline", () => {
    write("README.md", "# fixture\n");
    commit();
    git("branch", "base");
    writeConfig();
    emptyBaseline();

    const result = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
    });
    expect(result.policySource).toBe("current");
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "bootstrap-policy" }),
      ]),
    );
    expect(
      result.activeFindings.some(
        (finding) =>
          finding.rule === "policy-change" && finding.file === ".testguard.yml",
      ),
    ).toBe(true);
  });

  it("requires a detailed waiver for a legitimate deleted-test replacement", () => {
    writeConfig();
    emptyBaseline();
    write(
      "src/legacy.test.ts",
      `it("legacy", () => { expect(1).toBe(1); });\n`,
    );
    commit();
    git("branch", "base");
    remove("src/legacy.test.ts");

    const result = runScan({
      cwd: temporary,
      mode: "diff",
      base: "base",
      prBody: `## test-guard waiver
- Files: src/legacy.test.ts
- Rules: test-removed
- Reason: replacement coverage lives in the reviewed contract suite
`,
    });
    const removed = result.findings.find(
      (finding) => finding.rule === "test-removed",
    );
    expect(removed?.waiver?.source).toBe("pr");
    expect(result.activeFindings).not.toContainEqual(removed);
  });

  it("fails explicitly when the trusted baseline blob is malformed", () => {
    writeConfig();
    write(".testguard-baseline.json", "{not-json");
    write("src/example.test.ts", `it("one", () => { expect(1).toBe(1); });\n`);
    commit();
    git("branch", "base");
    write(
      "src/example.test.ts",
      `it.skip("one", () => { expect(1).toBe(1); });\n`,
    );

    expect(() =>
      runScan({
        cwd: temporary,
        mode: "diff",
        base: "base",
      }),
    ).toThrow(/could not parse baseline/);
  });

  it("fails explicitly when the trusted policy blob is malformed", () => {
    write(".testguard.yml", "version: [broken\n");
    write("README.md", "# fixture\n");
    commit();
    git("branch", "base");
    writeConfig();

    expect(() =>
      runScan({
        cwd: temporary,
        mode: "diff",
        base: "base",
      }),
    ).toThrow(/could not parse|invalid .testguard.yml/);
  });
});

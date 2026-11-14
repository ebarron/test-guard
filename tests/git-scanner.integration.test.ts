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

describe("Git scan modes", () => {
  it("staged mode audits staged files without changing Git state", () => {
    write("README.md", "# fixture\n");
    commit();
    write("src/orphan.ts", "export const orphan = 1;\n");
    git("add", "src/orphan.ts");
    write("src/unstaged.ts", "export const unstaged = 1;\n");
    const before = git("status", "--porcelain=v1");
    const result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "staged",
      baselinePath: false,
    });
    expect(result.auditedFiles).toContain("src/orphan.ts");
    expect(result.auditedFiles).not.toContain("src/unstaged.ts");
    expect(result.activeFindings[0]?.rule).toBe("missing-test");
    expect(git("status", "--porcelain=v1")).toBe(before);
  });

  it("diff mode includes committed, staged, unstaged, and untracked changes", () => {
    write("src/tracked.ts", "export const tracked = 1;\n");
    write(
      "src/tracked.test.ts",
      `it('tracked', () => { expect(1).toBe(1); });\n`,
    );
    write("README.md", "# fixture\n");
    commit();
    git("branch", "base");

    write("src/committed.ts", "export const committed = 1;\n");
    commit("committed change");
    write("src/staged.ts", "export const staged = 1;\n");
    git("add", "src/staged.ts");
    write("src/tracked.ts", "export const tracked = 2;\n");
    write("src/untracked.ts", "export const untracked = 1;\n");

    const result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    expect(result.auditedFiles).toEqual(
      expect.arrayContaining([
        "src/committed.ts",
        "src/staged.ts",
        "src/tracked.ts",
        "src/untracked.ts",
      ]),
    );
  });

  it("reconciles committed, staged, and unstaged deletions to the final worktree", () => {
    for (const name of ["committed", "staged", "unstaged"]) {
      write(`src/${name}.ts`, `export const ${name} = 1;\n`);
      write(
        `src/${name}.test.ts`,
        `it("${name}", () => { expect(1).toBe(1); });\n`,
      );
    }
    commit();
    git("branch", "base");

    for (const name of ["committed", "staged", "unstaged"]) {
      write(`src/${name}.ts`, `export const ${name} = 2;\n`);
    }
    commit("modify production");
    git("rm", "src/committed.ts");
    commit("delete committed production");
    git("rm", "src/staged.ts");
    remove("src/unstaged.ts");

    const diff = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    for (const name of ["committed", "staged", "unstaged"]) {
      expect(diff.auditedFiles).not.toContain(`src/${name}.ts`);
    }

    const all = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "all",
      baselinePath: false,
    });
    expect(all.auditedFiles).not.toContain("src/unstaged.ts");
  });

  it("reports a missing or shallow-clone-style base error", () => {
    write("README.md", "# fixture\n");
    commit();
    expect(() =>
      runScan({
        cwd: temporary,
        config: testConfig(),
        mode: "diff",
        base: "origin/does-not-exist",
        baselinePath: false,
      }),
    ).toThrow(/fetch-depth: 0/);
  });
});

describe("test deletion and rename handling", () => {
  it("detects deletion of the last Go package test", () => {
    write("pkg/a.go", "package pkg\nfunc A() int { return 1 }\n");
    write("pkg/a_test.go", "package pkg\nfunc TestA() {}\n");
    commit();
    git("branch", "base");
    remove("pkg/a_test.go");
    const result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    expect(
      result.activeFindings.find(
        (finding) =>
          finding.file === "pkg/a.go" && finding.rule === "missing-test",
      ),
    ).toBeDefined();
  });

  it("does not fail when another Go test remains", () => {
    write("pkg/a.go", "package pkg\nfunc A() int { return 1 }\n");
    write("pkg/a_test.go", "package pkg\nfunc TestA() {}\n");
    write("pkg/b_test.go", "package pkg\nfunc TestB() {}\n");
    commit();
    git("branch", "base");
    remove("pkg/a_test.go");
    const result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    expect(
      result.activeFindings.find(
        (finding) =>
          finding.file === "pkg/a.go" && finding.rule === "missing-test",
      ),
    ).toBeUndefined();
  });

  it("detects removed colocated tests and understands test renames", () => {
    write("src/Foo.ts", "export const Foo = 1;\n");
    write("src/Foo.test.ts", `it('Foo', () => { expect(Foo).toBe(1); });\n`);
    commit();
    git("branch", "base");
    remove("src/Foo.test.ts");
    let result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    expect(
      result.activeFindings.find(
        (finding) =>
          finding.file === "src/Foo.ts" && finding.rule === "missing-test",
      ),
    ).toBeDefined();

    write("src/Foo.spec.ts", `it('Foo', () => { expect(Foo).toBe(1); });\n`);
    result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    expect(
      result.activeFindings.find(
        (finding) =>
          finding.file === "src/Foo.ts" && finding.rule === "missing-test",
      ),
    ).toBeUndefined();
  });

  it("retains a deleted-test event after an earlier committed test change", () => {
    write("src/Foo.ts", "export const Foo = 1;\n");
    write("src/Foo.test.ts", `it("Foo", () => { expect(1).toBe(1); });\n`);
    commit();
    git("branch", "base");

    write(
      "src/Foo.test.ts",
      `it("Foo updated", () => { expect(1).toBe(1); });\n`,
    );
    commit("update test");
    git("rm", "src/Foo.test.ts");

    const result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    expect(
      result.activeFindings.find(
        (finding) =>
          finding.file === "src/Foo.ts" && finding.rule === "missing-test",
      ),
    ).toBeDefined();
  });

  it("handles staged production and test renames", () => {
    write("src/Foo.ts", "export const Foo = 1;\n");
    write("src/Foo.test.ts", `it("Foo", () => { expect(1).toBe(1); });\n`);
    commit();
    git("branch", "base");
    git("mv", "src/Foo.ts", "src/Bar.ts");
    git("mv", "src/Foo.test.ts", "src/Bar.test.ts");
    const result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    expect(result.auditedFiles).toEqual(
      expect.arrayContaining(["src/Bar.ts", "src/Bar.test.ts"]),
    );
    expect(
      result.activeFindings.find(
        (finding) =>
          finding.file === "src/Bar.ts" && finding.rule === "missing-test",
      ),
    ).toBeUndefined();
  });

  it("collapses committed and staged rename chains to existing final paths", () => {
    write("src/Foo.ts", "export const Foo = 1;\n");
    write("src/Foo.test.ts", `it("Foo", () => { expect(1).toBe(1); });\n`);
    commit();
    git("branch", "base");

    git("mv", "src/Foo.ts", "src/Bar.ts");
    git("mv", "src/Foo.test.ts", "src/Bar.test.ts");
    commit("first rename");
    git("mv", "src/Bar.ts", "src/Baz.ts");
    git("mv", "src/Bar.test.ts", "src/Baz.test.ts");

    const result = runScan({
      cwd: temporary,
      config: testConfig(),
      mode: "diff",
      base: "base",
      baselinePath: false,
    });
    expect(result.auditedFiles).toEqual(
      expect.arrayContaining(["src/Baz.ts", "src/Baz.test.ts"]),
    );
    expect(result.auditedFiles).not.toEqual(
      expect.arrayContaining(["src/Bar.ts", "src/Bar.test.ts"]),
    );
    expect(
      result.activeFindings.find(
        (finding) =>
          finding.file === "src/Baz.ts" && finding.rule === "missing-test",
      ),
    ).toBeUndefined();
  });
});

describe("CLI failures", () => {
  it("returns exit code 2 for scanner or configuration failures", () => {
    write("README.md", "# fixture\n");
    commit();
    const errors: string[] = [];
    const code = runCli(
      ["scan", "--all"],
      { stdout: () => undefined, stderr: (message) => errors.push(message) },
      temporary,
    );
    expect(code).toBe(2);
    expect(errors.join("")).toMatch(/configuration not found/);
  });
});

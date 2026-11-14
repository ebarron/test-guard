import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { runCli } from "../src/cli.js";
import { renderPreset } from "../src/config.js";
import { temporary, useTemporaryRepository, write } from "./helpers.js";

useTemporaryRepository();

it("uses exit code 2 when configuration is missing", () => {
  const messages: string[] = [];
  expect(
    runCli(
      ["scan", "--all"],
      {
        stdout: () => undefined,
        stderr: (message) => messages.push(message),
      },
      temporary,
    ),
  ).toBe(2);
  expect(messages.join("")).toMatch(/configuration not found/);
});

it("rejects config and baseline paths outside the repository", () => {
  const configErrors: string[] = [];
  expect(
    runCli(
      ["scan", "--all", "--config", "../outside.yml"],
      {
        stdout: () => undefined,
        stderr: (message) => configErrors.push(message),
      },
      temporary,
    ),
  ).toBe(2);
  expect(configErrors.join("")).toMatch(/must not contain "\.\."/);

  write(".testguard.yml", renderPreset("typescript"));
  const baselineErrors: string[] = [];
  expect(
    runCli(
      ["scan", "--all", "--baseline", "../outside.json"],
      {
        stdout: () => undefined,
        stderr: (message) => baselineErrors.push(message),
      },
      temporary,
    ),
  ).toBe(2);
  expect(baselineErrors.join("")).toMatch(/must not contain "\.\."/);
});

it("rejects a configuration symlink that resolves outside the repository", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "test-guard-config-"));
  try {
    const target = path.join(outside, ".testguard.yml");
    fs.writeFileSync(target, renderPreset("typescript"));
    fs.symlinkSync(target, path.join(temporary, ".linked-testguard.yml"));
    const errors: string[] = [];
    expect(
      runCli(
        ["scan", "--all", "--config", ".linked-testguard.yml"],
        {
          stdout: () => undefined,
          stderr: (message) => errors.push(message),
        },
        temporary,
      ),
    ).toBe(2);
    expect(errors.join("")).toMatch(
      /configuration.*resolves outside the repository root/,
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { PRESETS } from "../src/config.js";
import type { TestGuardConfig } from "../src/types.js";

export let temporary = "";

export function useTemporaryRepository(): void {
  beforeEach(() => {
    temporary = fs.mkdtempSync(path.join(os.tmpdir(), "test-guard-"));
    fs.mkdirSync(path.join(temporary, ".empty-hooks"));
    execFileSync("git", ["init", "-q", "--initial-branch=main"], {
      cwd: temporary,
    });
    git("config", "user.email", "test-guard@example.invalid");
    git("config", "user.name", "test-guard");
    git("config", "commit.gpgsign", "false");
    git("config", "tag.gpgsign", "false");
    git("config", "core.hooksPath", path.join(temporary, ".empty-hooks"));
  });
  afterEach(() => {
    fs.rmSync(temporary, { recursive: true, force: true });
  });
}

export function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: temporary,
    encoding: "utf8",
  }).trim();
}

export function write(file: string, source: string): void {
  const absolute = path.join(temporary, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, source);
}

export function remove(file: string): void {
  fs.rmSync(path.join(temporary, file));
}

export function commit(message = "snapshot"): void {
  git("add", "-A");
  git("commit", "-q", "-m", message);
}

export function testConfig(): TestGuardConfig {
  const config = structuredClone(PRESETS.polyglot);
  config.production.include = ["**/*.{go,ts,tsx,py}"];
  config.production.exclude = [
    "**/{node_modules,vendor,dist,build,coverage,testdata}/**",
    "**/__fixtures__/**",
    "**/*.d.ts",
    "**/zz_generated.*",
    "**/*.pb.go",
  ];
  config.playwright.testGlobs = ["**/e2e/**/*.spec.ts"];
  return config;
}

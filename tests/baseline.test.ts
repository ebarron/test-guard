import path from "node:path";
import { expect, it } from "vitest";
import { updateBaseline } from "../src/baseline.js";
import { createFinding } from "../src/rules.js";
import { temporary, testConfig, useTemporaryRepository } from "./helpers.js";

useTemporaryRepository();

it("requires explicit acceptance before a baseline grows", () => {
  const finding = createFinding(testConfig(), {
    rule: "missing-test",
    file: "src/orphan.ts",
    line: 1,
    message: "missing",
    evidence: "strategy:colocated",
  });
  if (!finding) throw new Error("missing-test unexpectedly disabled");
  expect(() =>
    updateBaseline(
      path.join(temporary, ".testguard-baseline.json"),
      [finding],
      { acceptNew: false, migrateV1: false },
    ),
  ).toThrow(/would grow/);
});

import { expect, it } from "vitest";
import { isProductionPath, isTestPath } from "../src/files.js";
import { testConfig } from "./helpers.js";

it("separates configured production and test paths", () => {
  const config = testConfig();
  expect(isProductionPath("src/widget.ts", config)).toBe(true);
  expect(isProductionPath("src/widget.test.ts", config)).toBe(false);
  expect(isTestPath("src/widget.test.ts", config)).toBe(true);
});

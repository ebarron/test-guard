import YAML from "yaml";
import { expect, it } from "vitest";
import { parseConfig, renderPreset } from "../src/config.js";

it("renders a valid strict TypeScript preset", () => {
  expect(parseConfig(YAML.parse(renderPreset("typescript"))).version).toBe(1);
});

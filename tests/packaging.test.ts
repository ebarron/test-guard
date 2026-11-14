import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

it("ships the Cursor skill and documents npm and SHA-pinned installation", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { files?: string[] };
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");

  expect(packageJson.files).toContain("skills");
  expect(fs.existsSync(path.join(root, "skills/test-guard/SKILL.md"))).toBe(
    true,
  );
  expect(readme).toContain("npm package is not currently published");
  expect(readme).toContain(
    "https://github.com/ebarron/test-guard/archive/${TEST_GUARD_SHA}.tar.gz",
  );
  expect(readme).toContain("raw.githubusercontent.com/ebarron/test-guard/");
  expect(readme).toContain("${TEST_GUARD_SHA}");
  expect(readme).toContain(
    "node_modules/@edjbarron/test-guard/skills/test-guard/SKILL.md",
  );
});

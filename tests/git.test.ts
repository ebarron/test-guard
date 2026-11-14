import { expect, it } from "vitest";
import { collectChanges } from "../src/git.js";
import { commit, temporary, useTemporaryRepository, write } from "./helpers.js";

useTemporaryRepository();

it("fails explicitly when a diff base is unavailable", () => {
  write("README.md", "# fixture\n");
  commit();
  expect(() =>
    collectChanges(temporary, "diff", "origin/does-not-exist"),
  ).toThrow(/base .* is unavailable/);
});

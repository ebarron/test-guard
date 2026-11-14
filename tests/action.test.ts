import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { expect, it } from "vitest";
import { runAction } from "../src/action.js";
import {
  temporary,
  testConfig,
  useTemporaryRepository,
  write,
} from "./helpers.js";

useTemporaryRepository();

it("emits exit-code 2 for wrapper validation failures", () => {
  const output = path.join(temporary, "github-output");
  const code = runAction({
    ...process.env,
    INPUT_MODE: "invalid",
    GITHUB_OUTPUT: output,
  });
  expect(code).toBe(2);
  expect(fs.readFileSync(output, "utf8")).toBe("exit-code=2\n");
});

it("requires the trusted event label before applying PR-body waivers", () => {
  write(".testguard.yml", YAML.stringify(testConfig()));
  write("src/orphan.ts", "export const orphan = true;\n");
  const event = path.join(temporary, "event.json");
  const body = `## test-guard waiver
- Files: src/orphan.ts
- Rules: missing-test
- Reason: generated declarations contain no executable behavior
`;
  fs.writeFileSync(
    event,
    JSON.stringify({ pull_request: { body, labels: [] } }),
  );
  const unapproved = runAction({
    ...process.env,
    INPUT_MODE: "all",
    INPUT_FORMAT: "json",
    GITHUB_EVENT_PATH: event,
    GITHUB_WORKSPACE: temporary,
    TEST_GUARD_PR_BODY: body,
  });
  expect(unapproved).toBe(1);

  fs.writeFileSync(
    event,
    JSON.stringify({
      pull_request: {
        body,
        labels: [{ name: "test-guard:waiver-approved" }],
      },
    }),
  );
  const approved = runAction({
    ...process.env,
    INPUT_MODE: "all",
    INPUT_FORMAT: "json",
    GITHUB_EVENT_PATH: event,
    GITHUB_WORKSPACE: temporary,
  });
  expect(approved).toBe(0);
});

it("fails closed on malformed event payloads", () => {
  write(".testguard.yml", YAML.stringify(testConfig()));
  write("src/orphan.ts", "export const orphan = true;\n");
  const event = path.join(temporary, "event.json");
  fs.writeFileSync(event, "{not-json");
  expect(
    runAction({
      ...process.env,
      INPUT_MODE: "all",
      INPUT_FORMAT: "json",
      INPUT_PR_BODY: `## test-guard waiver
- Files: src/orphan.ts
- Rules: missing-test
- Reason: generated declarations contain no executable behavior
`,
      GITHUB_EVENT_PATH: event,
      GITHUB_WORKSPACE: temporary,
    }),
  ).toBe(1);
});

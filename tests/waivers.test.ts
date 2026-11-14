import { expect, it } from "vitest";
import {
  fileInlineWaiver,
  inlineWaiverAt,
  parsePrWaivers,
} from "../src/waivers.js";

it("does not accept an expired PR waiver", () => {
  const parsed = parsePrWaivers(
    `## test-guard waiver
- Files: src/a.ts
- Reason: generated file contains no executable behavior
- Expires: 2026-01-01
`,
    3,
    new Date("2026-11-14T00:00:00Z"),
  );
  expect(parsed.waivers.size).toBe(0);
  expect(parsed.diagnostics[0]?.message).toMatch(/expired/);
});

it("ignores PR waiver examples hidden in HTML comments or fences", () => {
  const waiver = `- Files: src/a.ts
- Rules: missing-test
- Reason: generated declarations contain no executable behavior`;
  const hidden = parsePrWaivers(
    `## test-guard waiver
<!--
${waiver}
-->
`,
    3,
  );
  const fenced = parsePrWaivers(
    `## test-guard waiver
\`\`\`markdown
${waiver}
\`\`\`
`,
    3,
  );
  expect(hidden.waivers.size).toBe(0);
  expect(fenced.waivers.size).toBe(0);
});

it("accepts waiver markers only from lexical comment lines", () => {
  const line =
    "// test-guard-skip: legacy adapter requires contract coverage\ncall();";
  const block =
    "/*\n * test-guard-skip: legacy adapter requires contract coverage\n */\ncall();";
  const python =
    "# test-guard-skip: legacy adapter requires contract coverage\ncall()";
  expect(inlineWaiverAt(line, 2, 3)?.source).toBe("inline");
  expect(inlineWaiverAt(block, 4, 3)?.source).toBe("inline");
  expect(inlineWaiverAt(python, 2, 3)?.source).toBe("inline");

  const string =
    'const marker = "test-guard-skip: ordinary string must not waive";\ncall();';
  expect(fileInlineWaiver(string, 3)).toBeUndefined();
  expect(inlineWaiverAt(string, 2, 3)).toBeUndefined();
  expect(
    fileInlineWaiver(
      'value = """\ntest-guard-skip: multiline string must not waive\n"""\n',
      3,
    ),
  ).toBeUndefined();
  expect(
    fileInlineWaiver(
      'class Example {\n  #field = "test-guard-skip: private field must not waive";\n}',
      3,
    ),
  ).toBeUndefined();
});

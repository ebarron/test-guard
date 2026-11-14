import { describe, expect, it } from "vitest";
import { fingerprintFor, scanTestSource } from "../src/rules.js";
import { testConfig } from "./helpers.js";

describe("AST-backed TypeScript rules", () => {
  it("finds a shallow assertion but accepts a substantive sibling assertion", () => {
    const config = testConfig();
    const shallow = scanTestSource(
      "src/route.test.ts",
      `it('status', () => { expect(response.status).toBe(200); });`,
      config,
    );
    expect(shallow.map((finding) => finding.rule)).toContain(
      "shallow-assertion",
    );

    const rich = scanTestSource(
      "src/route.test.ts",
      `it('status', () => {
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ id: 'x' });
      });`,
      config,
    );
    expect(rich.some((finding) => finding.rule === "shallow-assertion")).toBe(
      false,
    );
  });

  it("finds every internal mock with a distinct stable fingerprint", () => {
    const config = testConfig();
    const findings = scanTestSource(
      "src/view.test.ts",
      `vi.mock('@/hooks/useThing');
       vi.mock('@/hooks/useThing');`,
      config,
    ).filter((finding) => finding.rule === "internal-mock");
    expect(findings).toHaveLength(2);
    expect(findings[0]?.fingerprint).not.toBe(findings[1]?.fingerprint);
    expect(
      scanTestSource(
        "src/view.test.ts",
        `\n\nvi.mock('@/hooks/useThing');`,
        config,
      )[0]?.fingerprint,
    ).toBe(findings[0]?.fingerprint);
  });

  it("allows configured mock boundaries and external modules", () => {
    const findings = scanTestSource(
      "src/view.test.ts",
      `vi.mock('node:fs'); vi.mock('../api');`,
      testConfig(),
    );
    expect(findings.some((finding) => finding.rule === "internal-mock")).toBe(
      false,
    );
  });

  it("finds repeated inline fetch mocks at the configured threshold", () => {
    const source = Array.from(
      { length: 3 },
      (_, index) =>
        `it('case ${index}', () => { globalThis.fetch = vi.fn(); expect(${index}).toBe(${index}); });`,
    ).join("\n");
    expect(
      scanTestSource("src/api.test.ts", source, testConfig()).find(
        (finding) => finding.rule === "inline-fetch-mock",
      )?.evidence,
    ).toBe("count:3");
  });

  it("finds test-id-only component tests and allows role queries", () => {
    const config = testConfig();
    expect(
      scanTestSource(
        "src/Widget.test.tsx",
        `it('renders', () => { screen.getByTestId('save'); });`,
        config,
      ).some((finding) => finding.rule === "test-id-over-role"),
    ).toBe(true);
    expect(
      scanTestSource(
        "src/Widget.test.tsx",
        `it('renders', () => {
          screen.getByRole('button', { name: 'Save' });
          screen.getByTestId('legacy');
        });`,
        config,
      ).some((finding) => finding.rule === "test-id-over-role"),
    ).toBe(false);
  });

  it("keeps test-id findings test-local and ignores unrelated query objects", () => {
    const config = testConfig();
    const separateTests = scanTestSource(
      "src/Widget.test.tsx",
      `it('legacy', () => {
        screen.getByTestId('legacy');
      });
      it('accessible', () => {
        screen.getByRole('button');
      });`,
      config,
    ).filter((finding) => finding.rule === "test-id-over-role");
    expect(separateTests).toHaveLength(1);
    expect(separateTests[0]?.evidence).toContain("test:legacy");

    const unrelated = scanTestSource(
      "src/Widget.test.tsx",
      `it('legacy', () => {
        screen.getByTestId('legacy');
        dataClient.getByRole('admin');
      });`,
      config,
    );
    expect(
      unrelated.some((finding) => finding.rule === "test-id-over-role"),
    ).toBe(true);

    const withinQuery = scanTestSource(
      "src/Widget.test.tsx",
      `it('scoped', () => {
        screen.getByTestId('legacy');
        within(dialog).getByRole('button');
      });`,
      config,
    );
    expect(
      withinQuery.some((finding) => finding.rule === "test-id-over-role"),
    ).toBe(false);
  });

  it("requires a reason beside Playwright API stubs", () => {
    const config = testConfig();
    const unreasoned = scanTestSource(
      "ui/e2e/catalog.spec.ts",
      `test('catalog', async ({ page }) => {
        await page.route('**/api/catalog', route => route.abort());
      });`,
      config,
    );
    expect(
      unreasoned.some((finding) => finding.rule === "playwright-api-stub"),
    ).toBe(true);

    const reasoned = scanTestSource(
      "ui/e2e/catalog.spec.ts",
      `test('catalog', async ({ page }) => {
        // reason: simulate an unavailable catalog service
        await page.route('**/api/catalog', route => route.abort());
      });`,
      config,
    );
    expect(
      reasoned.some((finding) => finding.rule === "playwright-api-stub"),
    ).toBe(false);

    const unrelatedCode = scanTestSource(
      "ui/e2e/catalog.spec.ts",
      `test('catalog', async ({ page }) => {
        const reason: string = 'not a comment';
        await page.route('**/api/catalog', route => route.abort());
      });`,
      config,
    );
    expect(
      unrelatedCode.some((finding) => finding.rule === "playwright-api-stub"),
    ).toBe(true);

    const shallowComment = scanTestSource(
      "ui/e2e/catalog.spec.ts",
      `test('catalog', async ({ page }) => {
        // reason: temporary
        await page.route('**/api/catalog', route => route.abort());
      });`,
      config,
    );
    expect(
      shallowComment.some((finding) => finding.rule === "playwright-api-stub"),
    ).toBe(true);
  });

  it("honors substantive inline waivers but rejects boilerplate", () => {
    const config = testConfig();
    const waived = scanTestSource(
      "src/a.test.ts",
      `// test-guard-skip: legacy seam requires this internal adapter
       vi.mock('../adapter');`,
      config,
    );
    expect(waived[0]?.waiver?.reason).toMatch(/legacy seam/);
    const rejected = scanTestSource(
      "src/a.test.ts",
      `// test-guard-skip: WIP
       vi.mock('../adapter');`,
      config,
    );
    expect(rejected[0]?.waiver).toBeUndefined();
  });

  it("rejects malformed TypeScript instead of silently scanning clean", () => {
    expect(() =>
      scanTestSource("src/a.test.ts", `it('broken', () => {`, testConfig()),
    ).toThrow(/could not parse/);
  });
});

describe("fingerprints", () => {
  it("do not depend on source line but include semantic evidence", () => {
    expect(fingerprintFor("internal-mock", "a.test.ts", "module:../a")).toBe(
      fingerprintFor("internal-mock", "a.test.ts", "module:../a"),
    );
    expect(
      fingerprintFor("internal-mock", "a.test.ts", "module:../a"),
    ).not.toBe(fingerprintFor("internal-mock", "a.test.ts", "module:../b"));
  });
});

import fs from "node:fs";
import YAML from "yaml";
import { z } from "zod";
import { resolveRepositoryPath } from "./files.js";
import { RULE_IDS, TestGuardError, type TestGuardConfig } from "./types.js";

function safeRepositoryPath(
  value: string,
  leadingSlashAllowed: boolean,
): boolean {
  const normalized = value.replaceAll("\\", "/");
  const windowsAbsolute =
    /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//");
  return (
    !windowsAbsolute &&
    (leadingSlashAllowed || !normalized.startsWith("/")) &&
    !normalized.split("/").some((segment) => segment === "..")
  );
}

const severity = z.enum(["off", "notice", "warning", "error"]);
const companionDirectory = z
  .string()
  .min(1)
  .refine((value) => safeRepositoryPath(value, true), {
    message:
      'must be repository-relative (a leading "/" means repository root) and must not contain ".."',
  });
const baselinePath = z
  .string()
  .min(1)
  .refine((value) => safeRepositoryPath(value, false), {
    message: 'must be repository-relative and must not contain ".."',
  });
const fileClass = z
  .object({
    extensions: z.array(z.string().startsWith(".")).min(1),
    testGlobs: z.array(z.string()).min(1),
  })
  .strict();
const companion = z
  .object({
    strategy: z.enum(["go-package", "colocated", "python-test-name"]),
    directories: z.array(companionDirectory).min(1),
    suffixes: z.array(z.string().min(1)),
  })
  .strict();

const configSchema = z
  .object({
    version: z.literal(1),
    production: z
      .object({
        include: z.array(z.string()).min(1),
        exclude: z.array(z.string()),
      })
      .strict(),
    fileClasses: z
      .object({
        typescript: fileClass,
        go: fileClass,
        python: fileClass,
      })
      .strict(),
    companions: z
      .object({
        typescript: companion,
        go: companion,
        python: companion,
      })
      .strict(),
    mockBoundaries: z
      .object({
        internalPrefixes: z.array(z.string()),
        allowModules: z.array(z.string()),
        boundaryGlobs: z.array(z.string()),
      })
      .strict(),
    rules: z
      .object(
        Object.fromEntries(RULE_IDS.map((rule) => [rule, severity])) as Record<
          (typeof RULE_IDS)[number],
          typeof severity
        >,
      )
      .strict(),
    baseline: baselinePath,
    defaultBase: z.string().min(1),
    waivers: z
      .object({
        minimumReasonWords: z.number().int().min(3).max(50),
      })
      .strict(),
    inlineFetchMockThreshold: z.number().int().min(1),
    playwright: z
      .object({
        testGlobs: z.array(z.string()),
        apiPathFragments: z.array(z.string()).min(1),
      })
      .strict(),
  })
  .strict();

const common: Omit<TestGuardConfig, "production" | "defaultBase"> = {
  version: 1,
  fileClasses: {
    typescript: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"],
      testGlobs: [
        "**/*.test.{ts,tsx,js,jsx,mts,cts}",
        "**/*.spec.{ts,tsx,js,jsx,mts,cts}",
        "**/__tests__/**/*.{ts,tsx,js,jsx,mts,cts}",
      ],
    },
    go: { extensions: [".go"], testGlobs: ["**/*_test.go"] },
    python: {
      extensions: [".py"],
      testGlobs: ["**/test_*.py", "**/*_test.py"],
    },
  },
  companions: {
    typescript: {
      strategy: "colocated",
      directories: [".", "__tests__"],
      suffixes: [".test", ".spec"],
    },
    go: {
      strategy: "go-package",
      directories: ["."],
      suffixes: ["_test"],
    },
    python: {
      strategy: "python-test-name",
      directories: [".", "tests"],
      suffixes: ["test_"],
    },
  },
  mockBoundaries: {
    internalPrefixes: ["@/", "./", "../"],
    allowModules: ["fs", "node:*"],
    boundaryGlobs: ["**/api", "**/*.api", "@/APIClient"],
  },
  rules: {
    "missing-test": "error",
    "test-removed": "error",
    "test-count": "error",
    "assertion-count": "error",
    "test-modifier": "error",
    "matcher-weakened": "error",
    "policy-change": "error",
    "shallow-assertion": "error",
    "internal-mock": "error",
    "inline-fetch-mock": "warning",
    "test-id-over-role": "warning",
    "playwright-api-stub": "error",
  },
  baseline: ".testguard-baseline.json",
  waivers: { minimumReasonWords: 3 },
  inlineFetchMockThreshold: 3,
  playwright: {
    testGlobs: ["**/e2e/**/*.spec.ts", "**/playwright/**/*.spec.ts"],
    apiPathFragments: ["/api/", "/v1/"],
  },
};

export const PRESETS: Record<"polyglot" | "typescript", TestGuardConfig> = {
  polyglot: {
    ...common,
    production: {
      include: ["**/*.{go,ts,tsx,js,jsx,mts,cts,py}"],
      exclude: [
        "**/{node_modules,vendor,dist,build,coverage,testdata}/**",
        "**/__fixtures__/**",
        "**/*.d.ts",
        "**/*.generated.*",
        "**/zz_generated.*",
        "**/*.pb.go",
      ],
    },
    defaultBase: "origin/main",
  },
  typescript: {
    ...common,
    production: {
      include: ["src/**/*.{ts,tsx}", "server/**/*.ts", "scripts/**/*.ts"],
      exclude: [
        "**/{node_modules,dist,build,coverage}/**",
        "**/__fixtures__/**",
        "**/*.d.ts",
        "**/*.generated.*",
      ],
    },
    defaultBase: "origin/main",
  },
};

export function parseConfig(value: unknown): TestGuardConfig {
  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new TestGuardError(`invalid .testguard.yml: ${details}`);
  }
  for (const [language, item] of Object.entries(parsed.data.companions)) {
    const expected = {
      typescript: "colocated",
      go: "go-package",
      python: "python-test-name",
    }[language];
    if (item.strategy !== expected) {
      throw new TestGuardError(
        `invalid .testguard.yml: companions.${language}.strategy must be ${expected}`,
      );
    }
  }
  if (parsed.data.rules["policy-change"] === "off") {
    throw new TestGuardError(
      "invalid .testguard.yml: rules.policy-change cannot be off",
    );
  }
  return parsed.data;
}

export function parseConfigSource(
  source: string,
  description = ".testguard.yml",
): TestGuardConfig {
  try {
    return parseConfig(YAML.parse(source) as unknown);
  } catch (error) {
    if (error instanceof TestGuardError) throw error;
    throw new TestGuardError(
      `could not parse ${description}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadConfig(
  cwd: string,
  configPath = ".testguard.yml",
): TestGuardConfig {
  const absolute = resolveRepositoryPath(cwd, configPath, {
    kind: "configuration",
    allowMissing: true,
  });
  let source: string;
  try {
    source = fs.readFileSync(absolute, "utf8");
  } catch {
    throw new TestGuardError(
      `configuration not found at ${absolute}; run "testguard init"`,
    );
  }
  try {
    return parseConfigSource(source, absolute);
  } catch (error) {
    if (error instanceof TestGuardError) throw error;
    throw new TestGuardError(
      `could not parse ${absolute}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function renderPreset(name: keyof typeof PRESETS): string {
  return YAML.stringify(PRESETS[name], { lineWidth: 100 });
}

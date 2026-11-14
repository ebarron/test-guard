import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import {
  TestGuardError,
  type Language,
  type TestGuardConfig,
} from "./types.js";

const matchOptions = { dot: true, nocase: false };

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function existingAncestor(candidate: string): string {
  let current = candidate;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return current;
}

export interface RepositoryPathOptions {
  kind: string;
  allowMissing?: boolean;
  leadingSlashIsRepositoryRoot?: boolean;
}

export function resolveRepositoryPath(
  cwd: string,
  value: string,
  options: RepositoryPathOptions,
): string {
  const windowsAbsolute =
    /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
  const repositoryRooted =
    options.leadingSlashIsRepositoryRoot === true &&
    value.startsWith("/") &&
    !value.startsWith("//");
  if (windowsAbsolute || (path.posix.isAbsolute(value) && !repositoryRooted)) {
    throw new TestGuardError(
      `${options.kind} path "${value}" must be repository-relative`,
    );
  }
  const relative = normalizePath(repositoryRooted ? value.slice(1) : value);
  if (
    relative.includes("\0") ||
    relative.split("/").some((segment) => segment === "..")
  ) {
    throw new TestGuardError(
      `${options.kind} path "${value}" must not contain ".."`,
    );
  }
  const root = path.resolve(cwd);
  const absolute = path.resolve(root, relative || ".");
  if (!inside(root, absolute)) {
    throw new TestGuardError(
      `${options.kind} path "${value}" escapes the repository root`,
    );
  }
  const rootReal = fs.realpathSync(root);
  let entryExists = true;
  try {
    fs.lstatSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      entryExists = false;
    } else {
      throw new TestGuardError(
        `${options.kind} path "${value}" could not be inspected: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  let targetReal: string;
  try {
    targetReal = fs.realpathSync(absolute);
  } catch (error) {
    if (!options.allowMissing || entryExists) {
      throw new TestGuardError(
        `${options.kind} path "${value}" could not be resolved: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const ancestor = existingAncestor(path.dirname(absolute));
    try {
      targetReal = fs.realpathSync(ancestor);
    } catch (ancestorError) {
      throw new TestGuardError(
        `${options.kind} path "${value}" could not be resolved: ${ancestorError instanceof Error ? ancestorError.message : String(ancestorError)}`,
      );
    }
  }
  if (!inside(rootReal, targetReal)) {
    throw new TestGuardError(
      `${options.kind} path "${value}" resolves outside the repository root`,
    );
  }
  return absolute;
}

export function repositoryFileExists(
  cwd: string,
  value: string,
  kind = "scanned file",
): boolean {
  const absolute = resolveRepositoryPath(cwd, value, {
    kind,
    allowMissing: true,
  });
  return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
}

function matchesAny(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => minimatch(file, pattern, matchOptions));
}

export function languageOf(
  file: string,
  config: TestGuardConfig,
): Language | undefined {
  const extension = path.posix.extname(normalizePath(file));
  return (Object.keys(config.fileClasses) as Language[]).find((language) =>
    config.fileClasses[language].extensions.includes(extension),
  );
}

export function isTestPath(file: string, config: TestGuardConfig): boolean {
  const normalized = normalizePath(file);
  return (
    Object.values(config.fileClasses).some((item) =>
      matchesAny(normalized, item.testGlobs),
    ) || matchesAny(normalized, config.playwright.testGlobs)
  );
}

export function isProductionPath(
  file: string,
  config: TestGuardConfig,
): boolean {
  const normalized = normalizePath(file);
  if (!languageOf(normalized, config) || isTestPath(normalized, config))
    return false;
  if (matchesAny(normalized, config.production.exclude)) return false;
  return matchesAny(normalized, config.production.include);
}

export function isGeneratedGo(file: string, cwd: string): boolean {
  if (!file.endsWith(".go")) return false;
  try {
    const absolute = resolveRepositoryPath(cwd, file, {
      kind: "scanned file",
    });
    const source = fs.readFileSync(absolute, "utf8");
    return isGeneratedGoSource(file, source);
  } catch (error) {
    if (error instanceof TestGuardError) throw error;
    throw new TestGuardError(
      `could not inspect ${file}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function isGeneratedGoSource(file: string, source: string): boolean {
  return (
    file.endsWith(".go") &&
    /^\/\/ Code generated .* DO NOT EDIT\.\r?$/m.test(source.slice(0, 4096))
  );
}

function filesIn(cwd: string, directory: string): string[] {
  const normalizedDirectory = normalizePath(directory) || ".";
  const absoluteDirectory = resolveRepositoryPath(cwd, normalizedDirectory, {
    kind: "companion directory",
    allowMissing: true,
  });
  if (!fs.existsSync(absoluteDirectory)) return [];
  return fs
    .readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) =>
      normalizePath(
        normalizedDirectory === "."
          ? entry.name
          : path.posix.join(normalizedDirectory, entry.name),
      ),
    )
    .filter((candidate) => {
      const absolute = resolveRepositoryPath(cwd, candidate, {
        kind: "companion file",
      });
      return fs.statSync(absolute).isFile();
    });
}

function companionDirectory(
  sourceDirectory: string,
  configured: string,
): string {
  const normalized = normalizePath(configured);
  if (
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith("//") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new TestGuardError(
      `companion directory "${configured}" must be repository-relative and must not contain ".."`,
    );
  }
  if (normalized === ".") return sourceDirectory;
  if (normalized.startsWith("/")) return normalized.slice(1);
  return normalizePath(path.posix.join(sourceDirectory, normalized));
}

function isTypeScriptCompanion(
  productionBase: string,
  testName: string,
  config: TestGuardConfig,
): boolean {
  const extension = path.posix.extname(testName);
  if (!config.fileClasses.typescript.extensions.includes(extension))
    return false;
  const stem = testName.slice(0, -extension.length);
  return config.companions.typescript.suffixes.some((suffix) => {
    const marker = `${suffix}.`;
    if (!stem.endsWith(suffix)) return false;
    const beforeSuffix = stem.slice(0, -suffix.length);
    return (
      beforeSuffix === productionBase ||
      beforeSuffix.startsWith(`${productionBase}.`) ||
      stem.includes(marker)
    );
  });
}

export function companionTestPaths(
  productionFile: string,
  cwd: string,
  config: TestGuardConfig,
): string[] {
  const file = normalizePath(productionFile);
  const language = languageOf(file, config);
  if (!language) return [];
  const directory = path.posix.dirname(file);
  const extension = path.posix.extname(file);
  const base = path.posix.basename(file, extension);
  const companion = config.companions[language];

  if (companion.strategy === "go-package") {
    return filesIn(cwd, directory).filter(
      (candidate) =>
        candidate.endsWith("_test.go") && isTestPath(candidate, config),
    );
  }

  if (companion.strategy === "python-test-name") {
    return companion.directories
      .flatMap((configured) => {
        const target = companionDirectory(directory, configured);
        return companion.suffixes.map((prefix) =>
          normalizePath(path.posix.join(target, `${prefix}${base}.py`)),
        );
      })
      .filter((candidate) => {
        const absolute = resolveRepositoryPath(cwd, candidate, {
          kind: "companion file",
          allowMissing: true,
        });
        return fs.existsSync(absolute) && fs.statSync(absolute).isFile();
      });
  }

  return companion.directories
    .flatMap((configured) =>
      filesIn(cwd, companionDirectory(directory, configured)),
    )
    .filter((candidate) =>
      isTypeScriptCompanion(base, path.posix.basename(candidate), config),
    );
}

export function companionTestPathsFromFiles(
  productionFile: string,
  files: string[],
  config: TestGuardConfig,
): string[] {
  const file = normalizePath(productionFile);
  const normalizedFiles = [...new Set(files.map(normalizePath))];
  const available = new Set(normalizedFiles);
  const language = languageOf(file, config);
  if (!language) return [];
  const directory = path.posix.dirname(file);
  const extension = path.posix.extname(file);
  const base = path.posix.basename(file, extension);
  const companion = config.companions[language];

  if (companion.strategy === "go-package") {
    return normalizedFiles.filter(
      (candidate) =>
        path.posix.dirname(candidate) === directory &&
        candidate.endsWith("_test.go") &&
        isTestPath(candidate, config),
    );
  }

  if (companion.strategy === "python-test-name") {
    return companion.directories
      .flatMap((configured) => {
        const target = companionDirectory(directory, configured);
        return companion.suffixes.map((prefix) =>
          normalizePath(path.posix.join(target, `${prefix}${base}.py`)),
        );
      })
      .filter((candidate) => available.has(candidate));
  }

  return companion.directories
    .flatMap((configured) => {
      const target = companionDirectory(directory, configured);
      return normalizedFiles.filter(
        (candidate) => path.posix.dirname(candidate) === target,
      );
    })
    .filter((candidate) =>
      isTypeScriptCompanion(base, path.posix.basename(candidate), config),
    )
    .sort();
}

function typeScriptTestDirectory(
  productionDirectory: string,
  testDirectory: string,
  config: TestGuardConfig,
): boolean {
  return config.companions.typescript.directories.some(
    (configured) =>
      companionDirectory(productionDirectory, configured) === testDirectory,
  );
}

export function productionAffectedByDeletedTest(
  deletedTest: string,
  productionFiles: string[],
  config: TestGuardConfig,
): string[] {
  const deleted = normalizePath(deletedTest);
  const language = languageOf(deleted, config);
  if (!language) return [];
  const testDirectory = path.posix.dirname(deleted);
  const testName = path.posix.basename(deleted);

  if (language === "go") {
    return productionFiles.filter(
      (candidate) =>
        candidate.endsWith(".go") &&
        path.posix.dirname(candidate) === testDirectory,
    );
  }

  if (language === "python") {
    return productionFiles.filter((candidate) => {
      if (!candidate.endsWith(".py")) return false;
      const sourceDirectory = path.posix.dirname(candidate);
      const base = path.posix.basename(candidate, ".py");
      return config.companions.python.directories.some((configured) => {
        const expectedDirectory = companionDirectory(
          sourceDirectory,
          configured,
        );
        return (
          expectedDirectory === testDirectory &&
          config.companions.python.suffixes.some(
            (prefix) => `${prefix}${base}.py` === testName,
          )
        );
      });
    });
  }

  return productionFiles.filter((candidate) => {
    if (languageOf(candidate, config) !== "typescript") return false;
    const sourceDirectory = path.posix.dirname(candidate);
    const extension = path.posix.extname(candidate);
    const base = path.posix.basename(candidate, extension);
    return (
      typeScriptTestDirectory(sourceDirectory, testDirectory, config) &&
      isTypeScriptCompanion(base, testName, config)
    );
  });
}

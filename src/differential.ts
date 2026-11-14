import path from "node:path";
import ts from "typescript";
import { isTestPath, languageOf } from "./files.js";
import { createFinding } from "./rules.js";
import type { Finding, TestGuardConfig, Waiver } from "./types.js";
import { fileInlineWaiver, inlineWaiverAt } from "./waivers.js";

interface Assertion {
  matcher: string;
  argumentCount: number;
  subject: string;
  line: number;
  column: number;
}

interface TestCase {
  key: string;
  title: string;
  assertions: Assertion[];
}

interface Modifier {
  kind: "skip" | "focus" | "todo" | "failing";
  construct: string;
  title: string;
  line: number;
  column: number;
}

export interface TestSourceSummary {
  testCount: number;
  assertionCount: number;
  tests: TestCase[];
  modifiers: Modifier[];
}

export interface DifferentialFile {
  beforePath: string;
  beforeSource: string;
  afterPath?: string | undefined;
  afterSource?: string | undefined;
}

function scriptKind(file: string): ts.ScriptKind {
  const extension = path.extname(file);
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function callPath(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const left = callPath(expression.expression);
    return left ? `${left}.${expression.name.text}` : undefined;
  }
  return undefined;
}

function staticTitle(node: ts.Node | undefined): string {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : "<dynamic>";
}

function location(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const point = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { line: point.line + 1, column: point.character + 1 };
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function matcher(call: ts.CallExpression): Assertion | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  let receiver: ts.Expression = call.expression.expression;
  while (ts.isPropertyAccessExpression(receiver))
    receiver = receiver.expression;
  if (!ts.isCallExpression(receiver)) return undefined;
  const expectPath = callPath(receiver.expression);
  if (expectPath !== "expect" && expectPath !== "expect.soft") return undefined;
  const at = location(call.getSourceFile(), call);
  return {
    matcher: call.expression.name.text,
    argumentCount: call.arguments.length,
    subject:
      receiver.arguments[0]
        ?.getText(call.getSourceFile())
        .replace(/\s+/g, " ")
        .trim() ?? "<missing>",
    ...at,
  };
}

function invokedPath(call: ts.CallExpression):
  | {
      path: string;
      builder: boolean;
    }
  | undefined {
  const direct = callPath(call.expression);
  if (direct) {
    return {
      path: direct,
      builder:
        direct.split(".").includes("each") &&
        ts.isCallExpression(call.parent) &&
        call.parent.expression === call,
    };
  }
  if (ts.isCallExpression(call.expression)) {
    const path = callPath(call.expression.expression);
    if (path?.split(".").includes("each")) return { path, builder: false };
  }
  return undefined;
}

function callbackOf(call: ts.CallExpression): ts.Node | undefined {
  return call.arguments.find(
    (argument) =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
  );
}

function isTestCasePath(value: string): boolean {
  const segments = value.split(".");
  const root = segments[0];
  if (root === "fit" || root === "xit" || root === "xtest") return true;
  if (root !== "it" && root !== "test") return false;
  return segments
    .slice(1)
    .every((segment) =>
      new Set([
        "only",
        "skip",
        "todo",
        "failing",
        "fails",
        "concurrent",
        "sequential",
        "each",
      ]).has(segment),
    );
}

function modifierFor(value: string): Modifier["kind"] | undefined {
  const segments = value.split(".");
  const root = segments[0];
  if (root === "fit" || root === "fdescribe" || segments.includes("only"))
    return "focus";
  if (
    root === "xit" ||
    root === "xtest" ||
    root === "xdescribe" ||
    segments.includes("skip")
  )
    return "skip";
  if (segments.includes("todo")) return "todo";
  if (segments.includes("failing") || segments.includes("fails"))
    return "failing";
  return undefined;
}

export function summarizeTestSource(
  file: string,
  source: string,
): TestSourceSummary {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const parsed = sourceFile as ts.SourceFile & {
    parseDiagnostics: readonly ts.DiagnosticWithLocation[];
  };
  if (parsed.parseDiagnostics.length > 0) {
    const first = parsed.parseDiagnostics[0];
    throw new Error(
      `could not parse ${file}: ${ts.flattenDiagnosticMessageText(first?.messageText ?? "", "\n")}`,
    );
  }

  const tests: TestCase[] = [];
  const modifiers: Modifier[] = [];
  let assertionCount = 0;
  const testOccurrences = new Map<string, number>();

  visit(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (matcher(node)) assertionCount++;
    const invoked = invokedPath(node);
    if (!invoked || invoked.builder) return;
    const modifier = modifierFor(invoked.path);
    const root = invoked.path.split(".")[0];
    const testLike =
      isTestCasePath(invoked.path) ||
      root === "describe" ||
      root === "fdescribe" ||
      root === "xdescribe";
    if (!testLike) return;

    const title = staticTitle(node.arguments[0]);
    if (modifier) {
      modifiers.push({
        kind: modifier,
        construct: invoked.path,
        title,
        ...location(sourceFile, node),
      });
    }
    if (!isTestCasePath(invoked.path)) return;

    const occurrence = (testOccurrences.get(title) ?? 0) + 1;
    testOccurrences.set(title, occurrence);
    const assertions: Assertion[] = [];
    const callback = callbackOf(node);
    if (callback) {
      visit(callback, (candidate) => {
        if (!ts.isCallExpression(candidate)) return;
        const assertion = matcher(candidate);
        if (assertion) assertions.push(assertion);
      });
    }
    tests.push({
      key: `${title}\0${occurrence}`,
      title,
      assertions,
    });
  });

  return {
    testCount: tests.length,
    assertionCount,
    tests,
    modifiers,
  };
}

function addFinding(
  findings: Finding[],
  config: TestGuardConfig,
  input: Parameters<typeof createFinding>[1],
): void {
  const finding = createFinding(config, input);
  if (finding) findings.push(finding);
}

function differentialWaiver(
  source: string,
  line: number,
  config: TestGuardConfig,
): Waiver | undefined {
  return (
    inlineWaiverAt(source, line, config.waivers.minimumReasonWords) ??
    fileInlineWaiver(source, config.waivers.minimumReasonWords)
  );
}

function addedModifiers(
  before: Modifier[],
  after: Modifier[],
): { modifier: Modifier; occurrence: number }[] {
  const beforeCounts = new Map<string, number>();
  for (const modifier of before) {
    const key = `${modifier.kind}\0${modifier.construct}\0${modifier.title}`;
    beforeCounts.set(key, (beforeCounts.get(key) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const added: { modifier: Modifier; occurrence: number }[] = [];
  for (const modifier of after) {
    const key = `${modifier.kind}\0${modifier.construct}\0${modifier.title}`;
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    if (occurrence > (beforeCounts.get(key) ?? 0)) {
      added.push({ modifier, occurrence });
    }
  }
  return added;
}

const exactMatchers = new Set(["toBe", "toEqual", "toStrictEqual"]);
const weakMatchers = new Set(["toBeTruthy", "toBeDefined"]);

export function scanDifferentialFile(
  change: DifferentialFile,
  config: TestGuardConfig,
): Finding[] {
  const findings: Finding[] = [];
  const beforeIsTest = isTestPath(change.beforePath, config);
  const afterIsTest =
    change.afterPath !== undefined && isTestPath(change.afterPath, config);
  if (!beforeIsTest) return findings;

  if (!afterIsTest || change.afterSource === undefined) {
    addFinding(findings, config, {
      rule: "test-removed",
      file: change.beforePath,
      line: 1,
      message: change.afterPath
        ? `test file moved outside configured test scope to ${change.afterPath}`
        : "test file was deleted without an in-scope rename",
      evidence: change.afterPath ? `moved-out:${change.afterPath}` : "deleted",
      waiver: fileInlineWaiver(
        change.beforeSource,
        config.waivers.minimumReasonWords,
      ),
    });
    return findings;
  }

  const afterPath = change.afterPath;
  const afterSource = change.afterSource;
  if (!afterPath) return findings;
  if (
    languageOf(change.beforePath, config) !== "typescript" ||
    languageOf(afterPath, config) !== "typescript"
  ) {
    return findings;
  }
  const before = summarizeTestSource(change.beforePath, change.beforeSource);
  const after = summarizeTestSource(afterPath, afterSource);
  const waiver = differentialWaiver(afterSource, 1, config);
  if (after.testCount < before.testCount) {
    addFinding(findings, config, {
      rule: "test-count",
      file: afterPath,
      line: 1,
      message: `JavaScript/TypeScript test-case count decreased from ${before.testCount} to ${after.testCount}`,
      evidence: `before:${before.testCount}|after:${after.testCount}`,
      waiver,
    });
  }
  if (after.assertionCount < before.assertionCount) {
    addFinding(findings, config, {
      rule: "assertion-count",
      file: afterPath,
      line: 1,
      message: `JavaScript/TypeScript assertion count decreased from ${before.assertionCount} to ${after.assertionCount}`,
      evidence: `before:${before.assertionCount}|after:${after.assertionCount}`,
      waiver,
    });
  }

  for (const { modifier, occurrence } of addedModifiers(
    before.modifiers,
    after.modifiers,
  )) {
    addFinding(findings, config, {
      rule: "test-modifier",
      file: afterPath,
      line: modifier.line,
      column: modifier.column,
      message: `new ${modifier.kind} test construct ${modifier.construct} requires review`,
      evidence: `kind:${modifier.kind}|construct:${modifier.construct}|test:${modifier.title}`,
      occurrence,
      waiver: differentialWaiver(afterSource, modifier.line, config),
    });
  }

  const afterTests = new Map(after.tests.map((test) => [test.key, test]));
  for (const beforeTest of before.tests) {
    const afterTest = afterTests.get(beforeTest.key);
    if (!afterTest) continue;
    const afterOccurrences = new Map<string, number>();
    const afterAssertions = new Map<string, Assertion>();
    for (const assertion of afterTest.assertions) {
      const occurrence = (afterOccurrences.get(assertion.subject) ?? 0) + 1;
      afterOccurrences.set(assertion.subject, occurrence);
      afterAssertions.set(`${assertion.subject}\0${occurrence}`, assertion);
    }
    const beforeOccurrences = new Map<string, number>();
    for (const oldAssertion of beforeTest.assertions) {
      const occurrence = (beforeOccurrences.get(oldAssertion.subject) ?? 0) + 1;
      beforeOccurrences.set(oldAssertion.subject, occurrence);
      const newAssertion = afterAssertions.get(
        `${oldAssertion.subject}\0${occurrence}`,
      );
      if (!newAssertion) continue;
      const equalityWeakened =
        exactMatchers.has(oldAssertion.matcher) &&
        weakMatchers.has(newAssertion.matcher);
      const throwWeakened =
        oldAssertion.matcher === "toThrow" &&
        oldAssertion.argumentCount > 0 &&
        newAssertion.matcher === "toThrow" &&
        newAssertion.argumentCount === 0;
      if (!equalityWeakened && !throwWeakened) continue;
      addFinding(findings, config, {
        rule: "matcher-weakened",
        file: afterPath,
        line: newAssertion.line,
        column: newAssertion.column,
        message: throwWeakened
          ? "typed or message-specific throw assertion became an untyped throw assertion"
          : `exact matcher ${oldAssertion.matcher} became ${newAssertion.matcher}`,
        evidence: `test:${beforeTest.key}|subject:${oldAssertion.subject}|occurrence:${occurrence}|matcher:${oldAssertion.matcher}->${newAssertion.matcher}`,
        waiver: differentialWaiver(afterSource, newAssertion.line, config),
      });
    }
  }
  return findings;
}

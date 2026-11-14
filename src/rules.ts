import { createHash } from "node:crypto";
import path from "node:path";
import { minimatch } from "minimatch";
import ts from "typescript";
import {
  fileInlineWaiver,
  hasSubstantiveReasonComment,
  inlineWaiverAt,
} from "./waivers.js";
import type {
  Finding,
  RuleId,
  Severity,
  TestGuardConfig,
  Waiver,
} from "./types.js";

interface FindingInput {
  rule: RuleId;
  file: string;
  line: number;
  column?: number;
  message: string;
  evidence: string;
  occurrence?: number | undefined;
  waiver?: Waiver | undefined;
}

export function fingerprintFor(
  rule: RuleId,
  file: string,
  evidence: string,
  occurrence = 1,
): string {
  return createHash("sha256")
    .update(`v2\0${rule}\0${file}\0${evidence}\0${occurrence}`)
    .digest("hex")
    .slice(0, 32);
}

export function createFinding(
  config: TestGuardConfig,
  input: FindingInput,
): Finding | undefined {
  const severity: Severity = config.rules[input.rule];
  if (severity === "off") return undefined;
  const finding: Finding = {
    rule: input.rule,
    severity,
    file: input.file,
    line: input.line,
    column: input.column ?? 1,
    message: input.message,
    evidence: input.evidence,
    fingerprint: fingerprintFor(
      input.rule,
      input.file,
      input.evidence,
      input.occurrence,
    ),
  };
  if (input.waiver) finding.waiver = input.waiver;
  return finding;
}

function scriptKind(file: string): ts.ScriptKind {
  const extension = path.extname(file);
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function location(
  sourceFile: ts.SourceFile,
  node: ts.Node,
): {
  line: number;
  column: number;
} {
  const point = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { line: point.line + 1, column: point.character + 1 };
}

function propertyName(expression: ts.Expression): string | undefined {
  return ts.isPropertyAccessExpression(expression)
    ? expression.name.text
    : undefined;
}

function callPath(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const left = callPath(expression.expression);
    return left ? `${left}.${expression.name.text}` : undefined;
  }
  return undefined;
}

function staticString(node: ts.Node | undefined): string | undefined {
  return node &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function visit(node: ts.Node, callback: (node: ts.Node) => void): void {
  callback(node);
  ts.forEachChild(node, (child) => visit(child, callback));
}

function containsCall(node: ts.Node, expected: string): boolean {
  let found = false;
  visit(node, (candidate) => {
    if (
      ts.isCallExpression(candidate) &&
      callPath(candidate.expression) === expected
    ) {
      found = true;
    }
  });
  return found;
}

function expectationMatcher(call: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  let expression: ts.Expression = call.expression.expression;
  while (ts.isPropertyAccessExpression(expression))
    expression = expression.expression;
  return ts.isCallExpression(expression) &&
    callPath(expression.expression) === "expect"
    ? call.expression.name.text
    : undefined;
}

function testCallback(call: ts.CallExpression): ts.Node | undefined {
  const name = callPath(call.expression);
  if (!name || !["it", "test", "it.only", "test.only"].includes(name))
    return undefined;
  return call.arguments.find(
    (argument) =>
      ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
  );
}

function isNumeric200(node: ts.Node | undefined): boolean {
  return Boolean(node && ts.isNumericLiteral(node) && node.text === "200");
}

function moduleAllowed(specifier: string, config: TestGuardConfig): boolean {
  const options = { dot: true, matchBase: true };
  const boundarySpecifier = specifier.replace(/^(?:\.\.?\/)+/, "");
  return (
    config.mockBoundaries.allowModules.some((pattern) =>
      minimatch(specifier, pattern, options),
    ) ||
    config.mockBoundaries.boundaryGlobs.some((pattern) =>
      minimatch(boundarySpecifier, pattern, options),
    )
  );
}

function internalModule(specifier: string, config: TestGuardConfig): boolean {
  return (
    !moduleAllowed(specifier, config) &&
    config.mockBoundaries.internalPrefixes.some((prefix) =>
      specifier.startsWith(prefix),
    )
  );
}

const TEST_ID_QUERIES = new Set([
  "getByTestId",
  "findByTestId",
  "queryByTestId",
]);
const ROLE_QUERIES = new Set(["getByRole", "findByRole", "queryByRole"]);

function testingLibraryBindings(root: ts.Node): {
  receivers: Set<string>;
  aliases: Map<string, string>;
} {
  const receivers = new Set<string>();
  const aliases = new Map<string, string>();
  visit(root, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer) return;
    const initializerName = ts.isCallExpression(node.initializer)
      ? callPath(node.initializer.expression)
      : callPath(node.initializer);
    const querySource =
      initializerName === "screen" ||
      initializerName === "render" ||
      initializerName?.endsWith(".render");
    if (!querySource) return;
    if (ts.isIdentifier(node.name)) {
      if (initializerName !== "screen") receivers.add(node.name.text);
      return;
    }
    if (!ts.isObjectBindingPattern(node.name)) return;
    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name)) continue;
      const original = element.propertyName;
      const query =
        original && (ts.isIdentifier(original) || ts.isStringLiteral(original))
          ? original.text
          : element.name.text;
      if (TEST_ID_QUERIES.has(query) || ROLE_QUERIES.has(query)) {
        aliases.set(element.name.text, query);
      }
    }
  });
  return { receivers, aliases };
}

function testingLibraryQuery(
  call: ts.CallExpression,
  bindings: ReturnType<typeof testingLibraryBindings>,
): string | undefined {
  if (ts.isIdentifier(call.expression)) {
    return bindings.aliases.get(call.expression.text);
  }
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const query = call.expression.name.text;
  if (!TEST_ID_QUERIES.has(query) && !ROLE_QUERIES.has(query)) return undefined;
  const receiver = call.expression.expression;
  if (ts.isIdentifier(receiver)) {
    return receiver.text === "screen" || bindings.receivers.has(receiver.text)
      ? query
      : undefined;
  }
  if (ts.isCallExpression(receiver)) {
    const name = callPath(receiver.expression);
    return name === "within" || name?.endsWith(".within") ? query : undefined;
  }
  return undefined;
}

export function scanTestSource(
  file: string,
  source: string,
  config: TestGuardConfig,
): Finding[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const parsedSource = sourceFile as ts.SourceFile & {
    parseDiagnostics: readonly ts.DiagnosticWithLocation[];
  };
  if (parsedSource.parseDiagnostics.length > 0) {
    const first = parsedSource.parseDiagnostics[0];
    const detail = ts.flattenDiagnosticMessageText(
      first?.messageText ?? "",
      "\n",
    );
    throw new Error(`could not parse ${file}: ${detail}`);
  }

  const findings: Finding[] = [];
  const occurrences = new Map<string, number>();
  const fetchAssignments: ts.BinaryExpression[] = [];

  const add = (input: Omit<FindingInput, "occurrence">): void => {
    const key = `${input.rule}\0${input.evidence}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const finding = createFinding(config, { ...input, occurrence });
    if (finding) findings.push(finding);
  };

  visit(sourceFile, (node) => {
    if (ts.isCallExpression(node)) {
      const callback = testCallback(node);
      if (callback) {
        const assertions: { call: ts.CallExpression; matcher: string }[] = [];
        const testIdCalls: ts.CallExpression[] = [];
        let roleCalls = 0;
        const bindings = testingLibraryBindings(callback);
        visit(callback, (candidate) => {
          if (!ts.isCallExpression(candidate)) return;
          const matcher = expectationMatcher(candidate);
          if (matcher) assertions.push({ call: candidate, matcher });
          const query = testingLibraryQuery(candidate, bindings);
          if (query && TEST_ID_QUERIES.has(query)) testIdCalls.push(candidate);
          if (query && ROLE_QUERIES.has(query)) roleCalls++;
        });
        const only = assertions.length === 1 ? assertions[0] : undefined;
        const name = staticString(node.arguments[0]) ?? "<anonymous>";
        if (
          only &&
          (only.matcher === "toBeTruthy" ||
            (only.matcher === "toBe" && isNumeric200(only.call.arguments[0])))
        ) {
          const at = location(sourceFile, only.call);
          add({
            rule: "shallow-assertion",
            file,
            ...at,
            message:
              only.matcher === "toBeTruthy"
                ? "test has only a truthiness assertion; assert the actual value"
                : "test has only a status-200 assertion; assert response shape and an error path",
            evidence: `test:${name}|matcher:${only.matcher}`,
            waiver: inlineWaiverAt(
              source,
              at.line,
              config.waivers.minimumReasonWords,
            ),
          });
        }
        if (
          testIdCalls.length > 0 &&
          roleCalls === 0 &&
          /\.test\.[jt]sx$/.test(file)
        ) {
          const firstTestId = testIdCalls[0];
          if (firstTestId) {
            const at = location(sourceFile, firstTestId);
            add({
              rule: "test-id-over-role",
              file,
              ...at,
              message: `${testIdCalls.length} test-id query call(s) and no role query in this test; prefer accessible roles`,
              evidence: `test:${name}|test-id-count:${testIdCalls.length}`,
              waiver: inlineWaiverAt(
                source,
                at.line,
                config.waivers.minimumReasonWords,
              ),
            });
          }
        }
      }

      if (callPath(node.expression) === "vi.mock") {
        const specifier = staticString(node.arguments[0]);
        if (specifier && internalModule(specifier, config)) {
          const at = location(sourceFile, node);
          add({
            rule: "internal-mock",
            file,
            ...at,
            message: `vi.mock('${specifier}') targets repository-internal code; mock a configured system boundary`,
            evidence: `module:${specifier}`,
            waiver: inlineWaiverAt(
              source,
              at.line,
              config.waivers.minimumReasonWords,
            ),
          });
        }
      }

      if (
        propertyName(node.expression) === "route" &&
        config.playwright.testGlobs.some((glob) =>
          minimatch(file, glob, { dot: true }),
        )
      ) {
        const route = staticString(node.arguments[0]);
        const at = location(sourceFile, node);
        if (
          route &&
          config.playwright.apiPathFragments.some((fragment) =>
            route.includes(fragment),
          ) &&
          !hasSubstantiveReasonComment(
            source,
            at.line,
            config.waivers.minimumReasonWords,
          )
        ) {
          add({
            rule: "playwright-api-stub",
            file,
            ...at,
            message:
              "Playwright route stubs an API without a nearby comment stating why",
            evidence: `route:${route}`,
            waiver: inlineWaiverAt(
              source,
              at.line,
              config.waivers.minimumReasonWords,
            ),
          });
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      ["global", "globalThis"].includes(callPath(node.left.expression) ?? "") &&
      node.left.name.text === "fetch" &&
      containsCall(node.right, "vi.fn")
    ) {
      fetchAssignments.push(node);
    }
  });

  if (fetchAssignments.length >= config.inlineFetchMockThreshold) {
    const firstFetch = fetchAssignments[0];
    if (!firstFetch) return findings;
    const at = location(sourceFile, firstFetch);
    add({
      rule: "inline-fetch-mock",
      file,
      ...at,
      message: `${fetchAssignments.length} inline fetch mocks repeat hand-built responses; prefer replayable fixtures`,
      evidence: `count:${fetchAssignments.length}`,
      waiver:
        inlineWaiverAt(source, at.line, config.waivers.minimumReasonWords) ??
        fileInlineWaiver(source, config.waivers.minimumReasonWords),
    });
  }

  return findings;
}

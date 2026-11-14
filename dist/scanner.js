import path from "node:path";
import { createHash } from "node:crypto";
import { minimatch } from "minimatch";
import { applyBaseline, applyBaselineSource } from "./baseline.js";
import { loadConfig, parseConfigSource } from "./config.js";
import { scanDifferentialFile } from "./differential.js";
import { companionTestPathsFromFiles, isGeneratedGoSource, isProductionPath, isTestPath, languageOf, normalizePath, productionAffectedByDeletedTest, resolveRepositoryPath, } from "./files.js";
import { collectChanges, comparisonRef, listSnapshotFiles, readSnapshotFile, } from "./git.js";
import { createFinding, scanTestSource } from "./rules.js";
import { TestGuardError, } from "./types.js";
import { fileInlineWaiver, parsePrWaivers, prWaiverFor } from "./waivers.js";
export function trustedDefaultBase(cwd, configPath = ".testguard.yml") {
    const anchor = comparisonRef(cwd, "diff", "origin/main");
    if (!anchor)
        return "origin/main";
    const normalized = normalizePath(configPath);
    if (!listSnapshotFiles(cwd, anchor).includes(normalized)) {
        return "origin/main";
    }
    return parseConfigSource(readSnapshotFile(cwd, anchor, normalized), `trusted Git snapshot ${anchor}:${normalized}`).defaultBase;
}
function currentConfigFromSnapshot(cwd, configPath, finalSource, finalFiles, supplied) {
    if (supplied)
        return supplied;
    const normalized = normalizePath(configPath);
    if (finalFiles.has(normalized)) {
        return parseConfigSource(readSnapshotFile(cwd, finalSource, normalized), `${finalSource} ${normalized}`);
    }
    return loadConfig(cwd, configPath);
}
function resolvePolicy(cwd, options, configPath) {
    resolveRepositoryPath(cwd, configPath, {
        kind: "configuration",
        allowMissing: true,
    });
    const trustedRef = comparisonRef(cwd, options.mode, options.base);
    const finalSource = options.mode === "staged" ? "index" : "worktree";
    const finalFiles = new Set(listSnapshotFiles(cwd, finalSource));
    if (options.mode === "all") {
        return {
            config: currentConfigFromSnapshot(cwd, configPath, finalSource, finalFiles, options.config),
            source: "current",
            beforeFiles: new Set(),
            finalFiles,
            finalSource,
            diagnostics: [...(options.diagnostics ?? [])],
        };
    }
    const beforeFiles = new Set(trustedRef ? listSnapshotFiles(cwd, trustedRef) : []);
    const normalizedConfig = normalizePath(configPath);
    if (trustedRef && beforeFiles.has(normalizedConfig)) {
        return {
            config: parseConfigSource(readSnapshotFile(cwd, trustedRef, normalizedConfig), `trusted Git snapshot ${trustedRef}:${normalizedConfig}`),
            source: "trusted",
            trustedRef,
            beforeFiles,
            finalFiles,
            finalSource,
            diagnostics: [...(options.diagnostics ?? [])],
        };
    }
    return {
        config: currentConfigFromSnapshot(cwd, configPath, finalSource, finalFiles, options.config),
        source: "current",
        ...(trustedRef ? { trustedRef } : {}),
        beforeFiles,
        finalFiles,
        finalSource,
        diagnostics: [
            ...(options.diagnostics ?? []),
            {
                code: "bootstrap-policy",
                level: "notice",
                message: "no trusted configuration exists in the comparison snapshot; this bootstrap scan uses the current configuration and ignores the current baseline",
            },
        ],
    };
}
function isDocOnlyGo(source) {
    const withoutComments = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
    return !/\b(func|type|var|const)\b/.test(withoutComments);
}
function missingMessage(file) {
    if (file.endsWith(".go"))
        return "Go package has no *_test.go file";
    if (file.endsWith(".py"))
        return "Python module has no configured test_<name>.py companion";
    return "production module has no configured colocated test companion";
}
function sourceReader(cwd, source) {
    const cache = new Map();
    return (file) => {
        const normalized = normalizePath(file);
        const existing = cache.get(normalized);
        if (existing !== undefined)
            return existing;
        const value = readSnapshotFile(cwd, source, normalized);
        cache.set(normalized, value);
        return value;
    };
}
const POLICY_GLOBS = [
    ".github/workflows/*.{yml,yaml}",
    ".github/actions/**/action.{yml,yaml}",
    "action.{yml,yaml}",
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
    "deno.json",
    "deno.jsonc",
    "vitest.config.*",
    "vite.config.*",
    "jest.config.*",
    "playwright.config.*",
    "cypress.config.*",
    "pytest.ini",
    "pyproject.toml",
    "tox.ini",
    "go.mod",
];
function isPolicyPath(file, configPath, baselinePath) {
    const normalized = normalizePath(file);
    return (normalized === normalizePath(configPath) ||
        normalized === normalizePath(baselinePath) ||
        POLICY_GLOBS.some((glob) => minimatch(normalized, glob, { dot: true, matchBase: true })));
}
function shortHash(value) {
    if (value === undefined)
        return "absent";
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
function policyChangeFindings(cwd, changes, policy, configPath, baselinePath) {
    const beforeRead = policy.trustedRef
        ? sourceReader(cwd, policy.trustedRef)
        : undefined;
    const finalRead = sourceReader(cwd, policy.finalSource);
    const findings = [];
    const seen = new Set();
    for (const change of changes) {
        const candidates = [change.oldPath, change.path].filter((value) => Boolean(value && isPolicyPath(value, configPath, baselinePath)));
        for (const file of candidates) {
            if (seen.has(file))
                continue;
            seen.add(file);
            const beforeSource = beforeRead && policy.beforeFiles.has(file)
                ? beforeRead(file)
                : undefined;
            const finalSource = policy.finalFiles.has(file)
                ? finalRead(file)
                : undefined;
            const finding = createFinding(policy.config, {
                rule: "policy-change",
                file,
                line: 1,
                message: "test policy, baseline, runner, or workflow settings changed; explicit human review is required",
                evidence: `status:${change.status}|old:${change.oldPath ?? "-"}|new:${change.path}|before:${shortHash(beforeSource)}|after:${shortHash(finalSource)}`,
            });
            if (finding)
                findings.push(finding);
        }
    }
    return findings;
}
function differentialChanges(cwd, changes, policy) {
    if (!policy.trustedRef)
        return [];
    const beforeRead = sourceReader(cwd, policy.trustedRef);
    const finalRead = sourceReader(cwd, policy.finalSource);
    const added = changes.filter((change) => change.status === "added" &&
        policy.finalFiles.has(change.path) &&
        isTestPath(change.path, policy.config));
    const usedAdded = new Set();
    const findings = [];
    for (const change of changes) {
        const beforePath = change.status === "renamed" ? change.oldPath : change.path;
        if (!beforePath ||
            !policy.beforeFiles.has(beforePath) ||
            !isTestPath(beforePath, policy.config)) {
            continue;
        }
        let afterPath;
        if (change.status === "modified" && policy.finalFiles.has(change.path)) {
            afterPath = change.path;
        }
        else if (change.status === "renamed" &&
            policy.finalFiles.has(change.path)) {
            afterPath = change.path;
        }
        else if (change.status === "deleted") {
            const beforeSource = beforeRead(beforePath);
            const replacement = added.find((candidate) => !usedAdded.has(candidate.path) &&
                finalRead(candidate.path) === beforeSource);
            if (replacement) {
                afterPath = replacement.path;
                usedAdded.add(replacement.path);
            }
        }
        const afterSource = afterPath && policy.finalFiles.has(afterPath)
            ? finalRead(afterPath)
            : undefined;
        try {
            findings.push(...scanDifferentialFile({
                beforePath,
                beforeSource: beforeRead(beforePath),
                ...(afterPath ? { afterPath } : {}),
                ...(afterSource !== undefined ? { afterSource } : {}),
            }, policy.config));
        }
        catch (error) {
            throw new TestGuardError(error instanceof Error
                ? error.message
                : `could not compare ${beforePath}`);
        }
    }
    return findings;
}
export function runScan(options) {
    const cwd = path.resolve(options.cwd);
    const configPath = options.configPath ?? ".testguard.yml";
    const policy = resolvePolicy(cwd, options, configPath);
    const config = policy.config;
    const changes = collectChanges(cwd, options.mode, options.base);
    const allFiles = [...policy.finalFiles];
    const read = sourceReader(cwd, policy.finalSource);
    const productionFiles = allFiles
        .filter((file) => isProductionPath(file, config))
        .filter((file) => !isGeneratedGoSource(file, read(file)));
    const production = new Set();
    const tests = new Set();
    for (const change of changes) {
        if (change.status !== "deleted" && policy.finalFiles.has(change.path)) {
            if (isProductionPath(change.path, config)) {
                production.add(change.path);
            }
            if (isTestPath(change.path, config))
                tests.add(change.path);
        }
        const removed = change.status === "deleted"
            ? change.path
            : change.status === "renamed"
                ? change.oldPath
                : undefined;
        if (removed && isTestPath(removed, config)) {
            for (const affected of productionAffectedByDeletedTest(removed, productionFiles, config)) {
                production.add(affected);
            }
        }
    }
    if (options.mode === "all") {
        for (const file of productionFiles)
            production.add(file);
        for (const file of allFiles) {
            if (isTestPath(file, config))
                tests.add(file);
        }
    }
    const baselinePath = options.baselinePath === false
        ? config.baseline
        : (options.baselinePath ?? config.baseline);
    resolveRepositoryPath(cwd, baselinePath, {
        kind: "baseline",
        allowMissing: true,
    });
    const findings = options.mode === "all"
        ? []
        : [
            ...differentialChanges(cwd, changes, policy),
            ...policyChangeFindings(cwd, changes, policy, configPath, baselinePath),
        ];
    for (const file of [...production].sort()) {
        if (!policy.finalFiles.has(file))
            continue;
        const source = read(file);
        if (file.endsWith(".go") && isDocOnlyGo(source))
            continue;
        const companions = companionTestPathsFromFiles(file, allFiles, config);
        if (companions.length === 0) {
            const finding = createFinding(config, {
                rule: "missing-test",
                file,
                line: 1,
                message: missingMessage(file),
                evidence: `strategy:${config.companions[file.endsWith(".go")
                    ? "go"
                    : file.endsWith(".py")
                        ? "python"
                        : "typescript"].strategy}`,
                waiver: fileInlineWaiver(source, config.waivers.minimumReasonWords),
            });
            if (finding)
                findings.push(finding);
        }
        for (const companion of companions)
            tests.add(companion);
    }
    for (const file of [...tests].sort()) {
        if (!policy.finalFiles.has(file))
            continue;
        if (languageOf(file, config) !== "typescript")
            continue;
        try {
            findings.push(...scanTestSource(file, read(file), config));
        }
        catch (error) {
            throw new TestGuardError(error instanceof Error ? error.message : `could not scan ${file}`);
        }
    }
    const parsedWaivers = parsePrWaivers(options.prBody ?? "", config.waivers.minimumReasonWords, options.now);
    for (const finding of findings) {
        if (!finding.waiver) {
            const waiver = prWaiverFor(parsedWaivers.waivers, finding.file, finding.rule);
            if (waiver)
                finding.waiver = waiver;
        }
    }
    let staleBaseline = [];
    if (options.baselinePath !== false) {
        let stale;
        if (options.mode === "all") {
            const absoluteBaseline = resolveRepositoryPath(cwd, baselinePath, {
                kind: "baseline",
                allowMissing: true,
            });
            stale = applyBaseline(findings, absoluteBaseline);
        }
        else {
            const trustedBaseline = policy.source === "trusted" &&
                policy.trustedRef &&
                policy.beforeFiles.has(normalizePath(baselinePath))
                ? readSnapshotFile(cwd, policy.trustedRef, normalizePath(baselinePath))
                : undefined;
            stale = applyBaselineSource(findings, trustedBaseline, policy.trustedRef
                ? `${policy.trustedRef}:${normalizePath(baselinePath)}`
                : normalizePath(baselinePath));
        }
        if (options.mode === "all")
            staleBaseline = stale;
    }
    findings.sort((left, right) => `${left.file}\0${left.line.toString().padStart(9, "0")}\0${left.rule}\0${left.fingerprint}`.localeCompare(`${right.file}\0${right.line.toString().padStart(9, "0")}\0${right.rule}\0${right.fingerprint}`));
    const result = {
        mode: options.mode,
        policySource: policy.source,
        auditedFiles: [...new Set([...production, ...tests])].sort(),
        findings,
        activeFindings: findings.filter((finding) => !finding.waiver && !finding.baseline),
        staleBaseline,
        waiverDiagnostics: parsedWaivers.diagnostics,
        diagnostics: policy.diagnostics,
    };
    if (policy.trustedRef)
        result.trustedRef = policy.trustedRef;
    if (options.base)
        result.base = options.base;
    return result;
}
//# sourceMappingURL=scanner.js.map
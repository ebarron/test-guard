#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { updateBaseline } from "./baseline.js";
import { loadConfig, PRESETS, renderPreset } from "./config.js";
import { resolveRepositoryPath } from "./files.js";
import { repositoryRoot } from "./git.js";
import { formatResult } from "./output.js";
import { runScan, trustedDefaultBase } from "./scanner.js";
import { TestGuardError, } from "./types.js";
const VERSION = "0.1.0";
const defaultIo = {
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
};
function valueAfter(args, index, option) {
    const value = args[index + 1];
    if (!value || value.startsWith("-")) {
        throw new TestGuardError(`${option} requires a value`);
    }
    args.splice(index, 2);
    return value;
}
function takeOption(args, option) {
    const equal = args.findIndex((arg) => arg.startsWith(`${option}=`));
    if (equal >= 0) {
        const value = (args[equal] ?? "").slice(option.length + 1);
        args.splice(equal, 1);
        if (!value)
            throw new TestGuardError(`${option} requires a value`);
        return value;
    }
    const index = args.indexOf(option);
    return index >= 0 ? valueAfter(args, index, option) : undefined;
}
function takeFlag(args, ...flags) {
    const index = args.findIndex((arg) => flags.includes(arg));
    if (index < 0)
        return false;
    args.splice(index, 1);
    return true;
}
function assertNoArgs(args) {
    if (args.length > 0) {
        throw new TestGuardError(`unknown argument${args.length > 1 ? "s" : ""}: ${args.join(" ")}`);
    }
}
function help() {
    return `test-guard ${VERSION} — advisory test-integrity scanner

Usage:
  test-guard init [--preset polyglot|typescript] [--force]
  test-guard scan --staged [--format human|json|sarif|github]
  test-guard scan --diff [--base <ref>]
  test-guard scan --all [--no-baseline]
  test-guard baseline [--accept-new] [--migrate-v1]

Common options:
  --config <path>       Configuration file (default .testguard.yml)
  --baseline <path>     Override configured baseline path
  --pr-body-file <path> Read PR waiver blocks from a file

Exit codes: 0 clean, 1 active findings, 2 scanner/configuration failure
`;
}
function parseFormat(value) {
    const format = value ?? "human";
    if (!["human", "json", "sarif", "github"].includes(format)) {
        throw new TestGuardError(`unsupported output format "${format}"`);
    }
    return format;
}
function initCommand(args, cwd, io) {
    const presetName = takeOption(args, "--preset") ?? "polyglot";
    if (!(presetName in PRESETS)) {
        throw new TestGuardError(`unknown preset "${presetName}"`);
    }
    const force = takeFlag(args, "--force");
    assertNoArgs(args);
    const root = repositoryRoot(cwd);
    const destination = path.join(root, ".testguard.yml");
    if (fs.existsSync(destination) && !force) {
        throw new TestGuardError(`${destination} already exists; use --force to replace it`);
    }
    fs.writeFileSync(destination, renderPreset(presetName));
    io.stdout(`test-guard: wrote ${destination} (${presetName} preset)\n`);
    return 0;
}
function sharedOptions(args, cwd) {
    const configPath = takeOption(args, "--config") ?? ".testguard.yml";
    const baselinePath = takeOption(args, "--baseline");
    const root = repositoryRoot(cwd);
    const result = { root, configPath };
    if (baselinePath)
        result.baselinePath = baselinePath;
    return result;
}
function scanCommand(args, cwd, io, runtime) {
    const shared = sharedOptions(args, cwd);
    let mode = "diff";
    if (takeFlag(args, "--staged"))
        mode = "staged";
    if (takeFlag(args, "--diff", "--diffs"))
        mode = "diff";
    if (takeFlag(args, "--all"))
        mode = "all";
    const requestedBase = takeOption(args, "--base") ?? takeOption(args, "--branch");
    const base = requestedBase ??
        (mode === "diff"
            ? trustedDefaultBase(shared.root, shared.configPath)
            : undefined);
    const format = parseFormat(takeOption(args, "--format"));
    const noBaseline = takeFlag(args, "--no-baseline");
    const prBodyFile = takeOption(args, "--pr-body-file");
    assertNoArgs(args);
    const prBody = prBodyFile
        ? fs.readFileSync(resolveRepositoryPath(shared.root, prBodyFile, {
            kind: "PR body",
        }), "utf8")
        : (runtime.prBody ?? process.env.TEST_GUARD_PR_BODY ?? "");
    const result = runScan({
        cwd: shared.root,
        configPath: shared.configPath,
        mode,
        ...(base ? { base } : {}),
        baselinePath: noBaseline ? false : shared.baselinePath,
        prBody,
        diagnostics: runtime.diagnostics,
    });
    io.stdout(`${formatResult(result, format)}\n`);
    return result.activeFindings.length > 0 ? 1 : 0;
}
function baselineCommand(args, cwd, io) {
    const shared = sharedOptions(args, cwd);
    const config = loadConfig(shared.root, shared.configPath);
    const acceptNew = takeFlag(args, "--accept-new");
    const migrateV1 = takeFlag(args, "--migrate-v1");
    assertNoArgs(args);
    const result = runScan({
        cwd: shared.root,
        config,
        mode: "all",
        baselinePath: false,
    });
    const baselinePath = resolveRepositoryPath(shared.root, shared.baselinePath ?? config.baseline, { kind: "baseline", allowMissing: true });
    const update = updateBaseline(baselinePath, result.findings, {
        acceptNew,
        migrateV1,
    });
    io.stdout(`test-guard: wrote baseline v2 with ${update.total} finding(s); ${update.added} added, ${update.stale} stale removed\n`);
    return 0;
}
export function runCli(argv, io = defaultIo, cwd = process.cwd(), runtime = {}) {
    try {
        const args = [...argv];
        if (takeFlag(args, "--help", "-h")) {
            io.stdout(help());
            return 0;
        }
        if (takeFlag(args, "--version", "-v")) {
            io.stdout(`${VERSION}\n`);
            return 0;
        }
        const command = args.shift() ?? "scan";
        if (command === "init")
            return initCommand(args, cwd, io);
        if (command === "scan")
            return scanCommand(args, cwd, io, runtime);
        if (command === "baseline")
            return baselineCommand(args, cwd, io);
        throw new TestGuardError(`unknown command "${command}"`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.stderr(`test-guard: ${message}\n`);
        return 2;
    }
}
const mainNames = new Set(["cli.js", "cli.ts", "test-guard", "testguard"]);
const isMain = process.argv[1] !== undefined &&
    mainNames.has(path.basename(process.argv[1]));
if (isMain)
    process.exitCode = runCli(process.argv.slice(2));
//# sourceMappingURL=cli.js.map
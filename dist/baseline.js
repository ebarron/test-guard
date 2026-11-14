import fs from "node:fs";
import path from "node:path";
import { RULE_IDS, TestGuardError } from "./types.js";
function parseBaseline(source, description) {
    let value;
    try {
        value = JSON.parse(source);
    }
    catch (error) {
        throw new TestGuardError(`could not parse baseline ${description}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!value || typeof value !== "object") {
        throw new TestGuardError(`baseline ${description} must be a JSON object`);
    }
    const record = value;
    if (record.version !== 2)
        return { kind: "legacy" };
    if (!Array.isArray(record.findings)) {
        throw new TestGuardError(`baseline ${description} must contain findings[]`);
    }
    const seen = new Map();
    const findings = record.findings.map((entry, index) => {
        const item = entry;
        if (!entry ||
            typeof entry !== "object" ||
            typeof item.fingerprint !== "string" ||
            typeof item.rule !== "string" ||
            typeof item.file !== "string" ||
            !/^[a-f0-9]{32}$/.test(item.fingerprint) ||
            !RULE_IDS.includes(item.rule)) {
            throw new TestGuardError(`baseline ${description} has an invalid finding at index ${index}`);
        }
        const parsed = {
            fingerprint: item.fingerprint,
            rule: item.rule,
            file: item.file,
        };
        const previous = seen.get(parsed.fingerprint);
        if (previous) {
            const qualifier = previous.rule === parsed.rule && previous.file === parsed.file
                ? "duplicate"
                : "conflicting";
            throw new TestGuardError(`baseline ${description} has a ${qualifier} fingerprint at index ${index}`);
        }
        seen.set(parsed.fingerprint, parsed);
        return parsed;
    });
    return { kind: "v2", baseline: { version: 2, findings } };
}
function readBaseline(baselinePath) {
    if (!fs.existsSync(baselinePath)) {
        return { kind: "missing", baseline: { version: 2, findings: [] } };
    }
    return parseBaseline(fs.readFileSync(baselinePath, "utf8"), baselinePath);
}
function legacyError(baselinePath) {
    return new TestGuardError(`legacy coarse baseline at ${baselinePath} is unsafe because file+rule entries can mask duplicate findings; run "test-guard baseline --migrate-v1 --accept-new" and review the replacement`);
}
export function applyBaseline(findings, baselinePath) {
    const read = readBaseline(baselinePath);
    if (read.kind === "legacy")
        throw legacyError(baselinePath);
    const entries = new Map(read.baseline.findings.map((entry) => [entry.fingerprint, entry]));
    const current = new Set(findings.map((finding) => finding.fingerprint));
    for (const finding of findings) {
        const entry = entries.get(finding.fingerprint);
        if (!entry)
            continue;
        if (entry.rule !== finding.rule || entry.file !== finding.file) {
            throw new TestGuardError(`baseline ${baselinePath} metadata does not match fingerprint ${finding.fingerprint}`);
        }
        finding.baseline = true;
    }
    return read.baseline.findings
        .filter((entry) => !current.has(entry.fingerprint))
        .map((entry) => entry.fingerprint)
        .sort();
}
export function applyBaselineSource(findings, source, description) {
    const read = source !== undefined
        ? parseBaseline(source, description)
        : { kind: "missing", baseline: { version: 2, findings: [] } };
    if (read.kind === "legacy")
        throw legacyError(description);
    const entries = new Map(read.baseline.findings.map((entry) => [entry.fingerprint, entry]));
    const current = new Set(findings.map((finding) => finding.fingerprint));
    for (const finding of findings) {
        const entry = entries.get(finding.fingerprint);
        if (!entry)
            continue;
        if (entry.rule !== finding.rule || entry.file !== finding.file) {
            throw new TestGuardError(`baseline ${description} metadata does not match fingerprint ${finding.fingerprint}`);
        }
        finding.baseline = true;
    }
    return read.baseline.findings
        .filter((entry) => !current.has(entry.fingerprint))
        .map((entry) => entry.fingerprint)
        .sort();
}
function entriesFor(findings) {
    const seen = new Set();
    return findings
        .filter((finding) => !finding.waiver)
        .map((finding) => ({
        fingerprint: finding.fingerprint,
        rule: finding.rule,
        file: finding.file,
    }))
        .filter((entry) => {
        if (seen.has(entry.fingerprint))
            return false;
        seen.add(entry.fingerprint);
        return true;
    })
        .sort((left, right) => `${left.file}\0${left.rule}\0${left.fingerprint}`.localeCompare(`${right.file}\0${right.rule}\0${right.fingerprint}`));
}
export function updateBaseline(baselinePath, findings, options) {
    const read = readBaseline(baselinePath);
    if (read.kind === "legacy" && !(options.migrateV1 && options.acceptNew)) {
        throw legacyError(baselinePath);
    }
    const existing = read.kind === "legacy"
        ? new Set()
        : new Set(read.baseline.findings.map((entry) => entry.fingerprint));
    const entries = entriesFor(findings);
    const current = new Set(entries.map((entry) => entry.fingerprint));
    const added = entries.filter((entry) => !existing.has(entry.fingerprint)).length;
    const stale = [...existing].filter((fingerprint) => !current.has(fingerprint)).length;
    if (added > 0 && !options.acceptNew) {
        throw new TestGuardError(`baseline would grow by ${added} finding(s); rerun with --accept-new only after reviewing the debt`);
    }
    const payload = { version: 2, findings: entries };
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
    return { added, stale, total: entries.length };
}
//# sourceMappingURL=baseline.js.map
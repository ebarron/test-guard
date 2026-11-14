export declare const RULE_IDS: readonly ["missing-test", "test-removed", "test-count", "assertion-count", "test-modifier", "matcher-weakened", "policy-change", "shallow-assertion", "internal-mock", "inline-fetch-mock", "test-id-over-role", "playwright-api-stub"];
export type RuleId = (typeof RULE_IDS)[number];
export type Severity = "off" | "notice" | "warning" | "error";
export type Language = "typescript" | "go" | "python";
export type ScanMode = "staged" | "diff" | "all";
export type OutputFormat = "human" | "json" | "sarif" | "github";
export interface FileClassConfig {
    extensions: string[];
    testGlobs: string[];
}
export interface CompanionConfig {
    strategy: "go-package" | "colocated" | "python-test-name";
    directories: string[];
    suffixes: string[];
}
export interface TestGuardConfig {
    version: 1;
    production: {
        include: string[];
        exclude: string[];
    };
    fileClasses: Record<Language, FileClassConfig>;
    companions: Record<Language, CompanionConfig>;
    mockBoundaries: {
        internalPrefixes: string[];
        allowModules: string[];
        boundaryGlobs: string[];
    };
    rules: Record<RuleId, Severity>;
    baseline: string;
    defaultBase: string;
    waivers: {
        minimumReasonWords: number;
    };
    inlineFetchMockThreshold: number;
    playwright: {
        testGlobs: string[];
        apiPathFragments: string[];
    };
}
export interface Waiver {
    source: "inline" | "pr";
    reason: string;
    expires?: string;
}
export interface Finding {
    rule: RuleId;
    severity: Exclude<Severity, "off">;
    file: string;
    line: number;
    column: number;
    message: string;
    evidence: string;
    fingerprint: string;
    waiver?: Waiver;
    baseline?: boolean;
}
export interface WaiverDiagnostic {
    message: string;
    block: number;
}
export interface ScanDiagnostic {
    code: "bootstrap-policy" | "pr-waiver-unapproved" | "github-event-invalid";
    level: "notice" | "warning";
    message: string;
}
export interface PrWaiverResult {
    waivers: Map<string, Waiver>;
    diagnostics: WaiverDiagnostic[];
}
export interface ScanOptions {
    cwd: string;
    config?: TestGuardConfig | undefined;
    configPath?: string | undefined;
    mode: ScanMode;
    base?: string | undefined;
    baselinePath?: string | false | undefined;
    prBody?: string | undefined;
    now?: Date | undefined;
    diagnostics?: ScanDiagnostic[] | undefined;
}
export interface ScanResult {
    mode: ScanMode;
    base?: string;
    trustedRef?: string;
    policySource?: "current" | "trusted";
    auditedFiles: string[];
    findings: Finding[];
    activeFindings: Finding[];
    staleBaseline: string[];
    waiverDiagnostics: WaiverDiagnostic[];
    diagnostics?: ScanDiagnostic[];
}
export declare class TestGuardError extends Error {
    name: string;
}
//# sourceMappingURL=types.d.ts.map
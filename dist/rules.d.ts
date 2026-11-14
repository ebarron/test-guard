import type { Finding, RuleId, TestGuardConfig, Waiver } from "./types.js";
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
export declare function fingerprintFor(rule: RuleId, file: string, evidence: string, occurrence?: number): string;
export declare function createFinding(config: TestGuardConfig, input: FindingInput): Finding | undefined;
export declare function scanTestSource(file: string, source: string, config: TestGuardConfig): Finding[];
export {};
//# sourceMappingURL=rules.d.ts.map
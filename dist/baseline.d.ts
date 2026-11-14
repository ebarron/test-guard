import { type Finding } from "./types.js";
export interface BaselineEntry {
    fingerprint: string;
    rule: string;
    file: string;
}
export interface BaselineV2 {
    version: 2;
    findings: BaselineEntry[];
}
export declare function applyBaseline(findings: Finding[], baselinePath: string): string[];
export declare function applyBaselineSource(findings: Finding[], source: string | undefined, description: string): string[];
export interface UpdateBaselineOptions {
    acceptNew: boolean;
    migrateV1: boolean;
}
export declare function updateBaseline(baselinePath: string, findings: Finding[], options: UpdateBaselineOptions): {
    added: number;
    stale: number;
    total: number;
};
//# sourceMappingURL=baseline.d.ts.map
import type { Finding, TestGuardConfig } from "./types.js";
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
export declare function summarizeTestSource(file: string, source: string): TestSourceSummary;
export declare function scanDifferentialFile(change: DifferentialFile, config: TestGuardConfig): Finding[];
export {};
//# sourceMappingURL=differential.d.ts.map
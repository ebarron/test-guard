import type { OutputFormat, ScanResult } from "./types.js";
export declare function formatHuman(result: ScanResult): string;
export declare function formatSarif(result: ScanResult): string;
export declare function formatGithub(result: ScanResult): string;
export declare function formatResult(result: ScanResult, format: OutputFormat): string;
//# sourceMappingURL=output.d.ts.map
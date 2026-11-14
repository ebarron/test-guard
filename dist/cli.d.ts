#!/usr/bin/env node
import { type ScanDiagnostic } from "./types.js";
export interface CliIo {
    stdout: (message: string) => void;
    stderr: (message: string) => void;
}
export interface CliRuntime {
    prBody?: string | undefined;
    diagnostics?: ScanDiagnostic[] | undefined;
}
export declare function runCli(argv: string[], io?: CliIo, cwd?: string, runtime?: CliRuntime): number;
//# sourceMappingURL=cli.d.ts.map
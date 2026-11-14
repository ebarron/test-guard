import { type ScanMode } from "./types.js";
export interface FileChange {
    status: "added" | "modified" | "deleted" | "renamed";
    path: string;
    oldPath?: string;
}
export declare function repositoryRoot(cwd: string): string;
export declare function comparisonRef(cwd: string, mode: ScanMode, base?: string): string | undefined;
export type SnapshotSource = string;
export declare function listSnapshotFiles(cwd: string, source: SnapshotSource): string[];
export declare function readSnapshotFile(cwd: string, source: SnapshotSource, file: string): string;
export declare function collectChanges(cwd: string, mode: ScanMode, base?: string): FileChange[];
//# sourceMappingURL=git.d.ts.map
import { type Language, type TestGuardConfig } from "./types.js";
export declare function normalizePath(value: string): string;
export interface RepositoryPathOptions {
    kind: string;
    allowMissing?: boolean;
    leadingSlashIsRepositoryRoot?: boolean;
}
export declare function resolveRepositoryPath(cwd: string, value: string, options: RepositoryPathOptions): string;
export declare function repositoryFileExists(cwd: string, value: string, kind?: string): boolean;
export declare function languageOf(file: string, config: TestGuardConfig): Language | undefined;
export declare function isTestPath(file: string, config: TestGuardConfig): boolean;
export declare function isProductionPath(file: string, config: TestGuardConfig): boolean;
export declare function isGeneratedGo(file: string, cwd: string): boolean;
export declare function isGeneratedGoSource(file: string, source: string): boolean;
export declare function companionTestPaths(productionFile: string, cwd: string, config: TestGuardConfig): string[];
export declare function companionTestPathsFromFiles(productionFile: string, files: string[], config: TestGuardConfig): string[];
export declare function productionAffectedByDeletedTest(deletedTest: string, productionFiles: string[], config: TestGuardConfig): string[];
//# sourceMappingURL=files.d.ts.map
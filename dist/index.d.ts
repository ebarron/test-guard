export { applyBaseline, applyBaselineSource, updateBaseline, } from "./baseline.js";
export { loadConfig, parseConfig, parseConfigSource, PRESETS, renderPreset, } from "./config.js";
export { scanDifferentialFile, summarizeTestSource } from "./differential.js";
export { companionTestPaths, isProductionPath, isTestPath, languageOf, productionAffectedByDeletedTest, } from "./files.js";
export { collectChanges, comparisonRef, listSnapshotFiles, readSnapshotFile, repositoryRoot, } from "./git.js";
export { formatResult } from "./output.js";
export { createFinding, fingerprintFor, scanTestSource } from "./rules.js";
export { runScan, trustedDefaultBase } from "./scanner.js";
export * from "./types.js";
export { acceptableReason, fileInlineWaiver, inlineWaiverAt, parsePrWaivers, } from "./waivers.js";
//# sourceMappingURL=index.d.ts.map
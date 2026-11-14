import { type TestGuardConfig } from "./types.js";
export declare const PRESETS: Record<"polyglot" | "typescript", TestGuardConfig>;
export declare function parseConfig(value: unknown): TestGuardConfig;
export declare function parseConfigSource(source: string, description?: string): TestGuardConfig;
export declare function loadConfig(cwd: string, configPath?: string): TestGuardConfig;
export declare function renderPreset(name: keyof typeof PRESETS): string;
//# sourceMappingURL=config.d.ts.map
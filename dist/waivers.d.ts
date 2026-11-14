import { type PrWaiverResult, type RuleId, type Waiver } from "./types.js";
export declare function acceptableReason(reason: string, minimumWords: number): boolean;
export declare function inlineWaiverAt(source: string, line: number, minimumWords: number): Waiver | undefined;
export declare function fileInlineWaiver(source: string, minimumWords: number): Waiver | undefined;
export declare function hasSubstantiveReasonComment(source: string, line: number, minimumWords: number): boolean;
export declare function parsePrWaivers(body: string, minimumWords: number, now?: Date): PrWaiverResult;
export declare function prWaiverFor(waivers: Map<string, Waiver>, file: string, rule: RuleId): Waiver | undefined;
//# sourceMappingURL=waivers.d.ts.map
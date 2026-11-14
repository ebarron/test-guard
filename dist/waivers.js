import { RULE_IDS, } from "./types.js";
import { normalizePath } from "./files.js";
const rejectedReasons = new Set([
    "",
    "wip",
    "later",
    "fix me",
    "fixme",
    "todo",
    "tbd",
    "n/a",
    "na",
    "temporary waiver",
]);
export function acceptableReason(reason, minimumWords) {
    const normalized = reason
        .trim()
        .toLowerCase()
        .replace(/[.!]+$/, "");
    return (!rejectedReasons.has(normalized) &&
        reason.trim().split(/\s+/).filter(Boolean).length >= minimumWords);
}
function reasonFromLine(comment, minimumWords) {
    const match = /test-guard-skip\s*:\s*(.+?)\s*$/.exec(comment);
    if (!match?.[1])
        return undefined;
    const reason = match[1].trim();
    return acceptableReason(reason, minimumWords) ? reason : undefined;
}
function lexicalComments(source) {
    const lines = source.split(/\r?\n/);
    const comments = new Map();
    let quote;
    let blockComment = false;
    const add = (line, comment) => {
        const existing = comments.get(line) ?? [];
        existing.push(comment);
        comments.set(line, existing);
    };
    for (const [lineNumber, line] of lines.entries()) {
        let cursor = 0;
        while (cursor < line.length) {
            if (blockComment) {
                const end = line.indexOf("*/", cursor);
                if (end < 0) {
                    add(lineNumber, line.slice(cursor));
                    break;
                }
                add(lineNumber, line.slice(cursor, end));
                blockComment = false;
                cursor = end + 2;
                continue;
            }
            if (quote) {
                const end = line.indexOf(quote, cursor);
                if (end < 0)
                    break;
                let backslashes = 0;
                for (let index = end - 1; index >= 0 && line[index] === "\\"; index--) {
                    backslashes++;
                }
                if (backslashes % 2 === 1) {
                    cursor = end + quote.length;
                    continue;
                }
                cursor = end + quote.length;
                quote = undefined;
                continue;
            }
            if (line.startsWith("//", cursor)) {
                add(lineNumber, line.slice(cursor + 2));
                break;
            }
            const nextCharacter = line[cursor + 1];
            if (line[cursor] === "#" &&
                line.slice(0, cursor).trim().length === 0 &&
                (nextCharacter === undefined || /\s/.test(nextCharacter))) {
                add(lineNumber, line.slice(cursor + 1));
                break;
            }
            if (line.startsWith("/*", cursor)) {
                const end = line.indexOf("*/", cursor + 2);
                if (end < 0) {
                    add(lineNumber, line.slice(cursor + 2));
                    blockComment = true;
                    break;
                }
                add(lineNumber, line.slice(cursor + 2, end));
                cursor = end + 2;
                continue;
            }
            if (line.startsWith("'''", cursor) || line.startsWith('"""', cursor)) {
                quote = line.slice(cursor, cursor + 3);
                cursor += 3;
                continue;
            }
            const character = line[cursor];
            if (character === "'" || character === '"' || character === "`") {
                quote = character;
            }
            cursor++;
        }
        if (quote && quote !== "`" && quote.length === 1)
            quote = undefined;
    }
    return { lines, comments };
}
export function inlineWaiverAt(source, line, minimumWords) {
    const { lines, comments } = lexicalComments(source);
    const index = Math.max(0, line - 1);
    for (const comment of comments.get(index) ?? []) {
        const reason = reasonFromLine(comment, minimumWords);
        if (reason)
            return { source: "inline", reason };
    }
    for (let cursor = index - 1; cursor >= 0 && cursor >= index - 6; cursor--) {
        if (!(lines[cursor] ?? "").trim())
            continue;
        const candidates = comments.get(cursor);
        if (!candidates)
            break;
        for (const comment of candidates) {
            const reason = reasonFromLine(comment, minimumWords);
            if (reason)
                return { source: "inline", reason };
        }
    }
    return undefined;
}
export function fileInlineWaiver(source, minimumWords) {
    for (const comments of lexicalComments(source).comments.values()) {
        for (const comment of comments) {
            const reason = reasonFromLine(comment, minimumWords);
            if (reason)
                return { source: "inline", reason };
        }
    }
    return undefined;
}
export function hasSubstantiveReasonComment(source, line, minimumWords) {
    const { comments } = lexicalComments(source);
    const index = Math.max(0, line - 1);
    for (let cursor = index - 1; cursor >= 0 && cursor >= index - 4; cursor--) {
        for (const comment of comments.get(cursor) ?? []) {
            const match = /\b(?:reason|because|stub-reason|why)\s*:\s*(.+?)\s*$/i.exec(comment);
            if (match?.[1] && acceptableReason(match[1], minimumWords))
                return true;
        }
    }
    return false;
}
function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return undefined;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.valueOf()) ||
        date.toISOString().slice(0, 10) !== value
        ? undefined
        : date;
}
function waiverKey(file, rule) {
    return `${normalizePath(file)}::${rule}`;
}
function visibleMarkdown(body) {
    const withoutComments = body.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\r\n]/g, " "));
    const lines = withoutComments.split(/\r?\n/);
    let fence;
    return lines
        .map((line) => {
        const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
        if (!fence && match?.[1]) {
            fence = {
                marker: match[1][0],
                length: match[1].length,
            };
            return "";
        }
        if (fence &&
            match?.[1]?.[0] === fence.marker &&
            match[1].length >= fence.length) {
            fence = undefined;
            return "";
        }
        return fence ? "" : line;
    })
        .join("\n");
}
export function parsePrWaivers(body, minimumWords, now = new Date()) {
    const waivers = new Map();
    const diagnostics = [];
    const visibleBody = visibleMarkdown(body);
    const section = /^##\s+test-guard\s+waiver\s*$([\s\S]*?)(?=^##\s|\s*$(?![\s\S]))/gim;
    let match;
    let block = 0;
    while ((match = section.exec(visibleBody)) !== null) {
        block++;
        const content = match[1] ?? "";
        const files = /^[-*]\s*Files?\s*:\s*(.+)$/im.exec(content)?.[1];
        const reason = /^[-*]\s*Reason\s*:\s*(.+)$/im.exec(content)?.[1]?.trim();
        const expires = /^[-*]\s*Expires\s*:\s*(.+)$/im.exec(content)?.[1]?.trim();
        const rulesValue = /^[-*]\s*Rules?\s*:\s*(.+)$/im
            .exec(content)?.[1]
            ?.trim();
        if (!files || !reason) {
            diagnostics.push({
                block,
                message: "waiver requires Files and Reason lines",
            });
            continue;
        }
        if (!acceptableReason(reason, minimumWords)) {
            diagnostics.push({
                block,
                message: "waiver reason is boilerplate or too short",
            });
            continue;
        }
        if (expires) {
            const date = parseDate(expires);
            if (!date) {
                diagnostics.push({
                    block,
                    message: `waiver expiry "${expires}" must be YYYY-MM-DD`,
                });
                continue;
            }
            const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            if (date < today) {
                diagnostics.push({ block, message: `waiver expired on ${expires}` });
                continue;
            }
        }
        const rules = rulesValue
            ? rulesValue
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value === "*" || RULE_IDS.includes(value))
            : ["*"];
        if (rulesValue && rules.length !== rulesValue.split(",").length) {
            diagnostics.push({ block, message: "waiver contains an unknown rule" });
            continue;
        }
        for (const file of files
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean)) {
            for (const rule of rules) {
                const waiver = { source: "pr", reason };
                if (expires)
                    waiver.expires = expires;
                waivers.set(waiverKey(file, rule), waiver);
            }
        }
    }
    return { waivers, diagnostics };
}
export function prWaiverFor(waivers, file, rule) {
    return (waivers.get(waiverKey(file, rule)) ?? waivers.get(waiverKey(file, "*")));
}
//# sourceMappingURL=waivers.js.map
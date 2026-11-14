import type { Finding, OutputFormat, ScanResult } from "./types.js";

function counts(result: ScanResult): {
  waived: number;
  baselined: number;
} {
  return {
    waived: result.findings.filter((finding) => finding.waiver).length,
    baselined: result.findings.filter((finding) => finding.baseline).length,
  };
}

export function formatHuman(result: ScanResult): string {
  const summary = counts(result);
  const lines = [
    `test-guard: audited ${result.auditedFiles.length} file(s); ${result.activeFindings.length} active, ${summary.waived} waived, ${summary.baselined} baselined`,
  ];
  for (const diagnostic of result.diagnostics ?? []) {
    lines.push(
      `  [${diagnostic.level.toUpperCase()}] ${diagnostic.code}: ${diagnostic.message}`,
    );
  }
  for (const diagnostic of result.waiverDiagnostics) {
    lines.push(
      `  [WAIVER] block ${diagnostic.block}: ${diagnostic.message}; it did not suppress findings`,
    );
  }
  if (result.staleBaseline.length > 0) {
    lines.push(
      `  [STALE] ${result.staleBaseline.length} baseline entr${result.staleBaseline.length === 1 ? "y" : "ies"} no longer matches`,
    );
  }
  for (const finding of result.activeFindings) {
    lines.push(
      `  [${finding.severity.toUpperCase()}] ${finding.file}:${finding.line}:${finding.column} ${finding.rule} — ${finding.message}`,
    );
  }
  if (result.activeFindings.length === 0) lines.push("  no active findings");
  return lines.join("\n");
}

function jsonPayload(result: ScanResult): object {
  return {
    schemaVersion: 1,
    mode: result.mode,
    ...(result.base ? { base: result.base } : {}),
    ...(result.trustedRef ? { trustedRef: result.trustedRef } : {}),
    ...(result.policySource ? { policySource: result.policySource } : {}),
    auditedFiles: result.auditedFiles,
    summary: {
      active: result.activeFindings.length,
      waived: counts(result).waived,
      baselined: counts(result).baselined,
      staleBaseline: result.staleBaseline.length,
    },
    findings: result.findings,
    staleBaseline: result.staleBaseline,
    waiverDiagnostics: result.waiverDiagnostics,
    diagnostics: result.diagnostics ?? [],
  };
}

function sarifLevel(finding: Finding): "error" | "warning" | "note" {
  if (finding.severity === "error") return "error";
  if (finding.severity === "warning") return "warning";
  return "note";
}

export function formatSarif(result: ScanResult): string {
  const rules = [
    ...new Set(result.activeFindings.map((finding) => finding.rule)),
  ].map((rule) => ({
    id: rule,
    shortDescription: { text: rule },
    helpUri: `https://github.com/ebarron/test-guard#${rule}`,
  }));
  return JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: { driver: { name: "test-guard", version: "0.1.0", rules } },
          results: result.activeFindings.map((finding) => ({
            ruleId: finding.rule,
            level: sarifLevel(finding),
            message: { text: finding.message },
            partialFingerprints: {
              testGuardFingerprint: finding.fingerprint,
            },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: finding.file },
                  region: {
                    startLine: Math.max(1, finding.line),
                    startColumn: Math.max(1, finding.column),
                  },
                },
              },
            ],
          })),
        },
      ],
    },
    null,
    2,
  );
}

function annotationEscape(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A")
    .replaceAll(":", "%3A")
    .replaceAll(",", "%2C");
}

function workflowCommand(
  command: "error" | "warning" | "notice",
  properties: Record<string, string | number>,
  message: string,
): string {
  const metadata = Object.entries(properties)
    .map(([name, value]) => `${name}=${annotationEscape(String(value))}`)
    .join(",");
  return `::${command}${metadata ? ` ${metadata}` : ""}::${annotationEscape(message)}`;
}

export function formatGithub(result: ScanResult): string {
  const lines = result.activeFindings.map((finding) => {
    const command =
      finding.severity === "error"
        ? "error"
        : finding.severity === "warning"
          ? "warning"
          : "notice";
    return workflowCommand(
      command,
      {
        file: finding.file,
        line: finding.line,
        col: finding.column,
        title: `test-guard ${finding.rule}`,
      },
      finding.message,
    );
  });
  for (const diagnostic of result.diagnostics ?? []) {
    lines.push(
      workflowCommand(
        diagnostic.level,
        { title: `test-guard ${diagnostic.code}` },
        diagnostic.message,
      ),
    );
  }
  for (const diagnostic of result.waiverDiagnostics) {
    lines.push(
      workflowCommand(
        "warning",
        { title: `test-guard waiver block ${diagnostic.block}` },
        `${diagnostic.message}; it did not suppress findings`,
      ),
    );
  }
  if (result.staleBaseline.length > 0) {
    lines.push(
      workflowCommand(
        "notice",
        { title: "test-guard stale baseline" },
        `${result.staleBaseline.length} baseline entr${result.staleBaseline.length === 1 ? "y" : "ies"} no longer matches`,
      ),
    );
  }
  const summary = counts(result);
  lines.push(
    workflowCommand(
      "notice",
      { title: "test-guard summary" },
      `audited ${result.auditedFiles.length} file(s); ${result.activeFindings.length} active, ${summary.waived} waived, ${summary.baselined} baselined`,
    ),
  );
  return lines.join("\n");
}

export function formatResult(result: ScanResult, format: OutputFormat): string {
  if (format === "human") return formatHuman(result);
  if (format === "json") return JSON.stringify(jsonPayload(result), null, 2);
  if (format === "sarif") return formatSarif(result);
  return formatGithub(result);
}

import fs from "node:fs";
import path from "node:path";
import { runCli } from "./cli.js";
import type { ScanDiagnostic } from "./types.js";

function input(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  const value = environment[`INPUT_${name.toUpperCase()}`]?.trim();
  return value === "" ? undefined : value;
}

interface PullRequestContext {
  body?: string;
  labels: Set<string>;
  malformed: boolean;
}

function eventPullRequest(environment: NodeJS.ProcessEnv): PullRequestContext {
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!eventPath) return { labels: new Set(), malformed: false };
  try {
    const value = JSON.parse(fs.readFileSync(eventPath, "utf8")) as unknown;
    if (!value || typeof value !== "object") {
      return { labels: new Set(), malformed: true };
    }
    const pullRequest = (value as Record<string, unknown>).pull_request;
    if (pullRequest === undefined) {
      return { labels: new Set(), malformed: false };
    }
    if (!pullRequest || typeof pullRequest !== "object") {
      return { labels: new Set(), malformed: true };
    }
    const record = pullRequest as Record<string, unknown>;
    const body = record.body;
    const labels = record.labels;
    if (
      (body !== undefined && body !== null && typeof body !== "string") ||
      (labels !== undefined && !Array.isArray(labels))
    ) {
      return { labels: new Set(), malformed: true };
    }
    const names = new Set<string>();
    for (const label of labels ?? []) {
      if (
        !label ||
        typeof label !== "object" ||
        typeof (label as Record<string, unknown>).name !== "string"
      ) {
        return { labels: new Set(), malformed: true };
      }
      names.add((label as { name: string }).name);
    }
    return {
      ...(typeof body === "string" ? { body } : {}),
      labels: names,
      malformed: false,
    };
  } catch {
    return { labels: new Set(), malformed: true };
  }
}

function containsWaiver(body: string): boolean {
  return /^##\s+test-guard\s+waiver\s*$/im.test(body);
}

export function runAction(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const mode = input(environment, "mode") ?? "diff";
  let code: number;
  if (!["diff", "staged", "all"].includes(mode)) {
    process.stderr.write(`test-guard: invalid action mode "${mode}"\n`);
    code = 2;
  } else {
    const args = [
      "scan",
      `--${mode}`,
      "--format",
      input(environment, "format") ?? "github",
    ];
    const base = input(environment, "base");
    const config = input(environment, "config");
    const baseline = input(environment, "baseline");
    if (base && mode === "diff") args.push("--base", base);
    if (config) args.push("--config", config);
    if (baseline) args.push("--baseline", baseline);

    const context = eventPullRequest(environment);
    const approvalLabel =
      input(environment, "approval_label") ?? "test-guard:waiver-approved";
    const candidateBody = input(environment, "pr_body") ?? context.body;
    const diagnostics: ScanDiagnostic[] = [];
    if (context.malformed) {
      diagnostics.push({
        code: "github-event-invalid",
        level: "warning",
        message:
          "GitHub event payload was malformed; pull-request waivers were not applied",
      });
    }
    const approved = !context.malformed && context.labels.has(approvalLabel);
    if (candidateBody && containsWaiver(candidateBody) && !approved) {
      diagnostics.push({
        code: "pr-waiver-unapproved",
        level: "warning",
        message: `pull-request waiver text is present but label "${approvalLabel}" is absent; waivers were not applied`,
      });
    }
    code = runCli(
      args,
      undefined,
      environment.GITHUB_WORKSPACE ?? process.cwd(),
      {
        prBody: approved && candidateBody ? candidateBody : "",
        diagnostics,
      },
    );
  }

  const outputFile = environment.GITHUB_OUTPUT;
  if (outputFile) fs.appendFileSync(outputFile, `exit-code=${code}\n`);
  return code;
}

const isMain =
  process.argv[1] !== undefined &&
  new Set(["action.ts", "index.cjs"]).has(path.basename(process.argv[1]));

if (isMain) process.exitCode = runAction();

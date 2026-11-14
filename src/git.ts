import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { TestGuardError, type ScanMode } from "./types.js";
import {
  normalizePath,
  repositoryFileExists,
  resolveRepositoryPath,
} from "./files.js";

export interface FileChange {
  status: "added" | "modified" | "deleted" | "renamed";
  path: string;
  oldPath?: string;
}

function git(cwd: string, args: string[], allowFailure = false): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) {
    throw new TestGuardError(`could not run git: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout).trim();
    throw new TestGuardError(
      `git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
  return result.status === 0 ? result.stdout : "";
}

export function repositoryRoot(cwd: string): string {
  const root = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  if (!root) throw new TestGuardError(`${cwd} is not inside a Git repository`);
  return path.resolve(root);
}

function parseNameStatus(raw: string): FileChange[] {
  const tokens = raw.split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const changes: FileChange[] = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!status) continue;
    const code = status[0];
    if (code === "R" || code === "C") {
      const oldPath = tokens[index++];
      const newPath = tokens[index++];
      if (!oldPath || !newPath) {
        throw new TestGuardError("git returned malformed rename data");
      }
      changes.push({
        status: "renamed",
        oldPath: normalizePath(oldPath),
        path: normalizePath(newPath),
      });
      continue;
    }
    const file = tokens[index++];
    if (!file) throw new TestGuardError("git returned malformed change data");
    changes.push({
      status: code === "D" ? "deleted" : code === "A" ? "added" : "modified",
      path: normalizePath(file),
    });
  }
  return changes;
}

function diff(cwd: string, args: string[]): FileChange[] {
  return parseNameStatus(
    git(cwd, ["diff", "--name-status", "-z", "--find-renames", ...args]),
  );
}

function untracked(cwd: string): FileChange[] {
  return git(cwd, ["ls-files", "-z", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean)
    .map((file) => ({ status: "added", path: normalizePath(file) }));
}

function deduplicate(changes: FileChange[]): FileChange[] {
  const seen = new Map<string, FileChange>();
  for (const change of changes) {
    const key = `${change.status}:${change.oldPath ?? ""}:${change.path}`;
    seen.set(key, change);
  }
  return [...seen.values()].sort((left, right) =>
    `${left.oldPath ?? ""}:${left.path}`.localeCompare(
      `${right.oldPath ?? ""}:${right.path}`,
    ),
  );
}

function validateBase(cwd: string, base: string): string {
  const resolved = git(
    cwd,
    ["rev-parse", "--verify", "--quiet", `${base}^{commit}`],
    true,
  ).trim();
  if (!resolved) {
    throw new TestGuardError(
      `base "${base}" is unavailable; fetch it (use fetch-depth: 0 in CI) or choose --base`,
    );
  }
  const mergeBase = git(cwd, ["merge-base", base, "HEAD"], true).trim();
  if (!mergeBase) {
    throw new TestGuardError(
      `no merge base for "${base}" and HEAD; the clone may be shallow or histories are unrelated`,
    );
  }
  return mergeBase;
}

function headCommit(cwd: string): string | undefined {
  return (
    git(
      cwd,
      ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
      true,
    ).trim() || undefined
  );
}

export function comparisonRef(
  cwd: string,
  mode: ScanMode,
  base?: string,
): string | undefined {
  repositoryRoot(cwd);
  if (mode === "all") return undefined;
  if (mode === "staged") return headCommit(cwd);
  if (!base) throw new TestGuardError("diff mode requires a base reference");
  return validateBase(cwd, base);
}

export type SnapshotSource = string;

export function listSnapshotFiles(
  cwd: string,
  source: SnapshotSource,
): string[] {
  repositoryRoot(cwd);
  const raw =
    source === "worktree"
      ? git(cwd, [
          "ls-files",
          "-z",
          "--cached",
          "--others",
          "--exclude-standard",
        ])
      : source === "index"
        ? git(cwd, ["ls-files", "-z", "--cached"])
        : git(cwd, ["ls-tree", "-r", "--name-only", "-z", source, "--"]);
  return [
    ...new Set(
      raw
        .split("\0")
        .filter(Boolean)
        .map(normalizePath)
        .filter(
          (file) => source !== "worktree" || repositoryFileExists(cwd, file),
        ),
    ),
  ].sort();
}

export function readSnapshotFile(
  cwd: string,
  source: SnapshotSource,
  file: string,
): string {
  const normalized = normalizePath(file);
  if (source === "worktree") {
    const absolute = resolveRepositoryPath(cwd, normalized, {
      kind: "scanned file",
    });
    try {
      return fs.readFileSync(absolute, "utf8");
    } catch (error) {
      throw new TestGuardError(
        `could not read worktree file ${normalized}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const entry =
    source === "index"
      ? git(cwd, ["ls-files", "--stage", "-z", "--", normalized])
      : git(cwd, ["ls-tree", "-z", source, "--", normalized]);
  const mode = /^(\d{6})\s/.exec(entry)?.[1];
  if (mode === "120000") {
    throw new TestGuardError(
      `${source === "index" ? "index" : `Git snapshot ${source}`} file ${normalized} is a symbolic link and cannot be scanned`,
    );
  }
  const object =
    source === "index" ? `:${normalized}` : `${source}:${normalized}`;
  try {
    return git(cwd, ["cat-file", "blob", object]);
  } catch (error) {
    throw new TestGuardError(
      `could not read ${source === "index" ? "index" : `Git snapshot ${source}`} file ${normalized}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function collectChanges(
  cwd: string,
  mode: ScanMode,
  base?: string,
): FileChange[] {
  repositoryRoot(cwd);
  if (mode === "all") {
    return git(cwd, [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
    ])
      .split("\0")
      .filter(Boolean)
      .map((file): FileChange => ({
        status: "modified",
        path: normalizePath(file),
      }))
      .filter((change) => repositoryFileExists(cwd, change.path));
  }
  if (mode === "staged") {
    return diff(cwd, ["--cached"]);
  }
  const mergeBase = comparisonRef(cwd, mode, base);
  if (!mergeBase)
    throw new TestGuardError("diff mode requires a base reference");
  return deduplicate([...diff(cwd, [mergeBase]), ...untracked(cwd)]).filter(
    (change) =>
      change.status === "deleted" ||
      change.status === "renamed" ||
      repositoryFileExists(cwd, change.path),
  );
}

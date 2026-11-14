import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "test-guard-smoke-"));

try {
  const git = spawnSync("git", ["init", "-q", "--initial-branch=main"], {
    cwd: temporary,
    encoding: "utf8",
  });
  if (git.status !== 0) throw new Error(git.stderr);
  fs.writeFileSync(
    path.join(temporary, ".testguard.yml"),
    fs.readFileSync(
      path.join(root, "examples/typescript/.testguard.yml"),
      "utf8",
    ),
  );
  const output = path.join(temporary, "output");
  const run = spawnSync(
    process.execPath,
    [path.join(root, "dist/action/index.cjs")],
    {
      cwd: temporary,
      encoding: "utf8",
      env: {
        ...process.env,
        INPUT_MODE: "all",
        INPUT_CONFIG: ".testguard.yml",
        INPUT_FORMAT: "github",
        GITHUB_OUTPUT: output,
      },
    },
  );
  if (run.status !== 0) {
    throw new Error(`${run.stdout}\n${run.stderr}`.trim());
  }
  if (!fs.readFileSync(output, "utf8").includes("exit-code=0")) {
    throw new Error("action did not emit exit-code=0");
  }
  process.stdout.write("action smoke test passed\n");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "test-guard-action-"));
const candidate = path.join(temporary, "index.cjs");

try {
  await build({
    absWorkingDir: root,
    entryPoints: ["src/action.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: candidate,
  });
  const checkedIn = path.join(root, "dist/action/index.cjs");
  if (
    !fs.existsSync(checkedIn) ||
    fs.readFileSync(checkedIn, "utf8") !== fs.readFileSync(candidate, "utf8")
  ) {
    process.stderr.write(
      'dist/action/index.cjs is stale; run "npm run build:action" and include it\n',
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("action bundle is current\n");
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

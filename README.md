# test-guard

`@edjbarron/test-guard` is a deterministic test-integrity CLI and GitHub
Action. It looks for changes that add production behavior without a companion
test or weaken common JavaScript/TypeScript test patterns.

> **Incubating v0.x:** test-guard is an advisory heuristic gate, not proof of
> test quality, correctness, or coverage. Review every finding and waiver.

The scanner is read-only: it makes no network calls, collects no telemetry, and
never edits source files or Git state.

## Requirements

- Node.js 22 or newer
- Git
- npm

The repository is `ebarron/test-guard`. The future npm package is scoped as
`@edjbarron/test-guard` because the unscoped package name is already occupied;
it is not currently published to npm.

## CLI

Install the current GitHub source at a reviewed full commit SHA, then initialize
a repository:

```sh
TEST_GUARD_SHA=<reviewed-40-character-commit-sha>
npm install --save-dev "github:ebarron/test-guard#${TEST_GUARD_SHA}"
npx --no-install test-guard init --preset typescript
```

Use the `polyglot` preset for repositories containing Go, TypeScript/JavaScript,
and Python. Both generated configurations are starting points and should be
narrowed to the repository's production directories.

```sh
npx --no-install test-guard scan --staged
npx --no-install test-guard scan --diff
npx --no-install test-guard scan --base=origin/release
npx --no-install test-guard scan --all
```

`--diff` includes committed changes against the merge base, staged changes,
unstaged tracked changes, and untracked files. A missing base, unrelated
history, or shallow clone is an explicit scanner error rather than a clean
result. Differential checks compare the merge-base blob directly with the
final worktree; `--staged` compares the `HEAD` blob with the index blob and
does not inspect unstaged content. `--all` runs current-state rules only.

For diff and staged scans, policy is not loaded from the proposed change.
test-guard loads `.testguard.yml` and the baseline from the merge base
(`--diff`) or `HEAD` (`--staged`). If no trusted configuration exists during
initial adoption, it uses the current configuration, ignores the current
baseline, and emits a `bootstrap-policy` diagnostic. The implicit diff-base
lookup is anchored at `origin/main`, then honors `defaultBase` from that
trusted configuration; use `--base` explicitly for another repository layout.

Exit codes are:

- `0`: no active findings
- `1`: one or more active findings
- `2`: scanner, Git, parse, baseline, or configuration failure

Choose `--format human`, `json`, `sarif`, or `github`. Scans never write a
baseline; baseline changes require the separate `baseline` command.

## Configuration

test-guard reads a strict, validated `.testguard.yml`. See
[`examples/typescript`](examples/typescript/.testguard.yml) for a TypeScript
repository and [`examples/polyglot`](examples/polyglot/.testguard.yml) for a
Go/UI/scripts layout.

The configuration defines:

- production include/exclude globs;
- TypeScript/JavaScript, Go, and Python file classes;
- Go package, colocated TS/TSX, and Python `test_<name>` companion strategies;
- internal mock prefixes, permitted modules, and mock boundary globs;
- enabled rule severities;
- baseline path and default Git base;
- minimum waiver-reason words;
- repeated-fetch threshold and Playwright API path fragments.

Companion directories are relative to the production file. A leading `/` is
repository-relative, such as `/scripts/tests`.

## Rules

- `missing-test`: a production file has no configured companion. Go is checked
  at package-directory scope.
- `test-removed`: a configured test file was deleted or moved outside test
  scope. An unchanged rename to another configured test path is preserved.
- `test-count`: a changed JavaScript/TypeScript test file has fewer AST test
  cases than its trusted snapshot.
- `assertion-count`: a changed JavaScript/TypeScript test file has fewer AST
  assertions than its trusted snapshot.
- `test-modifier`: a changed test adds a skip, focus, todo, or expected-failure
  construct.
- `matcher-weakened`: a changed assertion replaces exact equality with
  truthiness/defined checks, or a typed/message-specific throw with an untyped
  throw.
- `policy-change`: configuration, baseline, common test-runner settings, lock
  files, or GitHub workflow/action invocation changed and requires explicit
  human review. This rule cannot be disabled.
- `shallow-assertion`: a test's only assertion is `toBe(200)` or
  `toBeTruthy()`.
- `internal-mock`: `vi.mock()` targets repository-internal code rather than a
  configured boundary.
- `inline-fetch-mock`: a file repeats inline `globalThis.fetch = vi.fn()`
  setup at or above the configured threshold.
- `test-id-over-role`: a component test uses test-id queries but no accessible
  role query.
- `playwright-api-stub`: `page.route()` stubs a configured API path without a
  nearby `reason:`/`because:` comment.

TypeScript and JavaScript constructs are inspected with the TypeScript AST.
Differential fingerprints use semantic evidence and occurrence indexes rather
than source lines. Added, deleted, renamed, and space-containing paths are
handled without reading nonexistent intermediate paths. Regex is limited to
comment waivers and narrow comment context.

Coverage-floor enforcement is future work and is **not implemented**.

## Waivers

An inline waiver must include a substantive reason:

```ts
// test-guard-skip: legacy adapter is exercised through the contract suite
vi.mock("../legacy-adapter");
```

A pull request body may contain:

```markdown
## test-guard waiver

- Files: src/generated/client.ts
- Rules: missing-test
- Reason: generated declarations contain no executable behavior
- Expires: 2027-03-31
```

`Rules` and `Expires` are optional. Missing fields, unknown rules, invalid or
expired dates, boilerplate (`WIP`, `TODO`, `later`), and reasons below
`minimumReasonWords` do not suppress findings. They are reported as waiver
diagnostics.

For local review, pass a body explicitly with
`--pr-body-file path/to/body.md`. In the GitHub Action, body waivers are
ignored unless the pull request has the configured approval label (default
`test-guard:waiver-approved`). Waiver text without approval emits a diagnostic.
Malformed event payloads fail closed and never enable a waiver.

## Baseline v2

Baseline v2 stores a stable fingerprint for each semantic finding, so one
existing internal mock cannot hide a second mock in the same file.

```sh
# Refuses any growth:
npx --no-install test-guard baseline

# Explicitly acknowledge reviewed new debt:
npx --no-install test-guard baseline --accept-new
```

The file is deterministic and has no timestamp. Stale entries are reported by
full scans and removed by a successful baseline update. Legacy coarse
`(file, rule)` baseline data is rejected. Migrate only after reviewing a full
replacement:

```sh
npx --no-install test-guard baseline --migrate-v1 --accept-new
```

## GitHub Action

The action runs a checked-in Node bundle; consumer repositories do not install
the package. Pin a full commit SHA:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited, labeled, unlabeled]

permissions:
  contents: read

jobs:
  test-guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: ebarron/test-guard@0123456789abcdef0123456789abcdef01234567
        with:
          mode: diff
          base: origin/${{ github.base_ref }}
          config: .testguard.yml
          approval_label: "test-guard:waiver-approved"
```

Inputs are `mode` (`diff`, `staged`, or `all`), `base`, `config`, `baseline`,
`format`, optional `pr_body`, and `approval_label`. Pull-request bodies and
labels are read from the GitHub event by default. The `exit-code` output
mirrors the CLI.

Configure the approval label so only trusted human reviewers with appropriate
repository permissions can apply it; do not automate it from PR-authored
content. Include `edited`, `labeled`, and `unlabeled` activity types so body
and approval changes rerun the check. Make the full-SHA-pinned test-guard job a
protected-branch required check. A `CODEOWNERS` rule should require trusted
review for `.github/workflows/`, `.testguard.yml`, and the configured baseline.
Policy-change findings can be approved with the same detailed, label-gated PR
waiver process, which keeps legitimate runner and version upgrades possible.

## Cursor Agent Skill

[`skills/test-guard/SKILL.md`](skills/test-guard/SKILL.md) is a thin agent
workflow over the deterministic CLI. It may repair tests and fixtures, but
must ask before editing production code and must never weaken tests merely to
make the gate pass.

The npm package is not currently published. The immediately available
installation path is the GitHub source pinned to a reviewed full commit SHA:

```sh
TEST_GUARD_SHA=<reviewed-40-character-commit-sha>
mkdir -p .cursor/skills/test-guard
curl -fsSL \
  "https://raw.githubusercontent.com/ebarron/test-guard/${TEST_GUARD_SHA}/skills/test-guard/SKILL.md" \
  -o .cursor/skills/test-guard/SKILL.md
```

After `@edjbarron/test-guard` is published and installed, the same project
skill can be copied from npm without a network fetch:

```sh
npm install --save-dev @edjbarron/test-guard
mkdir -p .cursor/skills/test-guard
cp node_modules/@edjbarron/test-guard/skills/test-guard/SKILL.md \
  .cursor/skills/test-guard/SKILL.md
```

For a user-wide installation, use `~/.cursor/skills/test-guard/SKILL.md`
instead of the project-local `.cursor/skills` destination. Review the skill
before installation and keep GitHub installations SHA-pinned.

## Related Projects

[`kwangtaeko/test-guard`](https://github.com/kwangtaeko/test-guard) is an
independent project focused primarily on preventing test weakening. This
project originated independently from RTB-style missing-test and test-quality
checks and now includes independently implemented differential checks. There
is no affiliation between the projects.

## Development

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run check:action
npm run test:action
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for fixture and release expectations.

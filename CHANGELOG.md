# Changelog

All notable changes use the structure from Keep a Changelog. This project does
not promise semantic-versioning compatibility before 1.0.

## [Unreleased]

### Added

- Deterministic `init`, `scan`, and baseline-v2 CLI flows.
- Staged, working-tree diff, explicit-base, and full-tree scan modes.
- Configurable polyglot companion-test strategies and twelve advisory rules,
  including conservative differential test-removal, count, modifier, and
  matcher-weakening checks.
- AST-backed TypeScript/JavaScript checks, substantive inline/PR waivers, and
  expiring PR waivers with human-controlled Action label approval.
- Trusted merge-base/HEAD policy and baseline snapshots, bootstrap diagnostics,
  and dedicated policy-change review findings.
- Stable per-finding baseline fingerprints with stale-entry reporting and
  explicit coarse-baseline migration.
- Human, JSON, SARIF, and GitHub annotation output.
- Bundled JavaScript GitHub Action and Cursor Agent Skill.

### Known limitations

- Rules are conservative heuristics and do not establish test quality.
- Coverage-floor enforcement is not implemented.
- AST-aware rules currently target JavaScript/TypeScript test constructs;
  Go/Python are used for companion-test detection only.

[Unreleased]: https://github.com/ebarron/test-guard/commits/main

---
name: test-guard
description: Run, audit, explain, or fix test-guard findings. Use when the user asks to run test-guard, audit test integrity, explain test-guard output, or repair test-guard failures.
---

# Test Guard

Use the repository's installed `test-guard` CLI as the source of truth. This
skill explains deterministic findings and may repair tests or fixtures; it does
not replace scanner logic.

## Choose scope

- Default/change audit: `npx --no-install test-guard scan --diff --format json`
- Staged: `npx --no-install test-guard scan --staged --format json`
- Full audit: `npx --no-install test-guard scan --all --format json`
- Explicit base: add `--base=<ref>`

If `npx --no-install` cannot find the package, report that installation is
required. Do not fetch or install packages unless the user asks.

Exit `0` is clean, `1` means findings, and `2` is a scanner/configuration
failure. Treat exit `2` as an error; never reinterpret a missing base, shallow
clone, malformed config, parse error, or unsafe legacy baseline as clean.
Diff and staged scans use the trusted merge-base/HEAD policy and baseline.
Report `bootstrap-policy`, unapproved-waiver, malformed-event, and policy-change
diagnostics; do not dismiss them as ordinary scanner noise.

## Audit

1. Run the configured CLI in JSON mode.
2. Report all audited files; for large sets, group paths without dropping any.
3. Group active findings by rule and file.
4. List waived findings with their reasons and expiry, baselined findings, stale
   baseline entries, and malformed/expired waiver diagnostics separately.
5. Explain that v0.x findings are advisory heuristics, not proof of quality.

Do not edit `.testguard-baseline.json` during an audit. Never add a waiver or
baseline entry merely to make the result green.

## Repair

Autonomous edits are limited to:

- test files recognized by `.testguard.yml`;
- fixture, snapshot, testdata, or test-helper files used only by tests.

Prefer behavior assertions, accessible-role queries, real/replayable fixtures,
and mocks at configured system boundaries. Preserve or deepen existing
coverage.

Never:

- edit production code without explicit user authorization;
- weaken, skip, delete, or broaden a test just to pass;
- replace a real fixture with an inline mock;
- lower a rule severity, widen an exclude, add a waiver, or grow the baseline
  as a repair;
- commit, push, tag, publish, or alter Git state.

If a production change appears necessary, stop that repair and ask permission.
State the finding, likely root cause, proposed production file(s), and smallest
patch. Permission is one-shot and applies only to the named files/change.

After test/fixture repairs, run the narrow relevant test suite, then rerun the
same test-guard scan. If repository instructions define a broader required
suite, run it too. Do not claim success unless commands actually pass.

## Final summary

Summarize:

- scope and audited files;
- active, waived, baselined, and stale counts;
- tests/fixtures added or deepened;
- mocks replaced and waiver reasons encountered;
- verification commands and exact outcomes;
- remaining findings or production edits awaiting consent.

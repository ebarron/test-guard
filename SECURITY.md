# Security Policy

## Supported versions

Before the first npm release, security fixes target the latest commit on
`main`. After publication, only the latest v0.x version will receive security
fixes until a stable release.

## Reporting

Please use GitHub's private vulnerability reporting for
`ebarron/test-guard`. Do not open a public issue for an unpatched
vulnerability. Include affected versions, reproduction steps, impact, and any
suggested mitigation.

You should receive an acknowledgement within seven days. No bounty or response
time is guaranteed.

## Security model

The scanner reads repository files and invokes local Git. It makes no network
calls, sends no telemetry, and does not edit source or Git state. The GitHub
Action runs the checked-in `dist/action/index.cjs`; consumers should pin a full
commit SHA and review dependency updates.

Configuration, source files, PR waiver text, and baseline files are untrusted
input. Reports may contain repository paths and source-derived module names, so
treat JSON/SARIF output according to the repository's sensitivity.

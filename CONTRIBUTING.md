# Contributing

test-guard is an incubating v0.x project. Changes may adjust heuristics, but
must remain deterministic, offline, and read-only during scans.

## Development

Use Node.js 22+ and npm:

```sh
npm ci
npm run format
npm run lint
npm run typecheck
npm test
npm run build
npm run check:action
npm run test:action
```

Tests that exercise Git behavior must use local temporary repositories. Disable
user hooks and commit/tag signing so the suite does not depend on developer
configuration. Do not use network services in tests.

Rule changes need true-positive and false-positive tests. Git collection
changes need deletion, rename, staged, unstaged, untracked, and failure-path
coverage as applicable. Fingerprint changes are compatibility changes: explain
the baseline migration effect in the changelog.

## Action bundle

`dist/action/index.cjs` is checked in so consumer repositories need no install.
After changing action/runtime code, run:

```sh
npm run build:action
npm run check:action
```

Include the updated bundle in the proposed change.

## Releases

Maintainers update `CHANGELOG.md` and `package.json`, review `npm pack
--dry-run`, then create a signed version tag. The release workflow verifies the
tag/package version and publishes only with the protected npm environment.
Never publish from an unreviewed working tree.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

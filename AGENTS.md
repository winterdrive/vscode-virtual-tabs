# Repository Agent Instructions

- Use English for tracked repository documentation and code comments unless editing an explicitly localized file.
- Before answering or changing the repository, inspect related implementation, documentation, open work, and prior decisions. Do not rely on conversation context alone.
- Keep changes narrow and preserve unrelated worktree changes.

## Authoritative Documentation Map

Use this file as a routing entry point. Do not copy detailed procedures into
`AGENTS.md`; read the authoritative source required for the current task.

| Task | Required source |
|---|---|
| Release planning, version channels, contributor fast lane, release authorization | `docs/RELEASE_POLICY.md` |
| Build, local development, architecture, packaging | `DEVELOPMENT.md` |
| Current automated and UI/E2E test procedures | `docs/TESTING.md` |
| Contribution and pull-request expectations | `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md` |
| Localization changes | `I18N.md` and the existing locale files |
| Shipped behavior and release history | `CHANGELOG.md` |

Files under `docs/specs/`, `docs/research/`, and
`docs/specs/historical_release/` may describe proposals or historical states.
Do not treat them as current operational policy unless an authoritative source
explicitly points to them.

## Release Governance

Before planning or executing a release, read `docs/RELEASE_POLICY.md` in full
and re-check the current `main`, remote pull requests, CI, Marketplace, and
Open VSX state.

- A merged external-contributor bug fix immediately enters the Contributor Fast Lane.
- It must not remain pre-release-only indefinitely or wait for unrelated maintainer-authored routine pull requests before reaching stable.
- If the current pre-release has completed release validation, promote it to the next stable minor. Otherwise, backport the minimal fix to the current stable patch line.
- The stable `CHANGELOG.md` entry must reference the pull request and credit the contributor.
- Real UI/E2E validation is an owner-operated pre-release gate, not a required gate for every pull request.
- Without explicit owner authorization for that specific operation, do not create or modify a remote release pull request, apply `release-ready`, merge, trigger the remote UI workflow, tag, or publish.

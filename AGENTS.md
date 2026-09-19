# Repository Agent Instructions

- Use English for tracked repository documentation, code comments, and public GitHub-facing content such as issues and pull requests, unless editing an explicitly localized file.
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

For any release-related task, read `docs/RELEASE_POLICY.md` in full before
planning or taking action.

Files under `docs/specs/`, `docs/research/`, and
`docs/specs/historical_release/` may describe proposals or historical states.
Do not treat them as current operational policy unless an authoritative source
explicitly points to them.

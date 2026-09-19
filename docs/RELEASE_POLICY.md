# VirtualTabs Release Policy

This document is the single source of truth (SSOT) for VirtualTabs release
governance. Before planning or executing a release, maintainers and AI agents
must verify the current `main`, remote pull requests, CI, Marketplace, and Open
VSX state. Do not infer current release state from an old conversation, report,
or local branch.

## Version Channels

VirtualTabs uses minor-version parity to select the publication channel:

- Even minor versions, such as `0.14.x` and `0.16.x`, are stable releases.
- Odd minor versions, such as `0.13.x` and `0.15.x`, are pre-releases.
- An urgent fix on a stable line uses a patch release, such as `0.14.1`.
- The next unproven batch enters the next odd-minor pre-release and is promoted
  to the next even-minor stable release after validation.

`.github/workflows/publish.yml` determines the publication flags from
`package.json`. Do not manually override the channel selected by this version
convention.

## External Contributor Fast Lane

A merged bug fix authored by an external contributor immediately opens a
stable release window. An external contributor is a pull-request author who is
not the repository owner, routine maintenance automation, or a bot.

1. The fix may pass through pre-release validation, but it must not remain
   available only in the pre-release channel indefinitely.
2. If the current pre-release line has completed release validation, promote it
   directly to the next stable minor release.
3. If the current pre-release line is not ready, backport the minimal fix to the
   current stable patch line.
4. Do not delay the release merely to batch unrelated maintainer-authored
   routine pull requests.
5. The stable `CHANGELOG.md` entry must reference the pull request and clearly
   credit its contributor.
6. The Fast Lane shortens queueing time, not quality gates. Automated tests,
   owner-operated UI/E2E validation, and release authorization still apply.

### Stable promotion or backport

Decide in this order:

1. Verify the current stable and pre-release versions and the external pull
   request's actual dependency base.
2. Promote the pre-release to the next stable minor if automated release checks
   pass, no known release blocker remains, and the owner completes the required
   pre-release UI/E2E validation.
3. Otherwise, verify whether the minimal fix applies safely to the current
   stable line and publish a stable patch release when it does.
4. If both promotion and backport are blocked, report the concrete technical
   blocker and the shortest resolution path to the owner. Do not leave the fix
   in pre-release without a follow-up action.

## Release Train

Normal changes follow this flow:

1. Each candidate pull request completes code review, type checking,
   unit/property tests, coverage, and VSIX packaging.
2. Candidate pull requests do not bump the release version merely to enter a
   train. Version and release changelog updates belong in the release pull
   request.
3. The train is frozen when the release pull request is created. Do not add
   another pull request unless it fixes a release blocker.
4. The release pull-request body lists Included and Deferred changes,
   automated validation, manual validation, and known issues.
5. Unfinished internal candidates must not delay an external contributor's
   Fast Lane release window.

Persistence, migration, multi-root scope routing, group identity, and other
core state-model changes use a dedicated pre-release train. Do not mix them
into a stable hotfix merely to fill a release batch.

## Release Gates

### Candidate pull-request gate

- The branch represents a sufficiently current `main` and has no unresolved
  merge conflict.
- TypeScript, unit/property tests, coverage, and VSIX packaging pass.
- Persistence, provider, and multi-root changes test the production code path;
  a test-only reimplementation of the algorithm is not sufficient.
- `git diff --check` is clean.

### Release pull-request gate

- `package.json` and `package-lock.json` contain the same version.
- `CHANGELOG.md` lists every Included pull request and credits external
  contributors.
- After applying `release-ready`, version validation and all other required CI
  checks pass.
- The owner completes risk-appropriate local UI/E2E validation and a packaged
  VSIX smoke test.

Real VS Code UI/E2E validation is a manual pre-release gate, not a required
remote gate for every pull request. `.github/workflows/ui-tests.yml` is only a
diagnostic workflow and requires explicit owner authorization for each run. An
AI agent must not trigger it independently or treat a shared-runner environment
failure as proof of a product regression.

## CHANGELOG Contributor Credit

An external contributor's stable release entry must include:

- The user-visible behavior that was fixed.
- The pull-request number.
- The contributor's GitHub handle.

Example:

```md
- **fix(provider):** prevent persisted built-in groups from duplicating on reload
  ([#149](https://github.com/winterdrive/vscode-virtual-tabs/pull/149),
  thanks [@jianfulin](https://github.com/jianfulin)).
```

## Authorization Boundary

Analysis, planning, and local validation do not authorize a release. Creating
or modifying a remote release pull request, applying `release-ready`, merging a
release pull request, triggering the remote UI workflow, tagging, or publishing
requires explicit owner authorization for that specific operation. Approval
for an earlier operation does not carry forward automatically.

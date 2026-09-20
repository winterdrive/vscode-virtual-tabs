# Testing Guide (VirtualTabs)

[繁體中文](./TESTING.zh-TW.md) | English

This is the current, maintained reference for this repo's **automated** test
suites (v0.13.0 pre-release train). The current root baseline is **38 suites /
250 tests** (34 unit suites and 4 property suites). If you find older local notes describing manual test
checklists for specific past issues, they don't describe the actual current
suite — don't use them to judge current behavior or coverage.

If you add, rename, or remove a test file, update this doc in the same PR.

## Running the tests

| Script | Command | What it covers |
|---|---|---|
| Root unit + property tests | `npm test` | `tsc -p ./` then `jest --runInBand` against `**/src/test/**/*.test.ts` (excludes `src/test/ui/`) — this glob picks up **both** `src/test/unit/*.test.ts` and `src/test/properties/*.test.ts` in the same run, mocking `vscode` per-file rather than through a shared mock module |
| Coverage | `npm run test:coverage` | Same as `npm test` plus `--coverage`; `jest.config.js` only tracks coverage for `FileEntryMatcher.ts`, `GroupFileRemoval.ts`, `GroupFileTargets.ts` with a 90/80/90/90 threshold (stmts/branches/funcs/lines) — not repo-wide |
| Property tests only | `npm run test:properties` | Same Jest run, filtered to `src/test/properties` — useful when iterating on just the fast-check generators |
| UI/E2E setup | `npm run test:ui:setup` | `extest setup-tests` — downloads/prepares the VS Code + ChromeDriver instance used by all `test:ui*` scripts, without running anything |
| Main UI/E2E suite | `npm run test:ui` | Compiles UI tests (`tsconfig.test.ui.json`) then `extest setup-and-run` against `out/test/ui/**/*.test.js`, opening `test-resources/multi-root/virtual-tabs.code-workspace`, pinned to VS Code `1.96.0` |
| Demo recording | `npm run test:ui:demo` | Runs **only** `out/test/ui/demo/groupOrganize.demo.js` against `test-resources/demo-workspace`, and writes generated VS Code settings + a `test-results/demo-vscode-settings.generated.json` output file first — see "Demo script" below, this is not a regression test |
| Self-root E2E suite | `npm run test:ui:selfroot` | Runs **only** `out/test/ui/selfRoot/**/*.selfroot.js` against a dedicated `test-resources/self-root/project.code-workspace` fixture — kept separate from `test:ui` because it needs a *self-root* workspace (`"folders": [{ "path": "." }]`), which is structurally incompatible with the shared multi-root fixture every other UI test opens |

**UI tests require a real, visible VS Code window and take several minutes.**
They should be run by a human on their own machine, not by an AI agent in a
sandboxed environment.

None of the three `test:ui*` run scripts pass a project-local `-s`/`--storage`
override to `extest`. This is deliberate: `vscode-extension-tester` caches its
downloaded VS Code + ChromeDriver binaries under `%TEMP%/test-resources` by
default, and every sibling `vscode-extension-tester`-based project on this
machine (PromptManager, Edo-Tensei, editorGrouper/VirtualTabs itself) shares
that one cache instead of each downloading its own ~150MB+ copy of VS Code
1.96.0. Adding a per-project `-s` override here would silently opt this repo
out of that sharing and slow down every future first run.

There is no separate `mcp-server` test suite in this repo (unlike
PromptManager's `mcp-server/`) — `mcp-server/` here is build-only (`tsc`,
`esbuild`), with no `src/test/` directory.

## Root unit tests (`src/test/unit/`)

| File | Covers |
|---|---|
| `ConfigScopeDiscovery.test.ts` | `ConfigScopeDiscovery`'s scope-discovery algorithm across single-folder, multi-root, no-workspace, and **self-root `.code-workspace`** (workspace file's parent dir equals one of the folders) cases — including the id-collision guard that keeps scope ids unique so `provider.ts`'s `groupManagers` Map never gets two scopes mapped to the same key |
| `DropUriParser.test.ts` | Parses `text/uri-list` drag payloads (comments, blank lines, CRLF, non-string values), extracts URIs from `DataTransferFile`-like entries, dedupes while preserving order, and formats dragged files as chat-friendly references |
| `ScopeHeaderItem.test.ts` | `ScopeHeaderItem` tree node: label/contextValue for workspace vs. folder scopes, disk-root folder-name edge case, non-interactive (`command === undefined`) behavior |
| `addGroupScope.test.ts` | The "auto-decide vs. show scope picker" logic for Add Group (issues #17–#19): exactly one active repo scope auto-selects it; zero, 2+, or built-in-only selections fall back to showing the picker; `BUILTIN_SCOPE_ID` is excluded from the "non-builtin active" count |
| `autoGroupProviderRegression.test.ts` | Drives the **real** `provider.ts` `TempFoldersProvider` code path (not a hand-mirrored copy) for Auto Group by Extension/Modified Date: bookmarks move with files into new sub-groups, extensionless files share the `no-extension` bucket, sub-groups from the built-in group stay visible under a scope filter and are never persisted into a real scope, and `resetToDefault(scopeId)` doesn't leave a duplicate built-in group |
| `autoGroupScopeId.test.ts` | `buildExtAutoGroups`/`buildDateAutoGroups` inherit `sourceScopeId`/`sourceGroupId` correctly from their source group, including the case where the source has no `sourceScopeId`, and that groups from a non-first scope aren't misfiled into the first scope's config |
| `autoGrouperBookmarks.test.ts` | `AutoGrouper.groupByExtension`/`groupByDate` move bookmarks (not just files) into new sub-groups, including when the stored bookmark key differs in URI encoding from the file URI, and leave the source group's bookmarks untouched when it has none |
| `bookmarkManager.test.ts` | `BookmarkManager` URI matching when the lookup URI serializes differently from the stored key, update/remove through normalized matching, cross-group `findBookmarkKey` lookups for drag-and-drop moves, `createBookmark` against workspace-relative stored paths, and rejection of non-finite or non-integer line numbers |
| `builtInGroupInit.test.ts` | Built-in group injection condition: the fixed `!groups.some(g => g.builtIn)` check injects built-in even when user groups already exist (unlike the old buggy `groups.length === 0` check, which is also tested here as a documented regression baseline), keeps it first, and never double-injects |
| `builtInGroupSyncPersistence.test.ts` | Built-in tab and editor-group topology snapshots refresh the TreeView without rewriting config; duplicate events are ignored; scoped creates and built-in duplication paint before a target-only debounced save; multi-root duplication targets Workspace Config and single-folder duplication targets its folder scope |
| `configReloadNotification.test.ts` | `buildReloadMessage`/`dispatchReloadNotification`: i18n message fallback chain, uses `setStatusBarMessage` (3000ms) rather than a popup on success, suppresses notification during internal saves or failed reloads |
| `copyGroupName.test.ts` | `I18n.stripCopyPostfix`: strips a trailing "copy" postfix with/without an index, leaves non-matching names unchanged, and round-trips through `getCopyGroupName` so repeated duplication doesn't stack postfixes |
| `dragAndDropHiddenFiles.test.ts` | Drag-drop folder expansion filters out dot-prefixed hidden folders (e.g. `.git`) while still surfacing dot-prefixed hidden *files* (e.g. `.gitignore`), and correctly skips all descendants of a hidden folder |
| `dragHandleGroups.test.ts` | `handleDrag`'s group-collection logic (built-in and custom groups, including nested sub-groups, skipping groups without an id, deduping URIs across multiple dragged groups) and `EditorGroupItem`'s per-viewColumn file collection/dedup |
| `dragIsDescendantCycleGuard.test.ts` | `isDescendant`'s cycle guard for group drag-and-drop: direct/multi-level descendants return true, unrelated groups return false, and both a cyclic `parentGroupId` chain and a group pointing to itself terminate instead of infinite-looping |
| `fileEntryMatcher.test.ts` | `matchesStoredFileEntry` across relative-with/without-scope-root, absolute, and `file://` URI stored-path forms, including URIs that differ in string form but resolve to the same file, and a malformed `file://` URI returns false instead of throwing |
| `fileManagerRelpath.test.ts` | `FileManager.addFilesToGroup`/`removeFilesFromGroup` correctly recognize and operate on files stored as workspace-relative paths, remove orphaned bookmarks with removed files (including the last bookmarks field), and still report `notFound` for genuinely absent files |
| `fileSorter.test.ts` | `FileSorter.sortFiles` for all five criteria (none/name/path/extension/modified): stability and no-copy optimization for "none", asc/desc + non-mutation for name/path, extensionless-first + same-extension name-tiebreak for extension, and mtime-lookup-failure fallback to 0 for modified |
| `groupAggregation.test.ts` | Merging groups across multiple scopes: correct total count, `sourceScopeId` injected per group, other fields preserved, and empty-scope-array/empty-group edge cases |
| `groupFileRemoval.test.ts` | `removeStoredFileEntriesFromGroup`: no-op when the group has no files or no targets selected, removes every selected relative file while keeping unmatched bookmarks |
| `groupFileTargets.test.ts` | `groupItemsByGroupIdx`: empty map for no selection, single group for same-group selection, insertion-order-preserving split across multiple groups |
| `groupManagerCacheIsolation.test.ts` | `GroupManager`'s load cache: mutating a cache-miss result doesn't corrupt a subsequent cache-hit read, and each `loadGroups()` call returns an independent copy |
| `groupManagerNonArrayConfig.test.ts` | `GroupManager` recovers to an empty-array default (and attempts a backup) when `virtualTab.json`'s root is an object, a bare scalar, `null`, or when the corrupted-file backup itself fails |
| `getScopeLabel.test.ts` | Scope labels use VS Code's `WorkspaceFolder.name` through `scope.label`, including custom multi-root display names and filesystem-root folders where `path.basename` would be empty |
| `i18nGetMessage.test.ts` | `I18n.getMessage` placeholder substitution: plain args, literal `$` in an argument isn't treated as a replacement pattern, `$&`/`$$`/`$1`-style patterns in an argument aren't expanded, multiple placeholders substituted independently |
| `legacyMigration.test.ts` | Migration of the old single-value `virtualTabs.activeScope` setting to the new `activeScopes` array: wraps a non-empty old value, prefers the new key whenever present (even as an empty array, meaning "user cleared the filter"), and returns empty when neither key is set |
| `projectExplorerMaxResults.test.ts` | `ProjectExplorer.exploreProject`'s `maxResults` validation: negative, zero, and non-integer values all fall back to the default (negative specifically doesn't slice from the array's end), a valid positive value still truncates |
| `removeFilesFromGroup.test.ts` | `TempFoldersProvider.removeFilesFromGroup` against reloaded (workspace-relative-path) groups: single/multiple file removal, correct source-scope-root resolution when groups belong to different folders, fallback to workspace root for legacy groups without a source scope, bookmark removal alongside file removal, and no-op when selection doesn't match stored entries |
| `scopeDescription.test.ts` | `computeScopeDescription`: no-filter (undefined), built-in-only, single/multiple repo scope labels, "N scopes" counting, and stale-id filtering (ids no longer in `configScopes` are excluded from the count) |
| `scopeFilterRoot.test.ts` | Root-level tree shape after applying a scope filter (issues #10–#14): built-in-only, single-repo-scope (flat, no `ScopeHeaderItem`), single-repo + built-in, multiple-repo-scopes (with `ScopeHeaderItem`s), and clearing the filter restores the full multi-scope view |
| `ScopeHeaderItem.test.ts` | *(see above)* |
| `selfRootScopeCollisionRegression.test.ts` | **Issue/PR #116** — drives the real `discover()` → `reinitializeScopes()` → `GroupManager` file I/O → `saveGroupsImmediate()` pipeline (with a minimal mocked `vscode`) across simulated close/reopen cycles against a real temp self-root project dir, asserting the persisted group count never grows; also isolates the original root cause with a test that shows an id collision reaching `groupManagers` still doubles the group on save. Written specifically because `ConfigScopeDiscovery.test.ts` only exercises a hand-mirrored copy of the discovery logic and can't catch a regression in the real persistence path |
| `sendToLoadTargets.test.ts` | `SendToManager.loadSendTargets` sanitizes malformed target entries: drops entries missing a path or name, drops entries with an empty/non-string path array, returns empty for an all-malformed list, and leaves valid entries untouched |
| `skillGeneratorBuildSkillBody.test.ts` | Skill generation reports an actionable error when the packaged `SKILL.md` template is absent, while the success path strips frontmatter and substitutes the generated script path |
| `sourceScopeId.test.ts` | Injection/removal/routing of the `sourceScopeId` field used to track which scope a group came from: injects into all groups without touching other fields, removal strips it from serialized JSON, and routing skips groups with an invalid or missing `sourceScopeId` |

## Property-based tests (`src/test/properties/`)

These run as part of the same `npm test` invocation (matched by the same
`**/src/test/**/*.test.ts` glob) using `fast-check` generators rather than
example-based cases. `npm run test:properties` runs just this subset.

| File | Covers |
|---|---|
| `configScope.property.test.ts` | `ConfigScope` invariants under generated scope/folder combinations |
| `discovery.property.test.ts` | `ConfigScopeDiscovery` invariants (e.g. id uniqueness) under generated workspace-folder layouts |
| `pathRouting.property.test.ts` | Path-routing logic invariants under generated relative/absolute/URI path inputs |
| `treeView.property.test.ts` | Tree-view rebuild behavior under generated scope-id sets, e.g. that changing one scope's config only reloads that scope (mirroring `onExternalFileChange(scopeId)`) |

## UI / E2E tests (`src/test/ui/`)

Every file in the main suite opens the same shared fixture,
`test-resources/multi-root/virtual-tabs.code-workspace` (folders `Repo-A` /
`Repo-B`), via one `extest setup-and-run` invocation — mocha runs each file's
`describe` block sequentially against that single already-open VS Code
window, and most files write/restore each repo's `.vscode/virtualTab.json`
in `before()`/`after()` so suites don't leak state into each other despite
sharing the window.

Most files implement (or import a copy of) a `dismissOnboardingOverlay()`
helper that injects CSS/removes DOM nodes for VS Code's "Welcome" walkthrough
overlay — this overlay intercepts clicks in a fresh profile and would
otherwise make Activity Bar / sidebar interactions flaky or fail outright.
Several files (`contextMenuAvailability`, `copySubmenu`, `executableFile`)
also retry on `StaleElementReferenceError` while polling virtualized
`.monaco-list-row` tree rows, since VS Code recycles DOM nodes as the list
scrolls.

| File | Covers |
|---|---|
| `virtualTabs.ui.test.ts` | Baseline sanity: Activity Bar icon exists, clicking it opens the sidebar, sidebar title reads "Virtual Tabs", and the Add Group button is correctly hidden in a multi-root workspace (which uses per-scope inline buttons instead) |
| `builtInGroup.ui.test.ts` | Built-in "Currently Open Files" group init/visibility (manual tests #5–#7): appears even with existing custom groups, appears in an empty workspace, survives Refresh, and always renders before any `ScopeHeaderItem` |
| `multiRootScopes.ui.test.ts` | Multi-root scope UI: one tree section per discovered project scope with existing groups beneath it, adding a group through a scope header persists only to that scope's config, and (issue #56) Auto Group by Extension/Modified Date on a Repo-B group saves its auto-groups only into Repo-B's config |
| `scopeFilter.ui.test.ts` | Scope-filter picker UI (manual tests #10–#14) via direct DOM manipulation of VS Code's `canPickMany` QuickPick (since `vscode-extension-tester` has limited native support for it): built-in-only, single-scope, scope+built-in, multi-scope, and clearing the filter |
| `configReload.ui.test.ts` | **PR #51** — externally modifying `virtualTab.json` shows a status-bar "Config reloaded" message and does *not* pop up an information-message notification |
| `contextMenuAvailability.ui.test.ts` | The full context-menu/inline-button availability matrix (from `DEVELOPMENT.md`) across all five item types (Custom Group, Built-in Group, File-in-Custom, File-in-Built-in, Bookmark) — each suite collects the menu once in `before()` with a non-empty guard, then asserts every expected command is present and every inapplicable command is absent |
| `copySubmenu.ui.test.ts` | The "Copy..." submenu's contents (Copy Name / Copy Context for AI / Copy File Name / Copy Relative Path / Copy Absolute Path, plus Copy File Paths at group level) across the same five item types |
| `sortFilesSubmenu.ui.test.ts` | The "Sort Files" submenu's contents (by Name/Path/Extension/Modified, toggle order, clear sorting) for Custom and Built-in groups |
| `executableFile.ui.test.ts` | The "Run" inline button appears only for `.bat`/`.exe`-style executable file items (custom and built-in group variants) and is correctly absent for a plain `.ts` file (regression guard) |
| `addBookmarkNoDuplicate.ui.test.ts` | Adding a bookmark on Windows doesn't create a second file tree entry when the stored file URI's drive-letter casing differs from the URI VS Code hands back at bookmark time |
| `removeSelectedFilesFromGroup.ui.test.ts` | Removing selected files from a group correctly operates on reloaded (workspace-relative-path) groups, including when two separate groups both contain relative-path entries, without cross-group leakage |
| `autoGroupBookmarksAndBuiltIn.ui.test.ts` | Two v0.7.8 regressions found via manual testing, reproduced end-to-end: (1) **#96** — Auto Group by Extension previously moved only the file, not its bookmark, because the fix in #81 only touched the MCP-tool layer (`core/AutoGrouper.ts`), never the real tree-view command path in `provider.ts`; (2) **#99** — auto sub-groups created from the built-in group were invisible under an active scope filter and, once visible, were being silently persisted into whichever real scope's config happened to be first. Deliberately written as real end-to-end tests because the unit tests added alongside #96/#99 use a hand-built provider harness with a mocked `vscode` module — exactly the kind of gap that let both bugs ship in the first place |

### `src/test/ui/selfRoot/` — dedicated self-root E2E suite

`scopeCollision.selfroot.ts` is a real end-to-end regression test for
**issue/PR #116** (the self-root `.code-workspace` ConfigScope id collision
that doubled users' `virtualTab.json` group count on every reopen — 41 → 82
entries reported live). Unlike `selfRootScopeCollisionRegression.test.ts`
(a Jest test against a hand-mocked `vscode` module), this launches the real
packaged extension inside a real VS Code instance opened directly against a
self-root workspace, drives the exact user actions that triggered the bug
(toggling the Virtual Tabs view, clicking Refresh), and asserts across three
cycles that the persisted group count never grows and the tree never shows a
duplicated scope section. Both this suite and the unit-test counterpart were
added together specifically to close the gap the bug exposed, using a
fail-before/pass-after-the-fix methodology verified at the time.

It uses the `.selfroot.ts` naming convention (not `.test.ts`) and its own
fixture, `test-resources/self-root/project.code-workspace`, precisely
*because* a self-root workspace layout can't coexist with the shared
multi-root fixture — hence its own `test:ui:selfroot` script and its own
`tsconfig.test.ui.json`-compiled `out/test/ui/selfRoot/**/*.selfroot.js`
glob, run in complete isolation from the rest of `test:ui`.

### `src/test/ui/demo/` — not a test suite

`groupOrganize.demo.ts` (plus its `demoHelpers.ts`, `recording.ts`, and
`write-demo-settings.cjs` support files) is a **recording script**, not a
regression test, despite being structured as a mocha `describe`/`it` block
so it can reuse the same `vscode-extension-tester` driver plumbing. Running
`npm run test:ui:demo` opens a dedicated demo-workspace fixture, sets
zoom/telemetry/walkthrough settings for a clean recording, walks through a
scripted "group scattered files → export AI context" flow with visible
click-ripple cues, and produces `test-results/demo-raw.mp4` for turning into
README/marketing assets. It is not run as part of `test:ui` and asserts
nothing meaningful about correctness — do not treat a failure here as a
regression signal, and do not add real coverage assertions to it.

## Known limitations

- **UI tests require a real, visible VS Code window** and take several
  minutes; they should be run by a human on their own machine, not an AI
  agent in a sandboxed environment.
- **The shared `%TEMP%/test-resources` extest cache is intentional**, not an
  oversight — see "Running the tests" above. Don't add a `-s`/`--storage`
  flag to any `test:ui*` script without understanding you'd be opting this
  repo out of that sharing with PromptManager/Edo-Tensei.
- **`test:ui`, `test:ui:demo`, and `test:ui:selfroot` are pinned to VS Code
  `1.96.0`** via `extest`'s `-c` flag — independent of this extension's own
  `engines.vscode` compatibility floor (`^1.75.0`), which is what actually
  ships to users.
- **No `mcp-server` test suite exists in this repo** — `mcp-server/` is
  build-only. If MCP-tool-layer bugs like #96 recur, remember the lesson
  from `autoGroupBookmarksAndBuiltIn.ui.test.ts`: a fix at the MCP-tool layer
  does not automatically cover the real tree-view command path in
  `provider.ts`, and vice versa.
- **The self-root ConfigScope collision (#116) needed a real E2E test, not
  just a unit test**, because the unit-level regression test
  (`selfRootScopeCollisionRegression.test.ts`) mirrors the discovery/persist
  pipeline with a hand-mocked `vscode` module — it's a good regression guard
  for that exact code path, but it can't catch a *different* future bug in
  how `provider.ts` wires the real VS Code APIs together. The pattern of
  pairing a fast unit regression test with a slower dedicated E2E suite for
  the same bug, verified fail-before/pass-after the fix, is worth repeating
  for future collision-class bugs.
- **No explicit flaky-test documentation, retry annotations (`this.retries`),
  or skipped/`xit`/`xdescribe` tests were found** anywhere under `src/test/`
  at the time of writing — the only retry-like pattern is the generic
  `StaleElementReferenceError` polling loop used in a handful of UI tests
  (see "UI / E2E tests" above), which is a DOM-recycling workaround, not a
  documented flakiness issue. If a genuinely flaky UI test shows up in the
  future, prefer PromptManager's approach (documented in its own
  `docs/TESTING.md`): investigate whether the failure is consistent (a real
  harness limitation, not fixable by retries) or intermittent (a real
  candidate for a bounded retry) before reaching for `this.retries()`.
- **Unit test titles mix Traditional Chinese and English** depending on when
  each file was written — this is historical, not a convention to enforce
  either way when adding new tests.

# Change Log

All notable changes to the "VirtualTabs" extension will be documented in this file.

## [0.14.0] - Stable Release: Multi-Root State Consistency & Reload Safety - 2026-09-20

- **Stable Promotion:** promotes the tested `0.13.0` multi-root and state-consistency batch to the stable channel, including #120, #121, #122, #123, #126, #127, #128, #140, and #141.
- **fix(provider):** ignore stray persisted `builtIn` entries when loading one scope or all scopes, preventing repeated refreshes or external configuration reloads from duplicating the built-in `Currently Open Files` group ([#149](https://github.com/winterdrive/vscode-virtual-tabs/pull/149), thanks [@jianfulin](https://github.com/jianfulin)).
- **docs(release):** establish canonical release governance, the External Contributor Fast Lane, documentation ownership, and generated LLM context artifacts (#150).

## [0.13.0] - Multi-Root & State-Consistency Batch (pre-release) - 2026-08-27

- **fix(commands):** duplicate the built-in `Currently Open Files` group into an explicit target scope, show it immediately, and persist only that scope; multi-root workspaces use `Workspace Config`, while single-folder windows use their folder scope (#140, fixes #138).
- **fix(provider):** synchronize editor-group topology changes such as split creation/removal and group reordering through `tabGroups.onDidChangeTabGroups`, while snapshot guards suppress duplicate TreeView refreshes (#141, fixes #129).
- **fix(provider):** group extensionless files together under `no-extension` instead of creating a separate Auto Group for each filename (#120).
- **fix(core):** display VS Code's configured workspace-folder label, including custom multi-root names and filesystem-root folders (#121).
- **fix(commands):** ignore bookmark edit/remove commands whose captured group index is stale instead of dereferencing a missing group (#122).
- **fix(core):** remove orphaned bookmarks when MCP-driven file removal drops their file from a group (#126).
- **fix(core):** reject non-finite and non-integer bookmark line numbers at the shared core boundary (#127).
- **fix(mcp):** report an actionable error when the packaged `SKILL.md` template is missing (#128).
- **docs(testing):** refresh the maintained automated-testing reference for the current 38-suite / 249-test baseline (#123).
- **Known monitoring item:** Windows `EBADF` config-save failures have not reappeared in recent smoke tests, but the underlying synchronous persistence strategy remains tracked in #135 and is not claimed fixed by this release.

## [0.12.0] - Stable Release: Reliable Tab Sync & Faster Cold Start - 2026-08-26

- **Stable Promotion:** promotes the tested `0.11.1` and `0.11.2` pre-release fixes to the stable tier.
- **fix(provider):** reliably synchronize background, preview, close, move, pin, and split-editor tab changes in the built-in `Currently Open Files` group without requiring a view switch or manual refresh (#125, contributed by @jianfulin).
- **fix(provider):** keep tab-only synchronization in memory instead of rewriting `virtualTab.json`, reducing unnecessary filesystem work and save-error exposure (#130).
- **fix(provider):** avoid no-op config writes when the VirtualTabs view first appears, render newly created scoped groups before debounced persistence, save only the modified scope, and avoid a duplicate deactivation write (#136).
- **Manual verification:** Windows multi-root testing covered cold start, preview replacement, Open to Side, custom-group create/rename/duplicate/delete, persistence across Reload Window, and confirmed no observed `EBADF` during the release smoke test.
- **Known issue:** in a multi-root workspace, `Duplicate Group (Currently Open Files)` may not appear until Refresh/Reload, after which the snapshot is visible under `Workspace Config` (#138). Avoid repeated clicks until this follow-up is fixed.

## [0.11.2] - Cold-Start Config I/O Fix (pre-release) - 2026-08-26

- **fix(provider):** refresh the VirtualTabs view without rewriting unchanged `virtualTab.json` files, let newly created groups render before debounced persistence, and limit scoped group creation to saving only the modified workspace scope (#136)
- **fix(provider):** clear completed save timers and merge pending scoped saves so extension deactivation does not repeat an already-finished write (#136)

## [0.11.1] - Currently Open Files Auto-Sync Fix (pre-release) - 2026-08-26

- **fix(provider):** reliably synchronize background and preview tabs in the built-in `Currently Open Files` group without requiring a view switch or manual refresh (#125, contributed by @jianfulin)
- **fix(provider):** avoid rewriting `virtualTab.json` when only the in-memory built-in tab snapshot changes, eliminating unnecessary config writes from tab-only events (#130)

## [0.11.0] - Routine Bug-Hunt Batch (pre-release) - 2026-08-16

- **fix(mcp):** guard `validate_json_structure` against non-object array elements — a `null`/primitive entry in an otherwise well-formed array crashed with a misleading "JSON parse error" instead of a clear validation message (#104)
- **fix(commands):** use the localized copy postfix when stripping the copy suffix in `duplicateGroup` — under zh-tw/zh-cn (`複本`/`副本`), the old hardcoded `"Copy"` regex never matched, so repeated duplication stacked postfixes without bound (#105)
- **fix(provider):** surface save failures to the user instead of silently swallowing them — a failed write to `virtualTab.json` (disk full/locked/permissions) previously dropped edits with only a console log (#106)
- **fix(core):** use normalized bookmark key lookup in `AutoGrouper.moveBookmarks` — mirrors the existing normalization in `dragAndDrop.ts`, fixing bookmarks silently left behind (and duplicated) on auto-group when a stored key didn't exactly string-match the file's URI (#107)
- **fix(dragAndDrop):** guard `isDescendant` against cyclic `parentGroupId` chains — a corrupted or hand-edited config with a group cycle caused unbounded recursion to a stack overflow (#108)
- **fix(mcp):** isolate per-agent skill generation failures — one agent's failure no longer aborts skill generation for the rest of the selected agents (#109)
- **fix(core):** don't let a failed corrupted-config backup block recovery — if backing up a corrupted `virtualTab.json` itself failed, the default-config recovery step never ran, permanently stuck with a stale in-memory version and every subsequent save failing with an optimistic-lock error (#111)
- **fix(core):** don't throw on a malformed `file://` URI when matching stored file entries — a hand-corrupted config entry (e.g. an unescaped `%`) no longer aborts the whole add/remove-file loop (#112)
- **fix(core):** guard `ProjectExplorer.exploreProject` against invalid `maxResults` — non-positive or non-integer values from an MCP client no longer silently truncate results incorrectly (#114)
- **fix(extension):** refresh the tree view's scope description after a workspace-folder change removes an active scope, instead of leaving it stale (#115)
- **chore(sendTo):** remove the dead `getFilesInDirectory` method, unused anywhere in the codebase (#113)
- **chore(deps):** bump the `npm_and_yarn` dependency group across 2 directories — patch/minor security backports only (#110)

## [0.10.0] - Stable Release: Self-Root Workspace Fix & Auto-Group Promotion - 2026-08-16

- **fix(core):** resolve self-root `.code-workspace` `ConfigScope` id collision (#116, contributed by @jianfulin) — when a `.code-workspace` file declares only its own directory as the sole folder (`"folders": [{"path": "."}]`), the workspace scope and folder scope shared the same id, so every activation re-read and re-saved the same `virtualTab.json` twice, doubling group entries on each reopen. `ConfigScopeDiscovery` now skips the redundant workspace scope when it collides with a folder scope, and `provider.ts` adds a defense-in-depth guard against any future duplicate scope id.
- **Stable Promotion:** promotes the 0.9.0 pre-release fixes to the stable release tier — don't persist auto sub-groups sourced from the built-in "Currently Open Files" group (#99), and avoid a duplicate built-in group entry on scoped `resetToDefault` (#98).

## [0.9.0] - Built-in Auto-Group Duplicate Persistence Fixes (pre-release) - 2026-07-26

### 🐛 Bug Fixes

- **fix(provider):** don't persist auto sub-groups sourced from the built-in "Currently Open Files" group — they previously fell back to being saved into whichever real scope's storage file happened to be first, then re-rendered a second time under that scope's header on reload (#99)
- **fix(provider):** avoid duplicate built-in group on scoped `resetToDefault` — deleting a scope's `virtualTab.json` on disk could leave two built-in group entries in the tree (#98)

## [0.8.0] - Stable Release: Auto Group Fixes Promoted to Stable - 2026-07-26

### ✅ Stable Promotion

- Promotes the Auto Group bookmark-preservation and built-in scope-visibility fixes (#96, shipped in the 0.7.8 pre-release) to the stable release tier after manual E2E verification.

### 🧪 Testing

- **test(ui):** add E2E coverage for Auto Group bookmark preservation and built-in duplicate persistence (#100)

### 📝 Documentation

- **docs(ci):** require explicit confirmation before triggering `ui-tests.yml` (#101)

## [0.7.8] - Auto Group Bookmark & Scope-Visibility Fixes - 2026-07-23

### 🐛 Bug Fixes

- **fix(AutoGrouper):** move bookmarks to sub-groups on extension/date auto-grouping in the real tree-view command path (`provider.ts`), not just the MCP-tool layer (#96) — bookmarks were still dropped when using Auto Group by Extension/Date from the UI
- **fix(provider):** auto sub-groups created from the built-in "Currently Open Files" group stay visible when a scope filter is active (#96) — previously excluded from scope-filtered views because they lacked the `builtIn` flag
- **fix(extension):** dispose `FileSystemWatcher` when a scope's workspace folder is removed (#95) — prevents resource leaks in multi-root workspaces
- **fix(treeItems):** use `folder.name` for `ScopeHeaderItem` label instead of `path.basename` (#92) — respects custom multi-root workspace folder names and avoids empty labels for filesystem-root folders

### 🔧 Maintenance

- **chore(deps):** bump the `npm_and_yarn` dependency group across 2 directories (#91)

## [0.7.7] - Defensive Fixes & MCP Stability - 2026-07-22

### 🐛 Bug Fixes

- **fix(extension):** dispose treeView listeners and pending reveal timer (#77) — prevents listener leaks on extension deactivation
- **fix(provider):** guard against stale `groupIdx` when rendering file bookmarks (#78) — avoids out-of-bounds access after group list changes
- **fix(commands):** clamp bookmark position to document bounds in `jumpToBookmark` (#80) — prevents reveal errors on files shorter than the stored line
- **fix(mcp):** guard `files` iteration in `validate_json_structure` against `undefined` (#82) — stops MCP server crash when `files` key is absent
- **fix(i18n):** avoid `$`-pattern corruption in `getMessage` placeholder substitution (#86) — UNC paths and error strings no longer produce garbled notification text
- **fix(provider):** flush pending debounced save on deactivation (#83) — edits made within the 500 ms debounce window are now persisted before VS Code exits
- **fix(FileManager):** use normalized membership check for add/remove files (#79) — path comparison now consistent with bookmark key format
- **fix(dragAndDrop):** use normalized bookmark key lookup when moving files between groups (#85) — bookmarks correctly follow dragged files
- **fix(sendTo):** drop malformed send-target entries when loading config (#87) — prevents silent failures when config contains invalid entries
- **fix(GroupManager):** treat non-array JSON config as corrupted (#88) — resets storage instead of iterating over non-iterable value
- **fix(AutoGrouper):** move bookmarks to sub-groups on extension/date auto-grouping (#81) — bookmark entries now follow their files into sub-groups after auto-group calls
- **fix(mcp-server):** poll for workspace root instead of checking once at 3 s (#89) — slower MCP clients no longer miss the Roots handshake

## [0.7.6] - Multi-root Scope & Cache Correctness Fixes - 2026-07-01

### 🐛 Bug Fix

- **Group duplication in multi-root workspaces** ([#67](https://github.com/winterdrive/vscode-virtual-tabs/pull/67)): Duplicating a group now preserves `sourceScopeId`, so the copy saves to the same workspace root as the original instead of falling back to the first root.
- **Missing watchers for scopes added after startup** ([#68](https://github.com/winterdrive/vscode-virtual-tabs/pull/68)): Workspace folders added after activation now get their own `FileSystemWatcher`, so externally edited `virtualTab.json` files in newly added roots auto-refresh the tree view.
- **Group cache corruption on cache-miss** ([#69](https://github.com/winterdrive/vscode-virtual-tabs/pull/69)): `GroupManager.loadGroups()` now clones the result on the cache-miss path (matching the existing cache-hit behavior), preventing callers that mutate the returned array from silently corrupting the in-memory cache before it is persisted.
- **Bookmarks for relative-path files** ([#73](https://github.com/winterdrive/vscode-virtual-tabs/pull/73)): `createBookmark` now uses the same normalized path matching as file removal, so bookmarking a file stored as a workspace-relative path no longer incorrectly throws "File is not in group".
- **`Send To` with no destination folders** ([#74](https://github.com/winterdrive/vscode-virtual-tabs/pull/74)): Guards against an empty destination list, which previously caused a divide-by-zero progress step; adds a localized "no destinations" message in English, Simplified Chinese, and Traditional Chinese.

### 🧪 Tests

- Added unit tests covering all five `FileSorter` sort criteria (`none`, `name`, `path`, `extension`, `modified`), including edge cases like non-mutation and graceful `mtime` fallback ([#75](https://github.com/winterdrive/vscode-virtual-tabs/pull/75)).

## [0.7.5] - Drag-and-Drop DataTransfer Fixes - 2026-06-21

### 🐛 Bug Fix

- **Folder drops from VS Code Explorer** ([#60](https://github.com/winterdrive/vscode-virtual-tabs/issues/60)): External folder drops now handle VS Code's special `files` DataTransfer MIME entries in addition to `text/uri-list`, so folders dragged from Explorer or the OS can be expanded and added to a VirtualTabs group.
- **Group drags to AI chat sidebars** ([#60](https://github.com/winterdrive/vscode-virtual-tabs/issues/60)): Dragging a VirtualTabs group now also provides `text/plain` file references, giving chat inputs such as GitHub Copilot a readable fallback when they do not consume `text/uri-list` from extension tree items.

### 🧪 Tests

- Added unit coverage for URI-list parsing, external DataTransfer file URI extraction, duplicate URI handling, and chat-friendly drag text formatting.

## [0.7.4] - Skill Installer UX - 2026-06-16

### 🧠 Skill Installer UX (closes #25)

- **3-state install flow**: Workspace → Mode → Agents, with back navigation at every step
- **Multi-root workspace support**: Shows workspace picker (with active-editor pre-selection hint) when multiple folders are open
- **Auto Install**: `npx skills add winterdrive/vscode-virtual-tabs` launched in a terminal with one click
- **Manual Install**: Multi-select agent picker; choose one or more of Cursor, Antigravity, Claude Code, GitHub Copilot, Kiro IDE, Cline, Gemini CLI
- Added **Gemini CLI** as a supported install target (`.gemini/skills/virtualtabs/SKILL.md`)

## [0.7.2] - Auto Group Scope Fix - 2026-06-02

### 🐛 Bug Fix

- **Auto group saved to wrong scope in multi-root workspace** ([#56](https://github.com/winterdrive/vscode-virtual-tabs/issues/56)): Auto groups created by "Auto Group by Extension" and "Auto Group by Modified Date" now correctly inherit the source group's `sourceScopeId`, so they are saved to the right project root's `.vscode/virtualTab.json`. Previously, missing `sourceScopeId` caused the save route to fall back to the first workspace root, making auto groups disappear on reload in multi-root workspaces.

### 🧪 Tests

- **Unit tests**: 13 tests verifying `sourceScopeId` inheritance for both extension and date auto groups, including edge cases (no scope, non-first scope, empty input).
- **E2E tests**: 2 UI tests confirming auto groups land in the correct root's config file and leave the other root's config untouched.

## [0.7.1] - Demo Recording Pipeline - 2026-05-26

### 🎬 Product Demo Recording

- Added `npm run test:ui:demo` for a focused VS Code UI demo flow that records the VirtualTabs group organization and AI-context workflow.
- Added a dedicated `test-resources/demo-workspace` fixture so demo recording uses stable, product-like files instead of ad hoc local workspace state.
- Added demo helpers for captions, click ripples, context-menu interaction, and deterministic recording settings output under `test-results/`.

### 🧪 Demo Harness

- Kept the demo flow separate from the regular `npm run test:ui` regression suite so product recording can evolve without making CI UI tests slower or more fragile.

## [0.7.0] - Agent Skill - 2026-05-24

### 🧠 Agent Skill (npx skills add)

- Added `skills/virtualtabs/SKILL.md` as SSOT for `npx skills add winterdrive/VirtualTabs`
- Refactored `SkillGenerator.ts`: button-generated skill now reads from bundled `SKILL.md` instead of hardcoded inline template, keeping it always in sync

### 🔧 Internal

- Added `build:skills` script to sync SKILL.md and `vt.bundle.js` into `dist/skills/virtualtabs/`
- `vscode:prepublish` now runs `build:skills` automatically

## [0.6.2] - Config Reload Status Bar Notification - 2026-05-25

### 🔔 Config Reload Notification

- **Status bar instead of popup**: The "Config reloaded" message now appears in the status bar for 3 s and auto-dismisses, instead of a popup requiring manual dismissal. Resolves [#50](https://github.com/winterdrive/vscode-virtual-tabs/issues/50).

### 🧪 Reload Notification Tests

- **Unit tests**: Added coverage for message-building i18n fallback and dispatch logic — success, failure, `isInternalSaving`, and empty i18n string cases.
- **UI tests**: Added VS Code UI test verifying the status bar shows the reload message and no popup notification appears.

## [0.6.1] - Bookmark Deduplication & E2E Coverage - 2026-05-22

### 🔖 Bookmark Deduplication

- **Duplicate bookmark fix**: Bookmarks for the same file added with different URI casing (e.g. `D:` vs `d:`) are now correctly deduplicated.

### 🧪 Executable File & Sort Submenu Tests

- **E2E tests**: Added tests for executable file inline Run button and Sort Files submenu availability in both custom and built-in groups.
- **Unit tests**: Added bookmark deduplication unit tests.

## [0.6.0] - Multi-root Workspace Refinements - 2026-05-16

### 🌲 Multi-root Workspace UX

- **Per-scope Add Group button**: The panel title **Add Group** (`+`) button is hidden in multi-root workspaces. Each project scope's inline button handles group creation, keeping the action next to the target scope. Single-root workspaces are unaffected.

### 🐛 Drag-drop & Config Reload Fixes

- **Hidden directory exclusion**: Directory drag-and-drop now skips hidden directories (`.git`, `.vscode`, etc.) while still including dotfiles like `.gitignore` and `.editorconfig`.
- **Relative path reload**: Removing selected files from a group now works correctly when the group stores workspace-relative paths after a config reload.

### 🧪 Test Coverage & CI

- **Unit coverage**: Added focused coverage for file-entry matching, group file removal, command target grouping, provider-level removal, bookmark cleanup, multi-root scope isolation, and legacy workspace-root fallback.
- **UI coverage**: Added VS Code UI tests for removing reloaded workspace-relative files from single and separate groups.
- **CI**: Added `npm run test:coverage` and updated PR validation to run Jest coverage before packaging.

## [0.5.5] - Publishing & CI Improvements - 2026-05-13

### 🚀 Publishing & CI Workflows

- **Automated publishing**: Improved VS Code Marketplace and Open VSX release flow.
- **Validation workflows**: Added CI workflows for test validation and UI testing to keep multi-root workspace support safer to maintain.

## [0.5.0] - Multi-root Workspace Scope Support - 2026-05-10

### 🌍 Multi-root Workspace Scope Support

- **Per-folder scopes**: VirtualTabs now detects workspace folders and shows one scope section per project, so groups stay attached to the correct repo in a multi-root workspace.
- **Scope-level actions**: Added inline buttons for adding groups, moving scopes, opening scope config, revealing scope storage, and clearing a scope.
- **Scoped persistence**: Group creation and save now route through the selected/discovered scope instead of a single workspace-level config.
- **Automated scope tests**: Added coverage for config scope discovery, path routing, tree aggregation, source scope IDs, and multi-root UI behavior.

### 🔧 Release Packaging

- **VSIX cleanup**: Release packaging now excludes UI test output and the local test runner cache from the VSIX.

## [0.4.10] - Config Scope Groundwork - 2026-04-17

### 🏗 Config Scope & Test Infrastructure Prep

- **Internal groundwork**: Prepared config-scope architecture for multi-root workspace support.
- **Test infrastructure**: Expanded unit, property, and VS Code UI test infrastructure.

## [0.4.9] - File Reordering in Custom Groups - 2026-04-04

> **Special Thanks**: [@onelaview](https://github.com/onelaview) for the original idea! 🎉

### ↕️ File Reordering in Custom Groups

- **File reordering**: Files within a custom group can now be reordered via drag & drop, `Alt+↑` / `Alt+↓` keyboard shortcuts, or the right-click context menu (**Move File Up** / **Move File Down**).
- **Native Open Editors → VT sync**: Reordering tabs in the native Open Editors panel now automatically updates the order in the VirtualTabs built-in group.

### 🐛 Windows URI Encoding Fix

- **Duplicate file detection**: Fixed a bug where URI encoding differences on Windows (`d%3A` vs `d:`) caused the same file to be added twice to a group.
- **Reordering on Windows**: Fixed drag & drop and keyboard reordering silently failing on Windows due to the same URI encoding mismatch.

## [0.4.8] - Send To — File & Group Transfer - 2026-04-03

> **Special Thanks**: [@jianfulin](https://github.com/jianfulin) for the original idea and contribution! 🎉

### 📤 Send To — File & Group Transfer

- **Send to...**: Send selected files or an entire group to a destination folder via a Quick Pick UI.
- **Configured Targets**: Load targets from `.vscode/sendTargets.json` and show them as `$(rocket)` entries.
- **Multi-Path Targets**: A single target can define multiple destination paths and sends to all of them.
- **Recent Destinations**: "Browse" destinations are remembered and shown under **Recent**.
- **Group Structure Preserved**: Sending a group preserves its nested sub-group structure in the destination.
- **Include/Exclude Group Folder**: Two explicit commands to include or exclude the outer group folder when sending.
- **On-demand Template**: When no configured targets exist, the Quick Pick offers to create a `.vscode/sendTargets.json` template.

### 🐛 Optimistic Lock Fix on Empty Config

- **Config reload edge case**: Fixed a bug where clearing `virtualTab.json` to an empty array prevented future saves due to an optimistic lock version mismatch.

## [0.4.6] - Inline Close File & Editor Group IDs - 2026-03-26

### ✕ Inline Close File Button & Editor Group Stability

- **Inline "Close File" button**: Added a standard `$(close)` (×) button to all file items in the tree view — close editor tabs directly from the sidebar, matching native VS Code "Open Editors" UX.
- **Enhanced Duplicate ID Handling**: `TempFileItem` IDs now incorporate the `viewColumn` (editor group index), ensuring every item in "Currently Open Files" is unique even when the same file is open in multiple split editors.
- **TreeView error fix**: Resolved the "Element with id … is already registered" error when working with multiple editor groups.

## [0.4.5] - Auto Reveal & Editor Group Clustering - 2026-03-22

### 🎯 Auto Reveal Active File & Editor Group Clustering

- **Auto Reveal Active File**: The tree view now automatically scrolls to and highlights the active file in "Currently Open Files". Toggle via `virtualTabs.autoRevealActiveFile`.
- **Editor Group Clustering**: When multiple editor groups are open, "Currently Open Files" hierarchically organizes tabs by editor group (Group 1, Group 2, …) for a clearer workspace overview.

## [0.4.0] - MCP Server & AI Agent Integration - 2026-03-01

### 🤖 MCP Server & AI Agent Integration

- **MCP Server**: A bundled MCP server (`dist/mcp/index.js`) enables AI agents (Cursor, GitHub Copilot, Claude Code, Kiro IDE, Antigravity) to manage file groups via the Model Context Protocol.
- **Agent Skill Generation** (`VirtualTabs: Generate Agent Skill`): Generates a target-specific skill file (`.mdc` for Cursor, `SKILL.md` for others) with tool documentation and a four-layer safety decision tree.
- **MCP Config Panel** (`VirtualTabs: Show MCP Config`): A webview with ready-to-copy MCP server configuration JSON for each supported AI client.
- **MCP Tools**: `list_groups`, `create_group`, `rename_group`, `move_group`, `delete_group`, `add_files_to_group`, `remove_files_from_group`, `explore_project`, `read_file`, `create_bookmark`, `delete_bookmark`, `list_bookmarks`, `set_group_sorting`, `auto_group_by_extension`, `auto_group_by_date`.
- **Safety Fallback Tools**: `validate_json_structure` and `append_group_to_json` enforce workspace-relative paths, detect duplicate group names, and auto-create backups before any write.
- **Bundled CLI** (`vt.bundle.js`): A self-contained Node.js CLI for `list-groups`, `add-group`, `add-files`, and `remove-group` as a last-resort fallback.

### 🏗 Shared Core Library & Refactoring

- **Shared Core** (`src/core/`): Business logic for group management, file operations, bookmarks, path utilities, and project exploration is now a single shared library consumed by both the VS Code extension and the MCP server.
- **MCP server refactored**: MCP server managers are now thin wrappers over `src/core/`, eliminating duplicate logic.
- **Toolbar**: Added **MCP Config**, **Generate Skill**, and **Add Group** buttons to the tree view header.

### 🐛 Config Filename Fix

- **Correct config filename**: Fixed references from the wrong `virtualTabs.json` to the correct `virtualTab.json` throughout the codebase and documentation.

## [0.3.13] - Recursive Group Operations - 2026-02-23

### 🔁 Recursive Group Operations & Enhanced Drag & Drop

- **Recursive "Open/Close All"**: "Open All" and "Close All" on a parent group now recursively include all files in nested sub-groups.
- **Recursive drag resolution**: Dragging a group now properly resolves all nested files for external drops (e.g. into the editor or other extensions).

### 🐛 F2 Rename Shortcut Fix

- **F2 rename target**: Fixed a bug where the `F2` shortcut for "Rename Group" would target the wrong group.

## [0.3.12] - Live "Currently Open Files" & Sponsor Button - 2026-02-21

### 📂 Live "Currently Open Files" Tracking

- **Live editor tab sync**: The built-in "Currently Open Files" group now dynamically mirrors actual VS Code editor tabs in real time.

### 💝 Sponsor Button

- **Ko-fi button**: Replaced the generic sponsor text with a Ko-fi button in the tree view.

## [0.3.7 ~ 0.3.11] - Input Box UX & TreeView Stability - 2026-01 to 2026-02

### 🗂 Input Box UX & TreeView Stability

- **Input Box UX**: Added Cancel buttons and improved validation messages for group creation and renaming input boxes.
- **TreeView stabilization**: Rapid group creation/deletion now correctly reflects the underlying `virtualTab.json` state without ghost items.

## [0.3.6] - Multi-select Copy & Unified Copy Menu - 2026-01-14

### 📋 Multi-select Copy & Unified Copy Menu

- **Multi-select Copy**: All copy commands now support multi-selection — Copy File Name, Copy Relative Path (with deduplication), Copy Absolute Path (with deduplication), and Copy Group Context (handles mixed files + groups + bookmarks for AI prompt preparation).
- **Unified Copy Menu**: Consolidated 4 duplicate copy submenus into a single adaptive menu, drastically reducing UI clutter.

### 🔧 Selection Logic & Command Fixes

- **Robust selection**: Refactored core commands to consistently prioritize multi-selection over right-clicked items via a unified `resolveTargetItems` helper.
- **Context menu precision**: Strict `viewItem` regex checks prevent command "ghosting" on unrelated items.
- **Type safety**: Replaced legacy duck typing with `instanceof` checks and Set-based cycle detection for circular references.
- **Command namespace**: Renamed `deleteFile` to `virtualTabs.deleteFile` for system compatibility.
- **Bookmark context**: `Copy Group Context` now correctly handles bookmark items with hierarchical group paths.

## [0.3.3] - Configurable Delete Confirmation - 2025-12-31

> **Special Thanks**: [@jianfulin](https://github.com/jianfulin) for the major contribution! 🎉

### ✅ Configurable Delete Confirmation Dialogs

- **`virtualTabs.confirmBeforeDelete` setting**: Controls whether a confirmation dialog appears before deleting groups or files (default: enabled).
- **i18n support**: Confirmation messages support English, Traditional Chinese, and Simplified Chinese.
- **`executeWithConfirmation` utility**: Refactored confirmation logic into a reusable helper in `util.ts`.

## [0.3.2] - Group Reordering & Executable Files - 2025-12-21

> **Special Thanks**: [@jianfulin](https://github.com/jianfulin) for the major contribution! 🎉

### ↕️ Group Reordering & Executable File Support

- **Group Reordering**: Move groups up or down via context menu commands.
- **Executable File Support**: `.bat` and `.exe` files now have an inline "Run" button. Clicking the file still opens it in the editor.
- **Expanded State Persistence**: Group expanded/collapsed state is remembered across VS Code restarts.

### 🗃 Storage & Persistence Improvements

- **New storage location**: Moved `virtualTab.json` from the workspace root to `.vscode/virtualTab.json`.
- **Workspace-relative paths**: File references in `virtualTab.json` are now stored as paths relative to the workspace root.
- **Cross-platform terminal**: Improved shell command quoting for cross-platform terminal execution.

## [0.3.0] - Sub-Groups, AI Context & Drag & Drop - 2025-12-13

### 🗂 Sub-Groups & Hierarchical Structure

- **Sub-Groups**: Create hierarchical group organization by adding sub-groups or dragging groups onto each other.
- **Unique group IDs**: Groups now require unique IDs for stable references (auto-migrated from older versions).
- **Context menus**: Reorganized with separate submenus for different item types.

### 🤖 AI Context Export

- **Copy Context for AI**: Copy all files in a group as LLM-ready markdown with the "Copy Context for AI" command.

### 📁 Directory Drag & Drop & Copy Operations

- **Directory Drag & Drop**: Drag folders from Explorer to recursively add all files within.
- **Copy/Paste/Delete**: Full clipboard operations for files and groups.
- **Multi-select Delete**: Delete multiple groups or files at once.
- **File Move with Bookmarks**: Dragging files between groups preserves their bookmarks.

### 🐛 Circular Nesting & Bookmark Fixes

- **Circular nesting**: Fixed detection when dragging groups to prevent circular parent-child references.
- **Bookmark preservation**: Fixed bookmarks being lost when moving files between groups.
- **Large file context**: Improved error handling when copying large file contexts.

## [0.2.0] - Task-Oriented Bookmarks - 2025-12-01

### 🔖 Task-Oriented Bookmarks

- **Line Bookmarks**: Add bookmarks to specific lines of code within VirtualTabs groups.
- **Smart Flow**: Right-click to add bookmarks instantly — auto-labelled from line content, no input box required.
- **Bookmark Navigation**: Click a bookmark in the sidebar to jump directly to that code location.
- **Bookmark Management**: Edit bookmark labels and descriptions, or remove them via the context menu.

### 🐛 TreeView & Icon Fixes

- **TreeView performance**: Improved performance when handling groups with many files.
- **File icon fix**: Fixed file icons not displaying correctly in some themes.

## [0.1.0] - Initial Release - 2025-11-20

### 🎉 Initial Release

- **Custom file grouping**: Organize files into named virtual groups without moving them on disk.
- **Built-in "Open Editors" group**: Live-synced view of currently open editor tabs.
- **File sorting**: Sort by Name, Path, Extension, or Modified Time.
- **Auto-group by date**: Automatically group files by their modification date.
- **i18n**: English, Traditional Chinese, and Simplified Chinese support.

# Change Log

All notable changes to the "VirtualTabs" extension will be documented in this file.

## [0.4.0] - 2026-03-01

### Added

- **MCP Server Integration**: A fully bundled MCP server (`dist/mcp/index.js`) ships with the extension, enabling AI agents (Cursor, GitHub Copilot, Claude Code, Kiro IDE, Antigravity) to manage file groups programmatically via the Model Context Protocol.
- **Agent Skill Generation** (`VirtualTabs: Generate Agent Skill`): Generates a target-specific skill file (`.mdc` for Cursor, `SKILL.md` for others) containing tool documentation and a four-layer safety decision tree. The skill prominently clarifies that VirtualTabs groups are **purely virtual** — no files are moved on disk — preventing a common class of agent misunderstandings.
- **MCP Config Panel** (`VirtualTabs: Show MCP Config`): A webview panel displaying ready-to-copy MCP server configuration JSON for each supported AI client (Cursor, GitHub Copilot, Claude Code, Kiro IDE, Antigravity).
- **MCP Tools**: `list_groups`, `create_group`, `rename_group`, `move_group`, `delete_group`, `add_files_to_group`, `remove_files_from_group`, `explore_project`, `read_file`, `create_bookmark`, `delete_bookmark`, `list_bookmarks`, `set_group_sorting`, `auto_group_by_extension`, `auto_group_by_date`.
- **Safety Fallback MCP Tools**: `validate_json_structure` and `append_group_to_json` for use when primary tools fail; both enforce workspace-relative paths, detect duplicate group names, and auto-create backups before any write.
- **Bundled CLI Script** (`vt.bundle.js`): A self-contained Node.js CLI bundled alongside each generated skill file as a Layer 3 last-resort fallback. Supports `list-groups`, `add-group`, `add-files`, and `remove-group` commands with automatic workspace-root detection.
- **Shared Core Library** (`src/core/`): Core business logic for group management, file operations, bookmarks, path utilities, and project exploration is now maintained in a single shared library consumed by both the VS Code extension and the MCP server, ensuring consistent behaviour across all surfaces.

### Changed

- Toolbar now shows **MCP Config**, **Generate Skill**, and **Add Group** buttons in the VirtualTabs tree view header.
- MCP server managers refactored as thin wrappers over the new `src/core/` shared library, eliminating duplicate logic.

### Fixed

- Corrected config filename reference from `virtualTabs.json` (wrong) to `virtualTab.json` (correct) throughout the codebase and documentation.

## [0.3.13] - 2026-02-23

### Added

- **Recursive Group Operations**: "Open All" and "Close All" commands on a parent group now recursively include all files within its nested sub-groups.
- **Enhanced Drag & Drop**: Dragging a group now properly recursively resolves all its nested files for external drops (e.g. dragging into editor or other extensions).

### Fixed

- Fixed a bug where assigning the `F2` shortcut to "Rename Group" would fail to target the correctly focused group.

## [0.3.12] - 2026-02-21

### Added

- **"Currently Open Files" Live Tracking**: The built-in group "Currently Open Files" now dynamically updates and perfectly mirrors your actual VS Code editor tabs, serving as a live workspace overview.

### Changed

- Improved UI/UX for the Sponsor button, replacing the generic text with a recognizable Ko-fi button in the VirtualTabs tree view to support the project.

## [0.3.7 ~ 0.3.11] - 2026-01 to 2026-02

### Added

- **Input Box UX**: Added Cancel buttons and improved validation messages for group creation and renaming input boxes.

### Fixed

- Stabilized the custom TreeView rendering, ensuring that rapid group creation/deletion accurately reflects the underlying `.vscode/virtualTab.json` state without ghost items.

## [0.3.6] - 2026-01-14

### Added

- **🎯 Multi-select Copy (Core Productivity Feature)**: All copy commands now support multi-selection:
  - `Copy File Name` - Select multiple files/groups and copy all names at once.
  - `Copy Relative Path` - Multi-select support with automatic deduplication.
  - `Copy Absolute Path` - Multi-select support with automatic deduplication.
  - `Copy Group Context` - Enhanced to handle mixed selections (files + groups + bookmarks) for better AI prompt preparation.

### Changed

- **Unified Copy Menu**: Consolidated 4 duplicate copy submenus into a single smart menu that adapts to selection type, drastically reducing UI clutter.
- **Robust Selection Logic**: Refactored core commands to consistently prioritize multi-selection over right-clicked items using a unified `resolveTargetItems` helper.
- **Improved Context Menu Precision**: Strict `viewItem` regex checks prevent command "ghosting" on unrelated items.
- **Type Safety & Reliability**: Replaced legacy Duck Typing with `instanceof` checks and implemented Set-based cycle detection for circular references.

### Fixed

- **Command Namespace Conflict**: Renamed `deleteFile` to `virtualTabs.deleteFile` for better system compatibility.
- **Bookmark Context Handling**: `Copy Group Context` now correctly handles bookmark items and displays hierarchical group paths.

## [0.3.3] - 2025-12-31

> **Special Thanks**: [@jianfulin](https://github.com/jianfulin) for the major contribution! 🎉

### Added

- **Configurable Confirmation Dialogs**: New setting `virtualTabs.confirmBeforeDelete` to control whether confirmation dialogs appear before deleting groups or files (default: enabled).
- Confirmation messages now support internationalization (i18n) for English, Traditional Chinese, and Simplified Chinese.

### Changed

- Refactored confirmation logic into reusable `executeWithConfirmation` utility function in `util.ts`.
- Improved user experience with modal confirmation dialogs for delete operations.

## [0.3.2] - 2025-12-21

> **Special Thanks**: [@jianfulin](https://github.com/jianfulin) for the major contribution! 🎉

### Added

- **Group Reordering**: Move groups up or down via context menu commands.
- **Executable File Support**: `.bat` and `.exe` files now have an inline "Run" button. Clicking the file itself still opens it in editor for consistency.
- **Expanded State Persistence**: Remember which groups are expanded/collapsed across VS Code restarts.
- Persist group/bookmark data to `.vscode/virtualTab.json`.
- Store file references in `virtualTab.json` as paths relative to the workspace root.

### Changed

- **Storage Location**: Moved `virtualTab.json` from workspace root to `.vscode/virtualTab.json` for cleaner project structure.
- Allow duplicate group names when IDs differ.

### Fixed

- Improved shell command quoting for cross-platform terminal execution.

## [0.3.0] - 2025-12-13

### Added

- **Sub-Groups & Nested Structure**: Create hierarchical group organization by adding sub-groups or dragging groups onto each other.
- **AI Context Export**: Copy all files in a group as LLM-ready markdown with "Copy Context for AI" command.
- **Unified Copy Menu**: New submenu with smart behavior - copies work differently on groups vs files.
- **Directory Drag & Drop**: Drag folders from Explorer to recursively add all files within.
- **Copy/Paste/Delete Commands**: Full clipboard operations for files and groups within VirtualTabs.
- **Multi-select Delete**: Delete multiple groups or files at once.
- **File Move with Bookmarks**: Dragging files between groups preserves their bookmarks.

### Changed

- Groups now require unique IDs for stable references (auto-migrated from older versions).
- Improved drag-and-drop controller with better file/group/directory detection.
- Context menus reorganized with separate submenus for different item types.
- Copy File Name/Path commands now work on groups (copies all files recursively).

### Fixed

- Fixed circular nesting detection when dragging groups.
- Fixed bookmark preservation when moving files between groups.
- Improved error handling for large file context copying.

## [0.2.0] - 2025-12-01

### Added

- **Task-Oriented Bookmarks**: You can now add bookmarks to specific lines of code within your VirtualTabs groups.
- **Smart Flow**: Right-click to add bookmarks instantly without annoying input boxes. The system automatically labels them based on line content.
- **Bookmark Navigation**: Click on a bookmark in the sidebar to jump directly to the code location.
- **Bookmark Management**: Edit bookmark labels and descriptions, or remove them via the context menu.

### Changed

- Improved TreeView performance when handling groups with many files.
- Updated `package.json` to include new bookmark commands and menus.
- Refined UI for file items in the sidebar (click to open).

### Fixed

- Fixed an issue where file icons might not display correctly in some themes.

## [0.1.0] - 2025-11-20

### Added

- Initial release of VirtualTabs.
- Custom file grouping.
- Built-in "Open Editors" group.
- File sorting (Name, Path, Extension, Modified Time).
- Auto-group by modification date.
- Internationalization (i18n) support for English, Traditional Chinese, and Simplified Chinese.

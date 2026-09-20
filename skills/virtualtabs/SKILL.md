---
name: virtualtabs
description: Manages VS Code editor file groups using VirtualTabs MCP tools. Use this skill when the user wants to organize files into groups, create, rename, or delete groups, add or remove files from groups, manage bookmarks, set sorting rules, auto-group files by extension or date, or explore project structure.
---

# VirtualTabs MCP Integration

This project uses VirtualTabs to organize files into **virtual groups** across directories.

> ⚠️ **CRITICAL CONCEPT**: VirtualTabs groups are **purely virtual**.
> - No files are moved, copied, or modified on disk.
> - A "group" is just a named list of file references stored in `.vscode/virtualTab.json`.
> - When a user says "建立一個 md 資料夾" or "create an md folder", they mean a **VirtualTabs group**, NOT a real filesystem directory.
> - Never suggest creating a real folder or moving files as an alternative to VirtualTabs grouping.

## MCP Server Setup

The canonical human-facing setup reference is the
[MCP Setup Guide](https://github.com/winterdrive/vscode-virtual-tabs/blob/main/docs/mcp-setup.md).
The minimum connection steps quoted here are intentionally embedded so an
installed skill can recover when the MCP server is unavailable:
1. Open VS Code Command Palette (Ctrl+Shift+P)
2. Run: **VirtualTabs: Show MCP Config**
3. Follow the instructions for your specific AI tool

## Available Tools

The [MCP server reference](https://github.com/winterdrive/vscode-virtual-tabs/blob/main/mcp-server/README.md#registered-primitives)
is the canonical capability catalog. The list below is an embedded operational
excerpt for installed skills and must remain synchronized with that source.

### Core Operations

- `list_groups`: List all groups with their files and metadata
- `create_group`: Create a new group (optionally nested under a parent)
- `rename_group`: Rename an existing group
- `move_group`: Reorder group within its current tree level
- `delete_group`: Delete a group (optionally with all subgroups)
- `add_files_to_group`: Add files to a group (creates group if missing when using groupName)
- `remove_files_from_group`: Remove files from a group

### Project Exploration (Read-Only)

- `explore_project`: Explore the project structure using glob patterns, directory filters, and extension filters
- `read_file`: Read the content of a file (up to 100KB)

### Bookmarks (Read/Write)

- `create_bookmark`: Create a bookmark at a specific line in a file within a group
- `delete_bookmark`: Delete an existing bookmark
- `list_bookmarks`: List bookmarks, optionally filtered by group

### Smart Organization

- `set_group_sorting`: Set the sorting criteria and order for files within a group
- `auto_group_by_extension`: Automatically group files by their file extensions
- `auto_group_by_date`: Automatically group files by their modification date
- `create_group_by_pattern`: **⭐ PREFERRED** — Create a group and auto-populate it with files matching a glob pattern. No file paths needed. Use this instead of `explore_project` + `create_group` + `add_files_to_group` when grouping by type.
- `remove_files_by_pattern`: **⭐ PREFERRED** — Remove all files from a group that match a glob pattern. No file listing needed.

## Usage Guidelines

Use these tools to help users organize their workspace files into logical groups. The agent should:

1. **Understand user intent** through conversation before creating groups
2. **Prefer pattern-based tools** — use `create_group_by_pattern` / `remove_files_by_pattern` whenever the user's intent can be expressed as a glob pattern
3. **Batch array arguments** — when using `add_files_to_group` or `remove_files_from_group`, NEVER pass more than **15 file paths per call**. If you have more files, either use the `*_by_pattern` tools or split across multiple calls.
4. **Create groups** that reflect the user's mental model of their project

## ⚡ Action Decision Tree

> ❗ **MANDATORY**: Before performing ANY VirtualTabs operation, you MUST complete Layer 0 first.

### Layer 0: MCP Connection Gate — MUST PASS BEFORE ANY OTHER ACTION

Attempt to call `list_groups` now.

**If `list_groups` succeeds** → MCP is working. Proceed to Layer 1 immediately.

**If `list_groups` fails ("Tool not found" / no response / timeout)**:

> 🛑 **STOP. DO NOT PROCEED. DO NOT edit any files. DO NOT read virtualTab.json.**
>
> You MUST output the following message to the user and then WAIT for their response before taking any further action:
>
> ---
> **VirtualTabs MCP server is not connected.**
> To enable full functionality, please:
> 1. Open VS Code Command Palette (Ctrl+Shift+P)
> 2. Run: **VirtualTabs: Show MCP Config**
> 3. Follow the setup instructions for your AI client
> 4. Restart your AI client after configuring
>
> Would you like me to proceed with a limited fallback instead, or wait until MCP is configured?
> ---
>
> Only continue to Layer 2 or Layer 3 **if the user explicitly confirms they want the fallback**.

---

### Layer 1: Standard MCP Tools ✅ (Use whenever available)

Already listed above under "Available Tools". Always prefer these.

---

### Layer 2: Server-Side Safety Tools ⚠️ (Fallback — only with user confirmation)

- `validate_json_structure`: Validate a JSON string against the virtualTab.json schema.
- `append_group_to_json`: Safely append a new group. Handles backup, duplicate-name detection, and relative path enforcement automatically.

---

### Layer 3: Hard Fallback 🚨 (Last resort — only with explicit user confirmation)

**Option A – Use the bundled CLI script (recommended)**:
```bash
node skills/virtualtabs/scripts/vt.bundle.js add-group --name "GroupName"
node skills/virtualtabs/scripts/vt.bundle.js add-files --group "GroupName" src/a.ts src/b.ts
node skills/virtualtabs/scripts/vt.bundle.js list-groups
```

> If installed via the **VirtualTabs: Generate Skill File** button, use the agent-specific path instead (e.g. `.claude/skills/virtualtabs/scripts/vt.bundle.js`).

**Option B – Direct JSON edit** (only if Node.js is unavailable):
1. **Mandatory backup first**: Copy `.vscode/virtualTab.json` → `.vscode/virtualTab.json.backup`.
2. Use workspace-relative paths only (no absolute paths).
3. **Never modify groups with `"isBuiltIn": true`**.

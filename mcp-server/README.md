# VirtualTabs MCP Server

The Model Context Protocol (MCP) server for VirtualTabs, enabling AI agents (Cursor, GitHub Copilot, Kiro, Claude Code, Antigravity) to manage file groups programmatically through natural language.

## Architecture: Tool / Resource / Prompt

The MCP specification defines three interface primitives, each serving a distinct purpose:

| Primitive | Analogy | Triggered by | Nature | VirtualTabs Example |
|:---|:---|:---|:---|:---|
| **Tool** | 🦴 Hand — performs actions | AI decides when to call | Stateful, side-effectful | `create_group`, `add_files_to_group` |
| **Resource** | 📖 Reference book — supplies context | AI reads on demand | Read-only, static snapshot | `virtualtabs://docs/complete` |
| **Prompt** | 🧠 SOP template — encodes a workflow | User explicitly invokes | Parameterized workflow chain | `virtualtabs:organize`, `virtualtabs:cleanup` |

**One-line rule:**

> Want the AI to **do** something → **Tool** · Want the AI to **know** something → **Resource** · Want the AI to **follow a workflow** → **Prompt**

```mermaid
graph LR
    subgraph "IDE Layer (VS Code)"
        VS[VS Code Editor]
        EX[VirtualTabs Extension]
        VS -. reads .-> VT_JSON[".vscode/virtualTab.json"]
    end

    subgraph "Agent / Skill Layer"
        Agent[AI Agent]
        Skill[Skill / Workflow file]
        Agent -- invokes --> Skill
        Skill -- guides reasoning --> Agent
        Agent -- reads --> Resource
        Agent -- triggers --> Prompt
    end

    subgraph "MCP Capability Layer (server.ts)"
        direction TB
        subgraph "📖 Eyes  —  Resource"
            Resource["virtualtabs://docs/complete\n(Schema + Safety Rules + Workflows)"]
        end
        subgraph "🧠 Brain  —  Prompt"
            Prompt["virtualtabs:organize\nvirtualtabs:cleanup"]
        end
        subgraph "🦴 Hands  —  Tools"
            Tool1["create_group"]
            Tool2["add_files_to_group"]
            Tool3["...15 more tools"]
        end
        Tool1 -- writes --> VT_JSON
        Tool2 -- writes --> VT_JSON
    end

    VS -- renders groups --> EX
    Agent -- executes --> Tool1
    Agent -- executes --> Tool2
    Prompt -- defines steps --> Agent
```

### Registered Primitives

**Tools (19)**

| Category | Tool Names |
|:---|:---|
| Group Management | `list_groups` `create_group` `rename_group` `move_group` `delete_group` |
| File Management | `add_files_to_group` `remove_files_from_group` |
| Project Exploration | `explore_project` `read_file` |
| Bookmark Management | `create_bookmark` `delete_bookmark` `list_bookmarks` |
| Auto Grouping | `set_group_sorting` `auto_group_by_extension` `auto_group_by_date` |
| Pattern Operations | `create_group_by_pattern` `remove_files_by_pattern` |
| Safety Fallback | `validate_json_structure` `append_group_to_json` |

**Resources (1)**

- `virtualtabs://docs/complete` — Consolidated reference containing JSON schema, safety rules, and common workflow recipes

**Prompts (2)**

- `virtualtabs:organize` — Guides the AI to reorganize groups using a specified strategy (by-feature / by-type / by-layer)
- `virtualtabs:cleanup` — Guides the AI to identify and remove invalid file references from all groups

## Features

The MCP Server exposes the tools listed in [Registered Primitives](#registered-primitives), covering:

- **Group Management**: Create, rename, move, and delete groups
- **File Management**: Add/remove files to/from groups
- **Project Exploration**: Search project files, read file contents
- **Bookmark Management**: Create, delete, and list bookmarks
- **Auto Grouping**: Automatically create sub-groups by extension or modification date
- **Pattern Operations**: Create groups or remove grouped files with server-side glob matching
- **Safety Fallback Tools**: `validate_json_structure` (JSON schema validation), `append_group_to_json` (safe group append with auto-backup)

## Concurrency Safety 🔒

VirtualTabs MCP Server uses **Optimistic Locking** to protect concurrent writes to `virtualTab.json`, preventing data overwrites when multiple AI agents operate simultaneously.

**Technical details:**

- **Version checking**: Records the file's mtime (last modification time) on read; verifies the version before writing
- **Automatic conflict retry**: On conflict (`OptimisticLockError`), automatically reloads and retries up to 3 times
- **Zero external dependencies**: Uses only the Node.js standard `fs` module — no lock libraries required

This means you can:

- ✅ Use VirtualTabs simultaneously in Cursor and GitHub Copilot
- ✅ Connect multiple projects to separate MCP Server instances
- ✅ Never worry about concurrent operations corrupting your configuration

## Installation

```bash
cd editorGrouper/mcp-server
npm install
```

## Build

```bash
npm run build
```

## Start

```bash
npm start -- --workspace-root /path/to/your/workspace
```

## Development

```bash
# Watch mode (auto-recompile)
npm run watch
```

## Client and Agent Setup

Use the [MCP Setup Guide](../docs/mcp-setup.md) for current client
configuration and installation commands. Agent operating rules and fallback
behavior are maintained only in the canonical
[VirtualTabs Agent Skill](../skills/virtualtabs/SKILL.md).

---

## Real-world Examples

Below are excerpts from actual AI agent sessions demonstrating how different tools interact with VirtualTabs via MCP.

### Example 1: Cursor — Creating a Source Code Group

Cursor reads the generated `.mdc` skill file, then uses MCP tools to organize a project:

```text
Agent → list_groups()
  ← { groups: [] }   // workspace has no groups yet

Agent → create_group({ name: "Source Code" })
  ← { success: true, groupId: "abc123" }

Agent → explore_project({ pattern: "src/**/*.ts" })
  ← { files: ["src/extension.ts", "src/provider.ts", "src/commands.ts", ...] }

Agent → add_files_to_group({ groupId: "abc123", files: ["src/extension.ts", "src/provider.ts", "src/commands.ts"] })
  ← { success: true, addedCount: 3 }
```

### Example 2: Antigravity — Reading the Resource, Then Acting

Antigravity (Google's AI IDE) reads the `virtualtabs://docs/complete` resource for context, then follows the safety decision tree:

```text
Agent → read_resource("virtualtabs://docs/complete")
  ← (JSON schema, safety rules, workflow recipes)

Agent → list_groups()
  ← { groups: [{ name: "Config", files: [...] }] }

Agent → create_group({ name: "Source Code", color: "blue" })
  ← { success: true, groupId: "def456" }

Agent → explore_project({ pattern: "src/**/*.ts" })
  ← { files: ["src/index.ts", "src/server.ts", ...] }

Agent → add_files_to_group({ groupId: "def456", files: ["src/index.ts", "src/server.ts"] })
  ← { success: true, addedCount: 2 }
```

### Example 3: Cursor — Cleanup Workflow

An agent uses the `virtualtabs:cleanup` prompt to validate and clean up existing groups:

```text
Agent → list_groups()
  ← { groups: [{ name: "Legacy", files: ["old/removed.ts", "src/main.ts"] }] }

Agent → read_file({ path: "old/removed.ts" })
  ← Error: file not found

Agent → remove_files_from_group({ groupId: "legacy-id", files: ["old/removed.ts"] })
  ← { success: true, removedCount: 1 }

Agent → list_bookmarks()
  ← { bookmarks: [{ file: "src/main.ts", line: 42, label: "entry point" }] }
  // Valid bookmark retained — cleanup complete.
```

> **More examples:** See the `use_case/` directory in the repository for full interaction logs from Cursor, Antigravity, and Kiro.

---

## Project Structure

```
mcp-server/
├── src/
│   ├── index.ts           # Server entry point
│   ├── server.ts          # Core: registers Tools, Prompts, Resources, Logging, Roots
│   ├── managers/          # Thin wrappers over src/core/ (shared library)
│   ├── tools/             # MCP tool handler classes
│   └── utils/             # Utility functions (zodToJsonSchema, PathUtils)
├── dist/                  # Compiled output (bundled into dist/mcp/index.js via esbuild)
├── package.json
└── tsconfig.json
```

## License

MIT

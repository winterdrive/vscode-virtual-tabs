# MCP Configuration for AI Agents

This guide provides detailed instructions on how to configure the VirtualTabs MCP server in various AI-powered IDEs and agents.

## 🔌 Core Concepts

VirtualTabs ships with a fully bundled MCP server (`dist/mcp/index.js`) that lets AI agents (Cursor, Copilot, Claude, Kiro, Antigravity) manage your workspace groups programmatically. The current primitive and tool catalog is maintained in the [MCP server reference](../mcp-server/README.md#registered-primitives).

> [!IMPORTANT]
> **VirtualTabs groups are purely virtual.** AI tools will *never* move or modify your actual files on disk through these tools. They only manage the logical organization within the VirtualTabs UI.

---

## ⚙️ IDE Configuration Setup

Select your AI tool below to see the configuration steps:

| Cursor | Antigravity (Google) | Kiro |
|:---:|:---:|:---:|
| ![Cursor MCP Setup](./assets/mcp_cursor_demo.png) | ![Antigravity MCP Setup](./assets/mcp_antigravity_demo.png) | ![Kiro MCP Setup](./assets/mcp_kiro_demo.png) |
| Configure MCP in Cursor settings | Configure MCP in Antigravity environment | Configure MCP in Kiro IDE |

### 1. Cursor Setup

1. Open **Cursor Settings** -> **Models** -> **MCP**.
2. Add a new MCP server.
3. Type: `stdio`.
4. Command: `node <absolute-path-to-extension>/dist/mcp/index.js`.
   * *Tip: Use the command `VirtualTabs: Show MCP Config` in VS Code to get the exact path ready to paste.*

### 2. Antigravity Setup

1. Open your Antigravity environment configuration.
2. Add the MCP server entry using the bundled path.

### 3. Kiro Setup

1. Navigate to Kiro's MCP integration panel.
2. Link the VirtualTabs MCP server.

---

## 🛡️ Safety & Agent Skills

VirtualTabs can install the canonical agent skill, and can write custom skill/rule files when you need agent-specific output:

* **Cursor**: Generates `.mdc` rules.
* **Other Agents**: Generates `SKILL.md`.

Command: `VirtualTabs: Install Agent Skill`. Choose **Auto Install (Recommended)** for the standard install path, or **Generate Skill Files Manually** for agent-specific files.

The installed or generated skill follows the canonical behavior and safety workflow in [`skills/virtualtabs/SKILL.md`](../skills/virtualtabs/SKILL.md).

![Safety Decision Tree](./assets/safety_decision_tree_en.png)

---

## 📦 CLI Fallback (`vt.bundle.js`)

If the MCP protocol is unavailable in your environment, VirtualTabs provides a self-contained CLI (`dist/mcp/vt.bundle.js`) as a last-resort editing path for your AI scripts.

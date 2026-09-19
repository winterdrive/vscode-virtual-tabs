# VirtualTabs – VS Code Extension for Virtual Tabs & Custom File Grouping

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version-short/winterdrive.virtual-tabs.svg)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs)
[![Open VSX Version](https://img.shields.io/open-vsx/v/winterdrive/virtual-tabs)](https://open-vsx.org/extension/winterdrive/virtual-tabs)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/winterdrive/virtual-tabs)](https://open-vsx.org/extension/winterdrive/virtual-tabs)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://winterdrive.github.io/vscode-virtual-tabs/llms.txt)
[![Presented at COSCUP 2026](https://img.shields.io/badge/Presented%20at-COSCUP%202026-orange?style=flat-square)](https://coscup.org/2026/session/9CYHJT/)
<!-- [![VS Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/winterdrive.virtual-tabs.svg)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs) -->
<!-- [![VS Marketplace Downloads](https://vsmarketplacebadges.dev/downloads-short/winterdrive.virtual-tabs.svg)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs) -->

[繁體中文](./docs/zh-TW/README.md) | [日本語](./docs/ja/README.md) | [한국어](./docs/ko/README.md) | [简体中文](./docs/zh-CN/README.md) | English

![VirtualTabs - VS Code File Grouping and AI Context Extension](docs/assets/vscode-virtualtabs-grouping-banner.png)

---

## 🚀 What is VirtualTabs?

**VirtualTabs is a VS Code extension that provides custom "Virtual File Directories" outside of your native file system.** Unlike standard directories, VirtualTabs helps you create **independent logical file groups** based on your current development theme — keeping your spatial awareness intact even in complex workspaces. It also provides **AI-Ready Coding Context** for quick copying. Perfectly suited for Monorepo projects or large-scale applications using MVVM or MVC architectures.

---

### ⚡ VirtualTabs vs. Native VS Code Tabs

| Feature | Native VS Code Tabs | VirtualTabs Extension |
| :--- | :--- | :--- |
| **Persistence** | Cleared on session close | **Saved permanently** per workspace |
| **Grouping** | Folder-based only | **Logic-based** (Cross-directory support) |
| **Spatial Awareness** | Tabs pile up with no task context | **Task-oriented groups** with auto-reveal and sync |
| **AI Context** | Hard to gather manually | **One-click context generation** for LLMs |

![VirtualTabs vs Physical File System](docs/assets/virtual_vs_physical_concept.png)

### 🧩 Solving Modern Workflow Pain Points

In MVC/MVVM or large-scale projects, related files are often scattered across deep directory structures, making switching a repetitive chore:

```text
❌ Traditional File Structure:
├── config.json          (Root Config)
├── styles/theme.css     (Style Layer)
├── src/components/      (View Layer)
├── tests/__tests__/     (Testing Layer)

✅ Theme-Based Virtual Directory:
📁 Feature: Theme System
  ├── 📁📚 Configuration
  │   └── config.json
  ├── 📁📚 Style Definitions
  │   └── theme.css
  ├── 📁📚 Components (View Layer)
  │   └── ThemeProvider.tsx
  │     └── 🔖 Line 45: Context setup
  └── 📁📚 Unit Tests (Logic/Testing)
  │   └── theme.test.ts
```

*Why does VirtualTabs exist? [Read the philosophy](docs/PHILOSOPHY.md) → presented at [COSCUP 2026](https://coscup.org/2026/session/9CYHJT/)*

---

## 🚀 Quick Start

![VirtualTabs product demo](docs/assets/virtualtabs-product-demo.gif)

### Installation

1. Open VS Code.
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X`).
3. Search for **VirtualTabs** and click **Install**.

### First Time Setup

1. Click the **VirtualTabs icon** in the Activity Bar (left sidebar).
2. Right-click in the panel → **Create New Group**.
3. **Drag files** from Explorer into your group.

---

## ✨ Key Features

### 📁 Core Capabilities

- **Cross-Directory Grouping** — Organize files from anywhere, breaking free from folder constraints.
- **Task-Oriented Bookmarks** — Mark specific lines of code within your groups for quick navigation.
- **Sub-Groups & Nesting** — Create hierarchical structures for better organization.
- **AI Context Export** — One-click copy all files as LLM-ready context.
- **Portable Config** — Settings saved to `.vscode/virtualTab.json` for team sharing.
- **AI Agent Integration (MCP)** — Connect AI agents (Cursor, Claude, etc.) to manage groups programmatically.
- **Agent Skill Support** — Install the canonical `virtualtabs` skill using the current procedure in the [MCP Setup Guide](./docs/mcp-setup.md).
- **Multi-Root Workspace Scopes** — Keep groups separated per workspace folder in multi-root projects.
- **Auto Reveal & Sync** — Automatically focus active files and sync with native editor groups.
- **Send to...** — Quickly send selected files or groups to pre-configured destinations.
- **File Reordering** — Custom manual ordering via Drag & Drop or keyboard shortcuts.

### ⚡ Workflow Boosters

- **Smart Copy Menu** — Unified copy options for names, paths, and total file content.
- **Directory Drag & Drop** — Drag folders to add files recursively while skipping hidden directories.
- **Clipboard Operations** — Full Cut/Copy/Paste support for files and groups.
- **Smart Organization** — Auto-group by extension, date, or sort by various criteria.

---

## 📖 User Guide

### 📁 Group Management

- **Create/Rename**: Right-click panel or groups to manage.
- **Multi-root scopes**: In a multi-root workspace, each detected project appears as its own section. Use the inline **Add Group** button on the scope header to create groups; the panel title `+` button is intentionally hidden in multi-root mode to keep group creation scoped to the correct project. In single-root mode the panel title button is still present.
- **Sub-Groups**: Right-click a group → **Add Sub-Group** (or drag one group into another).
- **Auto-Sync**: The built-in "Open Editors" group automatically tracks your native tabs.
- **Drag & Drop**:
  - **Files**: Drag files from Explorer into groups.
  - **Folders**: Drag folders to recursively add files inside; directories whose names start with `.` are skipped, while dotfiles such as `.gitignore` are still included.
  - **Multi-select**: Hold `Ctrl/Cmd` to drag multiple files at once.

![Drag and Drop Demo](docs/assets/drag_drop_demo.png)

### 🔖 Task-Oriented Bookmarks

1. Right-click **any line of code** → **Add Bookmark to VirtualTabs**.
2. The bookmark appears nested under the file in your group.
3. Click to jump instantly to that exact line.
4. Edit label/description to document *why* this line is important.

![Bookmarks Feature](docs/assets/bookmarks_feature.png)

### 🤖 AI Context Export

**A power feature for LLM workflows.**

1. Setup a group with all relevant files for your current task.
2. Right-click the group → **Copy...** → **Copy Context for AI**.
3. Paste into ChatGPT/Claude.
    - **Smart**: Binary files are skipped; large files (>50KB) are flagged for review.
    - **Clean**: All code is formatted in markdown blocks with file paths.

![AI Context Demo](docs/assets/ai_context_demo.png)

---

## 🤖 Smart AI Agent Integration (MCP)

VirtualTabs provides full AI agent integration via the **Model Context Protocol (MCP)**. Let your AI assistant (Cursor, Antigravity, Kiro, etc.) manage your workspace groups programmatically.

- 🔌 **Standardized Tools**: Provides MCP tools for managing groups and exploring the project. See the [MCP server reference](./mcp-server/README.md) for the current capability catalog.
- 🛡️ **Safety Mode**: Uses the canonical [VirtualTabs Agent Skill](./skills/virtualtabs/SKILL.md) to guide safe tool use and fallbacks.
- ⚙️ **Setup**: Follow the [MCP Setup Guide](./docs/mcp-setup.md) for current client configuration and Agent Skill installation paths.

---

## 💡 Best Practices

1. **Group by Task, Not Folder**: Think about the feature you're working on.
2. **Use Bookmarks for Logic Flow**: Mark key decision points in your code.
3. **Curate AI Context**: Group only necessary files (5-10) to maximize LLM accuracy and reduce token noise.
4. **Share with Team**: Commit each project's `.vscode/virtualTab.json` to share curated project views.

---

## ❓ FAQ

**Q: I don't see the VirtualTabs panel?**  
Check if the extension is enabled and if you are using VS Code 1.75+. Look for the VirtualTabs icon in the Activity Bar.

**Q: How does "Copy Context for AI" work?**  
It reads all files in the group, formats them as markdown code blocks, and copies them to the clipboard.

**Q: Can I reorder groups manually?**  
Yes, right-click any group and use the **Move Up/Down** commands.

---

## 🤝 Contributing

We welcome community contributions! Start with **[CONTRIBUTING.md](./CONTRIBUTING.md)**, which links to the development and testing guides required for a pull request.

- 🐞 [Bug Reports/Feature Requests](https://github.com/winterdrive/vscode-virtual-tabs/issues)

---

## 🔥 Recommended Companions

### 🔥 Quick Prompt

**The perfect partner for VirtualTabs.**

**VirtualTabs** keeps your workspace organized. **Quick Prompt** keeps your thoughts organized inside the IDE.

- **VirtualTabs**: group files by task — across any directory, persisted across sessions
- **Quick Prompt**: capture ideas and queue next tasks while your agent runs — without switching windows

Together, they reduce the cognitive overhead of AI-assisted development.

Get Quick Prompt on [**VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=winterdrive.quick-prompt) | [**Open VSX Registry**](https://open-vsx.org/extension/winterdrive/quick-prompt)

### 🔁 Edo Tensei

**For when the AI session itself needs to move, not just your files.**

VirtualTabs solves *where am I in the workspace*. [Edo Tensei](https://github.com/Pain-Labs/Edo-Tensei) solves what happens when your AI quota runs out or you switch IDEs mid-task — it extracts local session history and packages it into a handoff prompt so the next agent can pick up where the last one left off.

Get Edo Tensei on [**VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) | [**Open VSX Registry**](https://open-vsx.org/extension/Pain-Labs/edo-tensei)

---

## 📅 Changelog

👉 See [CHANGELOG.md](./CHANGELOG.md) for full release history.

---

## ❤️ Support

If you find this extension helpful, please consider supporting the development!

<a href="https://ko-fi.com/Q5Q41SR5WO"><img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" height="36" alt="ko-fi" /></a>

**License**: [MIT](./LICENSE)

**Organize smarter, code faster.** 🚀

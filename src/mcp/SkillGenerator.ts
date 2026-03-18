import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { I18n } from '../i18n';

export type SkillGenerationResult =
    | { status: 'generated'; target: 'cursor' | 'vscode'; projectRoot: string; skillPath: string }
    | { status: 'cancelled'; projectRoot: string }
    | { status: 'no_workspace' };

export class SkillGenerator {
    public static getProjectRoot(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return workspaceFolders[0].uri.fsPath;
    }

    public static getMcpServerScriptPath(context: vscode.ExtensionContext): string {
        const extensionPath = context.extensionPath;
        return path.join(extensionPath, 'dist', 'mcp', 'index.js').replace(/\\/g, '/');
    }

    public static async generateSkill(context: vscode.ExtensionContext): Promise<SkillGenerationResult> {
        const projectRoot = this.getProjectRoot();
        if (!projectRoot) {
            vscode.window.showErrorMessage(I18n.getMessage('message.noWorkspaceFound') || 'No workspace opened.');
            return { status: 'no_workspace' };
        }

        const options = [
            'Cursor (.cursor/rules/virtualtabs.mdc)',
            'Antigravity (.agents/skills/virtualtabs/SKILL.md)',
            'Claude Code (.claude/skills/virtualtabs/SKILL.md)',
            'GitHub Copilot (.github/skills/virtualtabs/SKILL.md)',
            'Kiro IDE (.kiro/skills/virtualtabs/SKILL.md)',
            'Cline (.cline/skills/virtualtabs/SKILL.md)'
        ];
        const choice = await vscode.window.showQuickPick(options, {
            placeHolder: I18n.getMessage('mcp.selectAgentPlaceholder')
        });

        if (!choice) {
            return { status: 'cancelled', projectRoot };
        }

        const mcpServerScriptPath = this.getMcpServerScriptPath(context);

        if (choice.includes('Cursor')) {
            const skillPath = await this.generateCursorRule(context, projectRoot, mcpServerScriptPath);
            return { status: 'generated', target: 'cursor', projectRoot, skillPath };
        } else if (choice.includes('Antigravity')) {
            const skillPath = await this.generateVSCodeSkill(context, projectRoot, mcpServerScriptPath, '.agents');
            return { status: 'generated', target: 'vscode', projectRoot, skillPath };
        } else if (choice.includes('Claude')) {
            const skillPath = await this.generateVSCodeSkill(context, projectRoot, mcpServerScriptPath, '.claude');
            return { status: 'generated', target: 'vscode', projectRoot, skillPath };
        } else if (choice.includes('GitHub Copilot')) {
            const skillPath = await this.generateVSCodeSkill(context, projectRoot, mcpServerScriptPath, '.github');
            return { status: 'generated', target: 'vscode', projectRoot, skillPath };
        } else if (choice.includes('Kiro')) {
            const skillPath = await this.generateVSCodeSkill(context, projectRoot, mcpServerScriptPath, '.kiro');
            return { status: 'generated', target: 'vscode', projectRoot, skillPath };
        } else {
            const skillPath = await this.generateVSCodeSkill(context, projectRoot, mcpServerScriptPath, '.cline');
            return { status: 'generated', target: 'vscode', projectRoot, skillPath };
        }
    }

    private static async generateCursorRule(context: vscode.ExtensionContext, projectRoot: string, mcpServerPath: string, openDocument: boolean = true): Promise<string> {
        const rulesDir = path.join(projectRoot, '.cursor', 'rules');
        const ruleFilePath = path.join(rulesDir, 'virtualtabs.mdc');

        if (!fs.existsSync(rulesDir)) {
            fs.mkdirSync(rulesDir, { recursive: true });
        }

        const scriptRunPath = '.cursor/rules/scripts/vt.bundle.js';
        const scriptsCursorDir = path.join(projectRoot, '.cursor', 'rules', 'scripts');
        if (!fs.existsSync(scriptsCursorDir)) {
            fs.mkdirSync(scriptsCursorDir, { recursive: true });
        }
        fs.writeFileSync(path.join(scriptsCursorDir, 'vt.bundle.js'), SkillGenerator.getVtBundleContent(context), 'utf-8');

        const frontmatter = `---\ndescription: "VirtualTabs - File Group Management"\nglobs: "*"\n---\n`;
        const content = frontmatter + SkillGenerator.buildSkillBody(scriptRunPath);

        fs.writeFileSync(ruleFilePath, content, 'utf8');
        vscode.window.showInformationMessage(I18n.getMessage('mcp.generatedCursorRule'));

        if (openDocument) {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(ruleFilePath));
            await vscode.window.showTextDocument(document);
        }

        return ruleFilePath;
    }

    private static async generateVSCodeSkill(context: vscode.ExtensionContext, projectRoot: string, mcpServerPath: string, agentType: '.agents' | '.claude' | '.github' | '.kiro' | '.cline' = '.github', openDocument: boolean = true): Promise<string> {
        // Agent Skills directory layout:
        // - Antigravity: .agents/skills/virtualtabs/SKILL.md
        // - Claude Code: .claude/skills/virtualtabs/SKILL.md
        // - GitHub Copilot: .github/skills/virtualtabs/SKILL.md
        // - Kiro IDE: .kiro/skills/virtualtabs/SKILL.md
        // - Cline: .cline/skills/virtualtabs/SKILL.md
        const skillsDir = path.join(projectRoot, agentType, 'skills', 'virtualtabs');
        const mdPath = path.join(skillsDir, 'SKILL.md');

        if (!fs.existsSync(skillsDir)) {
            fs.mkdirSync(skillsDir, { recursive: true });
        }

        const skillScriptsDir = path.join(skillsDir, 'scripts');
        if (!fs.existsSync(skillScriptsDir)) {
            fs.mkdirSync(skillScriptsDir, { recursive: true });
        }
        fs.writeFileSync(path.join(skillScriptsDir, 'vt.bundle.js'), SkillGenerator.getVtBundleContent(context), 'utf-8');

        const scriptRunPath = agentType + '/skills/virtualtabs/scripts/vt.bundle.js';
        const frontmatter = `---\nname: virtualtabs\ndescription: Manages VS Code editor file groups using VirtualTabs MCP tools. Use this skill when the user wants to organize files into groups, create, rename, or delete groups, add or remove files from groups, manage bookmarks, set sorting rules, auto-group files by extension or date, or explore project structure. Also use when the user asks to help organize their workspace or work on a specific feature or topic area.\n---\n`;
        const content = frontmatter + SkillGenerator.buildSkillBody(scriptRunPath);

        fs.writeFileSync(mdPath, content, 'utf8');
        const relativeSkillPath = path.relative(projectRoot, mdPath).replace(/\\/g, '/');
        vscode.window.showInformationMessage(I18n.getMessage('mcp.generatedSkill', relativeSkillPath));

        if (openDocument) {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(mdPath));
            await vscode.window.showTextDocument(document);
        }

        return mdPath;
    }

    /**
     * Shared skill body used by both Cursor and VSCode-family skill generators.
     * Only the frontmatter and scriptRunPath differ between them.
     */
    private static buildSkillBody(scriptRunPath: string): string {
        return `# VirtualTabs MCP Integration

This project uses VirtualTabs to organize files into **virtual groups** across directories.

> ⚠️ **CRITICAL CONCEPT**: VirtualTabs groups are **purely virtual**.
> - No files are moved, copied, or modified on disk.
> - A "group" is just a named list of file references stored in \`.vscode/virtualTab.json\`.
> - When a user says "建立一個 md 資料夾" or "create an md folder", they mean a **VirtualTabs group**, NOT a real filesystem directory.
> - Never suggest creating a real folder or moving files as an alternative to VirtualTabs grouping.

## MCP Server Setup

To configure the MCP server for your AI tool:
1. Open VS Code Command Palette (Ctrl+Shift+P)
2. Run: **VirtualTabs: Show MCP Config**
3. Follow the instructions for your specific AI tool

## Available Tools

### Core Operations

- \`list_groups\`: List all groups with their files and metadata
- \`create_group\`: Create a new group (optionally nested under a parent)
- \`rename_group\`: Rename an existing group
- \`move_group\`: Reorder group within its current tree level
- \`delete_group\`: Delete a group (optionally with all subgroups)
- \`add_files_to_group\`: Add files to a group (creates group if missing when using groupName)
- \`remove_files_from_group\`: Remove files from a group

### Project Exploration (Read-Only)

- \`explore_project\`: Explore the project structure using glob patterns, directory filters, and extension filters
- \`read_file\`: Read the content of a file (up to 100KB)

### Bookmarks (Read/Write)

- \`create_bookmark\`: Create a bookmark at a specific line in a file within a group
- \`delete_bookmark\`: Delete an existing bookmark
- \`list_bookmarks\`: List bookmarks, optionally filtered by group

### Smart Organization

- \`set_group_sorting\`: Set the sorting criteria and order for files within a group
- \`auto_group_by_extension\`: Automatically group files by their file extensions
- \`auto_group_by_date\`: Automatically group files by their modification date
- \`create_group_by_pattern\`: **⭐ PREFERRED** — Create a group and auto-populate it with files matching a glob pattern. No file paths needed. Use this instead of \`explore_project\` + \`create_group\` + \`add_files_to_group\` when grouping by type.
- \`remove_files_by_pattern\`: **⭐ PREFERRED** — Remove all files from a group that match a glob pattern. No file listing needed.

## Usage Guidelines

Use these tools to help users organize their workspace files into logical groups. The agent should:

1. **Understand user intent** through conversation before creating groups
2. **Prefer pattern-based tools** — use \`create_group_by_pattern\` / \`remove_files_by_pattern\` whenever the user's intent can be expressed as a glob pattern
3. **Batch array arguments** — when using \`add_files_to_group\` or \`remove_files_from_group\`, NEVER pass more than **15 file paths per call**. If you have more files, either use the \`*_by_pattern\` tools or split across multiple calls.
4. **Create groups** that reflect the user'\''s mental model of their project

Example workflow:

- User: "I want to work on the authentication feature"
- Agent: [Uses grepSearch to find auth-related files] → [Creates "Authentication" group] → [Adds discovered files]

## ⚡ Action Decision Tree

> ❗ **MANDATORY**: Before performing ANY VirtualTabs operation, you MUST complete Layer 0 first.

### Layer 0: MCP Connection Gate — MUST PASS BEFORE ANY OTHER ACTION

Attempt to call \`list_groups\` now.

**If \`list_groups\` succeeds** → MCP is working. Proceed to Layer 1 immediately.

**If \`list_groups\` fails ("Tool not found" / no response / timeout)**:

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

Use these if standard Layer 1 write tools fail (e.g. extension IPC errors), but the MCP server itself is still responding:

- \`validate_json_structure\`: Validate a JSON string against the virtualTab.json schema. Run this before any direct file write to confirm structure is correct.
- \`append_group_to_json\`: Safely append a new group. Handles backup, duplicate-name detection, and relative path enforcement automatically. **Always prefer this over manually editing the JSON.**

---

### Layer 3: Hard Fallback 🚨 (Last resort — only with explicit user confirmation)

Only if ALL tools above are non-functional AND the user has explicitly confirmed they want to proceed:

**Option A – Use the bundled CLI script (recommended)**:
\`\`\`bash
# Step 1: Find all relevant files (use your own search/read tools first)
# Step 2: Create the group
node \${scriptRunPath} add-group --name "GroupName"
# Step 3: Add files (workspace-relative paths, space-separated)
node \${scriptRunPath} add-files --group "GroupName" src/a.ts src/b.ts src/c.ts
# Step 4: Verify result
node \${scriptRunPath} list-groups
\`\`\`
The script automatically creates a backup and checks for duplicate names.

**Option B – Direct JSON edit** (only if Node.js is unavailable):
1. **Mandatory backup first**: Copy \`.vscode/virtualTab.json\` → \`.vscode/virtualTab.json.backup\` before ANY write.
2. Read \`.vscode/virtualTab.json\` in full before editing.
3. Make minimal, targeted edits.
4. **Never modify groups with \`"isBuiltIn": true\`** — these are system-managed.
5. Use workspace-relative paths only (no absolute paths).
6. Validate JSON structure manually before saving (balanced brackets, no trailing commas).

---

## Behaviour Examples

### ✅ Example A: MCP available — md folder request (CRITICAL: groups are virtual)

> **User**: 幫我建立一個 md 資料夾，專門裝專案內的所有 markdown
>
> ❌ **WRONG response**: "I'\''ll create an md/ folder and move your files there"
> ❌ **WRONG**: [calls \`explore_project\`] → [calls \`create_group\`] → [calls \`add_files_to_group\` with 30+ paths] — risks JSON truncation
>
> ✅ **CORRECT** (use pattern tool — server handles everything):
> **Agent**: [calls \`create_group_by_pattern({ groupName: "md", pattern: "**/*.md" })\`]
> "我用 VirtualTabs 幫你建立了虛擬群組 '\''md'\''，並自動加入了所有 markdown 檔案。檔案並未移動位置。"

### ✅ Example B: MCP available — TypeScript feature

> **User**: Create a group called "auth" with all TypeScript files in src/auth/
>
> **Agent**: [calls \`create_group_by_pattern({ groupName: "auth", pattern: "src/auth/**/*.ts" })\`]
> "Done! I created the '\''auth'\'' group and added all TypeScript files from src/auth/."

### 🛑 Example C: MCP not connected (correct HALT behaviour)

> **User**: 幫我建立一個 md 資料夾
>
> **Agent** (discovers \`list_groups\` is unavailable):
> "**VirtualTabs MCP server is not connected.**
> To enable full functionality, please:
> 1. Open VS Code Command Palette (Ctrl+Shift+P)
> 2. Run: **VirtualTabs: Show MCP Config**
> 3. Follow the setup instructions for your AI client
> 4. Restart your AI client after configuring
>
> Would you like me to proceed with a limited fallback instead, or wait until MCP is configured?"

### ⚠️ Example D: User chooses fallback after being informed

> **User** (after seeing Example C): Proceed with fallback.
>
> **Agent**: [calls \`append_group_to_json\` with group_name="md", files=[...]] → reports result
> "Done — I used the safe fallback tool to add the virtual group. No files were moved."
`;
    }

    /**
     * Read the CLI content from the bundled dist/vt.bundle.js.
     * This bundle is produced by esbuild during the build:vt step and contains the full VirtualTabs CLI.
     */
    public static getVtBundleContent(context: vscode.ExtensionContext): string {
        const bundlePath = path.join(context.extensionPath, 'dist', 'vt.bundle.js');
        if (!fs.existsSync(bundlePath)) {
            throw new Error(`vt.bundle.js not found at ${bundlePath}. Run 'npm run build:vt' first.`);
        }
        return fs.readFileSync(bundlePath, 'utf-8');
    }
}

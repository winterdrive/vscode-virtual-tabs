import * as vscode from 'vscode';
import * as path from 'path';
import { I18n } from '../i18n';

interface ToolConfig {
    key: string;
    name: string;
    description: string;
    instruction: string;
    supportsVariableWorkspaceFolder: boolean;
    recommendedMode: ConfigMode;
    note?: string;
}

type ConfigMode = 'variable' | 'absolute';

interface ToolMetadata {
    key: string;
    nameKey: string;
    descriptionKey: string;
    instructionKey: string;
    noteKey?: string;
    // Some clients can expand ${workspaceFolder}, others require a real path.
    supportsVariableWorkspaceFolder: boolean;
    recommendedMode: ConfigMode;
}

interface WorkspaceOption {
    id: string;
    name: string;
    path: string;
}

export class McpConfigPanel {
    public static currentPanel: McpConfigPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private readonly _extensionUri: vscode.Uri;
    private readonly _stableMcpServerPath: string | undefined;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, stableMcpServerPath?: string) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._stableMcpServerPath = stableMcpServerPath;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    }

    public static show(extensionUri: vscode.Uri, stableMcpServerPath?: string) {
        if (McpConfigPanel.currentPanel) {
            McpConfigPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'virtualTabsMcpConfig',
            I18n.getMessage('mcp.webview.title'),
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri]
            }
        );

        McpConfigPanel.currentPanel = new McpConfigPanel(panel, extensionUri, stableMcpServerPath);
    }

    public dispose() {
        McpConfigPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        // Get the MCP Server entry-point path.
        // Priority 1: stable path under globalStorageUri (version-independent, recommended for users).
        // Priority 2: fallback to extensionUri path (includes version number, changes on update).
        const serverPath = this._stableMcpServerPath
            ?? path.join(this._extensionUri.fsPath, 'dist', 'mcp', 'index.js').replace(/\\/g, '/');

        const workspaceContext = this._resolveWorkspaceContext();
        const toolConfigs = this._buildToolConfigs();

        this._panel.webview.html = this._getHtmlForWebview(toolConfigs, workspaceContext, serverPath, {
            lang: vscode.env.language || 'en',
            title: I18n.getMessage('mcp.webview.title'),
            tipTitle: I18n.getMessage('mcp.webview.tipTitle'),
            tipBody: I18n.getMessage('mcp.webview.tipBody'),
            configTitle: I18n.getMessage('mcp.webview.configTitle'),
            skillTitle: I18n.getMessage('mcp.webview.skillTitle'),
            skillBody: I18n.getMessage('mcp.webview.skillBody'),
            concurrencyNote: I18n.getMessage('mcp.webview.concurrencyNote'),
            workspaceTitle: I18n.getMessage('mcp.webview.workspaceTitle'),
            workspaceDescription: I18n.getMessage('mcp.webview.workspaceDescription'),
            workspaceSelectLabel: I18n.getMessage('mcp.webview.workspaceSelectLabel'),
            workspaceCount: I18n.getMessage('mcp.webview.workspaceCount', String(workspaceContext.workspaces.length)),
            workspaceEmpty: I18n.getMessage('mcp.webview.workspaceEmpty'),
            supportVariable: I18n.getMessage('mcp.webview.supportVariable'),
            supportAbsolute: I18n.getMessage('mcp.webview.supportAbsolute'),
            recommendedConfigTitle: I18n.getMessage('mcp.webview.recommendedConfigTitle'),
            selectedWorkspaceConfigTitle: I18n.getMessage('mcp.webview.selectedWorkspaceConfigTitle'),
            variableConfigTitle: I18n.getMessage('mcp.webview.variableConfigTitle'),
            allWorkspacesConfigTitle: I18n.getMessage('mcp.webview.allWorkspacesConfigTitle'),
            copyRecommendedButton: I18n.getMessage('mcp.webview.copyRecommendedButton'),
            copySelectedButton: I18n.getMessage('mcp.webview.copySelectedButton'),
            copyVariableButton: I18n.getMessage('mcp.webview.copyVariableButton'),
            copyAllButton: I18n.getMessage('mcp.webview.copyAllButton'),
            advancedOptionsTitle: I18n.getMessage('mcp.webview.advancedOptionsTitle'),
            chooseToolTitle: I18n.getMessage('mcp.webview.chooseToolTitle'),
            copyConfigTitle: I18n.getMessage('mcp.webview.copyConfigTitle'),
            workspacePathLabel: I18n.getMessage('mcp.webview.workspacePathLabel'),
            workspacePathEmpty: I18n.getMessage('mcp.webview.workspacePathEmpty'),
            noWorkspaceWarning: I18n.getMessage('mcp.webview.noWorkspaceWarning'),
            copied: I18n.getMessage('mcp.webview.copied'),
        });

        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.command) {
                    case 'copyToClipboard':
                        vscode.env.clipboard.writeText(message.text);
                        return;
                }
            },
            null,
            this._disposables
        );
    }

    private _resolveWorkspaceContext(): { workspaces: WorkspaceOption[]; selectedWorkspaceId?: string } {
        // In multi-root workspaces, prefer the active editor's workspace folder
        // to avoid always binding MCP to workspaceFolders[0].
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
        const activeWorkspaceFolder = activeEditorUri
            ? vscode.workspace.getWorkspaceFolder(activeEditorUri)
            : undefined;
        const fallbackWorkspaceFolder = workspaceFolders.length > 0 ? workspaceFolders[0] : undefined;
        const workspaceFolder = activeWorkspaceFolder ?? fallbackWorkspaceFolder;

        return {
            workspaces: workspaceFolders.map(folder => ({
                id: folder.uri.toString(),
                name: folder.name,
                path: folder.uri.fsPath.replace(/\\/g, '/')
            })),
            selectedWorkspaceId: workspaceFolder?.uri.toString()
        };
    }

    private _buildToolConfigs(): Record<string, ToolConfig> {
        return this._getToolMetadata().reduce<Record<string, ToolConfig>>((acc, tool) => {
            acc[tool.key] = {
                key: tool.key,
                name: I18n.getMessage(tool.nameKey),
                description: I18n.getMessage(tool.descriptionKey),
                instruction: I18n.getMessage(tool.instructionKey),
                supportsVariableWorkspaceFolder: tool.supportsVariableWorkspaceFolder,
                recommendedMode: tool.recommendedMode,
                note: tool.noteKey ? I18n.getMessage(tool.noteKey) : undefined
            };
            return acc;
        }, {});
    }

    private _getToolMetadata(): ToolMetadata[] {
        return [
            {
                key: 'cursor',
                nameKey: 'mcp.tool.cursor.name',
                descriptionKey: 'mcp.tool.cursor.description',
                instructionKey: 'mcp.tool.cursor.instruction',
                supportsVariableWorkspaceFolder: true,
                recommendedMode: 'variable'
            },
            {
                key: 'copilot',
                nameKey: 'mcp.tool.copilot.name',
                descriptionKey: 'mcp.tool.copilot.description',
                instructionKey: 'mcp.tool.copilot.instruction',
                supportsVariableWorkspaceFolder: false,
                recommendedMode: 'absolute'
            },
            {
                key: 'kiro',
                nameKey: 'mcp.tool.kiro.name',
                descriptionKey: 'mcp.tool.kiro.description',
                instructionKey: 'mcp.tool.kiro.instruction',
                noteKey: 'mcp.tool.kiro.note',
                supportsVariableWorkspaceFolder: false,
                recommendedMode: 'absolute'
            },
            {
                key: 'claudeDesktop',
                nameKey: 'mcp.tool.claudeDesktop.name',
                descriptionKey: 'mcp.tool.claudeDesktop.description',
                instructionKey: 'mcp.tool.claudeDesktop.instruction',
                noteKey: 'mcp.tool.claudeDesktop.note',
                supportsVariableWorkspaceFolder: false,
                recommendedMode: 'absolute'
            },
            {
                key: 'antigravity',
                nameKey: 'mcp.tool.antigravity.name',
                descriptionKey: 'mcp.tool.antigravity.description',
                instructionKey: 'mcp.tool.antigravity.instruction',
                supportsVariableWorkspaceFolder: false,
                recommendedMode: 'absolute'
            }
        ];
    }

    private _getHtmlForWebview(toolConfigs: Record<string, ToolConfig>, workspaceContext: {
        workspaces: WorkspaceOption[];
        selectedWorkspaceId?: string;
    }, serverPath: string, i18n: {
        lang: string;
        title: string; tipTitle: string; tipBody: string;
        configTitle: string; skillTitle: string; skillBody: string;
        concurrencyNote: string; copied: string;
        workspaceTitle: string; workspaceDescription: string; workspaceSelectLabel: string;
        workspaceCount: string; workspaceEmpty: string;
        supportVariable: string; supportAbsolute: string;
        recommendedConfigTitle: string; selectedWorkspaceConfigTitle: string;
        variableConfigTitle: string; allWorkspacesConfigTitle: string;
        copyRecommendedButton: string; copySelectedButton: string;
        copyVariableButton: string; copyAllButton: string;
        advancedOptionsTitle: string; chooseToolTitle: string; copyConfigTitle: string;
        workspacePathLabel: string; workspacePathEmpty: string;
        noWorkspaceWarning: string;
    }) {
        const tools = Object.values(toolConfigs);
        const ideTabsHtml = tools.map((tool, index) => `
            <button class="ide-tab${index === 0 ? ' active' : ''}" data-tool-key="${tool.key}" type="button">${tool.name}</button>
        `).join('');

        const workspaceOptionsHtml = workspaceContext.workspaces.length > 0
            ? workspaceContext.workspaces.map(workspace => {
                const selected = workspace.id === workspaceContext.selectedWorkspaceId ? 'selected' : '';
                return `<option value="${workspace.id}" ${selected}>${workspace.name}</option>`;
            }).join('')
            : `<option value="__none__">${i18n.workspaceEmpty}</option>`;

        const webviewData = JSON.stringify({
            serverPath,
            tools,
            workspaces: workspaceContext.workspaces,
            selectedWorkspaceId: workspaceContext.selectedWorkspaceId,
            labels: {
                recommended: i18n.recommendedConfigTitle,
                selected: i18n.selectedWorkspaceConfigTitle,
                variable: i18n.variableConfigTitle,
                all: i18n.allWorkspacesConfigTitle
            },
            copyButtons: {
                recommended: i18n.copyRecommendedButton,
                selected: i18n.copySelectedButton,
                variable: i18n.copyVariableButton,
                all: i18n.copyAllButton
            },
            workspacePath: {
                label: i18n.workspacePathLabel,
                empty: i18n.workspacePathEmpty
            }
        }).replace(/</g, '\\u003c');

        return `<!DOCTYPE html>
<html lang="${i18n.lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${i18n.title}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            line-height: 1.6;
        }
        .container {
            max-width: 920px;
            margin: 0 auto;
        }
        h1, h2, h3 {
            color: var(--vscode-editor-foreground);
        }
        h2 {
            margin-top: 32px;
            color: var(--vscode-textPreformat-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        h3 {
            border-bottom: none;
            margin-top: 0;
            margin-bottom: 8px;
        }
        p {
            margin: 4px 0;
        }
        .code-block {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 16px;
            border-radius: 6px;
            position: relative;
            margin: 16px 0;
            overflow-x: auto;
            border: 1px solid var(--vscode-panel-border);
        }
        .code-actions {
            margin-top: 12px;
        }
        pre {
            margin: 0;
            white-space: pre;
            font-size: 13px;
        }
        .copy-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 7px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
        }
        .copy-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .copy-btn:focus-visible,
        .workspace-select:focus-visible,
        .ide-tab:focus-visible,
        .option-tab:focus-visible {
            outline: 2px solid var(--vscode-focusBorder);
            outline-offset: 2px;
        }
        .copy-btn:disabled {
            cursor: not-allowed;
            opacity: 0.55;
        }
        .config-title {
            margin: 0 0 8px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .instructions {
            background-color: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 10px 12px;
            margin: 14px 0 22px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .workspace-section,
        .step-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 14px 16px;
            margin-top: 0;
            margin-bottom: 16px;
            background: var(--vscode-editor-background);
        }
        .workspace-select {
            width: 100%;
            margin-top: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px;
        }
        .workspace-meta {
            margin-top: 6px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .workspace-path {
            margin-top: 8px;
            padding: 6px 8px;
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
            background: var(--vscode-textCodeBlock-background);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            word-break: break-all;
        }
        .config-shell {
            margin-bottom: 24px;
            padding: 18px;
            border: 1px solid var(--vscode-focusBorder);
            border-radius: 8px;
            background-color: var(--vscode-editorWidget-background);
        }
        .step-title {
            font-size: 12px;
            margin-bottom: 8px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .ide-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 10px;
        }
        .ide-tab,
        .option-tab {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 999px;
            font-size: 12px;
            padding: 6px 12px;
            cursor: pointer;
        }
        .ide-tab.active,
        .option-tab.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        .tool-description,
        .tool-support {
            color: var(--vscode-descriptionForeground);
            margin: 4px 0;
            font-size: 13px;
        }
        .tool-instruction {
            margin: 8px 0;
            font-size: 13px;
        }
        .tool-note {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin: 8px 0;
            white-space: pre-wrap;
            padding: 8px;
            background-color: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
        }
        .skill-section {
            background-color: var(--vscode-sideBar-background);
            padding: 24px;
            border-radius: 8px;
            border: 1px dashed var(--vscode-panel-border);
            margin-top: 40px;
        }
        .option-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 8px;
        }
        .warning-box {
            margin-top: 2px;
            padding: 8px 10px;
            border-radius: 4px;
            border: 1px solid var(--vscode-inputValidation-warningBorder);
            background: var(--vscode-inputValidation-warningBackground);
            color: var(--vscode-inputValidation-warningForeground);
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${i18n.title}</h1>
        
        <div class="instructions">
            <p><strong>${i18n.tipTitle}</strong> ${i18n.tipBody}</p>
            <p>${i18n.concurrencyNote}</p>
        </div>

        <h2>${i18n.configTitle}</h2>
        <div class="config-shell">
            <div class="workspace-section step-card">
                <p class="step-title">1. ${i18n.workspaceTitle}</p>
                <p>${i18n.workspaceDescription}</p>
                <label for="workspace-select">${i18n.workspaceSelectLabel}</label>
                <select id="workspace-select" class="workspace-select">${workspaceOptionsHtml}</select>
                <p class="workspace-meta">${i18n.workspaceCount}</p>
                <p id="workspace-path" class="workspace-path"></p>
            </div>

            <div class="step-card">
                <p class="step-title">2. ${i18n.chooseToolTitle}</p>
                <div id="ide-tabs" class="ide-tabs">${ideTabsHtml}</div>
                <h3 id="tool-name"></h3>
                <p id="tool-description" class="tool-description"></p>
                <p id="tool-instruction" class="tool-instruction"></p>
                <p id="tool-support" class="tool-support"></p>
                <p id="tool-note" class="tool-note" style="display:none;"></p>
            </div>

            <div class="step-card">
                <p class="step-title">3. ${i18n.advancedOptionsTitle}</p>
                <div id="option-tabs" class="option-tabs"></div>
            </div>

            <div class="step-card">
                <p class="step-title">4. ${i18n.copyConfigTitle}</p>
                <div class="code-block">
                    <p id="config-title" class="config-title"></p>
                    <pre><code id="active-config"></code></pre>
                    <div class="code-actions">
                        <button id="copy-active" class="copy-btn action-btn" type="button"></button>
                    </div>
                </div>
                <div id="no-workspace-warning" class="warning-box" style="display:none;">${i18n.noWorkspaceWarning}</div>
            </div>
        </div>

        <div class="skill-section">
            <h2>${i18n.skillTitle}</h2>
            <p>${i18n.skillBody}</p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const model = ${webviewData};
        const EMPTY_WORKSPACE = '/path/to/your/workspace';
        const hasWorkspace = model.workspaces.length > 0;
        const state = {
            activeToolKey: model.tools[0]?.key || '',
            activeOption: 'recommended'
        };

        function getTool(toolKey) {
            return model.tools.find(tool => tool.key === toolKey);
        }

        function getSelectedWorkspace() {
            const select = document.getElementById('workspace-select');
            const selected = model.workspaces.find(workspace => workspace.id === select.value);
            return selected || model.workspaces[0] || { id: '__none__', name: 'workspace', path: EMPTY_WORKSPACE };
        }

        function sanitizeServerName(name) {
            const normalized = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            return normalized || 'workspace';
        }

        function createServerEntry(workspaceRoot) {
            return {
                command: 'node',
                args: [model.serverPath, '--workspace-root', workspaceRoot]
            };
        }

        function buildJson(mcpServers) {
            return JSON.stringify({ mcpServers }, null, 2);
        }

        function buildAbsoluteConfig(toolKey, workspacePath) {
            return buildJson({
                virtualtabs: createServerEntry(workspacePath)
            });
        }

        function buildVariableConfig() {
            return buildJson({
                virtualtabs: createServerEntry('\${workspaceFolder}')
            });
        }

        function buildRecommendedConfig(tool, workspacePath) {
            if (tool.recommendedMode === 'variable' && tool.supportsVariableWorkspaceFolder) {
                return buildVariableConfig();
            }
            return buildAbsoluteConfig(tool.key, workspacePath);
        }

        function buildAllWorkspacesConfig() {
            const usedNames = {};
            const mcpServers = {};
            for (const workspace of model.workspaces) {
                const baseName = 'virtualtabs-' + sanitizeServerName(workspace.name);
                let serverName = baseName;
                let index = 2;
                while (usedNames[serverName]) {
                    serverName = baseName + '-' + index;
                    index += 1;
                }
                usedNames[serverName] = true;
                mcpServers[serverName] = createServerEntry(workspace.path);
            }
            return buildJson(mcpServers);
        }

        function setCode(id, value) {
            const node = document.getElementById(id);
            if (node) {
                node.textContent = value;
            }
        }

        function getOptionList(tool) {
            const options = ['recommended', 'selected'];
            if (tool.supportsVariableWorkspaceFolder) {
                options.push('variable');
            } else if (model.workspaces.length > 1) {
                options.push('all');
            }
            return options;
        }

        function requiresWorkspace(tool, option) {
            if (option === 'selected' || option === 'all') {
                return true;
            }
            return option === 'recommended' && tool.recommendedMode === 'absolute';
        }

        function getOptionConfig(tool, option, workspacePath) {
            if (option === 'recommended') {
                return buildRecommendedConfig(tool, workspacePath);
            }
            if (option === 'selected') {
                return buildAbsoluteConfig(tool.key, workspacePath);
            }
            if (option === 'variable') {
                return buildVariableConfig();
            }
            if (option === 'all') {
                return buildAllWorkspacesConfig();
            }
            return '';
        }

        function renderIdeTabs() {
            for (const tab of document.querySelectorAll('.ide-tab')) {
                tab.classList.toggle('active', tab.dataset.toolKey === state.activeToolKey);
            }
        }

        function renderOptionTabs(tool) {
            const options = getOptionList(tool);
            if (!options.includes(state.activeOption)) {
                state.activeOption = 'recommended';
            }
            const host = document.getElementById('option-tabs');
            host.innerHTML = options.map(option => {
                const activeClass = option === state.activeOption ? ' active' : '';
                return '<button class="option-tab' + activeClass + '" data-option="' + option + '" type="button">' + model.labels[option] + '</button>';
            }).join('');
        }

        function renderToolMeta(tool) {
            setCode('tool-name', tool.name);
            setCode('tool-description', tool.description);
            setCode('tool-instruction', tool.instruction);
            setCode('tool-support', tool.supportsVariableWorkspaceFolder ? '${i18n.supportVariable}' : '${i18n.supportAbsolute}');
            const note = document.getElementById('tool-note');
            if (tool.note) {
                note.style.display = 'block';
                note.textContent = tool.note;
            } else {
                note.style.display = 'none';
                note.textContent = '';
            }
        }

        function renderWorkspacePath() {
            const selectedWorkspace = getSelectedWorkspace();
            const pathNode = document.getElementById('workspace-path');
            if (!pathNode) {
                return;
            }
            if (!hasWorkspace) {
                pathNode.textContent = model.workspacePath.empty;
                return;
            }
            pathNode.textContent = model.workspacePath.label + ': ' + selectedWorkspace.path;
        }

        function renderActiveConfig() {
            const tool = getTool(state.activeToolKey);
            if (!tool) {
                return;
            }
            const selectedWorkspace = getSelectedWorkspace();
            const config = getOptionConfig(tool, state.activeOption, selectedWorkspace.path);
            setCode('config-title', model.labels[state.activeOption]);
            setCode('active-config', config);
            const copyBtn = document.getElementById('copy-active');
            copyBtn.textContent = model.copyButtons[state.activeOption];
            copyBtn.disabled = requiresWorkspace(tool, state.activeOption) && !hasWorkspace;
            document.getElementById('no-workspace-warning').style.display = copyBtn.disabled ? 'block' : 'none';
        }

        function renderAll() {
            const tool = getTool(state.activeToolKey);
            if (!tool) {
                return;
            }
            renderIdeTabs();
            renderToolMeta(tool);
            renderOptionTabs(tool);
            renderWorkspacePath();
            renderActiveConfig();
        }

        function copyText(text, btn) {
            if (btn.disabled) {
                return;
            }
            vscode.postMessage({
                command: 'copyToClipboard',
                text
            });
            const originalText = btn.innerText;
            btn.innerText = '${i18n.copied}';
            setTimeout(() => {
                btn.innerText = originalText;
            }, 1200);
        }

        function copyActive(btn) {
            const tool = getTool(state.activeToolKey);
            if (!tool) {
                return;
            }
            const selectedWorkspace = getSelectedWorkspace();
            copyText(getOptionConfig(tool, state.activeOption, selectedWorkspace.path), btn);
        }

        document.getElementById('ide-tabs').addEventListener('click', event => {
            const target = event.target;
            if (!target || !target.classList.contains('ide-tab')) {
                return;
            }
            state.activeToolKey = target.dataset.toolKey;
            state.activeOption = 'recommended';
            renderAll();
        });

        document.getElementById('option-tabs').addEventListener('click', event => {
            const target = event.target;
            if (!target || !target.classList.contains('option-tab')) {
                return;
            }
            state.activeOption = target.dataset.option;
            renderAll();
        });

        document.getElementById('copy-active').addEventListener('click', event => copyActive(event.target));
        document.getElementById('workspace-select').addEventListener('change', renderAll);
        renderAll();
    </script>
</body>
</html>`;
    }
}

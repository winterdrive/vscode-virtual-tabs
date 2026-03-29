import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TempFoldersProvider } from './provider';
import { TempFoldersDragAndDropController } from './dragAndDrop';
import { registerCommands } from './commands';
import { I18n } from './i18n';
import { TempFolderItem, TempFileItem } from './treeItems';

/**
 * 將 MCP server 部署到不受版本號影響的穩定路徑（globalStorageUri）。
 * 每次擴充功能啟動時自動執行，確保用戶配置的 MCP 路徑永遠指向最新版本。
 * @returns 穩定路徑的字串（使用 `/` 分隔符），若部署失敗則返回 undefined
 */
async function deployMcpServer(context: vscode.ExtensionContext): Promise<string | undefined> {
    const sourceFile = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp', 'index.js');
    const targetDir = vscode.Uri.joinPath(context.globalStorageUri, 'mcp');
    const targetFile = vscode.Uri.joinPath(targetDir, 'index.js');

    try {
        // 確保目標目錄存在
        await vscode.workspace.fs.createDirectory(targetDir);
        

        // 讀取原始 MCP server 檔案內容
        const sourceContent = await vscode.workspace.fs.readFile(sourceFile);

        // 寫入穩定路徑（覆蓋舊版本）
        await vscode.workspace.fs.writeFile(targetFile, sourceContent);

        console.log(`[VirtualTabs] MCP server deployed to stable path: ${targetFile.fsPath}`);
        return targetFile.fsPath.replace(/\\/g, '/');
    } catch (error) {
        // 部署失敗不影響擴充功能主要功能，降低為警告
        console.warn('[VirtualTabs] Failed to deploy MCP server to stable path:', error);
        return undefined;
    }
}

/**
 * Activate the extension
 * @param context Extension context
 */
export async function activate(context: vscode.ExtensionContext) {
    // 部署 MCP server 到穩定路徑（與版本號無關）
    const stableMcpPath = await deployMcpServer(context);

    // Initialize i18n
    await I18n.initialize(context);

    // Listen for language configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('locale')) {
                await I18n.reload(context);
            }
        })
    );

    // Create Provider and DragAndDrop controller
    const provider = new TempFoldersProvider(context);
    const expandedKey = 'virtualTabs.expandedGroups';
    const expandedIds = context.workspaceState.get<string[]>(expandedKey, []);
    provider.setExpandedGroupIds(expandedIds);
    const dragAndDropController = new TempFoldersDragAndDropController(provider);

    // Create tree view, enable multi-select
    const treeView = vscode.window.createTreeView('virtualTabsView', {
        treeDataProvider: provider,
        dragAndDropController,
        canSelectMany: true
    });
    context.subscriptions.push(treeView);

    // Pass the tree view to the provider for selection management
    provider.setTreeView(treeView);

    const updateExpandedState = (element: vscode.TreeItem, expanded: boolean) => {
        if (!(element instanceof TempFolderItem)) {
            return;
        }
        const ids = provider.updateGroupExpanded(element.groupId, expanded);
        context.workspaceState.update(expandedKey, ids);
    };

    treeView.onDidExpandElement(e => updateExpandedState(e.element, true));
    treeView.onDidCollapseElement(e => updateExpandedState(e.element, false));


    // Refresh the view when it becomes visible
    treeView.onDidChangeVisibility(e => {
        if (e.visible) {
            provider.refresh();
        }
    });

    // Update context key based on selection
    treeView.onDidChangeSelection(e => {
        const hasFile = e.selection.some(item => item instanceof TempFileItem);
        const hasCustomFile = e.selection.some(item =>
            item instanceof TempFileItem &&
            item.contextValue &&
            item.contextValue.includes('virtualTabsFileCustom')
        );
        vscode.commands.executeCommand('setContext', 'virtualTabs:hasFileSelected', hasFile);
        vscode.commands.executeCommand('setContext', 'virtualTabs:hasCustomFileSelected', hasCustomFile);
    });


    // Listen for active editor change to auto-reveal file in the Virtual Tabs panel.
    // NOTE: We intentionally do NOT call syncBuiltInGroup() here to avoid triggering
    // a tree data change event (which clears the registry) mid-reveal, causing a race condition.
    // Tab open/close events are handled by onDidChangeVisibleTextEditors below.
    let lastSelectionUri: string | undefined;
    let lastSelectionTime: number = 0;

    // Track when the user clicks a file inside VirtualTabs
    context.subscriptions.push(
        treeView.onDidChangeSelection(e => {
            if (e.selection.length > 0) {
                const item = e.selection[0];
                if (item && item.resourceUri) {
                    lastSelectionUri = item.resourceUri.toString();
                    lastSelectionTime = Date.now();
                }
            }
        })
    );

    let revealTimeout: NodeJS.Timeout | undefined;

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor || !editor.document) return;

            const config = vscode.workspace.getConfiguration('virtualTabs');
            if (!config.get<boolean>('autoRevealActiveFile', true)) return;
            if (!treeView.visible) return;

            const activeUri = editor.document.uri;

            // Context-Aware Reveal: If the active editor changed because the user JUST clicked 
            // a file inside VirtualTabs (within 500ms), suppress the global reveal. 
            // This prevents "Currently Open Files" group from jumping out and stealing focus.
            if (Date.now() - lastSelectionTime < 500 && lastSelectionUri === activeUri.toString()) {
                return;
            }

            // Debounce the reveal to prevent flickering during fast tab switches
            if (revealTimeout) {
                clearTimeout(revealTimeout);
            }

            revealTimeout = setTimeout(() => {
                // Pass viewColumn to disambiguate if the same file is open in multiple groups.
                const itemToReveal = provider.findInternalFileItem(activeUri, editor.viewColumn);

                if (itemToReveal) {
                    try {
                        // Non-Expanding Sync: expand: false ensures we don't force open collapsed groups.
                        // It only highlights if the target folder is already expanded by the user.
                        treeView.reveal(itemToReveal, { select: true, focus: false, expand: false });
                    } catch (e) {
                        console.error('Tree reveal failed:', e);
                    }
                }
            }, 100);
        })
    );

    // Listen for editor file open/close events to auto-refresh the tree view
    // Only use syncBuiltInGroup here to avoid recreating the entire tree when switching tabs
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(() => {
            provider.syncBuiltInGroup();
        })
    );

    // Register all commands
    registerCommands(context, provider, stableMcpPath);

    // Watch for .vscode/virtualTab.json changes
    const configPath = vscode.workspace.workspaceFolders?.[0]
        ? new vscode.RelativePattern(vscode.workspace.workspaceFolders[0], '.vscode/virtualTab.json')
        : null;

    if (configPath) {
        const watcher = vscode.workspace.createFileSystemWatcher(configPath);
        watcher.onDidChange(() => provider.onExternalFileChange());
        watcher.onDidCreate(() => provider.onExternalFileChange());
        watcher.onDidDelete(() => {
            provider.resetToDefault();
            const msg = I18n.getMessage('message.configDeleted') || 'VirtualTabs: Config file deleted. Groups reset to default.';
            vscode.window.showWarningMessage(msg);
        });
        context.subscriptions.push(watcher);
    }
}

/**
 * Deactivate the extension
 */
export function deactivate() { }

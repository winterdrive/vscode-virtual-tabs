import * as vscode from 'vscode';
import { TempFoldersProvider } from './provider';
import { TempFoldersDragAndDropController } from './dragAndDrop';
import { registerCommands } from './commands';
import { I18n } from './i18n';
import { TempFolderItem, TempFileItem, ScopeHeaderItem } from './treeItems';
import { ConfigScope } from './types';
import { revealTreeItemSafely } from './util';


/**
 * 為每個 ConfigScope 建立 FileSystemWatcher，監看 .vscode/virtualTab.json。
 * 回傳 scopeId → watcher 的對應表，以便後續依 scope 個別 dispose。
 */
function setupWatchers(
    scopes: ConfigScope[],
    provider: TempFoldersProvider,
    context: vscode.ExtensionContext
): Map<string, vscode.FileSystemWatcher> {
    const watchers = new Map<string, vscode.FileSystemWatcher>();

    for (const scope of scopes) {
        const pattern = new vscode.RelativePattern(
            vscode.Uri.file(provider.getConfigStorageRoot(scope)),
            '.vscode/virtualTab.json'
        );
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);

        const scopeId = scope.id;

        watcher.onDidChange(() => provider.onExternalFileChange(scopeId));
        watcher.onDidCreate(() => provider.onExternalFileChange(scopeId));
        watcher.onDidDelete(() => {
            provider.resetToDefault(scopeId);
            const msg = I18n.getMessage('message.configDeleted') || 'VirtualTabs: Config file deleted. Groups reset to default.';
            vscode.window.showWarningMessage(msg);
        });

        context.subscriptions.push(watcher);
        watchers.set(scopeId, watcher);
    }

    return watchers;
}

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
    const expandedScopesKey = 'virtualTabs.expandedScopes';
    const expandedScopeIds = context.workspaceState.get<string[]>(expandedScopesKey, []);
    provider.setExpandedScopeIds(expandedScopeIds);
    // 遷移舊的單選 storage key 到新的多選格式
    const legacyActiveScopeKey = 'virtualTabs.activeScope';
    const activeScopesKey = 'virtualTabs.activeScopes';
    const legacyId = context.workspaceState.get<string | undefined>(legacyActiveScopeKey, undefined);
    const storedIds = context.workspaceState.get<string[]>(activeScopesKey, legacyId ? [legacyId] : []);
    provider.setActiveScopeIds(storedIds);
    const dragAndDropController = new TempFoldersDragAndDropController(provider);

    // Create tree view, enable multi-select
    const treeView = vscode.window.createTreeView('virtualTabsView', {
        treeDataProvider: provider,
        dragAndDropController,
        canSelectMany: true
    });
    context.subscriptions.push(treeView);
    treeView.description = provider.computeScopeDescription();

    // Flush any pending debounced save on deactivation so a change made
    // just before VS Code closes isn't lost.
    context.subscriptions.push({ dispose: () => provider.flushPendingSave() });

    // Pass the tree view to the provider for selection management
    provider.setTreeView(treeView);

    const updateExpandedState = (element: vscode.TreeItem, expanded: boolean) => {
        if (element instanceof ScopeHeaderItem) {
            const ids = provider.updateScopeExpanded(element.scope.id, expanded);
            context.workspaceState.update(expandedScopesKey, ids);
            return;
        }

        if (!(element instanceof TempFolderItem)) {
            return;
        }
        const ids = provider.updateGroupExpanded(element.groupId, expanded);
        context.workspaceState.update(expandedKey, ids);
    };

    context.subscriptions.push(
        treeView.onDidExpandElement(e => updateExpandedState(e.element, true)),
        treeView.onDidCollapseElement(e => updateExpandedState(e.element, false))
    );

    // Refresh the view when it becomes visible
    context.subscriptions.push(
        treeView.onDidChangeVisibility(e => {
            if (e.visible) {
                provider.refreshView();
            }
        })
    );

    // Update context key based on selection; also track last selected custom file for keybindings
    let lastSelectedCustomFile: TempFileItem | undefined;
    context.subscriptions.push(
        treeView.onDidChangeSelection(e => {
            const hasFile = e.selection.some(item => item instanceof TempFileItem);
            const customFileItem = e.selection.find((item): item is TempFileItem =>
                item instanceof TempFileItem &&
                !!item.contextValue &&
                item.contextValue.includes('virtualTabsFileCustom')
            );
            if (customFileItem) {
                lastSelectedCustomFile = customFileItem;
            }
            vscode.commands.executeCommand('setContext', 'virtualTabs:hasFileSelected', hasFile);
            vscode.commands.executeCommand('setContext', 'virtualTabs:hasCustomFileSelected', !!customFileItem);
        })
    );


    // Listen for active editor change to auto-reveal file in the Virtual Tabs panel.
    // NOTE: We intentionally do NOT call syncBuiltInGroup() here to avoid triggering
    // a tree data change event (which clears the registry) mid-reveal, causing a race condition.
    // Tab open/close events are handled by tabGroups.onDidChangeTabs below.
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
                    // Non-Expanding Sync: expand: false ensures we don't force open collapsed groups.
                    // It only highlights if the target folder is already expanded by the user.
                    void revealTreeItemSafely(treeView, itemToReveal, { select: true, focus: false, expand: false });
                }
            }, 100);
        })
    );

    // Ensure the debounce timer doesn't fire against a disposed tree view on deactivation
    context.subscriptions.push({
        dispose: () => {
            if (revealTimeout) {
                clearTimeout(revealTimeout);
            }
        }
    });

    // Listen for both tab content changes and editor-group topology changes.
    // Only use syncBuiltInGroup here to avoid recreating the entire tree when switching tabs.
    //
    // Uses tabGroups.onDidChangeTabs rather than onDidChangeVisibleTextEditors:
    // the latter only reflects editors currently visible in a split pane, so it
    // can miss tabs opened in the background or as a preview tab (single-click
    // in Explorer) that don't change the set of *visible* editors — leaving the
    // built-in "Currently Open Files" group stale until a manual refresh.
    // onDidChangeTabs covers open/close/move/pin on every tab, while
    // onDidChangeTabGroups covers split creation/removal and group reordering.
    // The shared callback is snapshot-guarded: a duplicate event with no
    // effective change does not fire another TreeView refresh.
    const syncBuiltInGroup = () => {
        provider.syncBuiltInGroup();
    };
    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs(syncBuiltInGroup),
        vscode.window.tabGroups.onDidChangeTabGroups(syncBuiltInGroup)
    );

    // Register all commands
    registerCommands(context, provider, () => lastSelectedCustomFile, stableMcpPath, treeView);

    // 為每個 ConfigScope 建立 FileSystemWatcher（多 scope 支援）
    const scopeWatchers = setupWatchers(provider.configScopes, provider, context);

    // 監聽工作區資料夾動態變更（新增/移除 folder）
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            // 重新執行 discovery 並更新 provider 的 configScopes
            provider.reinitializeScopes();
            // reinitializeScopes() 會移除已不存在 scope 的 activeScopeIds，
            // 若不重新計算 description，面板標頭會停留在移除前的舊範圍文字。
            treeView.description = provider.computeScopeDescription();
            const currentScopeIds = new Set(provider.configScopes.map(s => s.id));

            // 移除 folder 後其 scope 已不存在，dispose 對應的 watcher 避免資源洩漏
            for (const [scopeId, watcher] of scopeWatchers) {
                if (!currentScopeIds.has(scopeId)) {
                    watcher.dispose();
                    scopeWatchers.delete(scopeId);
                }
            }

            // 為新增的 scope 建立 FileSystemWatcher（避免重複建立已有的）
            const newScopes = provider.configScopes.filter(s => !scopeWatchers.has(s.id));
            if (newScopes.length > 0) {
                const newWatchers = setupWatchers(newScopes, provider, context);
                newWatchers.forEach((watcher, scopeId) => scopeWatchers.set(scopeId, watcher));
            }
        })
    );
}

/**
 * Deactivate the extension
 */
export function deactivate() { }

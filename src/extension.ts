import * as vscode from 'vscode';
import { TempFoldersProvider } from './provider';
import { TempFoldersDragAndDropController } from './dragAndDrop';
import { registerCommands } from './commands';
import { I18n } from './i18n';
import { TempFolderItem, TempFileItem } from './treeItems';

/**
 * Activate the extension
 * @param context Extension context
 */
export async function activate(context: vscode.ExtensionContext) {
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
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor || !editor.document) return;

            const config = vscode.workspace.getConfiguration('virtualTabs');
            if (!config.get<boolean>('autoRevealActiveFile', true)) return;
            if (!treeView.visible) return;

            const activeUri = editor.document.uri;

            // Single-step reveal with expand:true.
            // VS Code will call getParent() to traverse the ancestor chain and expand
            // collapsed nodes automatically, then select the item.
            const itemToReveal = provider.findInternalFileItem(activeUri);

            if (itemToReveal) {
                try {
                    treeView.reveal(itemToReveal, { select: true, focus: false, expand: true });
                } catch (e) {
                    console.error('Tree reveal failed:', e);
                }
            }
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
    registerCommands(context, provider);

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

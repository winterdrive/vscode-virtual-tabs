import * as vscode from 'vscode';
import * as path from 'path';
import { TempFoldersProvider } from './provider';
import { TempFileItem, TempFolderItem, BookmarkItem } from './treeItems';
import { I18n } from './i18n';
import { BookmarkManager } from './core/BookmarkManager';
import { TempGroup } from './types';
import { executeWithConfirmation } from './util';
import { SkillGenerator } from './mcp/SkillGenerator';
import { McpConfigPanel } from './mcp/McpConfigPanel';

// Global clipboard for VirtualTabs items
let globalClipboardItems: (TempFileItem | TempFolderItem)[] = [];

type FileCommandTarget = TempFileItem | vscode.Uri | { resourceUri?: vscode.Uri } | undefined;
type ShellKind = 'powershell' | 'cmd' | 'posix' | 'other';

let execTerminal: vscode.Terminal | undefined;

function getFileUri(target: FileCommandTarget): vscode.Uri | undefined {
    if (!target) {
        return undefined;
    }
    if (target instanceof vscode.Uri) {
        return target;
    }
    if (target instanceof TempFileItem) {
        return target.uri;
    }
    if (typeof target === 'object' && target && 'resourceUri' in target && target.resourceUri instanceof vscode.Uri) {
        return target.resourceUri;
    }
    return undefined;
}

function isExecutableExtension(uri: vscode.Uri): boolean {
    const ext = path.extname(uri.fsPath).toLowerCase();
    return ext === '.bat' || ext === '.exe';
}

function getExecutionCwd(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
        return folder.uri.fsPath;
    }
    const firstFolder = vscode.workspace.workspaceFolders?.[0];
    if (firstFolder) {
        return firstFolder.uri.fsPath;
    }
    return path.dirname(uri.fsPath);
}

function normalizeShellKind(shellId: string): ShellKind {
    switch (shellId) {
        case 'pwsh':
        case 'powershell':
            return 'powershell';
        case 'cmd':
            return 'cmd';
        case 'bash':
        case 'sh':
        case 'zsh':
        case 'fish':
        case 'gitbash':
        case 'ksh':
        case 'csh':
        case 'wsl':
            return 'posix';
        default:
            return 'other';
    }
}

function detectShellKindFromPath(shellPath?: string): ShellKind {
    if (!shellPath) {
        return 'other';
    }
    const name = path.basename(shellPath).toLowerCase();
    if (name.includes('pwsh') || name.includes('powershell')) {
        return 'powershell';
    }
    if (name === 'cmd.exe' || name === 'cmd') {
        return 'cmd';
    }
    if (name.includes('bash') || name.includes('zsh') || name.includes('sh') || name.includes('fish')) {
        return 'posix';
    }
    return 'other';
}

function getShellKind(terminal?: vscode.Terminal): ShellKind {
    if (terminal?.state?.shell) {
        return normalizeShellKind(terminal.state.shell);
    }
    return detectShellKindFromPath(vscode.env.shell);
}

/**
 * Shell Command Quoting Functions
 * 
 * IMPLEMENTATION NOTE:
 * These functions manually construct shell command strings with proper quoting for different shells.
 * 
 * VS Code Native Approach:
 * - VS Code's built-in run buttons use `vscode.ShellExecution(command, args[])` 
 * - Arguments are passed as an array, avoiding string concatenation
 * - VS Code handles shell-specific quoting automatically via `vscode.ShellQuotedString`
 * 
 * Our Current Implementation:
 * - Manual string construction with shell-specific quoting rules
 * - Simpler and more direct for our use case (executing local workspace files)
 * - Adequate for paths within user's trusted workspace
 * 
 * Risk Assessment:
 * - Security risk: LOW (user can only execute files they already control in their workspace)
 * - Maintenance risk: MEDIUM (manual quoting requires shell-specific knowledge)
 * 
 * Future Consideration:
 * If we need to support user-provided arguments (not just file paths), consider migrating to:
 * ```typescript
 * const execution = new vscode.ShellExecution(filePath, [], { cwd });
 * const terminal = vscode.window.createTerminal({ shellPath, shellArgs });
 * terminal.sendText(execution.commandLine);
 * ```
 */

function quoteCmd(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

function quotePowerShell(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function quotePosix(value: string): string {
    if (!value) {
        return "''";
    }
    return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildExecutionCommand(filePath: string, cwd: string, shellKind: ShellKind): string {
    switch (shellKind) {
        case 'cmd':
            return `cd /d ${quoteCmd(cwd)} & ${quoteCmd(filePath)}`;
        case 'powershell':
            return `Set-Location -Path ${quotePowerShell(cwd)}; & ${quotePowerShell(filePath)}`;
        case 'posix':
            return `cd ${quotePosix(cwd)}; ${quotePosix(filePath)}`;
        default:
            return `cd ${quotePosix(cwd)}; ${quotePosix(filePath)}`;
    }
}

function getExecTerminal(cwd: string): vscode.Terminal {
    if (execTerminal) {
        return execTerminal;
    }
    execTerminal = vscode.window.createTerminal({
        name: 'Virtual Tabs Run',
        cwd
    });
    return execTerminal;
}

async function runFileInTerminal(uri: vscode.Uri): Promise<void> {
    const cwd = getExecutionCwd(uri);
    const terminal = getExecTerminal(cwd);
    const shellKind = getShellKind(terminal);
    const commandLine = buildExecutionCommand(uri.fsPath, cwd, shellKind);

    terminal.show(true);
    if (terminal.shellIntegration) {
        terminal.shellIntegration.executeCommand(commandLine);
    } else {
        terminal.sendText(commandLine, true);
    }
}

async function openFileInEditor(uri: vscode.Uri): Promise<void> {
    await vscode.commands.executeCommand('vscode.open', uri);
}

async function openFileDefault(uri: vscode.Uri): Promise<void> {
    if (isExecutableExtension(uri)) {
        await runFileInTerminal(uri);
        return;
    }
    await openFileInEditor(uri);
}

/**
 * Get all files from a group and its child groups (recursive)
 */
function getAllFilesInGroupRecursive(groups: TempGroup[], groupId: string): string[] {
    const allFiles: string[] = [];

    const collectFiles = (gId: string) => {
        const group = groups.find(g => g.id === gId);
        if (group && group.files) {
            allFiles.push(...group.files);
        }
        // Find child groups
        const children = groups.filter(g => g.parentGroupId === gId);
        for (const child of children) {
            collectFiles(child.id);
        }
    };

    collectFiles(groupId);
    return allFiles;
}

/**
 * Resolve target items with consistent priority logic
 * Priority 1: Use selected items from provider if available
 * Priority 2: Use right-clicked item if no selection
 * 
 * This helper eliminates DRY violations across multiple commands.
 */
function resolveTargetItems<T extends TempFileItem>(
    item: T | undefined,
    provider: TempFoldersProvider
): T[] {
    // Priority 1: Use selected items if available
    const selectedItems = provider.getSelectedFileItems() as T[];
    if (selectedItems.length > 0) {
        return selectedItems;
    }

    // Priority 2: Use right-clicked item if no selection
    if (item instanceof TempFileItem) {
        return [item as T];
    }

    return [];
}

function resolveGroupItem(
    item: TempFolderItem | undefined,
    provider: TempFoldersProvider
): TempFolderItem | undefined {
    if (item instanceof TempFolderItem) {
        return item;
    }

    const selection = provider.getSelection();
    if (selection.length === 1 && selection[0] instanceof TempFolderItem) {
        return selection[0];
    }

    return undefined;
}

// VirtualTabs command registration
export function registerCommands(context: vscode.ExtensionContext, provider: TempFoldersProvider, stableMcpPath?: string): void {
    // Run executable file in terminal (explicit action via inline button)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.runFile', async (target?: FileCommandTarget) => {
        const uri = getFileUri(target);
        if (!uri) {
            return;
        }
        await runFileInTerminal(uri);
    }));

    context.subscriptions.push(vscode.window.onDidCloseTerminal((terminal) => {
        if (terminal === execTerminal) {
            execTerminal = undefined;
        }
    }));

    // Register add group command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.addGroup', () => {
        provider.addGroup();
    }));

    // Register generate agent skill command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.generateAgentSkill', async () => {
        await SkillGenerator.generateSkill(context);
    }));

    // Register show MCP Config
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.showMcpConfig', () => {
        McpConfigPanel.show(context.extensionUri, stableMcpPath);
    }));

    // Register add sub-group command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.addSubGroup', (item: TempFolderItem) => {
        if (item && item.groupId) {
            provider.addSubGroup(item.groupId);
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.moveGroupUp', (item: TempFolderItem) => {
        if (item && item.groupId) {
            provider.moveGroup(item.groupId, 'up');
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.moveGroupDown', (item: TempFolderItem) => {
        if (item && item.groupId) {
            provider.moveGroup(item.groupId, 'down');
        }
    }));

    // Register remove group command (supports multi-select)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.removeGroup', async (item: TempFolderItem, selectedItems?: TempFolderItem[]) => {
        // Check if multiple groups are selected
        const itemsToRemove: TempFolderItem[] = [];

        if (selectedItems && selectedItems.length > 1) {
            // Multi-select: use all selected items
            itemsToRemove.push(...selectedItems.filter(i => i instanceof TempFolderItem));
        } else if (item instanceof TempFolderItem) {
            // Single select
            itemsToRemove.push(item);
        }

        if (itemsToRemove.length === 0) return;


        const executeDelete = () => {
            for (const groupItem of itemsToRemove) {
                provider.removeGroupById(groupItem.groupId);
            }
        };

        const groupLabel = typeof itemsToRemove[0].label === 'string'
            ? itemsToRemove[0].label
            : (itemsToRemove[0].label?.label || '');

        const message = itemsToRemove.length > 1
            ? I18n.getMessage('confirm.deleteGroups', itemsToRemove.length.toString())
            : I18n.getMessage('confirm.deleteGroup', groupLabel);

        await executeWithConfirmation(
            message,
            I18n.getMessage('confirm.delete'),
            executeDelete
        );

    }));

    // Delete file command (moves to trash/recycle bin)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.deleteFile', async (item: TempFileItem) => {
        if (!(item instanceof TempFileItem)) {
            return;
        }

        const fileName = path.basename(item.uri.fsPath);
        const config = vscode.workspace.getConfiguration('virtualTabs');
        const confirmBeforeDelete = config.get<boolean>('confirmBeforeDelete', true);

        let shouldDelete = true;

        if (confirmBeforeDelete) {
            const moveToTrashLabel = I18n.getMessage('confirm.moveToTrash');
            const confirm = await vscode.window.showWarningMessage(
                I18n.getMessage('confirm.deleteFromDisk', fileName),
                { modal: true },
                moveToTrashLabel
            );
            shouldDelete = (confirm === moveToTrashLabel);
        }

        if (shouldDelete) {
            try {
                await vscode.workspace.fs.delete(item.uri, {
                    recursive: false,
                    useTrash: true
                });

                // Auto-remove from TreeView (no additional confirmation needed)
                provider.removeFilesFromGroup(item.groupIdx, [item]);

                vscode.window.showInformationMessage(I18n.getMessage('message.fileDeleted', fileName));
                // refresh() is called inside removeFilesFromGroup
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(I18n.getMessage('error.deleteFileFailed', fileName, errorMsg));
            }
        }
    }));


    // Register auto group by extension command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.autoGroupByExt', () => {
        provider.addAutoGroupsByExt();
    }));

    // One-click open group command (only for custom groups)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.openAllFiles', async (item: TempFolderItem) => {
        if (typeof item?.groupIdx === 'number') {
            // Check if it is a built-in group, if so, do not execute
            const group = provider.groups[item.groupIdx];
            if (group?.builtIn) {
                vscode.window.showInformationMessage(I18n.getMessage('message.builtInGroupNotSupported'));
                return;
            }
            await provider.openAllFilesInGroup(item.groupIdx);
        }
    }));

    // One-click close group command (only for custom groups)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.closeAllFiles', async (item: TempFolderItem) => {
        if (typeof item?.groupIdx === 'number') {
            // Check if it is a built-in group, if so, do not execute
            const group = provider.groups[item.groupIdx];
            if (group?.builtIn) {
                vscode.window.showInformationMessage(I18n.getMessage('message.builtInGroupNotSupported'));
                return;
            }
            await provider.closeAllFilesInGroup(item.groupIdx);
        }
    }));

    // Group duplication
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.duplicateGroup', (item: TempFolderItem) => {
        if (typeof item?.groupIdx !== 'number') return;
        const group = provider.groups[item.groupIdx];
        if (!group || group.builtIn) return;

        // Generate new name
        let base = group.name.replace(/\s*Copy( \d+)?$/, '');
        let idx = 1;
        let newName = I18n.getCopyGroupName(base);
        while (provider.groups.some(g => g.name === newName)) {
            idx++;
            newName = I18n.getCopyGroupName(base, idx);
        }

        // Duplicate group
        provider.groups.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            name: newName,
            files: group.files ? [...group.files] : []
        });
        provider.refresh();
    }));

    // Group rename
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.renameGroup', async (item: TempFolderItem) => {
        const target = resolveGroupItem(item, provider);
        if (typeof target?.groupIdx !== 'number') {
            vscode.window.showInformationMessage(I18n.getMessage('message.pleaseSelectGroup'));
            return;
        }
        const group = provider.groups[target.groupIdx];
        if (!group || group.builtIn) return;

        const newName = await vscode.window.showInputBox({
            prompt: I18n.getMessage('input.groupNamePrompt'),
            value: group.name,
            validateInput: (val) => {
                if (!val.trim()) return I18n.getMessage('input.groupNameError.empty');
                return null;
            }
        });

        if (newName && newName !== group.name) {
            group.name = newName;
            provider.refresh();
        }
    }));

    // File right-click "delete" is changed to remove from group
    context.subscriptions.push(vscode.commands.registerCommand('deleteFile', async (item: TempFileItem, selectedItems?: TempFileItem[]) => {
        // Handle calls from browser or file explorer, forward to original command
        if (!(item instanceof TempFileItem)) {
            vscode.commands.executeCommand('workbench.action.files.delete');
            return;
        }

        // Check if multiple files are selected
        const allSelectedItems = provider.getSelectedFileItems();
        const filesToRemove = allSelectedItems.length > 1 ? allSelectedItems : [item];


        const executeDelete = () => {
            if (filesToRemove.length > 1) {
                provider.removeFilesFromGroup(item.groupIdx, filesToRemove);
            } else {
                const group = provider.groups[item.groupIdx];
                if (!group || !group.files) return;
                group.files = group.files.filter(uri => uri !== item.uri.toString());
                provider.refresh();
            }
        };

        const message = filesToRemove.length > 1
            ? I18n.getMessage('confirm.deleteFiles', filesToRemove.length.toString())
            : I18n.getMessage('confirm.deleteFile', vscode.workspace.asRelativePath(item.uri));

        await executeWithConfirmation(
            message,
            I18n.getMessage('confirm.delete'),
            executeDelete
        );

    }));


    // Handle opening multiple selected files (or right-clicked file)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.openSelectedFiles', async (item?: TempFileItem) => {
        const filesToOpen = resolveTargetItems(item, provider);
        if (filesToOpen.length === 0) return;
        await provider.openSelectedFiles(filesToOpen);
    }));

    // Handle closing multiple selected files (or right-clicked file)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.closeSelectedFiles', async (item?: TempFileItem) => {
        const filesToClose = resolveTargetItems(item, provider);
        if (filesToClose.length === 0) return;
        await provider.closeSelectedFiles(filesToClose);
    }));

    // Handle closing a single file (inline action)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.closeFile', async (item: TempFileItem) => {
        if (item instanceof TempFileItem) {
            await provider.closeFile(item);
        }
    }));
    // Handle removing multiple selected files from group (or right-clicked file)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.removeSelectedFilesFromGroup', (item?: TempFileItem) => {
        const filesToRemove = resolveTargetItems(item, provider);
        if (filesToRemove.length === 0) return;

        // Use the group index from the first file item
        const fileItem = filesToRemove[0];
        provider.removeFilesFromGroup(fileItem.groupIdx, filesToRemove);
    }));

    // Group context menu "Add selected files to group"
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.addSelectedFilesToGroup', (item: TempFolderItem) => {
        if (typeof item?.groupIdx !== 'number') return;

        const selectedItems = provider.getSelectedFileItems();
        if (selectedItems.length === 0) return;

        provider.addMultipleFilesToGroup(item.groupIdx, selectedItems);
    }));

    // Copy name command (copies only the name, no recursion)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.copyName', async (item: TempFileItem | TempFolderItem | BookmarkItem) => {
        let name = '';

        if (item instanceof TempFileItem) {
            // For files: copy file name only
            name = path.basename(item.uri.fsPath);
        } else if (item instanceof BookmarkItem) {
            // For bookmarks: copy file name only
            name = path.basename(item.fileUri.fsPath);
        } else if (item && 'groupIdx' in item && typeof item.groupIdx === 'number') {
            // For groups: copy group name only (no recursion)
            const group = provider.groups[item.groupIdx];
            if (group && group.name) {
                name = group.name;
            }
        }

        if (name) {
            await vscode.env.clipboard.writeText(name);
            vscode.window.showInformationMessage(I18n.getMessage('message.nameCopied', name));
        } else {
            vscode.window.showInformationMessage(I18n.getMessage('message.noNameToCopy'));
        }
    }));


    // Copy file name command (works for both files and groups, supports multi-select)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.copyFileName', async (item: TempFileItem | TempFolderItem, selectedItems?: (TempFileItem | TempFolderItem)[]) => {
        let itemsToProcess: (TempFileItem | TempFolderItem)[] = [];

        if (selectedItems && Array.isArray(selectedItems) && selectedItems.length > 0) {
            itemsToProcess = selectedItems;
        } else if (item) {
            itemsToProcess = [item];
        }

        if (itemsToProcess.length === 0) return;

        const results = new Set<string>();

        const processItem = (i: TempFileItem | TempFolderItem) => {
            if (i instanceof TempFileItem) {
                results.add(path.basename(i.uri.fsPath));
            } else if (i && 'groupIdx' in i && typeof i.groupIdx === 'number') {
                const group = provider.groups[i.groupIdx];
                if (group && group.id) {
                    const allFiles = getAllFilesInGroupRecursive(provider.groups, group.id);
                    allFiles.forEach(uriStr => {
                        try {
                            const uri = vscode.Uri.parse(uriStr);
                            results.add(path.basename(uri.fsPath));
                        } catch { }
                    });
                }
            }
        };

        itemsToProcess.forEach(processItem);

        if (results.size === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('message.noFilesToCopy'));
            return;
        }

        const text = Array.from(results).join('\n');
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(I18n.getMessage('message.copiedFileNames', results.size.toString()));
    }));

    // Copy relative path command (works for both files and groups, supports multi-select)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.copyRelativePath', async (item: TempFileItem | TempFolderItem, selectedItems?: (TempFileItem | TempFolderItem)[]) => {
        let itemsToProcess: (TempFileItem | TempFolderItem)[] = [];

        if (selectedItems && Array.isArray(selectedItems) && selectedItems.length > 0) {
            itemsToProcess = selectedItems;
        } else if (item) {
            itemsToProcess = [item];
        }

        if (itemsToProcess.length === 0) return;

        const results = new Set<string>();

        const processItem = (i: TempFileItem | TempFolderItem) => {
            if (i instanceof TempFileItem) {
                results.add(vscode.workspace.asRelativePath(i.uri));
            } else if (i && 'groupIdx' in i && typeof i.groupIdx === 'number') {
                const group = provider.groups[i.groupIdx];
                if (group && group.id) {
                    const allFiles = getAllFilesInGroupRecursive(provider.groups, group.id);
                    allFiles.forEach(uriStr => {
                        try {
                            const uri = vscode.Uri.parse(uriStr);
                            results.add(vscode.workspace.asRelativePath(uri));
                        } catch { }
                    });
                }
            }
        };

        itemsToProcess.forEach(processItem);

        if (results.size === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('message.noFilesToCopy'));
            return;
        }

        const text = Array.from(results).join('\n');
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(I18n.getMessage('message.copiedRelativePaths', results.size.toString()));
    }));

    // Copy absolute path command (works for both files and groups, supports multi-select)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.copyAbsolutePath', async (item: TempFileItem | TempFolderItem, selectedItems?: (TempFileItem | TempFolderItem)[]) => {
        let itemsToProcess: (TempFileItem | TempFolderItem)[] = [];

        if (selectedItems && Array.isArray(selectedItems) && selectedItems.length > 0) {
            itemsToProcess = selectedItems;
        } else if (item) {
            itemsToProcess = [item];
        }

        if (itemsToProcess.length === 0) return;

        const results = new Set<string>();

        const processItem = (i: TempFileItem | TempFolderItem) => {
            if (i instanceof TempFileItem) {
                results.add(i.uri.fsPath);
            } else if (i && 'groupIdx' in i && typeof i.groupIdx === 'number') {
                const group = provider.groups[i.groupIdx];
                if (group && group.id) {
                    const allFiles = getAllFilesInGroupRecursive(provider.groups, group.id);
                    allFiles.forEach(uriStr => {
                        try {
                            const uri = vscode.Uri.parse(uriStr);
                            results.add(uri.fsPath);
                        } catch { }
                    });
                }
            }
        };

        itemsToProcess.forEach(processItem);

        if (results.size === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('message.noFilesToCopy'));
            return;
        }

        const text = Array.from(results).join('\n');
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage(I18n.getMessage('message.copiedAbsolutePaths', results.size.toString()));
    }));

    // Duplicate built-in group
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.duplicateBuiltInGroup', (item: TempFolderItem) => {
        if (typeof item?.groupIdx !== 'number') return;
        const group = provider.groups[item.groupIdx];
        if (!group || !group.builtIn) return;

        // Generate new name
        let base = I18n.getBuiltInGroupName();
        let idx = 1;
        let newName = I18n.getCopyGroupName(base);
        while (provider.groups.some(g => g.name === newName)) {
            idx++;
            newName = I18n.getCopyGroupName(base, idx);
        }

        provider.groups.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            name: newName,
            files: group.files ? [...group.files] : []
        });
        provider.refresh();
    }));

    // Refresh built-in group
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.refreshBuiltInGroup', (item: TempFolderItem) => {
        if (typeof item?.groupIdx !== 'number') return;
        const group = provider.groups[item.groupIdx];
        if (!group || !group.builtIn) return;
        provider.refresh();
    }));

    // Remove single file from group
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.removeFileFromGroup', async (item: TempFileItem, selectedItems?: TempFileItem[]) => {
        const filesToRemove = (selectedItems && Array.isArray(selectedItems) && selectedItems.length > 0)
            ? selectedItems
            : (item ? [item] : []);

        if (filesToRemove.length === 0) return;


        const executeRemove = () => {
            let hasChanges = false;

            for (const fileItem of filesToRemove) {
                if (!(fileItem instanceof TempFileItem)) continue;

                const groupIdx = fileItem.groupIdx;
                const group = provider.groups[groupIdx];

                if (group && group.files) {
                    const fileUri = fileItem.uri.toString();
                    const originalLength = group.files.length;
                    group.files = group.files.filter(uri => uri !== fileUri);

                    if (group.files.length < originalLength) {
                        hasChanges = true;
                        // Remove associated bookmarks
                        if (group.bookmarks && group.bookmarks[fileUri]) {
                            delete group.bookmarks[fileUri];
                            if (Object.keys(group.bookmarks).length === 0) {
                                delete group.bookmarks;
                            }
                        }
                    }
                }
            }

            if (hasChanges) {
                provider.refresh();
            }
        };

        const message = filesToRemove.length > 1
            ? I18n.getMessage('confirm.removeFiles', filesToRemove.length.toString())
            : I18n.getMessage('confirm.removeFile', vscode.workspace.asRelativePath(filesToRemove[0].uri));

        await executeWithConfirmation(
            message,
            I18n.getMessage('confirm.remove'),
            executeRemove
        );

    }));

    // Generic Delete Command (for Delete key)
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.delete', (item?: TempFileItem | TempFolderItem, selectedItems?: (TempFileItem | TempFolderItem)[]) => {
        let selection: (TempFileItem | TempFolderItem)[] = [];

        // Priority: selectedItems > item > provider.getSelection()
        if (selectedItems && selectedItems.length > 0) {
            selection = selectedItems;
        } else if (item) {
            selection = [item];
        } else {
            selection = provider.getSelection() as (TempFileItem | TempFolderItem)[];
        }

        if (selection.length === 0) {
            return;
        }

        // Categorize items
        const filesToRemove = selection.filter(i => i instanceof TempFileItem) as TempFileItem[];
        const groupsToRemove = selection.filter(i => i instanceof TempFolderItem) as TempFolderItem[];

        // 1. Remove files
        if (filesToRemove.length > 0) {
            vscode.commands.executeCommand('virtualTabs.removeFileFromGroup', filesToRemove[0], filesToRemove);
        }

        // 2. Remove groups
        if (groupsToRemove.length > 0) {
            vscode.commands.executeCommand('virtualTabs.removeGroup', groupsToRemove[0], groupsToRemove);
        }
    }));

    // Copy Command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.copy', async (item: TempFileItem | TempFolderItem | undefined, selectedItems?: (TempFileItem | TempFolderItem)[]) => {
        let itemsToCopy: (TempFileItem | TempFolderItem)[] = [];

        if (selectedItems && Array.isArray(selectedItems) && selectedItems.length > 0) {
            itemsToCopy = selectedItems;
        } else if (item) {
            itemsToCopy = [item];
        } else {
            // Keybinding case: get from provider
            const selection = provider.getSelection();
            if (selection.length > 0) {
                itemsToCopy = selection.filter(i => i instanceof TempFileItem || i instanceof TempFolderItem) as (TempFileItem | TempFolderItem)[];
            }
        }

        if (itemsToCopy.length === 0) {
            return;
        }

        // 1. Update internal clipboard
        globalClipboardItems = [...itemsToCopy];

        // 2. Update system clipboard (text/plain)
        const textToCopy = itemsToCopy
            .map(i => {
                if (i instanceof TempFileItem) return i.uri.fsPath; // Absolute path
                if (i instanceof TempFolderItem) return `[Group] ${i.label}`;
                return '';
            })
            .filter(Boolean)
            .join('\n');

        await vscode.env.clipboard.writeText(textToCopy);
        vscode.window.setStatusBarMessage(`✓ ${I18n.getMessage('message.copiedItems', itemsToCopy.length.toString())}`, 3000);
    }));

    // Paste Command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.paste', (target: TempFolderItem | TempFileItem | undefined) => {
        let actualTarget = target;

        // Handle keybinding invocation
        if (!actualTarget) {
            const selection = provider.getSelection();
            if (selection.length > 0) {
                const first = selection[0];
                if (first instanceof TempFolderItem || first instanceof TempFileItem) {
                    actualTarget = first;
                }
            }
        }

        if (!actualTarget) {
            return;
        }

        let targetGroupIdx: number | undefined;

        if (actualTarget instanceof TempFolderItem) {
            targetGroupIdx = actualTarget.groupIdx;
        } else if (actualTarget instanceof TempFileItem) {
            targetGroupIdx = actualTarget.groupIdx;
        }

        if (targetGroupIdx === undefined) {
            return;
        }

        if (globalClipboardItems.length === 0) {
            return;
        }

        const group = provider.groups[targetGroupIdx];
        if (!group) {
            return;
        }

        // Process items
        const urisToAdd = globalClipboardItems
            .filter(i => i instanceof TempFileItem)
            .map(i => (i as TempFileItem).uri.toString());

        if (urisToAdd.length > 0) {
            if (!group.files) group.files = [];
            let addedCount = 0;
            for (const uri of urisToAdd) {
                if (!group.files.includes(uri)) {
                    group.files.push(uri);
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                provider.refresh();
                vscode.window.setStatusBarMessage(`✓ ${I18n.getMessage('message.pastedItems', addedCount.toString())}`, 3000);
            }
        }
    }));

    // Sort by name command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.sortByName', (item: TempFolderItem) => {
        if (typeof item?.groupIdx === 'number') {
            provider.setSortPreference(item.groupIdx, 'name', 'asc');
        }
    }));

    // Sort by path command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.sortByPath', (item: TempFolderItem) => {
        if (typeof item?.groupIdx === 'number') {
            provider.setSortPreference(item.groupIdx, 'path', 'asc');
        }
    }));

    // Sort by extension command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.sortByExtension', (item: TempFolderItem) => {
        if (typeof item?.groupIdx === 'number') {
            provider.setSortPreference(item.groupIdx, 'extension', 'asc');
        }
    }));

    // Sort by modified time command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.sortByModified', (item: TempFolderItem) => {
        if (typeof item?.groupIdx === 'number') {
            provider.setSortPreference(item.groupIdx, 'modified', 'asc');
        }
    }));

    // Toggle sort order command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.toggleSortOrder', (item: TempFolderItem) => {
        if (typeof item?.groupIdx === 'number') {
            const group = provider.groups[item.groupIdx];
            if (group && group.sortBy && group.sortBy !== 'none') {
                const newOrder = group.sortOrder === 'asc' ? 'desc' : 'asc';
                provider.setSortPreference(item.groupIdx, group.sortBy, newOrder);
            }
        }
    }));

    // Clear sorting command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.clearSort', (item: TempFolderItem) => {
        if (typeof item?.groupIdx === 'number') {
            provider.setSortPreference(item.groupIdx, 'none', 'asc');
        }
    }));

    // Auto group by modified date command
    context.subscriptions.push(vscode.commands.registerCommand('virtualTabs.autoGroupByModifiedDate', () => {
        provider.autoGroupByModifiedDate();
    }));

    // ========== Bookmark Commands (v0.2.0) ==========

    // Add bookmark to group (Smart Flow)
    context.subscriptions.push(
        vscode.commands.registerCommand('virtualTabs.addBookmark', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage(I18n.getMessage('bookmark.noActiveEditor'));
                return;
            }

            const fileUri = editor.document.uri.toString();
            const position = editor.selection.active;

            // 1. Smart Labeling: Line {n} ({code snippet})
            const lineContent = editor.document.lineAt(position.line).text.trim();
            let snippet = lineContent;
            if (snippet.length > 20) {
                snippet = snippet.substring(0, 20) + '...';
            }

            let label = `Line ${position.line + 1}`;
            if (snippet) {
                label += ` (${snippet})`;
            }

            // 2. Smart Grouping
            const customGroups = provider.groups.filter(g => !g.builtIn);

            // Scenario: No custom groups available
            if (customGroups.length === 0) {
                const createGroupLabel = I18n.getMessage('bookmark.createGroup');
                const selection = await vscode.window.showInformationMessage(
                    I18n.getMessage('bookmark.noGroupsCreatePrompt'),
                    createGroupLabel
                );

                if (selection === createGroupLabel) {
                    await provider.addGroup();
                    // After creating, we could try to continue, but simpler to ask user to try again
                    // or we could auto-select the new group. Let's just return for now to keep it simple.
                }
                return;
            }

            // Find groups containing this file
            const containingGroups = customGroups.filter(g => g.files?.includes(fileUri));

            let targetGroup;

            if (containingGroups.length === 1) {
                // Scenario A: File belongs to exactly one group -> Auto pick
                targetGroup = containingGroups[0];
            } else if (containingGroups.length > 1) {
                // Scenario B: File belongs to multiple groups -> Ask user
                const groupItems = containingGroups.map(g => ({
                    label: g.name,
                    group: g
                }));
                const selected = await vscode.window.showQuickPick(groupItems, {
                    placeHolder: I18n.getMessage('bookmark.selectGroup')
                });
                if (!selected) return;
                targetGroup = selected.group;
            } else {
                // Scenario C: File not in any group -> Ask user to pick any group
                const groupItems = customGroups.map(g => ({
                    label: g.name,
                    group: g
                }));
                const selected = await vscode.window.showQuickPick(groupItems, {
                    placeHolder: I18n.getMessage('bookmark.selectGroup')
                });
                if (!selected) return;
                targetGroup = selected.group;

                // Add file to group automatically
                if (!targetGroup.files) targetGroup.files = [];
                targetGroup.files.push(fileUri);
            }

            // 3. Create Bookmark (No Input Box!)
            const bookmark = BookmarkManager.createBookmarkObject(
                position.line,
                label,
                position.character,
                '' // Description empty by default
            );

            BookmarkManager.addBookmarkToGroup(targetGroup, fileUri, bookmark);
            provider.refresh();

            // Subtle feedback
            vscode.window.setStatusBarMessage(`\u2713 ${I18n.getMessage('bookmark.addedToGroup', targetGroup.name)}`, 3000);
        })
    );

    // Jump to bookmark
    context.subscriptions.push(
        vscode.commands.registerCommand('virtualTabs.jumpToBookmark', async (item: BookmarkItem) => {
            if (!(item instanceof BookmarkItem)) {
                return;
            }

            try {
                const document = await vscode.workspace.openTextDocument(item.fileUri);
                const editor = await vscode.window.showTextDocument(document);

                const position = new vscode.Position(
                    item.bookmark.line,
                    item.bookmark.character || 0
                );

                const range = new vscode.Range(position, position);

                // Jump and scroll to center
                editor.selection = new vscode.Selection(position, position);
                editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

                // Removed highlight logic based on user feedback

            } catch (error) {
                vscode.window.showErrorMessage(
                    I18n.getMessage('bookmark.jumpFailed', String(error))
                );
            }
        })
    );

    // Edit bookmark label
    context.subscriptions.push(
        vscode.commands.registerCommand('virtualTabs.editBookmarkLabel', async (item: BookmarkItem) => {
            if (!(item instanceof BookmarkItem)) {
                return;
            }

            const newLabel = await vscode.window.showInputBox({
                prompt: I18n.getMessage('bookmark.editLabel'),
                value: item.bookmark.label,
                validateInput: (value) => {
                    if (!value.trim()) {
                        return I18n.getMessage('bookmark.labelRequired');
                    }
                    return null;
                }
            });

            if (!newLabel || newLabel === item.bookmark.label) {
                return;
            }

            const group = provider.groups[item.groupIdx];
            const updatedBookmark = BookmarkManager.updateLabel(item.bookmark, newLabel);

            BookmarkManager.updateBookmarkInGroup(
                group,
                item.fileUri.toString(),
                item.bookmark.id,
                updatedBookmark
            );

            provider.refresh();
            vscode.window.showInformationMessage(
                I18n.getMessage('bookmark.labelUpdated', newLabel)
            );
        })
    );

    // Edit bookmark description
    context.subscriptions.push(
        vscode.commands.registerCommand('virtualTabs.editBookmarkDescription', async (item: BookmarkItem) => {
            if (!(item instanceof BookmarkItem)) {
                return;
            }

            const newDescription = await vscode.window.showInputBox({
                prompt: I18n.getMessage('bookmark.editDescription'),
                value: item.bookmark.description || '',
                placeHolder: I18n.getMessage('bookmark.descriptionPlaceholder')
            });

            if (newDescription === undefined) {
                return; // User cancelled
            }

            const group = provider.groups[item.groupIdx];
            const updatedBookmark = BookmarkManager.updateDescription(
                item.bookmark,
                newDescription || undefined
            );

            BookmarkManager.updateBookmarkInGroup(
                group,
                item.fileUri.toString(),
                item.bookmark.id,
                updatedBookmark
            );

            provider.refresh();
            vscode.window.showInformationMessage(
                I18n.getMessage('bookmark.descriptionUpdated')
            );
        })
    );

    // Remove bookmark
    context.subscriptions.push(
        vscode.commands.registerCommand('virtualTabs.removeBookmark', async (item: BookmarkItem) => {
            if (!(item instanceof BookmarkItem)) {
                return;
            }

            const group = provider.groups[item.groupIdx];
            const removed = BookmarkManager.removeBookmarkFromGroup(
                group,
                item.fileUri.toString(),
                item.bookmark.id
            );

            if (removed) {
                provider.refresh();
                vscode.window.setStatusBarMessage(`\u2713 ${I18n.getMessage('bookmark.removedStatus')}`, 3000);
            }
        })
    );


    // AI Context: Copy Group Context (works for both groups and files)
    context.subscriptions.push(
        vscode.commands.registerCommand('virtualTabs.copyGroupContext', async (item: TempFolderItem | TempFileItem | BookmarkItem | undefined, selectedItems?: (TempFolderItem | TempFileItem | BookmarkItem)[]) => {
            // Map to track files and their group names: Map<FileUriString, Set<GroupName>>
            const filesToProcessMap = new Map<string, Set<string>>();
            // Map to track bookmarks: Map<FileUriString, BookmarkItem[]>
            const bookmarksToProcessMap = new Map<string, BookmarkItem[]>();

            let contextTitle = '';
            let itemsToProcess: (TempFolderItem | TempFileItem | BookmarkItem)[] = [];

            // Type guards using instanceof (safer than duck typing)
            const isBookmarkItem = (i: unknown): i is BookmarkItem => i instanceof BookmarkItem;
            const isFileItem = (i: unknown): i is TempFileItem => i instanceof TempFileItem;
            const isFolderItem = (i: unknown): i is TempFolderItem => i instanceof TempFolderItem;

            // 1. Determine items to process (Prioritize selection)
            if (selectedItems && Array.isArray(selectedItems) && selectedItems.length > 0) {
                itemsToProcess = selectedItems;
                contextTitle = `Context from ${itemsToProcess.length} selected items`;
            } else if (item) {
                itemsToProcess = [item];
                // Set initial title based on single item
                if (isFolderItem(item)) {
                    const group = provider.groups[item.groupIdx];
                    contextTitle = `Context from Group: ${group?.name}`;
                } else if (isFileItem(item)) {
                    contextTitle = `Context from File: ${vscode.workspace.asRelativePath(item.uri)}`;
                } else if (isBookmarkItem(item)) {
                    contextTitle = `Context from Bookmark: ${item.label}`;
                }
            } else {
                // Try getting from provider selection as last resort
                const selection = provider.getSelection();
                if (selection.length > 0) {
                    itemsToProcess = selection.filter(i => isFileItem(i) || isFolderItem(i) || isBookmarkItem(i)) as (TempFolderItem | TempFileItem | BookmarkItem)[];
                    contextTitle = `Context from ${itemsToProcess.length} selected items`;
                }
            }

            if (itemsToProcess.length === 0) {
                vscode.window.showWarningMessage(I18n.getMessage('message.pleaseSelectItem'));
                return;
            }

            // 2. Collect all files and track their groups

            // Helper to get full group path with cycle detection
            const MAX_GROUP_DEPTH = 50; // Maximum allowed nesting depth
            const getGroupPath = (groupId: string): string => {
                const group = provider.groups.find(g => g.id === groupId);
                if (!group) return '';

                const visited = new Set<string>(); // Track visited groups for cycle detection
                let pathStr = group.name;
                let current = group;

                visited.add(current.id);

                while (current.parentGroupId) {
                    // Cycle detection: check if we've seen this parent before
                    if (visited.has(current.parentGroupId)) {
                        console.warn(`[VirtualTabs] Circular group reference detected: ${current.parentGroupId}`);
                        pathStr += ' [CYCLE DETECTED]';
                        break;
                    }

                    // Depth limit check (safety fallback)
                    if (visited.size >= MAX_GROUP_DEPTH) {
                        console.warn(`[VirtualTabs] Group nesting exceeds maximum depth of ${MAX_GROUP_DEPTH}`);
                        pathStr += ' [MAX DEPTH]';
                        break;
                    }

                    const parent = provider.groups.find(g => g.id === current.parentGroupId);
                    if (!parent) {
                        break;
                    }

                    pathStr = `${parent.name} / ${pathStr}`;
                    current = parent;
                    visited.add(current.id);
                }

                return pathStr;
            };

            for (const currentItem of itemsToProcess) {
                if (isFolderItem(currentItem)) {
                    const group = provider.groups[currentItem.groupIdx];
                    if (group && group.id) {
                        const groupFiles = getAllFilesInGroupRecursive(provider.groups, group.id);
                        groupFiles.forEach(f => {
                            if (!filesToProcessMap.has(f)) {
                                filesToProcessMap.set(f, new Set());
                            }
                            filesToProcessMap.get(f)?.add(getGroupPath(group.id!));
                        });
                    }
                } else if (isFileItem(currentItem)) {
                    const uriStr = currentItem.uri.toString();
                    if (!filesToProcessMap.has(uriStr)) {
                        filesToProcessMap.set(uriStr, new Set());
                    }
                    // Try to find group name for single file item
                    const group = provider.groups[currentItem.groupIdx];
                    if (group && group.id) {
                        filesToProcessMap.get(uriStr)?.add(getGroupPath(group.id));
                    }
                } else if (isBookmarkItem(currentItem)) {
                    // Handle Bookmark Item
                    const uriStr = currentItem.fileUri.toString(); // BookmarkItem has fileUri NOT uri
                    if (!bookmarksToProcessMap.has(uriStr)) {
                        bookmarksToProcessMap.set(uriStr, []);
                    }
                    bookmarksToProcessMap.get(uriStr)?.push(currentItem);
                }
            }

            const filesToProcess = Array.from(filesToProcessMap.keys());
            const bookmarksToProcess = Array.from(bookmarksToProcessMap.keys());
            const total = filesToProcess.length + bookmarksToProcess.length;

            if (total === 0) {
                vscode.window.showInformationMessage(I18n.getMessage('message.noFilesToGroup'));
                return;
            }

            // Enhanced Title Generation (Markdown List Format)
            let titleLines: string[] = [];
            const selectedGroupFiles = new Set<string>();

            // 1. Gather files from selected groups for deduplication check
            itemsToProcess.forEach(item => {
                if (isFolderItem(item)) {
                    const group = provider.groups[item.groupIdx];
                    if (group && group.id) {
                        const files = getAllFilesInGroupRecursive(provider.groups, group.id);
                        files.forEach(f => selectedGroupFiles.add(f));
                        titleLines.push(`- **Group**: ${group.name}`);
                    }
                }
            });

            // 2. Generate labels for Files and Bookmarks
            itemsToProcess.forEach(item => {
                if (isFileItem(item)) {
                    const label = vscode.workspace.asRelativePath(item.uri);
                    const isDeduped = selectedGroupFiles.has(item.uri.toString());
                    if (isDeduped) {
                        titleLines.push(`- **File**: \`${label}\` (Deduplicated)`);
                    } else {
                        titleLines.push(`- **File**: \`${label}\``);
                    }
                } else if (isBookmarkItem(item)) {
                    // For bookmarks, we format nicely: File (Line X) - Label
                    const relativePath = vscode.workspace.asRelativePath(item.fileUri);
                    const lineInfo = `Line ${item.bookmark.line + 1}`;
                    const bookmarkLabel = item.bookmark.label ? ` - *${item.bookmark.label.replace(/\n/g, ' ')}*` : '';
                    titleLines.push(`- **Bookmark**: \`${relativePath}\` (${lineInfo})${bookmarkLabel}`);
                }
            });

            if (titleLines.length > 0) {
                const header = `### Context Sources (${titleLines.length} items)`;
                // If too many items, truncate the list display but keep the header accurate
                if (titleLines.length > 15) {
                    const remaining = titleLines.length - 15;
                    contextTitle = `${header}\n${titleLines.slice(0, 15).join('\n')}\n- ... and ${remaining} more`;
                } else {
                    contextTitle = `${header}\n${titleLines.join('\n')}`;
                }
            }

            if (total > 20) {
                vscode.window.showInformationMessage(I18n.getMessage('error.tooManyFiles', total.toString()));
            }

            // Binary extension check
            const BINARY_EXTENSIONS = new Set([
                'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'webp',
                'mp3', 'wav', 'ogg', 'mp4', 'webm', 'mov',
                'zip', 'tar', 'gz', '7z', 'rar',
                'exe', 'dll', 'so', 'dylib', 'bin',
                'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
                'class', 'pyc', 'pyo', 'db', 'sqlite'
            ]);

            // Helper to prevent UI freeze
            const yieldToUI = async () => new Promise(resolve => setTimeout(resolve, 0));

            // Helper to merge overlapping line ranges
            const mergeLineRanges = (ranges: { start: number, end: number, label: string }[]) => {
                if (ranges.length === 0) return [];
                // Sort by start line
                const sorted = [...ranges].sort((a, b) => a.start - b.start);
                const merged: { start: number, end: number, labels: string[] }[] = [];

                let current = {
                    start: sorted[0].start,
                    end: sorted[0].end,
                    labels: [sorted[0].label]
                };

                for (let i = 1; i < sorted.length; i++) {
                    const next = sorted[i];
                    // If overlaps or adjacent (allowing for 1 line gap context merging if desired, but here strict overlap)
                    if (next.start <= current.end + 1) { // +1 to merge adjacent blocks
                        current.end = Math.max(current.end, next.end);
                        current.labels.push(next.label);
                    } else {
                        merged.push(current);
                        current = {
                            start: next.start,
                            end: next.end,
                            labels: [next.label]
                        };
                    }
                }
                merged.push(current);
                return merged;
            };

            let content = `${contextTitle}\n\n`;
            let isCancelled = false;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: I18n.getMessage('progress.generatingContext'),
                cancellable: true
            }, async (progress, token) => {
                const step = 100 / total;
                let processed = 0;

                // Process Files
                for (const uriStr of filesToProcess) {
                    if (token.isCancellationRequested) {
                        isCancelled = true;
                        break;
                    }

                    // Yield every 5 files to prevent freeze
                    if (processed % 5 === 0) await yieldToUI();

                    try {
                        const uri = vscode.Uri.parse(uriStr);
                        const ext = uri.fsPath.split('.').pop()?.toLowerCase() || '';

                        // Skip binary files by extension
                        if (BINARY_EXTENSIONS.has(ext)) {
                            processed++;
                            progress.report({ increment: step });
                            continue;
                        }

                        // Fix A: Use openTextDocument to respect user encoding settings
                        // Use try-catch for binary files that VS Code can't open as text
                        const doc = await vscode.workspace.openTextDocument(uri);
                        const fileText = doc.getText();

                        // Simple binary check: look for null bytes in the first 1000 chars
                        if (fileText.slice(0, 1000).indexOf('\0') !== -1) {
                            processed++;
                            progress.report({ increment: step });
                            continue;
                        }

                        // Limit file size (e.g. 1MB)
                        if (fileText.length > 1024 * 1024) {
                            content += `## File: ${vscode.workspace.asRelativePath(uri)}\n(File too large to include)\n\n`;
                            processed++;
                            progress.report({ increment: step, message: `(${processed}/${total})` });
                            continue;
                        }

                        // Format
                        const relativePath = vscode.workspace.asRelativePath(uri);
                        const groupNames = filesToProcessMap.get(uriStr);
                        let groupInfo = '';
                        if (groupNames && groupNames.size > 0) {
                            groupInfo = `> In Group: ${Array.from(groupNames).join(', ')}\n`;
                        }

                        content += `## File: ${relativePath}\n${groupInfo}`;
                        content += '```' + (ext || '') + '\n';
                        content += fileText + '\n';
                        content += '```\n\n';

                    } catch (e) {
                        // Fallback for files that cannot be opened as text document
                        console.error(`Failed to read file ${uriStr}`, e);
                        content += `## File: ${uriStr}\n(Error reading file)\n\n`;
                    }

                    processed++;
                    progress.report({ increment: step, message: `(${processed}/${total})` });
                }

                // Process Bookmarks
                for (const uriStr of bookmarksToProcess) {
                    if (token.isCancellationRequested) {
                        isCancelled = true;
                        break;
                    }

                    // Yield every 5 items
                    if (processed % 5 === 0) await yieldToUI();

                    try {
                        const uri = vscode.Uri.parse(uriStr);
                        const bookmarkItems = bookmarksToProcessMap.get(uriStr) || [];

                        // Fix A: Use openTextDocument
                        const doc = await vscode.workspace.openTextDocument(uri);
                        const totalLines = doc.lineCount;
                        const relativePath = vscode.workspace.asRelativePath(uri);

                        // Prepare ranges
                        const ranges = bookmarkItems.map(bm => ({
                            start: Math.max(0, bm.bookmark.line - 5),
                            end: Math.min(totalLines - 1, bm.bookmark.line + 5),
                            label: bm.bookmark.label
                        }));

                        // Fix B: Merge overlapping ranges
                        const mergedRanges = mergeLineRanges(ranges);

                        for (const range of mergedRanges) {
                            // Use Range object to extract text safely
                            const textRange = new vscode.Range(
                                new vscode.Position(range.start, 0),
                                new vscode.Position(range.end, doc.lineAt(range.end).text.length)
                            );
                            const chunkText = doc.getText(textRange);

                            const labelsStr = range.labels.join(', ');

                            content += `## Bookmarks: ${labelsStr} in ${relativePath}\n`;
                            content += `> Lines: ${range.start + 1}-${range.end + 1}\n`;
                            content += '```' + (uri.fsPath.split('.').pop() || '') + '\n';
                            content += chunkText + '\n';
                            content += '```\n\n';
                        }

                    } catch (e) {
                        console.error(`Failed to read bookmark file ${uriStr}`, e);
                        content += `## Bookmark File: ${uriStr}\n(Error reading file)\n\n`;
                    }

                    processed++;
                    progress.report({ increment: step, message: `(${processed}/${total})` });
                }

            });

            if (isCancelled) return;

            // Smart Handling Logic
            // Threshold for smart handling (50KB)
            const SIZE_THRESHOLD = 50 * 1024;

            if (content.length > SIZE_THRESHOLD) {
                // Too large -> Open in Untitled Document
                try {
                    const doc = await vscode.workspace.openTextDocument({
                        content: content,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc);
                    vscode.window.showInformationMessage(
                        I18n.getMessage('message.contextTooLargeOpenEditor', (content.length / 1024 / 1024).toFixed(1))
                    );
                } catch (e) {
                    vscode.window.showErrorMessage(I18n.getMessage('error.cannotOpenEditor'));
                }
            } else {
                // Small enough -> Copy to Clipboard
                await vscode.env.clipboard.writeText(content);
                vscode.window.showInformationMessage(I18n.getMessage('message.contextCopied'));
            }
        })
    );

    // AI Context: Copy Group Paths
    context.subscriptions.push(
        vscode.commands.registerCommand('virtualTabs.copyGroupPaths', async (item: TempFolderItem) => {
            if (typeof item?.groupIdx !== 'number') return;
            const group = provider.groups[item.groupIdx];
            if (!group || !group.files || group.files.length === 0) return;

            const paths = group.files.map(uriStr => {
                try {
                    return vscode.workspace.asRelativePath(vscode.Uri.parse(uriStr));
                } catch {
                    return uriStr;
                }
            });

            await vscode.env.clipboard.writeText(paths.join('\n'));
            vscode.window.showInformationMessage(I18n.getMessage('message.pathsCopied'));
        })
    );

    // Close Bookmark Container (Close the file of the bookmark)
    context.subscriptions.push(
        vscode.commands.registerCommand('virtualTabs.closeBookmarkContainer', async (item: BookmarkItem) => {
            if (item && item.resourceUri) {
                const targetUri = item.resourceUri;
                const tabGroups = vscode.window.tabGroups;
                for (const group of tabGroups.all) {
                    for (const tab of group.tabs) {
                        if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === targetUri.toString()) {
                            await vscode.window.tabGroups.close(tab);
                        }
                    }
                }
            }
        })
    );
}


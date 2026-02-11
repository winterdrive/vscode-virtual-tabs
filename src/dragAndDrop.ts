import * as vscode from 'vscode';
import { TempFoldersProvider } from './provider';
import { TempFolderItem, TempFileItem } from './treeItems';

// Drag-and-drop controller, allows files to be dragged into groups AND groups to be nested
export class TempFoldersDragAndDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
    constructor(private provider: TempFoldersProvider) { }

    public readonly supportedTypes = [
        'text/uri-list',
        'application/vnd.code.tree.virtualTabsView',
        'application/vnd.code.tree.virtualTabsView.files'
    ];
    public readonly dropMimeTypes = [
        'text/uri-list',
        'application/vnd.code.tree.virtualTabsView',
        'application/vnd.code.tree.virtualTabsView.files'
    ];
    public readonly dragMimeTypes = [
        'text/uri-list',
        'application/vnd.code.tree.virtualTabsView',
        'application/vnd.code.tree.virtualTabsView.files'
    ];

    async handleDrag(source: vscode.TreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        // Handle multi-file drag from the tree view
        const fileItems = source.filter((item): item is TempFileItem => item instanceof TempFileItem);
        const groupItems = source.filter((item): item is TempFolderItem => item instanceof TempFolderItem);

        if (fileItems.length > 0) {
            // Merge multiple file URIs into a single uri-list
            const uriList = fileItems
                .map(item => item.uri.toString())
                .join('\r\n');

            // Set drag data
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uriList));

            // Also store file items for internal move operation
            dataTransfer.set('application/vnd.code.tree.virtualTabsView.files', new vscode.DataTransferItem(fileItems));
        }

        if (groupItems.length > 0) {
            // Store group items for internal drag-drop
            dataTransfer.set('application/vnd.code.tree.virtualTabsView', new vscode.DataTransferItem(groupItems));
        }
    }

    async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        // Priority 1: Check if this is an internal file move (WE set this manually in handleDrag)
        const fileData = dataTransfer.get('application/vnd.code.tree.virtualTabsView.files');

        if (fileData) {
            const draggedFiles = fileData.value as TempFileItem[];
            // Try determine target group
            const targetGroup = this.determineTargetGroup(target);
            if (targetGroup) {
                await this.handleFileDrop(draggedFiles, targetGroup);
                return;
            }
        }

        // Priority 2: Check for external file drag (uri-list)
        const uriList = dataTransfer.get('text/uri-list');
        if (uriList && !fileData) { // Only process if not valid internal file move
            const targetGroup = this.determineTargetGroup(target);
            if (targetGroup) {
                // Fix: support both \n and \r\n, trim whitespace and control characters from each URI
                const uris = uriList.value.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean);

                // Expand directories to get all files
                const allFileUris: string[] = [];
                for (const uriStr of uris) {
                    try {
                        const uri = vscode.Uri.parse(uriStr);
                        const stat = await vscode.workspace.fs.stat(uri);

                        if (stat.type === vscode.FileType.Directory) {
                            // It's a directory - recursively get all files
                            const filesInDir = await this.getFilesInDirectoryRecursive(uri);
                            allFileUris.push(...filesInDir.map(f => f.toString()));
                        } else if (stat.type === vscode.FileType.File) {
                            // It's a file - add directly
                            allFileUris.push(uriStr);
                        }
                    } catch (e) {
                        // If we can't stat it, try adding it directly (might be a valid file)
                        allFileUris.push(uriStr);
                    }
                }

                if (allFileUris.length > 0) {
                    this.provider.addFilesToGroup(targetGroup.groupIdx, allFileUris);
                }
                return;
            }
        }

        // Priority 3: Handle group nesting (internal drag-drop)
        // VS Code automatically sets this MIME type for the tree view
        const groupData = dataTransfer.get('application/vnd.code.tree.virtualTabsView');

        if (groupData) {
            try {
                const rawValue = groupData.value;
                if (Array.isArray(rawValue)) {
                    // Filter manually, don't rely on strictly instanceof if across boundaries
                    const draggedGroups = rawValue.filter(g => g instanceof TempFolderItem || (g && g.contextValue && g.contextValue.includes('virtualTabsGroup')));

                    if (draggedGroups.length > 0) {
                        await this.handleGroupDrop(draggedGroups as TempFolderItem[], target);
                        return;
                    }
                }
            } catch (e) {
                // Ignore error matching group items
            }
        }
    }

    private determineTargetGroup(target: vscode.TreeItem | undefined): TempFolderItem | undefined {
        if (target instanceof TempFolderItem) {
            return target;
        } else if (target instanceof TempFileItem) {
            const targetGroupData = this.provider.groups[target.groupIdx];
            if (targetGroupData) {
                return new TempFolderItem(
                    targetGroupData.name,
                    target.groupIdx,
                    targetGroupData.id,
                    targetGroupData.builtIn
                );
            }
        }
        return undefined;
    }

    /**
     * Handle dropping file(s) onto a group (move files between groups)
     */
    private async handleFileDrop(draggedFiles: TempFileItem[], target: TempFolderItem): Promise<void> {
        const targetGroup = this.provider.groups[target.groupIdx];
        if (!targetGroup) return;

        for (const fileItem of draggedFiles) {
            const sourceGroup = this.provider.groups[fileItem.groupIdx];
            if (!sourceGroup) continue;

            const fileUri = fileItem.uri.toString();

            // Skip if dropping onto the same group
            if (fileItem.groupIdx === target.groupIdx) continue;

            // 1. Move Bookmarks
            if (sourceGroup.bookmarks && sourceGroup.bookmarks[fileUri]) {
                if (!targetGroup.bookmarks) {
                    targetGroup.bookmarks = {};
                }
                // Move bookmarks to target group
                targetGroup.bookmarks[fileUri] = sourceGroup.bookmarks[fileUri];
                // Remove from source group
                delete sourceGroup.bookmarks[fileUri];

                // Clean up empty bookmarks object if needed
                if (Object.keys(sourceGroup.bookmarks).length === 0) {
                    delete sourceGroup.bookmarks;
                }
            }

            // 2. Move File
            // Remove from source group
            if (sourceGroup.files) {
                sourceGroup.files = sourceGroup.files.filter(uri => uri !== fileUri);
            }

            // Add to target group
            if (!targetGroup.files) targetGroup.files = [];
            if (!targetGroup.files.includes(fileUri)) {
                targetGroup.files.push(fileUri);
            }
        }

        this.provider.refresh();
    }

    /**
     * Handle dropping group(s) onto another group or root
     */
    private async handleGroupDrop(draggedGroups: TempFolderItem[], target: vscode.TreeItem | undefined): Promise<void> {
        let hasChanges = false;

        for (const draggedGroup of draggedGroups) {
            const sourceGroup = this.provider.groups[draggedGroup.groupIdx];
            if (!sourceGroup) continue;

            // Case 1: Drop onto another group (nest)
            if (target instanceof TempFolderItem) {
                const destGroup = this.provider.groups[target.groupIdx];
                if (!destGroup) continue;

                // Validation checks
                if (sourceGroup.id === destGroup.id) {
                    vscode.window.showErrorMessage('Cannot nest a group into itself.');
                    continue;
                }

                if (this.isDescendant(destGroup.id, sourceGroup.id)) {
                    vscode.window.showErrorMessage('Cannot create circular nesting: target is a descendant of source.');
                    continue;
                }

                if (sourceGroup.builtIn) {
                    vscode.window.showErrorMessage('Cannot nest the built-in group.');
                    continue;
                }

                // Set parent relationship
                sourceGroup.parentGroupId = destGroup.id;
                hasChanges = true;
            }
            // Case 2: Drop onto root (un-nest)
            else if (!target) {
                // Remove parent relationship
                delete sourceGroup.parentGroupId;
                hasChanges = true;
            }
        }

        // Only refresh if changes were made
        if (hasChanges) {
            this.provider.refresh();
        }
    }

    /**
     * Check if a group is a descendant of another group (prevent circular nesting)
     */
    private isDescendant(groupId: string, potentialAncestorId: string): boolean {
        const group = this.provider.groups.find(g => g.id === groupId);
        if (!group || !group.parentGroupId) return false;

        if (group.parentGroupId === potentialAncestorId) return true;

        return this.isDescendant(group.parentGroupId, potentialAncestorId);
    }

    /**
     * Recursively get all files in a directory
     */
    private async getFilesInDirectoryRecursive(dirUri: vscode.Uri): Promise<vscode.Uri[]> {
        const files: vscode.Uri[] = [];

        try {
            const entries = await vscode.workspace.fs.readDirectory(dirUri);

            for (const [name, type] of entries) {
                const entryUri = vscode.Uri.joinPath(dirUri, name);

                if (type === vscode.FileType.File) {
                    files.push(entryUri);
                } else if (type === vscode.FileType.Directory) {
                    // Recursively get files from subdirectory
                    const subFiles = await this.getFilesInDirectoryRecursive(entryUri);
                    files.push(...subFiles);
                }
            }
        } catch (e) {
            console.error(`Failed to read directory: ${dirUri.fsPath}`, e);
        }

        return files;
    }
}
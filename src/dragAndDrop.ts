import * as vscode from 'vscode';
import { TempFoldersProvider } from './provider';
import { TempFolderItem, TempFileItem } from './treeItems';
import { I18n } from './i18n';

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

        const uriSet = new Set<string>();

        if (fileItems.length > 0) {
            for (const item of fileItems) {
                uriSet.add(item.uri.toString());
            }

            // Also store file items for internal move operation
            dataTransfer.set('application/vnd.code.tree.virtualTabsView.files', new vscode.DataTransferItem(fileItems));
        }

        if (groupItems.length > 0) {
            for (const item of groupItems) {
                const group = this.provider.groups[item.groupIdx];
                if (!group || group.builtIn || !group.id) continue;
                const groupFiles = this.collectGroupFilesRecursive(group.id);
                for (const uri of groupFiles) {
                    uriSet.add(uri);
                }
            }

            // Store group items for internal drag-drop
            dataTransfer.set('application/vnd.code.tree.virtualTabsView', new vscode.DataTransferItem(groupItems));
        }

        if (uriSet.size > 0) {
            const uriList = Array.from(uriSet).join('\r\n');
            // Set drag data
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uriList));
        }
    }

    async handleDrop(target: vscode.TreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        // Priority 1: Check if this is an internal file move (WE set this manually in handleDrag)
        // IMPORTANT: Always validate the type of fileData.value before using it,
        // because VS Code's DataTransfer may serialize/deserialize the value across boundaries.
        const fileData = dataTransfer.get('application/vnd.code.tree.virtualTabsView.files');
        const draggedFiles = this.extractDraggedFiles(fileData);

        if (draggedFiles && draggedFiles.length > 0) {
            // Try determine target group
            const targetGroup = this.determineTargetGroup(target);
            if (targetGroup) {
                await this.handleFileDrop(draggedFiles, targetGroup, target);
                return;
            }
        }

        // Priority 2: Check for external file drag (uri-list)
        // Condition: uri-list exists AND we did NOT successfully extract internal file items
        // Note: We do NOT use `!fileData` because fileData may exist but contain an invalid/serialized value
        const uriList = dataTransfer.get('text/uri-list');
        if (uriList && !draggedFiles) {
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

    /**
     * Safely extract TempFileItem[] from a DataTransferItem.
     * Returns null if the value is not a valid TempFileItem array
     * (e.g. when VS Code serializes the value across the webview boundary).
     */
    private extractDraggedFiles(fileData: vscode.DataTransferItem | undefined): TempFileItem[] | null {
        if (!fileData) return null;

        const value = fileData.value;

        // Must be a non-empty array
        if (!Array.isArray(value) || value.length === 0) return null;

        // Every element must be a TempFileItem instance
        const allAreFileItems = value.every(item => item instanceof TempFileItem);
        if (!allAreFileItems) return null;

        return value as TempFileItem[];
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
    private async handleFileDrop(draggedFiles: TempFileItem[], targetGroupItem: TempFolderItem, target?: vscode.TreeItem): Promise<void> {
        const targetGroup = this.provider.groups[targetGroupItem.groupIdx];
        if (!targetGroup) return;

        for (const fileItem of draggedFiles) {
            const sourceGroup = this.provider.groups[fileItem.groupIdx];
            if (!sourceGroup) continue;

            const fileUri = fileItem.uri.toString();

            // Reorder inside the same group
            if (fileItem.groupIdx === targetGroupItem.groupIdx) {
                // target here is the ORIGINAL drop target (TempFileItem or TempFolderItem), not the derived targetGroupItem
                const targetUri = (target instanceof TempFileItem) ? target.uri.toString() : null;
                this.provider.reorderFileInGroup(fileItem.groupIdx, fileUri, targetUri);
                continue;
            }

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

            // Add to target group (fsPath comparison to handle URI encoding differences)
            if (!targetGroup.files) targetGroup.files = [];
            const incomingFsPath = vscode.Uri.parse(fileUri).fsPath;
            const alreadyExists = targetGroup.files.some(f => {
                try { return vscode.Uri.parse(f).fsPath === incomingFsPath; }
                catch { return f === fileUri; }
            });
            if (!alreadyExists) {
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
                    vscode.window.showErrorMessage(I18n.getMessage('error.cannotNestSelf'));
                    continue;
                }

                if (this.isDescendant(destGroup.id, sourceGroup.id)) {
                    vscode.window.showErrorMessage(I18n.getMessage('error.circularNesting'));
                    continue;
                }

                if (sourceGroup.builtIn) {
                    vscode.window.showErrorMessage(I18n.getMessage('error.cannotNestBuiltIn'));
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

    private collectGroupFilesRecursive(groupId: string): string[] {
        const files: string[] = [];
        const visited = new Set<string>();

        const walk = (id: string) => {
            if (visited.has(id)) return;
            visited.add(id);

            const group = this.provider.groups.find(g => g.id === id);
            if (!group) return;

            if (group.files) {
                files.push(...group.files);
            }

            const children = this.provider.groups.filter(g => g.parentGroupId === id);
            for (const child of children) {
                if (child.id) {
                    walk(child.id);
                }
            }
        };

        walk(groupId);
        return files;
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
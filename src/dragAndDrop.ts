import * as vscode from 'vscode';
import { TempFoldersProvider } from './provider';
import { TempFolderItem, TempFileItem, ScopeHeaderItem, EditorGroupItem } from './treeItems';
import { I18n } from './i18n';
import { extractDataTransferFileUris, formatDraggedFilesPlainText, parseUriList, uniqueUriStrings } from './core/DropUriParser';
import { BookmarkManager } from './core/BookmarkManager';
import { removeStoredFileEntriesFromGroup } from './core/GroupFileRemoval';

// Drag-and-drop controller, allows files to be dragged into groups AND groups to be nested
export class TempFoldersDragAndDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
    constructor(private provider: TempFoldersProvider) { }

    public readonly supportedTypes = [
        'files',
        'text/uri-list',
        'application/vnd.code.tree.virtualTabsView',
        'application/vnd.code.tree.virtualTabsView.files'
    ];
    public readonly dropMimeTypes = [
        'files',
        'text/uri-list',
        'application/vnd.code.tree.virtualTabsView',
        'application/vnd.code.tree.virtualTabsView.files'
    ];
    public readonly dragMimeTypes = [
        'text/plain',
        'text/uri-list',
        'application/vnd.code.tree.virtualTabsView',
        'application/vnd.code.tree.virtualTabsView.files'
    ];

    async handleDrag(source: vscode.TreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
        // Handle multi-file drag from the tree view
        const fileItems = source.filter((item): item is TempFileItem => item instanceof TempFileItem);
        const groupItems = source.filter((item): item is TempFolderItem => item instanceof TempFolderItem);
        const editorGroupItems = source.filter((item): item is EditorGroupItem => item instanceof EditorGroupItem);

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
                // Skip only groups without a valid id (builtIn groups are now allowed
                // so that "Currently Open Files" can produce a drag payload).
                if (!group || !group.id) continue;
                const groupFiles = this.collectGroupFilesRecursive(group.id);
                for (const uri of groupFiles) {
                    uriSet.add(uri);
                }
            }

            // Store group items for internal drag-drop
            dataTransfer.set('application/vnd.code.tree.virtualTabsView', new vscode.DataTransferItem(groupItems));
        }

        // Handle EditorGroupItem (split-editor sub-nodes under the built-in group).
        // These are not TempFolderItem instances, so they need separate handling.
        if (editorGroupItems.length > 0) {
            for (const item of editorGroupItems) {
                const files = this.provider.getEditorGroupFiles(item.viewColumn);
                for (const uri of files) {
                    uriSet.add(uri);
                }
            }
        }

        if (uriSet.size > 0) {
            const uriList = Array.from(uriSet).join('\r\n');
            // Set drag data
            dataTransfer.set('text/uri-list', new vscode.DataTransferItem(uriList));
            dataTransfer.set('text/plain', new vscode.DataTransferItem(this.createDraggedFilesPlainText(Array.from(uriSet))));
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
            if (target instanceof ScopeHeaderItem) {
                const groupIdx = this.provider.createGroupInScope(target.scope.id, [], false);
                if (groupIdx !== undefined) {
                    const group = this.provider.groups[groupIdx];
                    await this.handleFileDrop(
                        draggedFiles,
                        new TempFolderItem(group.name, groupIdx, group.id, group.builtIn),
                        target
                    );
                    return;
                }
            }
        }

        // Priority 2: Check for external file drag.
        // Condition: external URIs exist AND we did NOT successfully extract internal file items
        // Note: We do NOT use `!fileData` because fileData may exist but contain an invalid/serialized value
        const uriList = dataTransfer.get('text/uri-list');
        const uriListText = uriList ? await this.readDataTransferString(uriList) : undefined;
        const externalUris = uniqueUriStrings([
            ...parseUriList(uriListText),
            ...this.extractExternalFileUris(dataTransfer)
        ]);
        if (externalUris.length > 0 && !draggedFiles) {
            const targetGroup = this.determineTargetGroup(target);
            if (targetGroup || target instanceof ScopeHeaderItem) {
                // Expand directories to get all files
                const allFileUris: string[] = [];
                for (const uriStr of externalUris) {
                    try {
                        const uri = this.toDroppedUri(uriStr);
                        const stat = await vscode.workspace.fs.stat(uri);

                        if (stat.type === vscode.FileType.Directory) {
                            // It's a directory - recursively get all files
                            const filesInDir = await this.getFilesInDirectoryRecursive(uri);
                            allFileUris.push(...filesInDir.map(f => f.toString()));
                        } else if (stat.type === vscode.FileType.File) {
                            // It's a file - add directly
                            allFileUris.push(uri.toString());
                        }
                    } catch (e) {
                        // If we can't stat it, try adding it directly (might be a valid file)
                        allFileUris.push(uriStr);
                    }
                }

                if (allFileUris.length > 0) {
                    if (targetGroup) {
                        this.provider.addFilesToGroup(targetGroup.groupIdx, allFileUris);
                    } else if (target instanceof ScopeHeaderItem) {
                        this.provider.createGroupInScope(target.scope.id, allFileUris);
                    }
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

    private async readDataTransferString(item: vscode.DataTransferItem): Promise<unknown> {
        try {
            return await item.asString();
        } catch {
            return item.value;
        }
    }

    private extractExternalFileUris(dataTransfer: vscode.DataTransfer): string[] {
        const files: vscode.DataTransferFile[] = [];
        for (const [, item] of dataTransfer) {
            const file = item.asFile();
            if (file) {
                files.push(file);
            }
        }
        return extractDataTransferFileUris(files);
    }

    private toDroppedUri(uriStr: string): vscode.Uri {
        if (/^[a-zA-Z]:[\\/]/.test(uriStr) || uriStr.startsWith('\\\\') || uriStr.startsWith('/')) {
            return vscode.Uri.file(uriStr);
        }
        return vscode.Uri.parse(uriStr);
    }

    private createDraggedFilesPlainText(uriStrings: readonly string[]): string {
        const paths = uriStrings.map(uriString => {
            try {
                const uri = vscode.Uri.parse(uriString);
                return vscode.workspace.asRelativePath(uri, false);
            } catch {
                return uriString;
            }
        });

        return formatDraggedFilesPlainText(paths);
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
            // Use a normalized key lookup (not exact string match) because the dragged
            // item's URI string can differ from the stored bookmark key in encoding/casing.
            const bookmarkKey = sourceGroup.bookmarks
                ? BookmarkManager.findBookmarkKey(sourceGroup, fileUri)
                : undefined;
            if (sourceGroup.bookmarks && bookmarkKey) {
                if (!targetGroup.bookmarks) {
                    targetGroup.bookmarks = {};
                }
                // Move bookmarks to target group
                targetGroup.bookmarks[bookmarkKey] = sourceGroup.bookmarks[bookmarkKey];
                // Remove from source group
                delete sourceGroup.bookmarks[bookmarkKey];

                // Clean up empty bookmarks object if needed
                if (Object.keys(sourceGroup.bookmarks).length === 0) {
                    delete sourceGroup.bookmarks;
                }
            }

            // 2. Move File
            // Remove from source group. Compare via the shared fsPath-based matcher,
            // not a raw string filter: the dragged item's URI can re-serialize with
            // different encoding than what's stored on the group (e.g.
            // vscode.Uri.parse(...).toString() percent-encodes a Windows
            // drive-letter colon while the in-memory value produced by
            // PathUtils.toFileUri() does not). A strict `!==` filter then silently
            // fails to remove the entry, leaving the file duplicated in both groups.
            if (sourceGroup.files) {
                const sourceScopeRoot = sourceGroup.sourceScopeId
                    ? this.provider.configScopes.find(s => s.id === sourceGroup.sourceScopeId)?.uri.fsPath
                    : undefined;
                removeStoredFileEntriesFromGroup(
                    sourceGroup,
                    [{ uri: fileUri, fsPath: fileItem.uri.fsPath }],
                    sourceScopeRoot
                );
            }

            // Add to target group (fsPath comparison to handle URI encoding differences)
            if (!targetGroup.files) targetGroup.files = [];
            const incomingFsPath = fileItem.uri.fsPath;
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

                if (!this.provider.moveGroupUnderGroup(sourceGroup.id, destGroup.id)) {
                    continue;
                }
                hasChanges = true;
            }
            // Case 2: Drop onto a scope header (move to that scope's root)
            else if (target instanceof ScopeHeaderItem) {
                if (sourceGroup.builtIn) {
                    vscode.window.showErrorMessage(I18n.getMessage('error.cannotNestBuiltIn'));
                    continue;
                }

                this.provider.moveGroupToScope(sourceGroup.id, target.scope.id);
                hasChanges = false;
            }
            // Case 2: Drop onto root (un-nest)
            else if (!target) {
                hasChanges = this.provider.unnestGroup(sourceGroup.id) || hasChanges;
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
    private isDescendant(groupId: string, potentialAncestorId: string, visited = new Set<string>()): boolean {
        if (visited.has(groupId)) return false;
        visited.add(groupId);

        const group = this.provider.groups.find(g => g.id === groupId);
        if (!group || !group.parentGroupId) return false;

        if (group.parentGroupId === potentialAncestorId) return true;

        return this.isDescendant(group.parentGroupId, potentialAncestorId, visited);
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
                    // Skip hidden directories (names starting with '.') such as .git, .github
                    // to match VS Code's native tree view behavior.
                    // Hidden files (e.g. .gitignore, .editorconfig) are still included.
                    if (name.startsWith('.')) {
                        continue;
                    }
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

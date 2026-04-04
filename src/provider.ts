import * as vscode from 'vscode';
import * as path from 'path';
import { TempGroup, SortCriteria, DateGroup, VTBookmark } from './types';
import { TempFileItem, TempFolderItem, BookmarkItem, EditorGroupItem } from './treeItems';
import { I18n } from './i18n';
import { FileSorter } from './core/FileSorter';
import { AutoGrouper } from './core/AutoGrouper';
import { BookmarkManager } from './core/BookmarkManager';
import { GroupManager, OptimisticLockError } from './core/GroupManager';
import { PathUtils } from './core/PathUtils';

/**
 * Type-safe helper to extract a URI from a VS Code Tab's input.
 * Handles TextInput, Notebook, and Custom tab types without unsafe casts.
 */
function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
    const input = tab.input;
    if (input instanceof vscode.TabInputText) { return input.uri; }
    if (input instanceof vscode.TabInputNotebook) { return input.uri; }
    if (input instanceof vscode.TabInputCustom) { return input.uri; }
    if (input instanceof vscode.TabInputTextDiff) { return input.modified; }
    return undefined;
}

/**
 * In-memory snapshot of a single VS Code editor group's open files.
 * Not persisted to disk; rebuilt on every sync from vscode.window.tabGroups.
 */
interface EditorGroupInfo {
    viewColumn: number;
    label: string;
    files: string[];
}

// TreeDataProvider implementation
export class TempFoldersProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null> = new vscode.EventEmitter();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // In-memory group array
    public groups: TempGroup[] = [];
    private expandedGroupIds: Set<string> = new Set();
    private treeView?: vscode.TreeView<vscode.TreeItem>;

    // Debounce timer for saving groups to reduce disk I/O
    private saveDebounceTimer: ReturnType<typeof setTimeout> | undefined;

    // Flag to ignore file system events triggered by the extension itself
    private isInternalSaving: boolean = false;

    // Core module: group JSON read/write (no vscode dependency)
    private groupManager: GroupManager | undefined;
    // Last successfully loaded version number (for optimistic locking)
    private loadedVersion: number = 0;

    // Registry of rendered TempFileItems by ID, so reveal() can use exact same instance
    private fileItemRegistry: Map<string, TempFileItem> = new Map();

    // Per-group file lists mirroring vscode.window.tabGroups.all (in-memory only, not persisted)
    private builtInEditorGroups: EditorGroupInfo[] = [];

    constructor(_context?: vscode.ExtensionContext) {
        const root = this.getWorkspaceRootPath();
        if (root) {
            this.groupManager = new GroupManager(root);
        }
        this.loadGroups();
        if (this.groups.length === 0) {
            this.initBuiltInGroup();
        }
    }

    // Save TreeView reference for multi-select management
    setTreeView(treeView: vscode.TreeView<vscode.TreeItem>): void {
        this.treeView = treeView;
    }

    setExpandedGroupIds(ids: string[]): void {
        this.expandedGroupIds = new Set(ids);
    }

    updateGroupExpanded(id: string, expanded: boolean): string[] {
        if (expanded) {
            this.expandedGroupIds.add(id);
        } else {
            this.expandedGroupIds.delete(id);
        }
        return Array.from(this.expandedGroupIds);
    }

    isGroupExpanded(id: string): boolean {
        return this.expandedGroupIds.has(id);
    }

    // Get currently selected file items
    getSelectedFileItems(): TempFileItem[] {
        if (!this.treeView) return [];

        // Ensure selection is an array
        const selection = this.treeView.selection || [];

        // Filter all items of type TempFileItem
        const fileItems = selection.filter((item): item is TempFileItem => item instanceof TempFileItem);

        return fileItems;
    }

    getSelection(): vscode.TreeItem[] {
        return this.treeView ? [...this.treeView.selection] : [];
    }

    private saveGroups() {
        // Debounce: Clear any pending save and schedule a new one
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveGroupsImmediate();
        }, 500);
    }

    private saveGroupsImmediate() {
        if (!this.groupManager) {
            console.warn('Cannot save VirtualTabs data: workspace root not found');
            return;
        }

        try {
            const storageGroups = this.toStorageGroups(this.groups);

            // Set flag to ignore the next file system event
            this.isInternalSaving = true;
            try {
                this.groupManager.saveGroups(storageGroups, this.loadedVersion);
                // Update version number
                const { version } = this.groupManager.loadGroups();
                this.loadedVersion = version;
            } catch (err) {
                if (err instanceof OptimisticLockError) {
                    // Version conflict: externally modified, reload without overwriting
                    console.warn('VirtualTabs: OptimisticLockError on save — external change detected, skipping write');
                } else {
                    throw err;
                }
            }

            // Reset flag after a short delay to ensure the event is captured
            setTimeout(() => {
                this.isInternalSaving = false;
            }, 500);
        } catch (error) {
            this.isInternalSaving = false;
            console.error('Failed to save VirtualTabs data file:', error);
        }
    }

    /**
     * Handle external changes to the data file
     */
    public onExternalFileChange() {
        if (this.isInternalSaving) {
            return;
        }

        // Option A: Silent reload of UI
        const success = this.loadGroups();
        if (success) {
            this.refresh(false); // UI only, do NOT save back to disk to avoid overwriting user's manual edit

            // Use a persistent status bar message
            const msg = I18n.getMessage('message.configReloaded') || 'VirtualTabs: Config reloaded';
            vscode.window.showInformationMessage(msg); // Shift to notification because status bar is too subtle/volatile
        }
    }

    /**
     * Reset groups to default state (called when config file is deleted)
     */
    public resetToDefault() {
        this.groups = [];
        this.initBuiltInGroup();
        this.refresh(true); // Save to recreate the config file
    }



    private loadGroups(): boolean {
        if (!this.groupManager) return false;
        try {
            const { groups: saved, version } = this.groupManager.loadGroups();
            // If the user clears the config (empty array), treat it as a valid reset-to-default.
            // Critical: still update loadedVersion so future writes don't hit optimistic-lock conflicts.
            if (saved.length === 0) {
                this.groups = [];
                this.initBuiltInGroup();
                this.loadedVersion = version;
                return true;
            }

            if (this.validateGroups(saved)) {
                this.groups = this.fromStorageGroups(this.migrateGroups(saved));
                this.loadedVersion = version;
                return true;
            } else {
                console.error('VirtualTabs: Loaded data failed validation');
                vscode.window.showErrorMessage(I18n.getMessage('error.invalidConfigFormat') || 'Invalid format in virtualTab.json. Please check the file structure.');
                return false;
            }
        } catch (error) {
            console.error('Failed to load VirtualTabs data file:', error);
            vscode.window.showErrorMessage(`${I18n.getMessage('error.loadConfigFailed') || 'Failed to load virtualTab.json'}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    private validateGroups(data: unknown): data is TempGroup[] {
        if (!Array.isArray(data)) return false;

        for (let i = 0; i < data.length; i++) {
            const g = data[i];
            if (typeof g !== 'object' || g === null) return false;

            // Critical: name is required for Tree View
            if (typeof g.name !== 'string' || g.name.trim() === '') {
                console.warn(`VirtualTabs: Group at index ${i} is missing a name`);
                return false;
            }

            // files array is optional but must be array of strings if present
            if (g.files !== undefined) {
                if (!Array.isArray(g.files)) return false;
                const originalLength = g.files.length;
                const validFiles = g.files.filter((f: unknown) => typeof f === 'string');
                if (validFiles.length !== originalLength) {
                    console.warn(`VirtualTabs: Group "${g.name}" at index ${i} has ${originalLength - validFiles.length} invalid file entries (filtered out)`);
                }
                g.files = validFiles;
            }

            // id is optional (generated if missing), but if present must be string
            if (g.id !== undefined && typeof g.id !== 'string' && typeof g.id !== 'number') return false;

            // parentGroupId must be string if present
            if (g.parentGroupId !== undefined && g.parentGroupId !== null && typeof g.parentGroupId !== 'string') return false;
        }

        return true;
    }

    private migrateGroups(saved: TempGroup[]): TempGroup[] {
        return saved.map(group => ({
            ...group,
            bookmarks: group.bookmarks || {},
            id: group.id || Date.now().toString() + Math.random().toString(36).substring(2, 9)
        }));
    }

    private toStorageGroups(groups: TempGroup[]): TempGroup[] {
        const workspaceRoot = this.getWorkspaceRootPath();
        if (!workspaceRoot) {
            return groups;
        }

        return groups.map(group => ({
            ...group,
            files: group.files ? group.files.map(uriStr => this.toRelativePath(uriStr, workspaceRoot)) : group.files,
            bookmarks: group.bookmarks ? this.toRelativeBookmarks(group.bookmarks, workspaceRoot) : group.bookmarks
        }));
    }

    private fromStorageGroups(groups: TempGroup[]): TempGroup[] {
        const workspaceRoot = this.getWorkspaceRootPath();
        if (!workspaceRoot) {
            return groups;
        }

        return groups.map(group => {
            let files = group.files
                ? group.files.map(pathStr => this.toAbsoluteUri(pathStr, workspaceRoot))
                : group.files;

            // Deduplicate by fsPath to fix any existing bad data
            if (files) {
                const seen = new Set<string>();
                files = files.filter(f => {
                    try {
                        const key = process.platform === 'win32'
                            ? vscode.Uri.parse(f).fsPath.toLowerCase()
                            : vscode.Uri.parse(f).fsPath;
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    } catch { return true; }
                });
            }

            return {
                ...group,
                files,
                bookmarks: group.bookmarks ? this.fromStorageBookmarks(group.bookmarks, workspaceRoot) : group.bookmarks
            };
        });
    }

    private toRelativeBookmarks(bookmarks: Record<string, VTBookmark[]>, workspaceRoot: string): Record<string, VTBookmark[]> {
        const result: Record<string, VTBookmark[]> = {};
        for (const [fileUri, items] of Object.entries(bookmarks)) {
            const key = this.toRelativePath(fileUri, workspaceRoot);
            result[key] = items;
        }
        return result;
    }

    private fromStorageBookmarks(bookmarks: Record<string, VTBookmark[]>, workspaceRoot: string): Record<string, VTBookmark[]> {
        const result: Record<string, VTBookmark[]> = {};
        for (const [storedPath, items] of Object.entries(bookmarks)) {
            const key = this.toAbsoluteUri(storedPath, workspaceRoot);
            result[key] = items;
        }
        return result;
    }

    /** Cached PathUtils instance per workspace root (avoids repeated allocations). */
    private pathUtilsCache: { root: string; instance: PathUtils } | undefined;

    private getPathUtils(workspaceRoot: string): PathUtils {
        if (this.pathUtilsCache && this.pathUtilsCache.root === workspaceRoot) {
            return this.pathUtilsCache.instance;
        }
        const instance = new PathUtils(workspaceRoot);
        this.pathUtilsCache = { root: workspaceRoot, instance };
        return instance;
    }

    private toRelativePath(value: string, workspaceRoot: string): string {
        try {
            return this.getPathUtils(workspaceRoot).toRelativePath(value);
        } catch (error) {
            console.error('Failed to convert path to relative:', error);
            return value;
        }
    }

    private toAbsoluteUri(value: string, workspaceRoot: string): string {
        try {
            const pu = this.getPathUtils(workspaceRoot);
            // If already a file:// URI, return as-is
            if (value.startsWith('file://')) return value;
            return pu.toFileUri(pu.toAbsolutePath(value));
        } catch (error) {
            console.error('Failed to convert path to file URI:', error);
            return value;
        }
    }

    private getWorkspaceRootPath(): string | undefined {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder?.uri.fsPath;
    }

    private initBuiltInGroup() {
        this.builtInEditorGroups = this.computeEditorGroups();
        // Get all open editor files
        const openUris = vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .map(tab => getTabUri(tab))
            .filter((uri): uri is vscode.Uri => !!uri)
            .map(uri => uri.toString());
        this.groups.unshift({
            id: 'builtin_group_id', // Fixed ID for built-in group
            name: I18n.getBuiltInGroupName(),
            files: openUris,
            builtIn: true
        });
    }

    /**
     * Build a snapshot of VS Code editor groups containing at least one text/notebook file.
     * Groups with only non-text tabs (e.g. Settings, Welcome) are excluded.
     */
    private computeEditorGroups(): EditorGroupInfo[] {
        return vscode.window.tabGroups.all
            .map((tabGroup, idx) => ({
                viewColumn: tabGroup.viewColumn,
                label: I18n.getMessage('group.editorGroupName', String(idx + 1)),
                files: tabGroup.tabs
                    .map(tab => getTabUri(tab))
                    .filter((uri): uri is vscode.Uri => !!uri)
                    .map(uri => uri.toString())
            }))
            .filter(group => group.files.length > 0);
    }

    /**
     * Returns true if the new editor group snapshot differs from the current one
     * in either count, column assignment, or file distribution.
     * Matches groups by viewColumn (not array index) to handle reordering correctly.
     */
    private hasEditorGroupStructureChanged(newGroups: EditorGroupInfo[]): boolean {
        if (newGroups.length !== this.builtInEditorGroups.length) return true;

        const oldByViewColumn = new Map(this.builtInEditorGroups.map(g => [g.viewColumn, g]));

        for (const ng of newGroups) {
            const og = oldByViewColumn.get(ng.viewColumn);
            if (!og) return true; // New view column appeared
            const ngFiles = new Set(ng.files);
            const ogFiles = new Set(og.files);
            if (ngFiles.size !== ogFiles.size) return true;
            for (const f of ngFiles) {
                if (!ogFiles.has(f)) return true;
            }
        }
        return false;
    }

    /**
     * Synchronize the built-in group ("Currently Open Files") with actual VS Code tabs.
     * Fires tree update if the set of open files, their order, or the editor-group distribution changed.
     */
    syncBuiltInGroup(): boolean {
        let changed = false;
        const builtIn = this.groups.find(g => g.builtIn);
        
        if (builtIn) {
            const newEditorGroups = this.computeEditorGroups();
            const openUris = newEditorGroups.flatMap(g => g.files);
            
            const oldFiles = builtIn.files || [];
            const oldSet = new Set(oldFiles);
            const newSet = new Set(openUris);
            
            let setsEqual = oldSet.size === newSet.size;
            if (setsEqual) {
                for (const uri of newSet) {
                    if (!oldSet.has(uri)) {
                        setsEqual = false;
                        break;
                    }
                }
            }

            const orderChanged = setsEqual && !this.arraysEqualInOrder(oldFiles, openUris);
            const groupStructureChanged = this.hasEditorGroupStructureChanged(newEditorGroups);

            if (!setsEqual || orderChanged || groupStructureChanged) {
                this.builtInEditorGroups = newEditorGroups;

                if (!setsEqual) {
                    // Keep order stable: retain old files in their current order, append new ones
                    const newFilesStable = oldFiles.filter(uri => newSet.has(uri));
                    for (const uri of openUris) {
                        if (!oldSet.has(uri)) {
                            newFilesStable.push(uri);
                        }
                    }
                    builtIn.files = newFilesStable;
                } else if (orderChanged) {
                    // Native panel was reordered — follow VS Code's order
                    builtIn.files = openUris;
                }

                this.saveGroups();
                this._onDidChangeTreeData.fire(undefined);
                changed = true;
            }
        }
        return changed;
    }

    private arraysEqualInOrder(a: string[], b: string[]): boolean {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    refresh(save: boolean = true): void {
        // Resync built-in group content but force the update
        const builtIn = this.groups.find(g => g.builtIn);
        if (builtIn) {
            this.builtInEditorGroups = this.computeEditorGroups();
            const openUris = vscode.window.tabGroups.all
                .flatMap(g => g.tabs)
                .map(tab => getTabUri(tab))
                .filter((uri): uri is vscode.Uri => !!uri)
                .map(uri => uri.toString());
            builtIn.files = openUris;
        }

        if (save) {
            this.saveGroups();
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    addGroup() {
        // Auto-generate name: New Group 1, 2, ...
        let idx = 1;
        let name = I18n.getGroupName(undefined, idx);
        while (this.groups.some(g => g.name === name)) {
            idx++;
            name = I18n.getGroupName(undefined, idx);
        }
        this.groups.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            name,
            files: []
        });
        this.refresh();
    }

    addSubGroup(parentGroupId: string) {
        // Validation: Parent must exist (unless it's null, but view logic handles that)
        const parent = this.groups.find(g => g.id === parentGroupId);
        if (!parent) return;

        // Auto-generate name with prefix
        let idx = 1;
        let name = I18n.getGroupName(undefined, idx);
        // Scoped name check (global check is safer for simplicity)
        while (this.groups.some(g => g.name === name)) {
            idx++;
            name = I18n.getGroupName(undefined, idx);
        }

        this.groups.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            name,
            files: [],
            parentGroupId: parentGroupId
        });
        this.refresh();
    }

    moveGroup(groupId: string, direction: 'up' | 'down') {
        const currentIndex = this.groups.findIndex(group => group.id === groupId);
        if (currentIndex < 0) return;

        const group = this.groups[currentIndex];
        if (!group || group.builtIn) return;

        const parentId = group.parentGroupId ?? null;
        const siblings = this.groups
            .map((g, idx) => ({ group: g, idx }))
            .filter(({ group: g }) => (g.parentGroupId ?? null) === parentId);

        const currentPosition = siblings.findIndex(sibling => sibling.idx === currentIndex);
        if (currentPosition < 0) return;

        const offset = direction === 'up' ? -1 : 1;
        const targetPosition = currentPosition + offset;
        if (targetPosition < 0 || targetPosition >= siblings.length) return;

        const target = siblings[targetPosition].group;
        if (target.builtIn) return;

        let insertIndex = siblings[targetPosition].idx + (direction === 'down' ? 1 : 0);
        if (insertIndex > currentIndex) {
            insertIndex -= 1;
        }

        this.groups.splice(currentIndex, 1);
        this.groups.splice(insertIndex, 0, group);
        this.refresh();
    }

    /**
     * Remove group by ID (recursive)
     * Recommended over index-based removal for nested structures
     */
    removeGroupById(id: string) {
        const group = this.groups.find(g => g.id === id);
        if (!group || group.builtIn) return;

        // 1. Find all descendants recursively
        const idsToRemove = new Set<string>();
        const collectIds = (currentId: string) => {
            idsToRemove.add(currentId);
            const children = this.groups.filter(g => g.parentGroupId === currentId);
            for (const child of children) {
                collectIds(child.id);
            }
        };
        collectIds(id);

        // 2. Filter out all collected IDs
        this.groups = this.groups.filter(g => !idsToRemove.has(g.id));
        this.refresh();
    }

    addFilesToGroup(groupIdx: number, uris: string[]) {
        const group = this.groups[groupIdx];
        if (!group) return;
        if (!group.files) group.files = [];
        // Avoid duplicates using fsPath comparison (handles URI encoding differences)
        for (const uri of uris) {
            const incomingFsPath = vscode.Uri.parse(uri).fsPath;
            const isDuplicate = group.files.some(f => {
                try { return this.pathsEqual(vscode.Uri.parse(f).fsPath, incomingFsPath); }
                catch { return f === uri; }
            });
            if (!isDuplicate) {
                group.files.push(uri);
            }
        }
        this.refresh();
    }

    private getAllFilesInGroupRecursive(groupId: string): string[] {
        const files = new Set<string>();
        const visited = new Set<string>();

        const collect = (currentId: string) => {
            if (visited.has(currentId)) return;
            visited.add(currentId);

            const group = this.groups.find(g => g.id === currentId);
            if (!group) return;

            if (group.files) {
                for (const uri of group.files) {
                    files.add(uri);
                }
            }

            const children = this.groups.filter(g => g.parentGroupId === currentId);
            for (const child of children) {
                if (child.id) {
                    collect(child.id);
                }
            }
        };

        collect(groupId);
        return Array.from(files);
    }

    /**
     * Reorder file inside a group via drag and drop
     */
    reorderFileInGroup(groupIdx: number, fileUri: string, targetUri: string | null) {
        const group = this.groups[groupIdx];
        if (!group || !group.files || group.builtIn) return;

        // Clear sort preference inline (no intermediate refresh/save)
        if (group.sortBy && group.sortBy !== 'none') {
            group.sortBy = 'none';
            group.sortOrder = 'asc';
            vscode.window.showInformationMessage(I18n.getMessage('message.sortClearedForReorder'));
        }

        const files = [...group.files];
        const srcFsPath = vscode.Uri.parse(fileUri).fsPath;
        const currentIndex = files.findIndex(f => vscode.Uri.parse(f).fsPath === srcFsPath);
        if (currentIndex === -1) return;

        // Use the stored URI (not the incoming one) to preserve format consistency
        const storedFileUri = files[currentIndex];

        // Remove from current position
        files.splice(currentIndex, 1);

        if (targetUri === null) {
            // Drop on folder -> move to end
            files.push(storedFileUri);
        } else {
            // Drop on file -> insert before target
            const tgtFsPath = vscode.Uri.parse(targetUri).fsPath;
            const targetIndex = files.findIndex(f => vscode.Uri.parse(f).fsPath === tgtFsPath);
            if (targetIndex !== -1) {
                files.splice(targetIndex, 0, storedFileUri);
            } else {
                files.push(storedFileUri);
            }
        }

        group.files = files;
        this.refresh();
    }

    /**
     * Move file up/down via keyboard shortcuts
     */
    moveFileInGroup(groupIdx: number, fileUri: string, direction: 'up' | 'down') {
        const group = this.groups[groupIdx];
        if (!group || !group.files || group.builtIn) return;

        // Clear sort preference inline (no intermediate refresh/save)
        if (group.sortBy && group.sortBy !== 'none') {
            group.sortBy = 'none';
            group.sortOrder = 'asc';
            vscode.window.showInformationMessage(I18n.getMessage('message.sortClearedForReorder'));
        }

        const files = group.files;
        const targetFsPath = vscode.Uri.parse(fileUri).fsPath;
        const currentIndex = files.findIndex(f => vscode.Uri.parse(f).fsPath === targetFsPath);
        if (currentIndex === -1) return;

        if (direction === 'up' && currentIndex > 0) {
            // Swap with previous
            [files[currentIndex - 1], files[currentIndex]] = [files[currentIndex], files[currentIndex - 1]];
            this.refresh();
        } else if (direction === 'down' && currentIndex < files.length - 1) {
            // Swap with next
            [files[currentIndex + 1], files[currentIndex]] = [files[currentIndex], files[currentIndex + 1]];
            this.refresh();
        }
    }

    // One-click open all files in group (only for custom groups)
    async openAllFilesInGroup(idx: number) {
        const group = this.groups[idx];
        // Skip if built-in group
        if (!group || group.builtIn) return;

        const files = group.id ? this.getAllFilesInGroupRecursive(group.id) : (group.files || []);
        if (files.length > 0) {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: I18n.getMessage('progress.openingFiles', group.name),
                cancellable: false
            }, async (progress) => {
                const total = files.length;
                let openedCount = 0;
                const step = 100 / total;

                // Open files sequentially, waiting briefly after each
                for (const uriStr of files) {
                    try {
                        const uri = vscode.Uri.parse(uriStr);
                        await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
                        openedCount++;
                        progress.report({
                            increment: step,
                            message: I18n.getMessage('progress.fileCount', openedCount.toString(), total.toString())
                        });
                        // Give the system a moment to settle
                        await new Promise(resolve => setTimeout(resolve, 100));
                    } catch (e) {
                        console.error(I18n.getMessage('error.cannotOpenFile', uriStr), e);
                    }
                }
            });
        } else {
            vscode.window.showInformationMessage(I18n.getMessage('message.noFilesToOpen', group.name));
        }
    }

    // One-click close all files in group (only for custom groups)
    async closeAllFilesInGroup(idx: number) {
        const group = this.groups[idx];
        // Skip if built-in group
        if (!group || group.builtIn) return;

        const files = group.id ? this.getAllFilesInGroupRecursive(group.id) : (group.files || []);
        if (files.length > 0) {
            // Show progress notification
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: I18n.getMessage('progress.closingFiles', group.name),
                cancellable: false
            }, async (progress) => {
                const total = files.length;
                let closedCount = 0;
                const step = 100 / total;

                // Convert to URI objects

                // Find all open tabs matching the group's files
                const tabsToClose: vscode.Tab[] = [];
                vscode.window.tabGroups.all.forEach(tabGroup => {
                    tabGroup.tabs.forEach(tab => {
                        const tabUri = getTabUri(tab);
                        if (tabUri) {
                            const tabUriStr = tabUri.toString();
                            if (files.includes(tabUriStr)) {
                                tabsToClose.push(tab);
                            }
                        }
                    });
                });

                // Close tabs one by one, waiting briefly after each
                for (const tab of tabsToClose) {
                    try {
                        await vscode.window.tabGroups.close(tab);
                        closedCount++;
                        progress.report({
                            increment: step,
                            message: I18n.getMessage('progress.fileCount', closedCount.toString(), tabsToClose.length.toString())
                        });
                        // Give the system a moment to settle
                        await new Promise(resolve => setTimeout(resolve, 50));
                    } catch (e) {
                        console.error(I18n.getMessage('error.cannotCloseTab'), e);
                    }
                }

            });
        } else {
            vscode.window.showInformationMessage(I18n.getMessage('message.noFilesToClose', group.name));
        }
    }

    // Open multiple selected files
    async openSelectedFiles(fileItems: TempFileItem[]) {
        if (fileItems.length === 0) return;

        // Show progress notification
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: I18n.getMessage('progress.openingSelected'),
            cancellable: false
        }, async (progress) => {
            const total = fileItems.length;
            let openedCount = 0;
            const step = 100 / total;

            // Open files sequentially
            for (const item of fileItems) {
                try {
                    await vscode.commands.executeCommand('vscode.open', item.uri);
                    openedCount++;
                    progress.report({
                        increment: step,
                        message: I18n.getMessage('progress.fileCount', openedCount.toString(), total.toString())
                    });
                    // Give the system a moment to settle
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (e) {
                    console.error(I18n.getMessage('error.cannotOpenFile', item.uri.toString()), e);
                }
            }
        });
    }

    // Close multiple selected files
    async closeSelectedFiles(fileItems: TempFileItem[]) {
        if (fileItems.length === 0) return;

        // Show progress notification
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: I18n.getMessage('progress.closingSelected'),
            cancellable: false
        }, async (progress) => {
            const total = fileItems.length;
            let closedCount = 0;
            const step = 100 / total;

            const uriStrings = fileItems.map(item => item.uri.toString());

            // Collect tabs to close
            const tabsToClose: vscode.Tab[] = [];
            vscode.window.tabGroups.all.forEach(tabGroup => {
                tabGroup.tabs.forEach(tab => {
                    const tabUri = getTabUri(tab);
                    if (tabUri && uriStrings.includes(tabUri.toString())) {
                        tabsToClose.push(tab);
                    }
                });
            });

            // Close tabs one by one
            for (const tab of tabsToClose) {
                try {
                    await vscode.window.tabGroups.close(tab);
                    closedCount++;
                    progress.report({
                        increment: step,
                        message: I18n.getMessage('progress.fileCount', closedCount.toString(), tabsToClose.length.toString())
                    });
                    // Give the system a moment to settle
                    await new Promise(resolve => setTimeout(resolve, 50));
                } catch (e) {
                    console.error(I18n.getMessage('error.cannotCloseTab'), e);
                }
            }

        });
    }

    // Close a single file (inline action)
    async closeFile(fileItem: TempFileItem) {
        if (!(fileItem instanceof TempFileItem)) return;

        const uriStr = fileItem.uri.toString();
        const tabsToClose: vscode.Tab[] = [];

        vscode.window.tabGroups.all.forEach(tabGroup => {
            tabGroup.tabs.forEach(tab => {
                const tabUri = getTabUri(tab);
                if (tabUri && tabUri.toString() === uriStr) {
                    tabsToClose.push(tab);
                }
            });
        });

        for (const tab of tabsToClose) {
            try {
                await vscode.window.tabGroups.close(tab);
            } catch (e) {
                console.error(I18n.getMessage('error.cannotCloseTab'), e);
            }
        }
    }

    // Remove multiple selected files from a group
    removeFilesFromGroup(groupIdx: number, fileItems: TempFileItem[]) {
        const group = this.groups[groupIdx];
        if (!group || !group.files || fileItems.length === 0) return;

        // Ensure all selected files belong to the specified group
        const uriStrings = fileItems.map(item => item.uri.toString());

        // Remove files from the specified group
        group.files = group.files.filter(uriStr => !uriStrings.includes(uriStr));


        this.refresh();
    }

    // Add multiple selected files to a specified group
    addMultipleFilesToGroup(groupIdx: number, fileItems: TempFileItem[]) {
        if (fileItems.length === 0) return;

        const uriStrings = fileItems.map(item => item.uri.toString());
        this.addFilesToGroup(groupIdx, uriStrings);
    }

    /**
     * Only auto-group by extension for files in the user-selected group.
     * If no group is selected, show a prompt. No longer fallback to all open files.
     */
    addAutoGroupsByExt() {
        // Only allow single group selection
        if (!this.treeView || this.treeView.selection.length !== 1 || !(this.treeView.selection[0] instanceof TempFolderItem)) {
            vscode.window.showInformationMessage(I18n.getMessage('message.pleaseSelectGroup'));
            return;
        }
        const groupIdx = (this.treeView.selection[0] as TempFolderItem).groupIdx;
        const group = this.groups[groupIdx];
        if (!group || !group.files || group.files.length === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('message.noFilesToGroup'));
            return;
        }
        // Group by extension
        const extMap: Record<string, string[]> = {};
        for (const uriStr of group.files) {
            try {
                const uri = vscode.Uri.parse(uriStr);
                const ext = uri.fsPath.split('.').pop()?.toLowerCase() || 'other';
                if (!extMap[ext]) extMap[ext] = [];
                extMap[ext].push(uriStr);
            } catch { }
        }
        // Remove old auto groups (cleanup via sourceGroupId or legacy auto check)
        this.groups = this.groups.filter((g) => {
            // Keep if it's the source group itself
            if (g.id === group.id) return true;
            // Remove if it's an auto group sourced from this group
            if (g.auto && (g.sourceGroupId === group.id)) return false;
            // Legacy cleanup (optional, but safer to rely on ID now)
            return true;
        });

        // Insert auto groups at the original group position (after it)
        const newGroups = Object.entries(extMap).map(([ext, files]) => ({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            name: `${I18n.getAutoGroupName(ext)} @ ${group.name}`, // Naming: .ext @ Source
            files,
            auto: true,
            sourceGroupId: group.id
        }));

        // Find fresh index of group because filtering might have shifted it
        const newGroupIdx = this.groups.findIndex(g => g.id === group.id);
        if (newGroupIdx !== -1) {
            this.groups.splice(newGroupIdx + 1, 0, ...newGroups);
        }
        this.refresh();
    }

    /**
     * Set sort preference for a group
     * @param groupIdx Group index
     * @param criteria Sort criteria
     * @param order Sort order (ascending or descending)
     */
    setSortPreference(groupIdx: number, criteria: SortCriteria, order: 'asc' | 'desc' = 'asc') {
        const group = this.groups[groupIdx];
        if (!group) return;

        group.sortBy = criteria;
        group.sortOrder = order;
        this.refresh();
    }

    /**
     * Auto-group files by modified date
     * Only works on user-selected group
     */
    autoGroupByModifiedDate() {
        // Only allow single group selection
        if (!this.treeView || this.treeView.selection.length !== 1 || !(this.treeView.selection[0] instanceof TempFolderItem)) {
            vscode.window.showInformationMessage(I18n.getMessage('message.pleaseSelectGroup'));
            return;
        }

        const groupIdx = (this.treeView.selection[0] as TempFolderItem).groupIdx;
        const group = this.groups[groupIdx];

        if (!group || !group.files || group.files.length === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('message.noFilesToGroup'));
            return;
        }

        // Group by modified date
        const dateGroups = AutoGrouper.groupByModifiedDate(group.files);

        // Remove old auto groups related to this source group
        this.groups = this.groups.filter((g) => {
            if (g.id === group.id) return true;
            if (g.auto && (g.sourceGroupId === group.id)) return false;
            return true;
        });

        // Create new date-based groups
        const newGroups: TempGroup[] = [];
        const dateOrder: DateGroup[] = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'older'];

        for (const dateGroup of dateOrder) {
            const files = dateGroups.get(dateGroup);
            if (files && files.length > 0) {
                newGroups.push({
                    id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
                    name: `${I18n.getMessage('group.autoGroupPrefix')} ${AutoGrouper.getDateGroupLabel(dateGroup, I18n)} @ ${group.name}`, // Naming: [Auto] Label @ Source
                    files,
                    auto: true,
                    autoGroupType: 'modifiedDate',
                    sourceGroupId: group.id
                    // Removed parentGroupId to make it sibling
                });
            }
        }

        // Find fresh index
        const newGroupIdx = this.groups.findIndex(g => g.id === group.id);
        if (newGroupIdx !== -1) {
            this.groups.splice(newGroupIdx + 1, 0, ...newGroups);
        }

        this.refresh();
    }

    /**
     * Required by TreeView.reveal() to open collapsed folders
     */
    getParent(element: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem> {
        if (element instanceof BookmarkItem) {
            // Return corresponding TempFileItem
            const group = this.groups[element.groupIdx];
            return new TempFileItem(element.fileUri, element.groupIdx, group?.builtIn, group?.id);
        }
        if (element instanceof EditorGroupItem) {
            // Return the built-in TempFolderItem
            const builtInIdx = this.groups.findIndex(g => g.builtIn);
            if (builtInIdx === -1) return undefined;
            const builtIn = this.groups[builtInIdx];
            return new TempFolderItem(builtIn.name, builtInIdx, builtIn.id, true);
        }
        if (element instanceof TempFileItem) {
            // Return corresponding TempFolderItem
            const group = this.groups[element.groupIdx];
            if (group?.builtIn && this.builtInEditorGroups.length > 1) {
                // Extension Fix: Use stored subId (viewColumn) to find the correct EditorGroupItem
                if (element.subId) {
                    const viewColumn = parseInt(element.subId, 10);
                    const editorGroup = this.builtInEditorGroups.find(eg => eg.viewColumn === viewColumn);
                    if (editorGroup) {
                        return new EditorGroupItem(editorGroup.label, editorGroup.viewColumn, element.groupIdx, group.id);
                    }
                }
                // Fallback (e.g. if subId is missing)
                const uriStr = element.uri.toString();
                const editorGroup = this.builtInEditorGroups.find(eg => eg.files.includes(uriStr));
                if (editorGroup) {
                    return new EditorGroupItem(editorGroup.label, editorGroup.viewColumn, element.groupIdx, group.id);
                }
            }
            if (group) {
                return new TempFolderItem(group.name, element.groupIdx, group.id, group.builtIn);
            }
        }
        if (element instanceof TempFolderItem) {
            // Return parent TempFolderItem if it's a sub-group
            const group = this.groups[element.groupIdx];
            if (group && group.parentGroupId) {
                const parentIdx = this.groups.findIndex(g => g.id === group.parentGroupId);
                const parentGroup = this.groups[parentIdx];
                if (parentGroup) {
                    return new TempFolderItem(parentGroup.name, parentIdx, parentGroup.id, parentGroup.builtIn, true);
                }
            }
        }
        return undefined;
    }

    /**
     * Return the TempFolderItem for the built-in group to use in a pre-reveal expand call.
     */
    getBuiltInFolderItem(): TempFolderItem | undefined {
        const builtInIdx = this.groups.findIndex(g => g.builtIn);
        if (builtInIdx === -1) return undefined;
        const group = this.groups[builtInIdx];
        return new TempFolderItem(group.name, builtInIdx, group.id, true);
    }

    /**
     * Helper for platform-specific path comparison.
     */
    private pathsEqual(p1: string, p2: string): boolean {
        if (p1 === p2) return true;
        // On Windows, paths are case-insensitive.
        if (process.platform === 'win32') {
            return p1.toLowerCase() === p2.toLowerCase();
        }
        return false;
    }

    /**
     * Find a TempFileItem in the built-in group (Currently Open Files).
     * Returns the EXACT same instance that was rendered by getChildren() via the registry,
     * so that TreeView.reveal() can find the node.
     * @param viewColumn Optional: specify which editor group to target (used for disambiguation)
     */
    findInternalFileItem(uri: vscode.Uri, viewColumn?: number): TempFileItem | undefined {
        const targetFsPath = uri.fsPath;
        let matchedCustomItems: TempFileItem[] = [];

        // 1. Group Isolation: Prioritize cached items in Custom Groups.
        // This ensures if a user opens a file that belongs to a custom group, 
        // the auto-reveal highlights the custom group instead of the built-in one.
        for (const item of this.fileItemRegistry.values()) {
            if (item instanceof TempFileItem) {
                const isMatch = item.uri.toString() === uri.toString() ||
                    (process.platform === 'win32' && this.pathsEqual(item.uri.fsPath, targetFsPath));

                if (isMatch) {
                    const group = this.groups[item.groupIdx];
                    if (group && !group.builtIn) {
                        matchedCustomItems.push(item);
                    }
                }
            }
        }

        if (matchedCustomItems.length > 0) {
            return matchedCustomItems[0];
        }

        // 2. Fallback: Search the built-in group (Currently Open Files)
        const builtInIdx = this.groups.findIndex(g => g.builtIn);
        if (builtInIdx === -1) return undefined;
        
        const group = this.groups[builtInIdx];
        if (!group || !group.files) return undefined;

        // Fallback matching to handle URI casing/encoding differences on Windows
        const matchedStr = group.files.find(f => {
            if (f === uri.toString()) return true;
            try {
                return this.pathsEqual(vscode.Uri.parse(f).fsPath, targetFsPath);
            } catch {
                return false;
            }
        });

        if (!matchedStr) return undefined;

        // Construct the stable ID exactly as TempFileItem constructor does
        const matchedUri = vscode.Uri.parse(matchedStr);
        const subId = (this.builtInEditorGroups.length > 1 && viewColumn !== undefined) ? viewColumn.toString() : undefined;
        const expectedId = `virtualTabsFile:${group.id}${subId ? ':' + subId : ''}:${matchedUri.toString()}`;
        
        // First try: return cached exact instance from the registry
        const cached = this.fileItemRegistry.get(expectedId);
        if (cached) return cached;

        // Fallback: construct a new one (tree might not have expanded yet)
        return new TempFileItem(matchedUri, builtInIdx, true, group.id, subId);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
        if (!element) {
            // Root Level: Show top-level groups (no parentGroupId)
            return this.groups
                .map((g, idx) => ({ group: g, idx })) // Map to preserve original index
                .filter(({ group }) => !group.parentGroupId)
                .map(({ group, idx }) => {
                    const item = new TempFolderItem(group.name, idx, group.id, group.builtIn);
                    item.collapsibleState = this.isGroupExpanded(group.id)
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.Collapsed;
                    return item;
                });
        }

        // Expanded Group Node: Show Sub-groups AND Files
        if (element instanceof TempFolderItem) {
            const group = this.groups[element.groupIdx];
            // Safety check: index might be stale if groups array shifted, but for now we rely on refresh() keeping it consistent.
            // Ideally should find group by ID, but that requires O(N) search or Map.
            // Since we rebuild tree on every refresh, index is generally safe *within* a render cycle.

            if (!group) return [];

            // Built-in group with multiple editor groups: render editor-group sub-nodes
            if (group.builtIn && this.builtInEditorGroups.length > 1) {
                this.fileItemRegistry.clear();
                return this.builtInEditorGroups.map(eg =>
                    new EditorGroupItem(eg.label, eg.viewColumn, element.groupIdx, group.id)
                );
            }

            const items: vscode.TreeItem[] = [];

            // 1. Sub-groups
            const subGroups = this.groups
                .map((g, idx) => ({ group: g, idx }))
                .filter(({ group: g }) => g.parentGroupId === element.groupId); // Compare with parent's ID

            items.push(...subGroups.map(({ group: g, idx }) =>
                (() => {
                    const item = new TempFolderItem(g.name, idx, g.id, g.builtIn, true); // Mark as sub-group
                    item.collapsibleState = this.isGroupExpanded(g.id)
                        ? vscode.TreeItemCollapsibleState.Expanded
                        : vscode.TreeItemCollapsibleState.Collapsed;
                    return item;
                })()
            ));

            // 2. Files
            if (group.files && group.files.length > 0) {
                // Apply sorting before rendering
                const sortedFiles = FileSorter.sortFiles(
                    group.files,
                    group.sortBy || 'none',
                    group.sortOrder || 'asc'
                );

                // Clear stale registrations for this group before re-populating
                if (group.builtIn) {
                    this.fileItemRegistry.clear();
                }

                const fileItems = sortedFiles.map(uriStr => {
                    const uri = vscode.Uri.parse(uriStr);
                    const fileItem = new TempFileItem(uri, element.groupIdx, group.builtIn, group.id);

                    // Cache the rendered item so reveal() can use the same instance
                    if (group.builtIn && fileItem.id) {
                        this.fileItemRegistry.set(fileItem.id, fileItem);
                    }

                    // Check if file has bookmarks (v0.2.0)
                    const bookmarks = BookmarkManager.getBookmarksForFile(group, uriStr);
                    if (bookmarks.length > 0) {
                        // Set file as expandable if it has bookmarks
                        fileItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    }

                    return fileItem;
                });

                items.push(...fileItems);
            }

            return items;
        }

        // Editor-group sub-node: show the files belonging to that VS Code editor group
        if (element instanceof EditorGroupItem) {
            const builtInIdx = this.groups.findIndex(g => g.builtIn);
            if (builtInIdx === -1) return [];
            const builtIn = this.groups[builtInIdx];

            const editorGroup = this.builtInEditorGroups.find(eg => eg.viewColumn === element.viewColumn);
            if (!editorGroup) return [];

            return editorGroup.files.map(uriStr => {
                const uri = vscode.Uri.parse(uriStr);
                // Fix Collision: Pass viewColumn as subId to keep ID unique across groups
                const fileItem = new TempFileItem(uri, builtInIdx, true, builtIn.id, editorGroup.viewColumn.toString());

                // Register for reveal() lookup
                if (fileItem.id) {
                    this.fileItemRegistry.set(fileItem.id, fileItem);
                }

                return fileItem;
            });
        }

        // If it's a file node, show bookmarks (v0.2.0)
        if (element instanceof TempFileItem) {
            const group = this.groups[element.groupIdx];
            const bookmarks = BookmarkManager.getBookmarksForFile(
                group,
                element.uri.toString()
            );

            return bookmarks.map(bookmark =>
                new BookmarkItem(bookmark, element.uri, element.groupIdx)
            );
        }

        return [];
    }
}

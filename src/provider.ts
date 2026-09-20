import * as vscode from 'vscode';
import * as path from 'path';
import { TempGroup, SortCriteria, DateGroup, VTBookmark, ConfigScope } from './types';
import { TempFileItem, TempFolderItem, BookmarkItem, EditorGroupItem, ScopeHeaderItem } from './treeItems';
import { I18n } from './i18n';
import { FileSorter } from './core/FileSorter';
import { AutoGrouper } from './core/AutoGrouper';
import { BookmarkManager } from './core/BookmarkManager';
import { GroupManager, OptimisticLockError } from './core/GroupManager';
import { PathUtils } from './core/PathUtils';
import { ConfigScopeDiscovery } from './core/ConfigScopeDiscovery';
import { removeStoredFileEntriesFromGroup } from './core/GroupFileRemoval';

export const BUILTIN_SCOPE_ID = '__builtin__';

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
    private expandedScopeIds: Set<string> = new Set();
    private scopeOrderIds: string[] = [];
    private activeScopeIds: Set<string> = new Set();
    private treeView?: vscode.TreeView<vscode.TreeItem>;

    // Debounce timer for saving groups to reduce disk I/O
    private saveDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingSaveScopeIds: Set<string> = new Set();
    private pendingSaveAllScopes: boolean = false;

    // Flag to ignore file system events triggered by the extension itself
    private isInternalSaving: boolean = false;

    // 多 GroupManager 架構：以 ConfigScope.id 為 key
    private groupManagers: Map<string, GroupManager> = new Map();
    // 各 scope 的最後載入版本號（用於 optimistic locking）
    private loadedVersions: Map<string, number> = new Map();
    // 已探索的 ConfigScope 陣列
    public configScopes: ConfigScope[] = [];

    // Registry of rendered TempFileItems by ID, so reveal() can use exact same instance
    private fileItemRegistry: Map<string, TempFileItem> = new Map();

    // Cache for built-in group TempFileItems — avoids recreating on every fire(undefined)
    private builtInItemsCache: TempFileItem[] | null = null;
    private builtInFilesSnapshot: string[] = [];

    // Per-group file lists mirroring vscode.window.tabGroups.all (in-memory only, not persisted)
    private builtInEditorGroups: EditorGroupInfo[] = [];

    constructor(private readonly context?: vscode.ExtensionContext) {
        this.scopeOrderIds = this.context?.workspaceState.get<string[]>('virtualTabs.scopeOrder', []) ?? [];

        // 探索所有 ConfigScope，為每個 scope 建立對應的 GroupManager
        this.configScopes = this.applyScopeOrder(ConfigScopeDiscovery.discover());
        this.assertUniqueScopeIds(this.configScopes);
        for (const scope of this.configScopes) {
            const gm = new GroupManager(this.getConfigStorageRoot(scope));
            this.migrateLegacyWorkspaceConfig(scope, gm);
            this.groupManagers.set(scope.id, gm);
        }

        // 無工作區資料夾時，設定 context key 停用群組管理功能
        vscode.commands.executeCommand(
            'setContext',
            'virtualTabs:hasWorkspace',
            this.configScopes.length > 0
        );
        this.updateScopeHeadersContext();

        this.loadGroups();
        if (!this.groups.some(g => g.builtIn)) {
            this.initBuiltInGroup();
        }
    }

    /**
     * 重新初始化所有 ConfigScope 和 GroupManager（工作區資料夾變更時呼叫）
     */
    public reinitializeScopes(): void {
        this.configScopes = this.applyScopeOrder(ConfigScopeDiscovery.discover());
        this.assertUniqueScopeIds(this.configScopes);
        for (const id of [...this.activeScopeIds]) {
            if (id !== BUILTIN_SCOPE_ID && !this.configScopes.some(scope => scope.id === id)) {
                this.activeScopeIds.delete(id);
            }
        }
        for (const scope of this.configScopes) {
            if (!this.expandedScopeIds.has(scope.id)) {
                this.expandedScopeIds.add(scope.id);
            }
        }
        this.groupManagers.clear();
        this.loadedVersions.clear();

        for (const scope of this.configScopes) {
            const gm = new GroupManager(this.getConfigStorageRoot(scope));
            this.migrateLegacyWorkspaceConfig(scope, gm);
            this.groupManagers.set(scope.id, gm);
        }

        this.updateScopeHeadersContext();

        // 重新載入所有群組
        const builtInGroups = this.groups.filter(g => g.builtIn);
        this.groups = [...builtInGroups];
        this.loadGroups();
        this.refresh(false);
    }

    /**
     * 防禦性檢查：ConfigScope.id 必須唯一，否則後續以 scope.id 為 key 的
     * groupManagers.set() 會靜默覆蓋前一個 scope 的 GroupManager，導致
     * loadGroups()/saveGroupsImmediate() 對同一組 scope id 重複讀寫同一份
     * 設定檔（症狀：群組資料每次啟動倍增）。
     *
     * ConfigScopeDiscovery 已針對已知的 self-root .code-workspace 情境
     * （workspace 父目錄與某個 folder 相同）從根源排除碰撞，這裡是最後一道
     * 防線：若仍發現重複 id（例如未來新增的 discovery 規則有疏漏），
     * 直接丟棄後出現的碰撞 scope 並記錄警告，而非讓 Map 靜默覆蓋。
     */
    private assertUniqueScopeIds(scopes: ConfigScope[]): void {
        const seen = new Set<string>();
        for (let i = scopes.length - 1; i >= 0; i--) {
            const id = scopes[i].id;
            if (seen.has(id)) {
                console.warn(`VirtualTabs: duplicate ConfigScope id detected, dropping colliding scope "${id}" (type: ${scopes[i].type}, label: ${scopes[i].label})`);
                scopes.splice(i, 1);
                continue;
            }
            seen.add(id);
        }
    }

    // Save TreeView reference for multi-select management
    setTreeView(treeView: vscode.TreeView<vscode.TreeItem>): void {
        this.treeView = treeView;
    }

    setExpandedGroupIds(ids: string[]): void {
        this.expandedGroupIds = new Set(ids);
    }

    setExpandedScopeIds(ids: string[]): void {
        this.expandedScopeIds = ids.length > 0
            ? new Set(ids)
            : new Set(this.configScopes.map(scope => scope.id));
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

    /**
     * True for the built-in group itself, or for an auto sub-group whose
     * sourceGroupId traces back to it. Auto sub-groups never get
     * `builtIn: true` themselves (only `sourceGroupId`), so both the
     * scope-filtered tree rendering and the save-routing logic need this
     * to treat them consistently as "not a real persisted, scoped group".
     */
    isBuiltInFamily(group: TempGroup): boolean {
        return !!group.builtIn || this.groups.find(g => g.id === group.sourceGroupId)?.builtIn === true;
    }

    updateScopeExpanded(id: string, expanded: boolean): string[] {
        if (expanded) {
            this.expandedScopeIds.add(id);
        } else {
            this.expandedScopeIds.delete(id);
        }
        return Array.from(this.expandedScopeIds);
    }

    isScopeExpanded(id: string): boolean {
        return this.expandedScopeIds.has(id);
    }

    getActiveScopeIds(): ReadonlySet<string> {
        return this.activeScopeIds;
    }

    setActiveScopeIds(ids: string[]): void {
        this.activeScopeIds = new Set(
            ids.filter(id => id === BUILTIN_SCOPE_ID || this.configScopes.some(scope => scope.id === id))
        );
        this.updateScopeHeadersContext();
        // Scope filter only changes the root-level structure; built-in group files are unchanged.
        // Fire directly instead of going through refresh() to avoid redundant builtIn sync.
        this._onDidChangeTreeData.fire(undefined);
    }

    private computeHasScopeHeaders(): boolean {
        const isFiltered = this.activeScopeIds.size > 0;
        if (isFiltered) {
            const visibleScopes = this.configScopes.filter(s => this.activeScopeIds.has(s.id));
            return visibleScopes.length !== 1;
        }
        return this.configScopes.length > 1;
    }

    private updateScopeHeadersContext(): void {
        vscode.commands.executeCommand(
            'setContext',
            'virtualTabs:hasMultipleScopes',
            this.computeHasScopeHeaders()
        );
    }

    /** Compute the treeView.description string reflecting the active scope filter. */
    computeScopeDescription(): string | undefined {
        if (this.activeScopeIds.size === 0) return undefined;
        const labels: string[] = [];
        if (this.activeScopeIds.has(BUILTIN_SCOPE_ID)) labels.push(I18n.getBuiltInGroupName());
        for (const scope of this.configScopes) {
            if (this.activeScopeIds.has(scope.id)) labels.push(this.getScopeLabel(scope));
        }
        if (labels.length === 0) return undefined;
        return labels.length === 1 ? labels[0] : `${labels.length} scopes`;
    }

    getScopeLabel(scope: ConfigScope): string {
        // Use scope.label (set by ConfigScopeDiscovery from VS Code's own
        // WorkspaceFolder.name) instead of re-deriving via path.basename,
        // which returns '' when a folder is opened at a filesystem root.
        return scope.type === 'workspace'
            ? 'Workspace Config'
            : `Project: ${scope.label}`;
    }

    moveScope(scopeId: string, direction: 'up' | 'down'): void {
        const currentIndex = this.configScopes.findIndex(scope => scope.id === scopeId);
        if (currentIndex < 0) return;

        const offset = direction === 'up' ? -1 : 1;
        const targetIndex = currentIndex + offset;
        if (targetIndex < 0 || targetIndex >= this.configScopes.length) return;

        const nextScopes = [...this.configScopes];
        const [scope] = nextScopes.splice(currentIndex, 1);
        nextScopes.splice(targetIndex, 0, scope);

        this.configScopes = nextScopes;
        this.scopeOrderIds = nextScopes.map(scope => scope.id);
        this.context?.workspaceState.update('virtualTabs.scopeOrder', this.scopeOrderIds);
        this.refresh(false);
    }

    private applyScopeOrder(scopes: ConfigScope[]): ConfigScope[] {
        if (this.scopeOrderIds.length === 0) {
            return scopes;
        }

        const orderIndex = new Map(this.scopeOrderIds.map((id, index) => [id, index]));
        return [...scopes].sort((a, b) => {
            const aIndex = orderIndex.get(a.id);
            const bIndex = orderIndex.get(b.id);
            if (aIndex === undefined && bIndex === undefined) {
                return scopes.indexOf(a) - scopes.indexOf(b);
            }
            if (aIndex === undefined) return 1;
            if (bIndex === undefined) return -1;
            return aIndex - bIndex;
        });
    }

    public getConfigStorageRoot(scope: ConfigScope): string {
        if (scope.type === 'workspace' && this.context?.storageUri) {
            return path.join(this.context.storageUri.fsPath, 'workspace-config');
        }

        return scope.uri.fsPath;
    }

    public getScopeConfigPath(scopeId: string): string | undefined {
        return this.groupManagers.get(scopeId)?.getConfigPath();
    }

    public clearScope(scopeId: string): boolean {
        if (!this.groupManagers.has(scopeId)) return false;

        const groupIds = new Set(
            this.groups
                .filter(group => !group.builtIn && group.sourceScopeId === scopeId)
                .map(group => group.id)
        );

        if (groupIds.size === 0) return false;

        this.groups = this.groups.filter(group => !groupIds.has(group.id));
        this.saveGroupsImmediate();
        this._onDidChangeTreeData.fire(undefined);
        return true;
    }

    private migrateLegacyWorkspaceConfig(scope: ConfigScope, targetManager: GroupManager): void {
        if (scope.type !== 'workspace' || targetManager.hasConfigFile()) {
            return;
        }

        const legacyManager = new GroupManager(scope.uri.fsPath);
        if (!legacyManager.hasConfigFile() || legacyManager.getConfigPath() === targetManager.getConfigPath()) {
            return;
        }

        try {
            const { groups } = legacyManager.loadGroups();
            const { version } = targetManager.loadGroups();
            targetManager.saveGroups(groups, version);
        } catch (error) {
            console.warn('VirtualTabs: failed to migrate legacy workspace config', error);
        }
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

    private takePendingSaveScopeIds(): ReadonlySet<string> | undefined {
        this.pendingSaveScopeIds ??= new Set();
        this.pendingSaveAllScopes ??= false;
        const scopeIds = this.pendingSaveAllScopes
            ? undefined
            : new Set(this.pendingSaveScopeIds);
        this.pendingSaveScopeIds.clear();
        this.pendingSaveAllScopes = false;
        return scopeIds;
    }

    private saveGroups(scopeId?: string) {
        this.pendingSaveScopeIds ??= new Set();
        this.pendingSaveAllScopes ??= false;

        // A save without a scope means every configured scope may have changed.
        // Scoped saves are accumulated so rapid edits in different scopes are not lost.
        if (scopeId && !this.pendingSaveAllScopes) {
            this.pendingSaveScopeIds.add(scopeId);
        } else if (!scopeId) {
            this.pendingSaveAllScopes = true;
            this.pendingSaveScopeIds.clear();
        }

        // Debounce: Clear any pending save and schedule a new one.
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
        }
        this.saveDebounceTimer = setTimeout(() => {
            this.saveDebounceTimer = undefined;
            this.saveGroupsImmediate(this.takePendingSaveScopeIds());
        }, 500);
    }

    /**
     * Synchronously flush a pending debounced save, if any.
     * Call this on extension deactivation — otherwise an edit made just
     * before VS Code closes can be lost, since the 500ms debounce timer
     * never gets a chance to fire.
     */
    flushPendingSave(): void {
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = undefined;
            this.saveGroupsImmediate(this.takePendingSaveScopeIds());
        }
    }

    private saveGroupsImmediate(scopeIds?: ReadonlySet<string>) {
        if (this.groupManagers.size === 0) {
            console.warn('Cannot save VirtualTabs data: no GroupManagers available');
            return;
        }

        try {
            // 依 sourceScopeId 路由至對應的 GroupManager
            // 先將群組依 scopeId 分組
            const groupsByScopeId = new Map<string, TempGroup[]>(
                this.configScopes
                    .filter(scope => !scopeIds || scopeIds.has(scope.id))
                    .map(scope => [scope.id, []])
            );

            for (const group of this.groups) {
                // 內建群組（及其自動子群組）不持久化：子群組沒有 sourceScopeId，
                // 若不在此排除，會落入下方「無 sourceScopeId」的向下相容分支，
                // 被誤存到第一個 scope 的檔案裡，導致下次載入後在該 scope 底下
                // 重複顯示一次（除了原本就會顯示在頂層的內建群組區塊之外）。
                if (this.isBuiltInFamily(group)) continue;

                const scopeId = group.sourceScopeId;
                if (!scopeId) {
                    // 無 sourceScopeId：使用第一個可用的 scope（向下相容）
                    const firstScopeId = this.configScopes[0]?.id;
                    if (firstScopeId && (!scopeIds || scopeIds.has(firstScopeId))) {
                        if (!groupsByScopeId.has(firstScopeId)) {
                            groupsByScopeId.set(firstScopeId, []);
                        }
                        groupsByScopeId.get(firstScopeId)!.push(group);
                    }
                    continue;
                }

                if (scopeIds && !scopeIds.has(scopeId)) continue;

                if (!this.groupManagers.has(scopeId)) {
                    console.warn(`VirtualTabs: sourceScopeId "${scopeId}" does not match any known ConfigScope, skipping save for group "${group.name}"`);
                    continue;
                }

                if (!groupsByScopeId.has(scopeId)) {
                    groupsByScopeId.set(scopeId, []);
                }
                groupsByScopeId.get(scopeId)!.push(group);
            }

            // 設定旗標以忽略下一個檔案系統事件
            this.isInternalSaving = true;

            // 對每個 scope 執行儲存
            for (const [scopeId, scopeGroups] of groupsByScopeId) {
                const gm = this.groupManagers.get(scopeId);
                if (!gm) continue;

                const scope = this.configScopes.find(s => s.id === scopeId);
                const scopeRoot = scope?.uri.fsPath;
                const storageGroups = this.toStorageGroups(scopeGroups, scopeRoot);

                try {
                    const currentVersion = this.loadedVersions.get(scopeId) ?? 0;

                    gm.saveGroups(storageGroups, currentVersion);

                    // 更新版本號
                    const { version } = gm.loadGroups();
                    this.loadedVersions.set(scopeId, version);
                } catch (err) {
                    if (err instanceof OptimisticLockError) {
                        console.warn(`VirtualTabs: OptimisticLockError on save for scope "${scopeId}" — reloading version and retrying once`);
                        const { version } = gm.loadGroups();
                        gm.saveGroups(storageGroups, version);
                        const { version: savedVersion } = gm.loadGroups();
                        this.loadedVersions.set(scopeId, savedVersion);
                    } else {
                        throw err;
                    }
                }
            }

            // 重置旗標
            setTimeout(() => {
                this.isInternalSaving = false;
            }, 500);
        } catch (error) {
            this.isInternalSaving = false;
            console.error('Failed to save VirtualTabs data file:', error);
            vscode.window.showErrorMessage(`${I18n.getMessage('error.saveConfigFailed') || 'Failed to save virtualTab.json'}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Handle external changes to the data file
     * @param scopeId 選填：指定要重新載入的 scope ID；若未提供則重新載入所有 scope
     */
    public onExternalFileChange(scopeId?: string) {
        if (this.isInternalSaving) {
            return;
        }

        // Option A: Silent reload of UI
        const success = this.loadGroups(scopeId);
        if (success) {
            this.refresh(false); // UI only, do NOT save back to disk to avoid overwriting user's manual edit

            const msg = I18n.getMessage('message.configReloaded') || 'VirtualTabs: Config reloaded';
            vscode.window.setStatusBarMessage(msg, 3000);
        }
    }

    /**
     * Reset groups to default state (called when config file is deleted)
     * @param scopeId 選填：指定要重置的 scope ID；若未提供則重置所有 scope
     */
    public resetToDefault(scopeId?: string) {
        if (scopeId) {
            // 只移除屬於該 scope 的群組；內建群組一併移除，交由 initBuiltInGroup() 重建單一份
            this.groups = this.groups.filter(g => !g.builtIn && g.sourceScopeId !== scopeId);
        } else {
            this.groups = [];
        }
        this.initBuiltInGroup();
        this.refresh(true); // Save to recreate the config file
    }



    private loadGroups(scopeId?: string): boolean {
        if (this.groupManagers.size === 0) return false;

        try {
            if (scopeId) {
                // 只重新載入指定 scope 的群組
                const gm = this.groupManagers.get(scopeId);
                if (!gm) return false;

                const scope = this.configScopes.find(s => s.id === scopeId);
                const scopeRoot = scope?.uri.fsPath;

                const { groups: saved, version } = gm.loadGroups();
                this.loadedVersions.set(scopeId, version);

                // 移除舊的該 scope 群組（保留其他 scope 和內建群組）
                this.groups = this.groups.filter(g => g.builtIn || g.sourceScopeId !== scopeId);

                if (saved.length > 0 && this.validateGroups(saved)) {
                    const migrated = this.migrateGroups(saved);
                    const restored = this.fromStorageGroups(migrated, scopeRoot);
                    // 注入 sourceScopeId
                    // 過濾任何殘留的 builtIn 標記：內建群組不應該持久化（見
                    // saveGroupsImmediate 的排除邏輯），但舊版本或手動編輯可能
                    // 讓 builtIn: true 的項目意外寫入檔案。若不過濾，這裡會把
                    // 它當成一般群組載入，疊加在上方保留的既有內建群組之上，
                    // 每次 reload 都多一份，導致「目前已開啟檔案」重複顯示且
                    // 持續增加。
                    const withScopeId = restored
                        .filter(g => !g.builtIn)
                        .map(g => ({ ...g, sourceScopeId: scopeId }));
                    this.groups.push(...withScopeId);
                }
                return true;
            }

            // 載入所有 scope 的群組
            const allGroups: TempGroup[] = [];

            for (const scope of this.configScopes) {
                const gm = this.groupManagers.get(scope.id);
                if (!gm) continue;

                const { groups: saved, version } = gm.loadGroups();
                this.loadedVersions.set(scope.id, version);

                if (saved.length === 0) continue;

                if (this.validateGroups(saved)) {
                    const migrated = this.migrateGroups(saved);
                    const restored = this.fromStorageGroups(migrated, scope.uri.fsPath);
                    // 注入 sourceScopeId
                    // 過濾任何殘留的 builtIn 標記，理由同上：內建群組本不該
                    // 持久化，若檔案裡意外存有 builtIn: true 的項目，會跟下方
                    // 保留的既有內建群組疊加，造成「目前已開啟檔案」重複顯示
                    // 且每次 reinitializeScopes()/reload 都再增加一份。
                    const withScopeId = restored
                        .filter(g => !g.builtIn)
                        .map(g => ({ ...g, sourceScopeId: scope.id }));
                    allGroups.push(...withScopeId);
                } else {
                    console.error(`VirtualTabs: Loaded data for scope "${scope.id}" failed validation`);
                    vscode.window.showErrorMessage(I18n.getMessage('error.invalidConfigFormat') || 'Invalid format in virtualTab.json. Please check the file structure.');
                }
            }

            if (allGroups.length === 0) {
                this.groups = [];
                this.initBuiltInGroup();
                return true;
            }

            // 保留內建群組，替換其他群組
            const builtInGroups = this.groups.filter(g => g.builtIn);
            this.groups = [...builtInGroups, ...allGroups];
            return true;
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

    private toStorageGroups(groups: TempGroup[], scopeRoot?: string): TempGroup[] {
        const root = scopeRoot ?? this.getWorkspaceRootPath();
        if (!root) {
            return groups;
        }

        return groups.map(group => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { sourceScopeId: _removed, ...groupWithoutScopeId } = group;
            return {
                ...groupWithoutScopeId,
                files: group.files ? group.files.map(uriStr => this.toRelativePath(uriStr, root)) : group.files,
                bookmarks: group.bookmarks ? this.toRelativeBookmarks(group.bookmarks, root) : group.bookmarks
            };
        });
    }

    private fromStorageGroups(groups: TempGroup[], scopeRoot?: string): TempGroup[] {
        const root = scopeRoot ?? this.getWorkspaceRootPath();
        if (!root) {
            return groups;
        }

        return groups.map(group => {
            let files = group.files
                ? group.files.map(pathStr => this.toAbsoluteUri(pathStr, root))
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
                bookmarks: group.bookmarks ? this.fromStorageBookmarks(group.bookmarks, root) : group.bookmarks
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
     * Get the file URI strings for a specific editor group by viewColumn.
     * Used by the drag controller to collect files when dragging EditorGroupItem nodes
     * without directly accessing the private builtInEditorGroups array.
     */
    getEditorGroupFiles(viewColumn: number): string[] {
        const eg = this.builtInEditorGroups.find(g => g.viewColumn === viewColumn);
        return eg ? [...eg.files] : [];
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

                this.builtInItemsCache = null;
                // Built-in tab state is derived from VS Code and intentionally excluded
                // from virtualTab.json. Persisting here only rewrites config files on
                // every tab event without saving any built-in data.
                // A scoped fire(builtInItem) was tried here but proved unreliable: when the
                // built-in group is already expanded, VS Code does not consistently re-query
                // getChildren() for it on a targeted fire, leaving the visible file list stale
                // until some other event forces a full tree redraw. fire(undefined) is the same
                // mechanism refresh()/the manual refresh button already rely on and is reliable.
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
            this.builtInItemsCache = null;
        }

        if (save) {
            this.saveGroups();
        }
        this._onDidChangeTreeData.fire(undefined);
    }

    /** Refresh the visible tree without rewriting persisted custom groups. */
    refreshView(): void {
        this.refresh(false);
    }

    addGroup() {
        const nonBuiltinActive = [...this.activeScopeIds].filter(id => id !== BUILTIN_SCOPE_ID);
        if (nonBuiltinActive.length === 1) {
            this.createGroupInScope(nonBuiltinActive[0]);
            return;
        }

        // Multi-scope: fall back to the first configScope so the group has a sourceScopeId
        // and is rendered under the correct ScopeHeaderItem.
        const fallbackScopeId = this.configScopes[0]?.id;
        if (fallbackScopeId) {
            this.createGroupInScope(fallbackScopeId);
            return;
        }

        // No configScopes at all — legacy single-scope fallback
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

    createGroupInScope(scopeId: string, files: string[] = [], save: boolean = true): number | undefined {
        if (!this.groupManagers.has(scopeId)) return undefined;

        let idx = 1;
        let name = I18n.getGroupName(undefined, idx);
        while (this.groups.some(g => g.name === name)) {
            idx++;
            name = I18n.getGroupName(undefined, idx);
        }

        const uniqueFiles: string[] = [];
        for (const uri of files) {
            const incomingFsPath = vscode.Uri.parse(uri).fsPath;
            const isDuplicate = uniqueFiles.some(f => {
                try { return this.pathsEqual(vscode.Uri.parse(f).fsPath, incomingFsPath); }
                catch { return f === uri; }
            });
            if (!isDuplicate) {
                uniqueFiles.push(uri);
            }
        }

        this.groups.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            name,
            files: uniqueFiles,
            sourceScopeId: scopeId
        });

        // Ensure the scope header is expanded so the new group is immediately visible
        this.expandedScopeIds.add(scopeId);

        if (save) {
            // Let VS Code paint the new group before the debounced persistence work runs.
            this.refresh(false);
            this.saveGroups(scopeId);
        }

        return this.groups.length - 1;
    }

    duplicateBuiltInGroup(groupIdx: number): number | undefined {
        const source = this.groups[groupIdx];
        if (!source?.builtIn) return undefined;

        // The built-in group is workspace-wide. In a multi-root workspace its
        // persisted copy belongs to Workspace Config; in a single-folder
        // window the only folder scope is the persistence target.
        const targetScope = this.configScopes.find(scope => scope.type === 'workspace')
            ?? this.configScopes[0];
        if (!targetScope || !this.groupManagers.has(targetScope.id)) return undefined;

        const base = I18n.getBuiltInGroupName();
        let copyIndex = 1;
        let name = I18n.getCopyGroupName(base);
        while (this.groups.some(group => group.name === name)) {
            copyIndex++;
            name = I18n.getCopyGroupName(base, copyIndex);
        }

        this.groups.push({
            id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
            name,
            files: source.files ? [...source.files] : [],
            sourceScopeId: targetScope.id
        });
        this.expandedScopeIds.add(targetScope.id);

        // Paint the scoped copy immediately, then persist only its target scope.
        this.refresh(false);
        this.saveGroups(targetScope.id);
        return this.groups.length - 1;
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
            parentGroupId: parentGroupId,
            sourceScopeId: parent.sourceScopeId
        });
        this.refresh();
    }

    moveGroupToScope(groupId: string, scopeId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (!group || group.builtIn || !this.groupManagers.has(scopeId)) return;

        delete group.parentGroupId;
        this.updateGroupScopeRecursive(groupId, scopeId);
        this.refresh();
    }

    moveGroupUnderGroup(groupId: string, parentGroupId: string): boolean {
        const group = this.groups.find(g => g.id === groupId);
        const parent = this.groups.find(g => g.id === parentGroupId);
        if (!group || !parent || group.builtIn || parent.builtIn) return false;
        if (group.id === parent.id) return false;
        if (this.isDescendantGroup(parent.id, group.id)) return false;

        group.parentGroupId = parent.id;
        if (parent.sourceScopeId) {
            this.updateGroupScopeRecursive(group.id, parent.sourceScopeId);
        }
        return true;
    }

    /**
     * Check if `groupId` is a descendant of `potentialAncestorId`, following
     * parentGroupId links. Guards against cyclic chains with a visited set
     * (mirrors dragAndDrop.ts's isDescendant).
     */
    private isDescendantGroup(groupId: string, potentialAncestorId: string, visited = new Set<string>()): boolean {
        if (visited.has(groupId)) return false;
        visited.add(groupId);

        const group = this.groups.find(g => g.id === groupId);
        if (!group || !group.parentGroupId) return false;

        if (group.parentGroupId === potentialAncestorId) return true;

        return this.isDescendantGroup(group.parentGroupId, potentialAncestorId, visited);
    }

    unnestGroup(groupId: string): boolean {
        const group = this.groups.find(g => g.id === groupId);
        if (!group || group.builtIn) return false;

        delete group.parentGroupId;
        return true;
    }

    private updateGroupScopeRecursive(groupId: string, scopeId: string): void {
        const group = this.groups.find(g => g.id === groupId);
        if (!group) return;

        group.sourceScopeId = scopeId;
        const children = this.groups.filter(g => g.parentGroupId === groupId);
        for (const child of children) {
            this.updateGroupScopeRecursive(child.id, scopeId);
        }
    }

    moveGroup(groupId: string, direction: 'up' | 'down') {
        const currentIndex = this.groups.findIndex(group => group.id === groupId);
        if (currentIndex < 0) return;

        const group = this.groups[currentIndex];
        if (!group || group.builtIn) return;

        const parentId = group.parentGroupId ?? null;
        const scopeId = group.sourceScopeId;
        const siblings = this.groups
            .map((g, idx) => ({ group: g, idx }))
            .filter(({ group: g }) =>
                (g.parentGroupId ?? null) === parentId &&
                (parentId !== null || g.sourceScopeId === scopeId)
            );

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
        const scopeRoot = group.sourceScopeId
            ? this.configScopes.find(scope => scope.id === group.sourceScopeId)?.uri.fsPath
            : this.getWorkspaceRootPath();

        const targets = fileItems.map(item => ({
            uri: item.uri.toString(),
            fsPath: item.uri.fsPath
        }));

        if (removeStoredFileEntriesFromGroup(group, targets, scopeRoot)) {
            this.refresh();
        }
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
                const rawExt = path.extname(uri.fsPath).toLowerCase();
                const ext = rawExt ? rawExt.slice(1) : 'no-extension';
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
        const newGroups: TempGroup[] = Object.entries(extMap).map(([ext, files]) => {
            const newGroup: TempGroup = {
                id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
                name: `${I18n.getAutoGroupName(ext)} @ ${group.name}`, // Naming: .ext @ Source
                files,
                auto: true,
                sourceGroupId: group.id,
                sourceScopeId: group.sourceScopeId
            };
            AutoGrouper.moveBookmarks(group, newGroup, files);
            return newGroup;
        });

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
                const newGroup: TempGroup = {
                    id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
                    name: `${I18n.getMessage('group.autoGroupPrefix')} ${AutoGrouper.getDateGroupLabel(dateGroup, I18n)} @ ${group.name}`, // Naming: [Auto] Label @ Source
                    files,
                    auto: true,
                    autoGroupType: 'modifiedDate',
                    sourceGroupId: group.id,
                    sourceScopeId: group.sourceScopeId
                };
                AutoGrouper.moveBookmarks(group, newGroup, files);
                newGroups.push(newGroup);
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
            // 無工作區資料夾時，顯示提示訊息
            if (this.configScopes.length === 0) {
                const noWorkspaceItem = new vscode.TreeItem(
                    I18n.getMessage('message.noWorkspaceFolder') || 'No workspace folder open',
                    vscode.TreeItemCollapsibleState.None
                );
                noWorkspaceItem.contextValue = 'virtualTabsNoWorkspace';
                return [noWorkspaceItem];
            }

            const makeFolderItem = (group: TempGroup, idx: number) => {
                const item = new TempFolderItem(group.name, idx, group.id, group.builtIn);
                item.collapsibleState = this.isGroupExpanded(group.id)
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.Collapsed;
                return item;
            };

            const isFiltered = this.activeScopeIds.size > 0;

            if (isFiltered) {
                const showBuiltIn = this.activeScopeIds.has(BUILTIN_SCOPE_ID);
                const visibleScopes = this.configScopes.filter(s => this.activeScopeIds.has(s.id));

                const builtInItems = showBuiltIn
                    ? this.groups
                        .map((g, idx) => ({ group: g, idx }))
                        .filter(({ group }) => this.isBuiltInFamily(group))
                        .map(({ group, idx }) => makeFolderItem(group, idx))
                    : [];

                // 只有 built-in（沒有 repo scope）
                if (visibleScopes.length === 0) {
                    return builtInItems;
                }

                // 單一 repo scope 且不含 built-in：平面顯示（與舊的單選行為一致）
                if (visibleScopes.length === 1 && !showBuiltIn) {
                    return this.groups
                        .map((g, idx) => ({ group: g, idx }))
                        .filter(({ group }) =>
                            !group.parentGroupId &&
                            !group.builtIn &&
                            group.sourceScopeId === visibleScopes[0].id
                        )
                        .map(({ group, idx }) => makeFolderItem(group, idx));
                }

                // 單一 repo scope + built-in：built-in 在前，該 scope 的群組平面顯示
                if (visibleScopes.length === 1 && showBuiltIn) {
                    const scopeGroups = this.groups
                        .map((g, idx) => ({ group: g, idx }))
                        .filter(({ group }) =>
                            !group.parentGroupId &&
                            !group.builtIn &&
                            group.sourceScopeId === visibleScopes[0].id
                        )
                        .map(({ group, idx }) => makeFolderItem(group, idx));
                    return [...builtInItems, ...scopeGroups];
                }

                // 多個 repo scope（含或不含 built-in）：ScopeHeaderItem
                const scopeItems = visibleScopes.map(scope =>
                    new ScopeHeaderItem(scope, true, this.isScopeExpanded(scope.id))
                );
                return [...builtInItems, ...scopeItems];
            }

            // 無篩選：保留原有行為
            const hasMultipleScopes = this.configScopes.length > 1;

            if (hasMultipleScopes) {
                const scopeItems = this.configScopes.map(scope =>
                    new ScopeHeaderItem(scope, true, this.isScopeExpanded(scope.id))
                );
                const builtInItems = this.groups
                    .map((g, idx) => ({ group: g, idx }))
                    .filter(({ group }) => this.isBuiltInFamily(group))
                    .map(({ group, idx }) => makeFolderItem(group, idx));
                return [...builtInItems, ...scopeItems];
            }

            // 單一 scope 或無 scope
            return this.groups
                .map((g, idx) => ({ group: g, idx }))
                .filter(({ group }) => !group.parentGroupId)
                .map(({ group, idx }) => makeFolderItem(group, idx));
        }

        // Expanded Scope Node: Show top-level groups belonging to this scope
        if (element instanceof ScopeHeaderItem) {
            const scopeGroups = this.groups
                .map((g, idx) => ({ group: g, idx }))
                .filter(({ group }) =>
                    !group.parentGroupId &&
                    !group.builtIn &&
                    group.sourceScopeId === element.scope.id
                );

            return scopeGroups.map(({ group, idx }) => {
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

            // Built-in group with multiple editor groups: render editor-group sub-nodes.
            // NOTE: The builtInItemsCache is NOT used in this split-editor path — each EditorGroupItem
            // renders its own children lazily, so caching at this level doesn't help.
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
                // Built-in group: return cached items when file list is unchanged
                if (group.builtIn) {
                    if (
                        this.builtInItemsCache &&
                        this.arraysEqualInOrder(this.builtInFilesSnapshot, group.files)
                    ) {
                        // Restore registry from cache so reveal() still works
                        for (const item of this.builtInItemsCache) {
                            if (item.id) this.fileItemRegistry.set(item.id, item);
                        }
                        items.push(...this.builtInItemsCache);
                        return items;
                    }
                    this.fileItemRegistry.clear();
                }

                // Apply sorting before rendering
                const sortedFiles = FileSorter.sortFiles(
                    group.files,
                    group.sortBy || 'none',
                    group.sortOrder || 'asc'
                );

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
                        fileItem.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                    }

                    return fileItem;
                });

                if (group.builtIn) {
                    this.builtInItemsCache = fileItems;
                    this.builtInFilesSnapshot = [...group.files];
                }

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
            // Safety check: groupIdx might be stale if the groups array shifted
            // (e.g. a group was removed/reordered) before this node re-rendered.
            if (!group) return [];
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

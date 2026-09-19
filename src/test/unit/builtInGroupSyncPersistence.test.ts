import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { TempGroup } from '../../types';

jest.mock('vscode', () => {
    class Uri {
        private constructor(public readonly fsPath: string) { }

        static file(fsPath: string): Uri {
            return new Uri(path.resolve(fsPath));
        }

        static parse(value: string): Uri {
            if (value.startsWith('file://')) {
                return new Uri(new URL(value).pathname);
            }
            return new Uri(value);
        }

        static joinPath(base: Uri, ...segments: string[]): Uri {
            return new Uri(path.join(base.fsPath, ...segments));
        }

        toString(): string {
            return pathToFileURL(this.fsPath).toString();
        }
    }

    return {
        Uri,
        TreeItem: class {
            constructor(public readonly label: unknown, public readonly collapsibleState?: number) { }
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        EventEmitter: class {
            event = jest.fn();
            fire = jest.fn();
        },
        ThemeIcon: Object.assign(
            class { constructor(public readonly id: string, public readonly color?: unknown) { } },
            { File: { id: 'file' } }
        ),
        ThemeColor: class { constructor(public readonly id: string) { } },
        TabInputText: class { },
        TabInputNotebook: class { },
        TabInputCustom: class { },
        TabInputTextDiff: class { },
        commands: { executeCommand: jest.fn() },
        window: {
            tabGroups: { all: [] },
            showErrorMessage: jest.fn(),
            showInformationMessage: jest.fn(),
            setStatusBarMessage: jest.fn()
        },
        workspace: { workspaceFolders: [] }
    };
}, { virtual: true });

import { TempFoldersProvider } from '../../provider';
import { GroupManager } from '../../core/GroupManager';

interface ProviderInternals {
    builtInEditorGroups: Array<{ viewColumn: number; label: string; files: string[] }>;
    builtInItemsCache: unknown;
    computeEditorGroups: jest.Mock;
    saveGroups: jest.Mock;
    saveGroupsImmediate: jest.Mock;
    pendingSaveScopeIds: Set<string>;
    pendingSaveAllScopes: boolean;
    groupManagers: Map<string, unknown>;
    loadedVersions: Map<string, number>;
    expandedScopeIds: Set<string>;
    isInternalSaving: boolean;
    _onDidChangeTreeData: { fire: jest.Mock };
}

function createProviderHarness(groups: TempGroup[]) {
    const provider = Object.create(TempFoldersProvider.prototype) as TempFoldersProvider;
    provider.groups = groups;

    const internals = provider as unknown as ProviderInternals;
    internals.builtInEditorGroups = [];
    internals.builtInItemsCache = [];
    internals.computeEditorGroups = jest.fn();
    internals.saveGroups = jest.fn();
    internals.saveGroupsImmediate = jest.fn();
    internals.pendingSaveScopeIds = new Set();
    internals.pendingSaveAllScopes = false;
    internals.groupManagers = new Map();
    internals.loadedVersions = new Map();
    internals.expandedScopeIds = new Set();
    internals.isInternalSaving = false;
    internals._onDidChangeTreeData = { fire: jest.fn() };

    return { provider, internals };
}

describe('TempFoldersProvider built-in group persistence', () => {
    test('syncBuiltInGroup updates derived tab state without scheduling a config save', () => {
        const fileA = 'file:///workspace/a.ts';
        const fileB = 'file:///workspace/b.ts';
        const builtIn: TempGroup = {
            id: 'builtin_group_id',
            name: 'Currently Open Files',
            files: [fileA],
            builtIn: true
        };
        const { provider, internals } = createProviderHarness([builtIn]);

        internals.builtInEditorGroups = [
            { viewColumn: 1, label: 'Editor Group 1', files: [fileA] }
        ];
        internals.computeEditorGroups.mockReturnValue([
            { viewColumn: 1, label: 'Editor Group 1', files: [fileA, fileB] }
        ]);

        expect(provider.syncBuiltInGroup()).toBe(true);
        expect(builtIn.files).toEqual([fileA, fileB]);
        expect(internals.builtInItemsCache).toBeNull();
        expect(internals._onDidChangeTreeData.fire).toHaveBeenCalledWith(undefined);
        expect(internals.saveGroups).not.toHaveBeenCalled();
    });

    test('syncBuiltInGroup refreshes when editor-group topology changes with the same files', () => {
        const fileA = 'file:///workspace/a.ts';
        const fileB = 'file:///workspace/b.ts';
        const builtIn: TempGroup = {
            id: 'builtin_group_id',
            name: 'Currently Open Files',
            files: [fileA, fileB],
            builtIn: true
        };
        const { provider, internals } = createProviderHarness([builtIn]);
        internals.builtInEditorGroups = [
            { viewColumn: 1, label: 'Editor Group 1', files: [fileA, fileB] }
        ];
        internals.computeEditorGroups.mockReturnValue([
            { viewColumn: 1, label: 'Editor Group 1', files: [fileA] },
            { viewColumn: 2, label: 'Editor Group 2', files: [fileB] }
        ]);

        expect(provider.syncBuiltInGroup()).toBe(true);
        expect(builtIn.files).toEqual([fileA, fileB]);
        expect(internals.builtInEditorGroups).toHaveLength(2);
        expect(internals._onDidChangeTreeData.fire).toHaveBeenCalledWith(undefined);
        expect(internals.saveGroups).not.toHaveBeenCalled();
    });

    test('syncBuiltInGroup ignores duplicate events when the snapshot is unchanged', () => {
        const fileA = 'file:///workspace/a.ts';
        const builtIn: TempGroup = {
            id: 'builtin_group_id',
            name: 'Currently Open Files',
            files: [fileA],
            builtIn: true
        };
        const { provider, internals } = createProviderHarness([builtIn]);
        const snapshot = [{ viewColumn: 1, label: 'Editor Group 1', files: [fileA] }];
        internals.builtInEditorGroups = snapshot;
        internals.computeEditorGroups.mockReturnValue(snapshot);

        expect(provider.syncBuiltInGroup()).toBe(false);
        expect(internals._onDidChangeTreeData.fire).not.toHaveBeenCalled();
        expect(internals.saveGroups).not.toHaveBeenCalled();
    });

    test('custom group edits still use the normal persistence path', () => {
        const builtIn: TempGroup = {
            id: 'builtin_group_id',
            name: 'Currently Open Files',
            files: [],
            builtIn: true
        };
        const custom: TempGroup = {
            id: 'custom-group',
            name: 'Custom',
            files: []
        };
        const { provider, internals } = createProviderHarness([builtIn, custom]);
        internals.computeEditorGroups.mockReturnValue([]);

        provider.addFilesToGroup(1, ['file:///workspace/custom.ts']);

        expect(custom.files).toEqual(['file:///workspace/custom.ts']);
        expect(internals.saveGroups).toHaveBeenCalledTimes(1);
        expect(internals._onDidChangeTreeData.fire).toHaveBeenCalledWith(undefined);
    });

    test('showing the view refreshes derived state without scheduling a config save', () => {
        const builtIn: TempGroup = {
            id: 'builtin_group_id',
            name: 'Currently Open Files',
            files: [],
            builtIn: true
        };
        const { provider, internals } = createProviderHarness([builtIn]);
        internals.computeEditorGroups.mockReturnValue([]);

        provider.refreshView();

        expect(internals.saveGroups).not.toHaveBeenCalled();
        expect(internals._onDidChangeTreeData.fire).toHaveBeenCalledWith(undefined);
    });

    test('creating a scoped group paints first and schedules only that scope', () => {
        const { provider, internals } = createProviderHarness([]);
        internals.groupManagers.set('scope-a', {});
        const refresh = jest.spyOn(provider, 'refresh').mockImplementation(() => undefined);

        const groupIndex = provider.createGroupInScope('scope-a');

        expect(groupIndex).toBe(0);
        expect(provider.groups[0].sourceScopeId).toBe('scope-a');
        expect(refresh).toHaveBeenCalledWith(false);
        expect(internals.saveGroups).toHaveBeenCalledWith('scope-a');
        expect(internals.expandedScopeIds.has('scope-a')).toBe(true);
    });

    test('duplicating the built-in group targets Workspace Config and is visible immediately', () => {
        const sourceFiles = ['file:///workspace/a.ts', 'file:///workspace/b.ts'];
        const { provider, internals } = createProviderHarness([{
            id: 'builtin_group_id',
            name: 'Currently Open Files',
            files: sourceFiles,
            builtIn: true
        }]);
        provider.configScopes = [
            { id: 'scope:workspace', type: 'workspace', label: 'Workspace Config', uri: { fsPath: '/workspace' } } as never,
            { id: 'scope:project', type: 'folder', label: 'Project', uri: { fsPath: '/workspace/project' } } as never
        ];
        internals.groupManagers = new Map([
            ['scope:workspace', {}],
            ['scope:project', {}]
        ]);
        const refresh = jest.spyOn(provider, 'refresh').mockImplementation(() => undefined);

        const groupIndex = provider.duplicateBuiltInGroup(0);

        expect(groupIndex).toBe(1);
        expect(provider.groups[1]).toMatchObject({
            files: sourceFiles,
            sourceScopeId: 'scope:workspace'
        });
        expect(provider.groups[1].files).not.toBe(sourceFiles);
        expect(internals.expandedScopeIds.has('scope:workspace')).toBe(true);
        expect(refresh).toHaveBeenCalledWith(false);
        expect(internals.saveGroups).toHaveBeenCalledWith('scope:workspace');
        expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(internals.saveGroups.mock.invocationCallOrder[0]);
    });

    test('duplicating the built-in group uses the folder scope in a single-folder window', () => {
        const { provider, internals } = createProviderHarness([{
            id: 'builtin_group_id',
            name: 'Currently Open Files',
            files: [],
            builtIn: true
        }]);
        provider.configScopes = [
            { id: 'scope:folder', type: 'folder', label: 'Project', uri: { fsPath: '/project' } } as never
        ];
        internals.groupManagers.set('scope:folder', {});
        jest.spyOn(provider, 'refresh').mockImplementation(() => undefined);

        provider.duplicateBuiltInGroup(0);

        expect(provider.groups[1].sourceScopeId).toBe('scope:folder');
        expect(internals.saveGroups).toHaveBeenCalledWith('scope:folder');
    });

    test('debounce unions scoped saves and clears the timer after it runs', () => {
        jest.useFakeTimers();
        try {
            const { provider, internals } = createProviderHarness([]);
            const saveGroups = (TempFoldersProvider.prototype as unknown as {
                saveGroups: (scopeId?: string) => void;
            }).saveGroups.bind(provider);

            saveGroups('scope-a');
            saveGroups('scope-b');
            jest.advanceTimersByTime(500);

            expect(internals.saveGroupsImmediate).toHaveBeenCalledTimes(1);
            const scopeIds = internals.saveGroupsImmediate.mock.calls[0][0] as ReadonlySet<string>;
            expect([...scopeIds].sort()).toEqual(['scope-a', 'scope-b']);

            provider.flushPendingSave();
            expect(internals.saveGroupsImmediate).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    test('an unscoped save supersedes pending scoped saves', () => {
        jest.useFakeTimers();
        try {
            const { provider, internals } = createProviderHarness([]);
            const saveGroups = (TempFoldersProvider.prototype as unknown as {
                saveGroups: (scopeId?: string) => void;
            }).saveGroups.bind(provider);

            saveGroups('scope-a');
            saveGroups();
            jest.advanceTimersByTime(500);

            expect(internals.saveGroupsImmediate).toHaveBeenCalledWith(undefined);
        } finally {
            jest.useRealTimers();
        }
    });

    test('loadGroups filters out a stray persisted builtIn entry instead of duplicating the built-in group', () => {
        // Regression test: built-in groups are excluded from persistence by
        // saveGroupsImmediate's isBuiltInFamily() guard, but if a builtIn: true
        // entry ever ends up on disk anyway (e.g. from an older buggy save, or
        // a manually edited config), loadGroups() must not treat it as a
        // second real group. Without the fix, every full reload
        // (onExternalFileChange with no scopeId, which reinitializeScopes()/
        // the refresh command triggers) would carry the existing in-memory
        // built-in group forward AND load the stray one from disk, doubling
        // the "Currently Open Files" group each time.
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'virtualtabs-stray-builtin-'));
        try {
            fs.mkdirSync(path.join(root, '.vscode'), { recursive: true });
            const configPath = path.join(root, '.vscode', 'virtualTab.json');
            fs.writeFileSync(configPath, JSON.stringify([
                { id: 'builtin_group_id', name: 'Currently Open Files', files: ['stale.ts'], builtIn: true },
                { id: 'custom-group', name: 'Custom', files: [] }
            ], null, 2));

            const manager = new GroupManager(root);
            const { provider, internals } = createProviderHarness([{
                id: 'builtin_group_id',
                name: 'Currently Open Files',
                files: [],
                builtIn: true
            }]);
            provider.configScopes = [
                { id: 'scope-a', type: 'folder', label: 'A', uri: { fsPath: root } } as never
            ];
            internals.groupManagers = new Map([['scope-a', manager]]);

            provider.onExternalFileChange();

            const builtInGroups = provider.groups.filter(g => g.builtIn);
            expect(builtInGroups).toHaveLength(1);
            expect(provider.groups.filter(g => g.name === 'Custom')).toHaveLength(1);

            // A second reload must not compound the duplication further.
            provider.onExternalFileChange();
            expect(provider.groups.filter(g => g.builtIn)).toHaveLength(1);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('a scoped save leaves other workspace configs byte-for-byte unchanged', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'virtualtabs-scoped-save-'));
        try {
            const rootA = path.join(root, 'a');
            const rootB = path.join(root, 'b');
            fs.mkdirSync(path.join(rootA, '.vscode'), { recursive: true });
            fs.mkdirSync(path.join(rootB, '.vscode'), { recursive: true });

            const configA = path.join(rootA, '.vscode', 'virtualTab.json');
            const configB = path.join(rootB, '.vscode', 'virtualTab.json');
            fs.writeFileSync(configA, JSON.stringify([{ id: 'old-a', name: 'Old A', files: [] }], null, 2));
            fs.writeFileSync(configB, JSON.stringify([{ id: 'old-b', name: 'Old B', files: [] }], null, 2));
            const originalB = fs.readFileSync(configB, 'utf8');

            const managerA = new GroupManager(rootA);
            const managerB = new GroupManager(rootB);
            const versionA = managerA.loadGroups().version;
            const versionB = managerB.loadGroups().version;

            const { provider, internals } = createProviderHarness([
                { id: 'new-a', name: 'New A', files: [], sourceScopeId: 'scope-a' },
                { id: 'old-b', name: 'Old B', files: [], sourceScopeId: 'scope-b' }
            ]);
            provider.configScopes = [
                { id: 'scope-a', type: 'folder', label: 'A', uri: { fsPath: rootA } } as never,
                { id: 'scope-b', type: 'folder', label: 'B', uri: { fsPath: rootB } } as never
            ];
            internals.groupManagers = new Map([
                ['scope-a', managerA],
                ['scope-b', managerB]
            ]);
            internals.loadedVersions = new Map([
                ['scope-a', versionA],
                ['scope-b', versionB]
            ]);

            const saveGroupsImmediate = (TempFoldersProvider.prototype as unknown as {
                saveGroupsImmediate: (scopeIds?: ReadonlySet<string>) => void;
            }).saveGroupsImmediate.bind(provider);
            saveGroupsImmediate(new Set(['scope-a']));

            expect(JSON.parse(fs.readFileSync(configA, 'utf8'))).toEqual([
                { id: 'new-a', name: 'New A', files: [] }
            ]);
            expect(fs.readFileSync(configB, 'utf8')).toBe(originalB);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

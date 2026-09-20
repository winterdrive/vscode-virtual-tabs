/**
 * Regression test for dragging a file into a group's own sub-group.
 *
 * Reported symptom: for a file whose stored path lies OUTSIDE the workspace
 * root (e.g. a different drive letter on Windows, or any other absolute
 * path VirtualTabs can't express as a workspace-relative path), dragging it
 * into a sub-group leaves it in BOTH the source and the target group, and
 * the duplicate survives reload — so it's a persisted data bug.
 *
 * Root cause: PathUtils.toFileUri() (src/core/PathUtils.ts) builds file://
 * URIs with a naive string substitution and does NOT percent-encode the
 * drive-letter colon, e.g. "file:///d:/foo". But vscode.Uri.parse(...).
 * toString() (used by dragAndDrop.ts to turn a dragged TempFileItem back
 * into a string) DOES percent-encode it by default, e.g. "file:///d%3A/foo".
 * handleFileDrop() removes the file from the source group with a strict
 * string filter (`uri !== fileUri`), so the differently-encoded string never
 * matches and the "remove from source" step silently no-ops, while the
 * fsPath-based "add to target" check succeeds — leaving the file in both
 * groups under two different string encodings of the same path.
 *
 * The mocked vscode.Uri below reproduces vscode.Uri's real default
 * toString() encoding (percent-encoding everything except path separators,
 * which is what turns a drive-letter colon into %3A) so the test exercises
 * the actual mismatch, not a hand-rolled shortcut that bypasses it — while
 * still exercising the real dragAndDrop.ts / treeItems.ts / provider.ts
 * production code path, not a reimplementation of their logic.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import type { TempGroup, ConfigScope } from '../../types';

jest.mock('vscode', () => {
    /**
     * Minimal stand-in for vscode.Uri, scoped to what this test needs.
     *
     * parse()/.fsPath delegate to Node's real fileURLToPath() -- the exact
     * function src/core/FileEntryMatcher.ts uses to interpret a stored
     * file:// entry -- so this mock's notion of "which file this points to"
     * always agrees with the production matcher, on any platform (a
     * hand-rolled string-splitting parser previously disagreed with
     * fileURLToPath() specifically on Linux CI, since POSIX keeps a
     * leading "/" before a Windows-shaped "c:/..." path that a naive
     * `.replace(/^file:\/\/\//, '')` silently drops).
     *
     * toString() re-encodes the fsPath the way vscode.Uri's default
     * (non-skipEncoding) toString() does -- percent-encoding each path
     * segment, which notably encodes a Windows drive-letter colon (":")
     * to "%3A". This is the one place this mock deliberately diverges
     * from a "real" Uri implementation, because it's the exact encoding
     * mismatch this test exists to reproduce.
     */
    class Uri {
        private constructor(public readonly fsPath: string) { }

        static parse(value: string): Uri {
            return new Uri(fileURLToPath(value));
        }

        static file(fsPath: string): Uri {
            return new Uri(path.resolve(fsPath));
        }

        static joinPath(base: Uri, ...segments: string[]): Uri {
            return new Uri(path.join(base.fsPath, ...segments));
        }

        toString(): string {
            const normalized = this.fsPath.replace(/\\/g, '/');
            const encoded = normalized.split('/').map(seg => encodeURIComponent(seg)).join('/');
            return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
        }
    }

    class TreeItem {
        id?: string;
        resourceUri?: unknown;
        command?: unknown;
        iconPath?: unknown;
        tooltip?: unknown;
        contextValue?: string;
        collapsibleState?: number;

        constructor(public readonly label: unknown, collapsibleState?: number) {
            this.collapsibleState = collapsibleState;
        }
    }

    return {
        Uri,
        TreeItem,
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2
        },
        EventEmitter: class {
            event = jest.fn();
            fire = jest.fn();
        },
        ThemeIcon: Object.assign(
            class {
                constructor(public readonly id: string, public readonly color?: unknown) { }
            },
            { File: { id: 'file' } }
        ),
        ThemeColor: class {
            constructor(public readonly id: string) { }
        },
        window: {
            tabGroups: { all: [] },
            showErrorMessage: jest.fn(),
            showInformationMessage: jest.fn()
        },
        workspace: {
            workspaceFolders: [],
            asRelativePath: (uri: { fsPath: string }) => uri.fsPath
        }
    };
}, { virtual: true });

import * as vscode from 'vscode';
import { TempFoldersProvider } from '../../provider';
import { TempFolderItem, TempFileItem } from '../../treeItems';
import { TempFoldersDragAndDropController } from '../../dragAndDrop';

function createProviderHarness(groups: TempGroup[], configScopes: ConfigScope[] = []): TempFoldersProvider {
    const provider = Object.create(TempFoldersProvider.prototype) as TempFoldersProvider;
    provider.groups = groups;
    provider.configScopes = configScopes;
    (provider as unknown as { activeScopeIds: Set<string> }).activeScopeIds = new Set();
    (provider as unknown as { expandedGroupIds: Set<string> }).expandedGroupIds = new Set();
    jest.spyOn(provider, 'refresh').mockImplementation(jest.fn());
    return provider;
}

class FakeDataTransfer {
    private map = new Map<string, { value: unknown }>();
    set(mime: string, item: { value: unknown }): void {
        this.map.set(mime, item);
    }
    get(mime: string): { value: unknown } | undefined {
        return this.map.get(mime);
    }
    [Symbol.iterator](): IterableIterator<[string, { value: unknown }]> {
        return this.map.entries();
    }
}

/** Renders a TempFileItem the way provider.ts's getChildren() actually does. */
function renderFileItem(uriStr: string, groupIdx: number, groupId: string): TempFileItem {
    const uri = vscode.Uri.parse(uriStr);
    return new TempFileItem(uri, groupIdx, false, groupId);
}

describe('Dragging a file into a sub-group of its own parent (real dragAndDrop.ts code path)', () => {
    test('a workspace-relative file moves cleanly (baseline, matches the earlier passing case)', async () => {
        const fileUri = 'file:///c:/Users/kwz50/PromptManager/src/commands.ts';

        const parentGroup: TempGroup = { id: 'group-parent', name: 'Parent', files: [fileUri] };
        const subGroup: TempGroup = { id: 'group-sub', name: 'Sub', parentGroupId: 'group-parent', files: [] };

        const provider = createProviderHarness([parentGroup, subGroup]);
        const controller = new TempFoldersDragAndDropController(provider);

        const draggedFileItem = renderFileItem(fileUri, 0, 'group-parent');
        const targetSubGroupItem = new TempFolderItem('Sub', 1, 'group-sub', false, true);

        const dataTransfer = new FakeDataTransfer();
        dataTransfer.set('application/vnd.code.tree.virtualTabsView.files', { value: [draggedFileItem] });

        await controller.handleDrop(targetSubGroupItem, dataTransfer as never, {} as never);

        expect(parentGroup.files).toEqual([]);
        expect(subGroup.files).toHaveLength(1);
    });

    test('a file outside the workspace root (different drive letter) duplicates instead of moving', async () => {
        // This is exactly the string PathUtils.toFileUri() produces for a
        // cross-drive path: a naive file:// prefix with NO percent-encoding
        // of the drive-letter colon. Taken verbatim from a real repro's
        // .vscode/virtualTab.json.
        const storedUri = 'file:///d:/IdeaProjects/etoro_trade/.env.example';

        const parentGroup: TempGroup = { id: 'group-parent', name: '新群組 6', files: [storedUri] };
        const subGroup: TempGroup = { id: 'group-sub', name: '新群組 7', parentGroupId: 'group-parent', files: [] };

        const provider = createProviderHarness([parentGroup, subGroup]);
        const controller = new TempFoldersDragAndDropController(provider);

        // Rendered exactly as provider.ts renders it: vscode.Uri.parse(storedUri).
        const draggedFileItem = renderFileItem(storedUri, 0, 'group-parent');
        const targetSubGroupItem = new TempFolderItem('新群組 7', 1, 'group-sub', false, true);

        const dataTransfer = new FakeDataTransfer();
        dataTransfer.set('application/vnd.code.tree.virtualTabsView.files', { value: [draggedFileItem] });

        await controller.handleDrop(targetSubGroupItem, dataTransfer as never, {} as never);

        // What SHOULD happen: removed from parent, present once in sub-group.
        // What ACTUALLY happens (the bug): parent still has the original
        // unencoded string, and sub-group has a re-encoded ("file:///d%3A/...")
        // string for the same file — two entries, one file.
        expect(subGroup.files).toHaveLength(1);
        expect(parentGroup.files).toEqual([]);
    });
});

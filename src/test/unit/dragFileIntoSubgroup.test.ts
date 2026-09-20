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
 * This uses the `vscode-uri` package (the same URI implementation
 * vscode.Uri is built on) as the mocked vscode.Uri, so Uri.parse(...).
 * toString() reproduces the real encoding behavior instead of a
 * hand-rolled approximation — and exercises the real dragAndDrop.ts /
 * treeItems.ts / provider.ts production code path, not a reimplementation.
 */

import * as path from 'path';
import { URI } from 'vscode-uri';
import type { TempGroup, ConfigScope } from '../../types';

jest.mock('vscode', () => {
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
        Uri: URI,
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
    const uri = URI.parse(uriStr) as unknown as never;
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

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

    class TreeItem {
        id?: string;
        resourceUri?: Uri;
        command?: unknown;
        iconPath?: unknown;
        tooltip?: unknown;
        contextValue?: string;

        constructor(public readonly label: unknown, public readonly collapsibleState?: number) { }
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
        TabInputText: class { },
        TabInputNotebook: class { },
        TabInputCustom: class { },
        TabInputTextDiff: class { },
        commands: {
            executeCommand: jest.fn()
        },
        window: {
            tabGroups: {
                all: []
            },
            showErrorMessage: jest.fn(),
            showInformationMessage: jest.fn()
        },
        workspace: {
            workspaceFolders: []
        }
    };
}, { virtual: true });

import { TempFoldersProvider } from '../../provider';

function createGroup(id: string, parentGroupId?: string): TempGroup {
    return {
        id,
        name: id,
        files: [],
        parentGroupId
    };
}

function createProviderHarness(groups: TempGroup[]): TempFoldersProvider {
    const provider = Object.create(TempFoldersProvider.prototype) as TempFoldersProvider;
    provider.groups = groups;
    provider.configScopes = [];
    return provider;
}

describe('TempFoldersProvider.moveGroupUnderGroup cycle guard', () => {
    test('moves a group under an unrelated group', () => {
        const moving = createGroup('moving');
        const provider = createProviderHarness([moving, createGroup('parent')]);

        expect(provider.moveGroupUnderGroup('moving', 'parent')).toBe(true);
        expect(moving.parentGroupId).toBe('parent');
    });

    test('rejects moving a group under its direct child', () => {
        const parent = createGroup('parent');
        const provider = createProviderHarness([parent, createGroup('child', 'parent')]);

        expect(provider.moveGroupUnderGroup('parent', 'child')).toBe(false);
        expect(parent.parentGroupId).toBeUndefined();
    });

    test('rejects moving a group under a deeper descendant', () => {
        const grandparent = createGroup('grandparent');
        const provider = createProviderHarness([
            grandparent,
            createGroup('parent', 'grandparent'),
            createGroup('child', 'parent')
        ]);

        expect(provider.moveGroupUnderGroup('grandparent', 'child')).toBe(false);
        expect(grandparent.parentGroupId).toBeUndefined();
    });

    test('terminates when an existing parent chain already contains a cycle', () => {
        const moving = createGroup('moving');
        const provider = createProviderHarness([
            createGroup('g1', 'g2'),
            createGroup('g2', 'g1'),
            moving
        ]);

        expect(() => provider.moveGroupUnderGroup('moving', 'g1')).not.toThrow();
        expect(moving.parentGroupId).toBe('g1');
    });
});

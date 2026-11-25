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

describe('TempFoldersProvider.removeGroupById cycle guard', () => {
    function harness(groups: TempGroup[]): TempFoldersProvider {
        const provider = createProviderHarness(groups);
        jest.spyOn(provider, 'refresh').mockImplementation(() => undefined);
        return provider;
    }

    test('removes a group together with its descendants and leaves unrelated groups alone', () => {
        const provider = harness([
            createGroup('parent'),
            createGroup('child', 'parent'),
            createGroup('grandchild', 'child'),
            createGroup('other')
        ]);

        provider.removeGroupById('parent');

        expect(provider.groups.map(g => g.id)).toEqual(['other']);
    });

    test('terminates when two groups name each other as parent, and removes both', () => {
        const provider = harness([createGroup('a', 'b'), createGroup('b', 'a'), createGroup('other')]);

        expect(() => provider.removeGroupById('a')).not.toThrow();

        expect(provider.groups.map(g => g.id)).toEqual(['other']);
    });

    test('terminates when a group names itself as parent', () => {
        const provider = harness([createGroup('a', 'a'), createGroup('other')]);

        expect(() => provider.removeGroupById('a')).not.toThrow();

        expect(provider.groups.map(g => g.id)).toEqual(['other']);
    });

    test('terminates on a longer cycle that the removed group is only part of', () => {
        const provider = harness([createGroup('a', 'c'), createGroup('b', 'a'), createGroup('c', 'b'), createGroup('other')]);

        expect(() => provider.removeGroupById('b')).not.toThrow();

        expect(provider.groups.map(g => g.id)).toEqual(['other']);
    });
});

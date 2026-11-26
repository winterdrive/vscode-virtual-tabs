import * as path from 'path';
import { pathToFileURL } from 'url';

jest.mock('vscode', () => {
    class TreeItem {
        label?: string;
        description?: string;
        tooltip?: string;
        id?: string;
        resourceUri?: unknown;
        command?: unknown;
        iconPath?: unknown;
        contextValue?: string;
        constructor(public readonly resourceUriOrLabel: unknown, public collapsibleState?: number) {
            // Like VS Code: a TreeItem built from a Uri derives its label from the file name.
            const uri = resourceUriOrLabel as { fsPath?: string };
            this.label = uri && typeof uri.fsPath === 'string' ? require('path').basename(uri.fsPath) : String(resourceUriOrLabel);
        }
    }
    return {
        TreeItem,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        ThemeIcon: Object.assign(class { constructor(public readonly id: string) { } }, { File: { id: 'file' } }),
        ThemeColor: class { constructor(public readonly id: string) { } },
        Uri: {}
    };
}, { virtual: true });

import { FileMetaManager } from '../../core/FileMetaManager';
import { removeStoredFileEntriesFromGroup } from '../../core/GroupFileRemoval';
import { TempFileItem } from '../../treeItems';
import type { TempGroup } from '../../types';

function uriOf(...segments: string[]): string {
    return pathToFileURL(path.resolve('/workspace/project', ...segments)).toString();
}

function makeGroup(extra: Partial<TempGroup> = {}): TempGroup {
    return { id: 'g1', name: 'Group', files: [], ...extra };
}

describe('FileMetaManager.set / get', () => {
    test('stores a label and a description for a file', () => {
        const group = makeGroup();
        const file = uriOf('a', 'index.js');

        FileMetaManager.set(group, file, { label: 'core index' });
        FileMetaManager.set(group, file, { description: 'entry point' });

        expect(FileMetaManager.get(group, file)).toEqual({ label: 'core index', description: 'entry point' });
    });

    test('trims input and leaves other fields untouched when one is patched', () => {
        const group = makeGroup();
        const file = uriOf('a', 'index.js');
        FileMetaManager.set(group, file, { label: '  core  ', description: 'd' });

        FileMetaManager.set(group, file, { label: 'cli' });

        expect(FileMetaManager.get(group, file)).toEqual({ label: 'cli', description: 'd' });
    });

    test('blank input clears the field and drops the entry once nothing is left', () => {
        const group = makeGroup();
        const file = uriOf('a', 'index.js');
        FileMetaManager.set(group, file, { label: 'core', description: 'd' });

        FileMetaManager.set(group, file, { description: '   ' });
        expect(FileMetaManager.get(group, file)).toEqual({ label: 'core' });

        FileMetaManager.set(group, file, { label: '' });
        expect(FileMetaManager.get(group, file)).toBeUndefined();
        expect(group.fileMeta).toBeUndefined();
    });

    test('clearing a file that has no metadata does not create an empty fileMeta object', () => {
        const group = makeGroup();

        FileMetaManager.set(group, uriOf('a.js'), { label: '' });

        expect(group.fileMeta).toBeUndefined();
    });

    test('the same file keeps independent labels in different groups', () => {
        const g1 = makeGroup({ id: 'g1' });
        const g2 = makeGroup({ id: 'g2' });
        const file = uriOf('a', 'index.js');

        FileMetaManager.set(g1, file, { label: 'one' });
        FileMetaManager.set(g2, file, { label: 'two' });

        expect(FileMetaManager.get(g1, file)?.label).toBe('one');
        expect(FileMetaManager.get(g2, file)?.label).toBe('two');
    });

    test('finds the stored key despite URI percent-encoding differences', () => {
        const fsPath = path.resolve('/workspace/project', 'src', 'index.js');
        const stored = pathToFileURL(fsPath).toString();
        const encodedVariant = stored.replace(/^(file:\/\/\/[A-Za-z]):/, '$1%3A');
        const group = makeGroup({ fileMeta: { [stored]: { label: 'src index' } } });

        expect(FileMetaManager.get(group, encodedVariant)?.label).toBe('src index');
        FileMetaManager.set(group, encodedVariant, { label: 'renamed' });
        expect(Object.keys(group.fileMeta!)).toEqual([stored]);
        expect(group.fileMeta![stored].label).toBe('renamed');
    });
});

describe('FileMetaManager.move / clone / mapKeys', () => {
    test('move carries metadata to the target group and removes it from the source', () => {
        const a = uriOf('a.js');
        const b = uriOf('b.js');
        const source = makeGroup({ fileMeta: { [a]: { label: 'A' }, [b]: { label: 'B' } } });
        const target = makeGroup({ id: 'g2' });

        FileMetaManager.move(source, target, [a]);

        expect(target.fileMeta).toEqual({ [a]: { label: 'A' } });
        expect(source.fileMeta).toEqual({ [b]: { label: 'B' } });
    });

    test('move removes the source fileMeta object once it is empty', () => {
        const a = uriOf('a.js');
        const source = makeGroup({ fileMeta: { [a]: { label: 'A' } } });
        const target = makeGroup({ id: 'g2' });

        FileMetaManager.move(source, target, [a]);

        expect(source.fileMeta).toBeUndefined();
    });

    test('move is a no-op for files without metadata', () => {
        const source = makeGroup({ fileMeta: { [uriOf('a.js')]: { label: 'A' } } });
        const target = makeGroup({ id: 'g2' });

        FileMetaManager.move(source, target, [uriOf('other.js')]);

        expect(target.fileMeta).toBeUndefined();
        expect(source.fileMeta).toBeDefined();
    });

    test('clone produces an independent copy', () => {
        const a = uriOf('a.js');
        const group = makeGroup({ fileMeta: { [a]: { label: 'A' } } });

        const copy = FileMetaManager.clone(group)!;
        copy[a].label = 'changed';

        expect(group.fileMeta![a].label).toBe('A');
        expect(FileMetaManager.clone(makeGroup())).toBeUndefined();
    });

    test('mapKeys remaps keys without touching values', () => {
        const mapped = FileMetaManager.mapKeys({ x: { label: 'X' }, y: { description: 'Y' } }, k => `rel/${k}`);

        expect(mapped).toEqual({ 'rel/x': { label: 'X' }, 'rel/y': { description: 'Y' } });
    });
});

describe('removing a file from a group drops its metadata', () => {
    test('removeStoredFileEntriesFromGroup removes the matching label and keeps the rest', () => {
        const scopeRoot = path.resolve('/workspace/project');
        const group: Pick<TempGroup, 'files' | 'bookmarks' | 'fileMeta'> = {
            files: ['src/a.js', 'src/b.js'],
            fileMeta: { 'src/a.js': { label: 'A' }, 'src/b.js': { label: 'B' } }
        };
        const fsPath = path.join(scopeRoot, 'src', 'a.js');

        removeStoredFileEntriesFromGroup(group, [{ uri: pathToFileURL(fsPath).toString(), fsPath }], scopeRoot);

        expect(group.files).toEqual(['src/b.js']);
        expect(group.fileMeta).toEqual({ 'src/b.js': { label: 'B' } });
    });

    test('the last label is removed together with the fileMeta object', () => {
        const scopeRoot = path.resolve('/workspace/project');
        const group: Pick<TempGroup, 'files' | 'bookmarks' | 'fileMeta'> = {
            files: ['src/a.js'],
            fileMeta: { 'src/a.js': { label: 'A' } }
        };
        const fsPath = path.join(scopeRoot, 'src', 'a.js');

        removeStoredFileEntriesFromGroup(group, [{ uri: pathToFileURL(fsPath).toString(), fsPath }], scopeRoot);

        expect(group.fileMeta).toBeUndefined();
    });
});

describe('TempFileItem with custom metadata', () => {
    const uri = { fsPath: path.resolve('/workspace/project/pkg/index.js'), toString: () => uriOf('pkg', 'index.js') };

    test('without metadata the label stays the file name', () => {
        const item = new TempFileItem(uri as never, 0, false, 'g1');

        expect(item.label).toBe('index.js');
        expect(item.tooltip).toBe(uri.fsPath);
        expect(item.description).toBeUndefined();
    });

    test('a custom label replaces the file name and the real path stays in the tooltip', () => {
        const item = new TempFileItem(uri as never, 0, false, 'g1', undefined, { label: 'pkg index' });

        expect(item.label).toBe('pkg index');
        expect(item.tooltip).toBe(uri.fsPath);
        expect(item.description).toBeUndefined();
    });

    test('a description is shown next to the label and appended to the tooltip', () => {
        const item = new TempFileItem(uri as never, 0, false, 'g1', undefined, { label: 'pkg index', description: 'entry' });

        expect(item.description).toBe('entry');
        expect(item.tooltip).toBe(`${uri.fsPath}\nentry`);
    });

    test('a description alone keeps the file name as label', () => {
        const item = new TempFileItem(uri as never, 0, false, 'g1', undefined, { description: 'entry' });

        expect(item.label).toBe('index.js');
        expect(item.description).toBe('entry');
    });
});

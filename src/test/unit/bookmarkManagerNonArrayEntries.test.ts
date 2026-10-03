import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BookmarkManager } from '../../core/BookmarkManager';
import { GroupManager } from '../../core/GroupManager';
import { FileManager } from '../../core/FileManager';
import type { TempGroup, VTBookmark } from '../../types';

// A hand-edited .vscode/virtualTab.json may hold a non-array value under a
// bookmark file key. Lookups must skip it instead of throwing TypeError.
const corruptValue = { id: 'not-an-array' } as unknown as VTBookmark[];

function makeGroup(): TempGroup {
    return {
        id: 'group-1',
        name: 'Group 1',
        files: [],
        bookmarks: {
            '/workspace/project/src/corrupt.ts': corruptValue,
            '/workspace/project/src/valid.ts': [
                { id: 'bm-1', line: 3, label: 'Valid', created: 1 }
            ]
        }
    };
}

describe('BookmarkManager static helpers with non-array bookmark entries', () => {
    test('getBookmarksForFile returns [] instead of throwing', () => {
        const group = makeGroup();
        expect(BookmarkManager.getBookmarksForFile(group, 'file:///workspace/project/src/corrupt.ts')).toEqual([]);
        expect(BookmarkManager.getBookmarksForFile(group, 'file:///workspace/project/src/valid.ts')).toHaveLength(1);
    });

    test('update/remove return false and leave the stored value untouched', () => {
        const group = makeGroup();
        const fileUri = 'file:///workspace/project/src/corrupt.ts';
        const replacement: VTBookmark = { id: 'bm-x', line: 1, label: 'X', created: 1 };

        expect(BookmarkManager.updateBookmarkInGroup(group, fileUri, 'bm-x', replacement)).toBe(false);
        expect(BookmarkManager.removeBookmarkFromGroup(group, fileUri, 'bm-x')).toBe(false);
        expect(group.bookmarks?.['/workspace/project/src/corrupt.ts']).toBe(corruptValue);
    });

    test('findBookmarkInGroup and getTotalBookmarkCount skip the non-array entry', () => {
        const group = makeGroup();
        expect(BookmarkManager.findBookmarkInGroup(group, 'bm-1')?.fileUri).toBe('/workspace/project/src/valid.ts');
        expect(BookmarkManager.findBookmarkInGroup(group, 'missing')).toBeNull();
        expect(BookmarkManager.getTotalBookmarkCount(group)).toBe(1);
    });
});

describe('BookmarkManager MCP methods with non-array bookmark entries', () => {
    let workspaceRoot: string;
    let manager: BookmarkManager;

    beforeEach(() => {
        workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-bm-nonarray-'));
        fs.mkdirSync(path.join(workspaceRoot, '.vscode'));
        const validUri = `file://${path.join(workspaceRoot, 'valid.ts')}`;
        const groups = [{
            id: 'group-1',
            name: 'Group 1',
            files: [validUri],
            bookmarks: {
                [`file://${path.join(workspaceRoot, 'corrupt.ts')}`]: 'oops',
                [validUri]: [{ id: 'bm-1', line: 2, label: 'Valid', created: 1 }]
            }
        }];
        fs.writeFileSync(path.join(workspaceRoot, '.vscode', 'virtualTab.json'), JSON.stringify(groups), 'utf8');
        const groupManager = new GroupManager(workspaceRoot);
        manager = new BookmarkManager(groupManager, new FileManager(workspaceRoot, groupManager));
    });

    afterEach(() => {
        fs.rmSync(workspaceRoot, { recursive: true, force: true });
    });

    test('listBookmarks returns only the valid bookmarks', () => {
        const list = manager.listBookmarks();
        expect(list.map(b => b.id)).toEqual(['bm-1']);
    });

    test('findBookmarkById and deleteBookmark do not throw', () => {
        expect(manager.findBookmarkById('bm-1')?.bookmark.label).toBe('Valid');
        expect(manager.findBookmarkById('missing')).toBeUndefined();
        expect(manager.deleteBookmark('missing')).toBe(false);
        expect(manager.deleteBookmark('bm-1')).toBe(true);
    });
});

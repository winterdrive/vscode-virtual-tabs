/**
 * Regression test: commands.ts used to carry its own copy of
 * getAllFilesInGroupRecursive with no visited-Set guard, unlike the
 * hardened version in util.ts (used by provider.ts). A circular
 * parentGroupId chain (e.g. from a hand-edited virtualTab.json, or briefly
 * during a drag-and-drop reparent) would make commands like
 * "Copy File Name(s)" / "Copy Relative Path" / "Copy Absolute Path" /
 * "Copy Context" recurse forever and crash with a stack overflow.
 *
 * commands.ts now imports the shared, cycle-safe implementation from
 * util.ts instead of defining its own. This test exercises that shared
 * implementation directly against a circular group hierarchy.
 */

import { getAllFilesInGroupRecursive } from '../../util';
import type { TempGroup } from '../../types';

jest.mock('vscode', () => ({}), { virtual: true });

describe('getAllFilesInGroupRecursive cycle guard', () => {
    test('circular parentGroupId chain does not cause infinite recursion', () => {
        const groups = [
            { id: 'g1', parentGroupId: 'g2', files: ['file:///a.txt'] },
            { id: 'g2', parentGroupId: 'g1', files: ['file:///b.txt'] }
        ] as unknown as TempGroup[];

        expect(() => getAllFilesInGroupRecursive(groups, 'g1')).not.toThrow();

        const files = getAllFilesInGroupRecursive(groups, 'g1');
        expect(files.sort()).toEqual(['file:///a.txt', 'file:///b.txt']);
    });

    test('self-referential parentGroupId does not cause infinite recursion', () => {
        const groups = [
            { id: 'g1', parentGroupId: 'g1', files: ['file:///a.txt'] }
        ] as unknown as TempGroup[];

        expect(() => getAllFilesInGroupRecursive(groups, 'g1')).not.toThrow();
        expect(getAllFilesInGroupRecursive(groups, 'g1')).toEqual(['file:///a.txt']);
    });

    test('normal nested groups still collect all descendant files', () => {
        const groups = [
            { id: 'parent', files: ['file:///parent.txt'] },
            { id: 'child', parentGroupId: 'parent', files: ['file:///child.txt'] },
            { id: 'grandchild', parentGroupId: 'child', files: ['file:///grandchild.txt'] }
        ] as unknown as TempGroup[];

        const files = getAllFilesInGroupRecursive(groups, 'parent');
        expect(files.sort()).toEqual(['file:///child.txt', 'file:///grandchild.txt', 'file:///parent.txt']);
    });
});

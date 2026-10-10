/**
 * Unit test: GroupManager.saveGroups() must not alias the caller's array in its cache.
 *
 * If it did, mutating the array after saving (without saving again) would leak
 * into the next cache-hit loadGroups() call, returning data that is not on disk.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GroupManager } from '../../core/GroupManager';
import type { TempGroup } from '../../types';

describe('GroupManager — saveGroups cache isolation', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'));
        fs.mkdirSync(path.join(tmpDir, '.vscode'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('mutating the saved array does not corrupt later cache-hit reads', () => {
        const manager = new GroupManager(tmpDir);
        const { groups, version } = manager.loadGroups();
        groups.push({ id: 'g1', name: 'Group 1', files: ['a.ts'] } as TempGroup);
        manager.saveGroups(groups, version);

        // Mutate without saving
        groups[0].files!.push('unsaved.ts');
        groups.push({ id: 'ghost', name: 'Ghost', files: [] } as TempGroup);

        const { groups: reloaded } = manager.loadGroups();
        expect(reloaded).toHaveLength(1);
        expect(reloaded[0].files).toEqual(['a.ts']);
    });
});

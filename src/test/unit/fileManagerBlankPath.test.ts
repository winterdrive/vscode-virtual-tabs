import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileManager } from '../../core/FileManager';
import { GroupManager } from '../../core/GroupManager';
import type { TempGroup } from '../../types';

describe('FileManager.addFilesToGroup blank / workspace-root paths', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-fm-blank-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function setupWorkspace(groups: TempGroup[]): { gm: GroupManager; fm: FileManager } {
        fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
        fs.writeFileSync(path.join(tmpDir, '.vscode', 'virtualTab.json'), JSON.stringify(groups));
        const gm = new GroupManager(tmpDir);
        const fm = new FileManager(tmpDir, gm);
        return { gm, fm };
    }

    test.each([
        ['empty string', ''],
        ['dot', '.'],
        ['workspace root absolute path', '<root>']
    ])('reports %s as invalid instead of storing the workspace root', (_label, input) => {
        const { fm, gm } = setupWorkspace([{ id: 'group-1', name: 'Test Group', files: [] }]);
        const filePath = input === '<root>' ? tmpDir : input;

        const result = fm.addFilesToGroup('group-1', [filePath]);

        expect(result.added).toEqual([]);
        expect(result.invalid).toEqual([filePath]);

        const { groups } = gm.loadGroups();
        expect(groups[0].files).toEqual([]);
    });

    test('still adds valid files passed alongside a blank entry', () => {
        const { fm, gm } = setupWorkspace([{ id: 'group-1', name: 'Test Group', files: [] }]);

        const result = fm.addFilesToGroup('group-1', ['', 'src/foo.ts']);

        expect(result.added).toEqual(['src/foo.ts']);
        expect(result.invalid).toEqual(['']);

        const { groups } = gm.loadGroups();
        expect(groups[0].files).toEqual([fm.toFileUri('src/foo.ts')]);
    });
});

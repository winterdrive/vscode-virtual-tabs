import * as os from 'os';
import * as path from 'path';
import { PathUtils } from '../../core/PathUtils';

describe('PathUtils.validatePath', () => {
    const root = path.join(os.tmpdir(), 'vt-pathutils-root');
    const utils = new PathUtils(root);

    test('accepts files inside the workspace', () => {
        expect(utils.validatePath('src/index.ts')).toBe(true);
        expect(utils.validatePath(path.join(root, 'src', 'index.ts'))).toBe(true);
    });

    test('accepts in-workspace entries whose name starts with ".."', () => {
        expect(utils.validatePath('..config/settings.json')).toBe(true);
        expect(utils.validatePath('..hidden')).toBe(true);
        expect(utils.validatePath(path.join(root, '..notes.md'))).toBe(true);
    });

    test('rejects paths that escape the workspace', () => {
        expect(utils.validatePath('..')).toBe(false);
        expect(utils.validatePath('../outside.ts')).toBe(false);
        expect(utils.validatePath('src/../../outside.ts')).toBe(false);
        expect(utils.validatePath(path.join(path.dirname(root), 'sibling', 'file.ts'))).toBe(false);
    });
});

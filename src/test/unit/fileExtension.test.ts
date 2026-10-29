/**
 * Regression test: "Copy Context" derived the code-fence language and the
 * binary-extension check from `uri.fsPath.split('.').pop()`. For files with
 * no extension (Makefile, Dockerfile, LICENSE) that returned the whole path,
 * so the generated markdown contained fences like ```/home/user/repo/makefile.
 */

import * as path from 'path';
import { getFileExtension } from '../../core/FileExtension';

describe('getFileExtension', () => {
    test('returns the lowercase extension without the dot', () => {
        expect(getFileExtension(path.join('repo', 'src', 'Index.TS'))).toBe('ts');
    });

    test('returns only the last extension for multi-dot names', () => {
        expect(getFileExtension(path.join('repo', 'archive.tar.gz'))).toBe('gz');
    });

    test('returns an empty string for extension-less files', () => {
        expect(getFileExtension(path.join('repo', 'Makefile'))).toBe('');
        expect(getFileExtension('/home/user/repo/Dockerfile')).toBe('');
    });

    test('ignores dots in parent directory names', () => {
        expect(getFileExtension(path.join('repo', 'v1.2', 'LICENSE'))).toBe('');
    });

    test('treats dotfiles as having no extension', () => {
        expect(getFileExtension(path.join('repo', '.gitignore'))).toBe('');
    });
});

import * as path from 'path';

/**
 * Return a file's extension in lowercase, without the leading dot.
 *
 * Uses path.extname instead of `fsPath.split('.').pop()`, which returns the
 * whole path for extension-less files (e.g. `/repo/Makefile`) or the tail of
 * a dotted directory name (e.g. `/repo/v1.2/LICENSE` -> `2/license`).
 */
export function getFileExtension(fsPath: string): string {
    return path.extname(fsPath).slice(1).toLowerCase();
}

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const showWarningMessage = jest.fn();
const showErrorMessage = jest.fn();

jest.mock('vscode', () => ({
    window: {
        showWarningMessage: (...args: unknown[]) => showWarningMessage(...args),
        showErrorMessage: (...args: unknown[]) => showErrorMessage(...args)
    }
}), { virtual: true });

import * as vscode from 'vscode';
import { SendToManager } from '../../sendTo';

describe('SendToManager.sendFile when the destination is the source folder', () => {
    let dir: string;
    let sourcePath: string;

    beforeEach(() => {
        showWarningMessage.mockReset();
        showErrorMessage.mockReset();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-sendto-same-'));
        sourcePath = path.join(dir, 'a.txt');
        fs.writeFileSync(sourcePath, 'original', 'utf8');
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    function uriOf(fsPath: string): vscode.Uri {
        return { fsPath } as unknown as vscode.Uri;
    }

    test('does not ask to overwrite the file with itself and leaves it intact', async () => {
        const ok = await SendToManager.sendFile(uriOf(sourcePath), dir, true);

        expect(ok).toBe(true);
        expect(showWarningMessage).not.toHaveBeenCalled();
        expect(showErrorMessage).not.toHaveBeenCalled();
        expect(fs.readFileSync(sourcePath, 'utf8')).toBe('original');
    });

    test('recognizes the same folder written with a trailing separator', async () => {
        const ok = await SendToManager.sendFile(uriOf(sourcePath), dir + path.sep, true);

        expect(ok).toBe(true);
        expect(showWarningMessage).not.toHaveBeenCalled();
    });

    test('still asks before overwriting a different existing file', async () => {
        const otherDir = path.join(dir, 'other');
        fs.mkdirSync(otherDir);
        fs.writeFileSync(path.join(otherDir, 'a.txt'), 'existing', 'utf8');
        showWarningMessage.mockResolvedValue(undefined);

        const ok = await SendToManager.sendFile(uriOf(sourcePath), otherDir, true);

        expect(ok).toBe(false);
        expect(showWarningMessage).toHaveBeenCalledTimes(1);
        expect(fs.readFileSync(path.join(otherDir, 'a.txt'), 'utf8')).toBe('existing');
    });
});

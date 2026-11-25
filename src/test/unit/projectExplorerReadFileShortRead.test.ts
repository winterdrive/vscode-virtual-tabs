/**
 * Unit test: ProjectExplorer.readFile() must only inspect the bytes actually read.
 *
 * If the file shrinks between statSync and readSync (or the read is short), the
 * unread tail of the zero-filled buffer must not be mistaken for NUL bytes and
 * reported as a binary file.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProjectExplorer } from '../../core/ProjectExplorer';

let shortRead = false;
jest.mock('fs', () => {
    const actual = jest.requireActual('fs');
    return {
        ...actual,
        readSync: (fd: number, buf: Buffer, ...rest: unknown[]) => {
            if (shortRead) {
                // Simulate the file having shrunk to 5 bytes after stat
                buf.write('hello', 0);
                return 5;
            }
            return (actual.readSync as (...a: unknown[]) => number)(fd, buf, ...rest);
        }
    };
});

describe('ProjectExplorer.readFile — short reads', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-readfile-'));
    });

    afterEach(() => {
        shortRead = false;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('does not treat unread buffer tail as binary content', () => {
        const file = path.join(tmpDir, 'a.txt');
        fs.writeFileSync(file, 'hello world');
        shortRead = true;

        const result = new ProjectExplorer(tmpDir).readFile(file);
        expect(result.content).toBe('hello');
    });

    it('still rejects real binary files', () => {
        const file = path.join(tmpDir, 'b.bin');
        fs.writeFileSync(file, Buffer.from([0x41, 0x00, 0x42]));
        expect(() => new ProjectExplorer(tmpDir).readFile(file)).toThrow('Binary files are not supported');
    });
});

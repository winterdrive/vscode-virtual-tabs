/**
 * Unit test: AutoGrouper.groupByModifiedDate() must count calendar days
 * correctly when local midnights straddle a DST transition (23h/25h days).
 *
 * Jest sandboxes process.env, so TZ cannot be changed in-process. The
 * bucketing runs in a child Node process (via tsx) with TZ set explicitly.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';

const AUTO_GROUPER_PATH = path.resolve(__dirname, '../../core/AutoGrouper.ts');

describe('AutoGrouper.groupByModifiedDate — DST day boundaries', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-autogroup-dst-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function makeFile(name: string, isoMtime: string): string {
        const filePath = path.join(tmpDir, name);
        const mtime = new Date(isoMtime);
        fs.writeFileSync(filePath, '');
        fs.utimesSync(filePath, mtime, mtime);
        return pathToFileURL(filePath).toString();
    }

    /** Returns a uri → bucket map computed under the given time zone. */
    function bucketsInTimeZone(uris: string[], timeZone: string): Record<string, string> {
        const script = [
            `const { AutoGrouper } = require(${JSON.stringify(AUTO_GROUPER_PATH)});`,
            `const groups = AutoGrouper.groupByModifiedDate(${JSON.stringify(uris)});`,
            'const out = {};',
            'for (const [bucket, list] of groups) { for (const uri of list) { out[uri] = bucket; } }',
            'process.stdout.write(JSON.stringify(out));'
        ].join('\n');
        const scriptPath = path.join(tmpDir, 'probe.cjs');
        fs.writeFileSync(scriptPath, script);

        const output = execFileSync(process.execPath, ['--import', 'tsx', scriptPath], {
            env: { ...process.env, TZ: timeZone },
            encoding: 'utf8'
        });
        return JSON.parse(output);
    }

    // US DST starts 2026-03-08 and ends 2026-11-01 (America/New_York).

    it('puts a file from the day before spring-forward into "yesterday"', () => {
        const newest = makeFile('newest.ts', '2026-03-09T12:00:00-04:00');
        const older = makeFile('older.ts', '2026-03-08T12:00:00-04:00');

        const buckets = bucketsInTimeZone([newest, older], 'America/New_York');

        expect(buckets[newest]).toBe('today');
        expect(buckets[older]).toBe('yesterday');
    });

    it('puts a file 8 calendar days back across spring-forward into "lastWeek"', () => {
        const newest = makeFile('newest.ts', '2026-03-12T12:00:00-04:00');
        const older = makeFile('older.ts', '2026-03-04T12:00:00-05:00');

        const buckets = bucketsInTimeZone([newest, older], 'America/New_York');

        expect(buckets[older]).toBe('lastWeek');
    });

    it('still puts a file from the day before fall-back into "yesterday"', () => {
        const newest = makeFile('newest.ts', '2026-11-02T12:00:00-05:00');
        const older = makeFile('older.ts', '2026-11-01T12:00:00-05:00');

        const buckets = bucketsInTimeZone([newest, older], 'America/New_York');

        expect(buckets[older]).toBe('yesterday');
    });
});

import { normalizeFilesParam } from '../../../mcp-server/src/utils/normalizeParams';

describe('normalizeFilesParam', () => {
    test('returns an empty array for undefined', () => {
        expect(normalizeFilesParam(undefined)).toEqual([]);
    });

    test('passes a real string array through unchanged', () => {
        expect(normalizeFilesParam(['src/a.ts', 'src/b.ts'])).toEqual(['src/a.ts', 'src/b.ts']);
    });

    test('decodes a JSON-encoded string array', () => {
        expect(normalizeFilesParam('["src/a.ts","src/b.ts"]')).toEqual(['src/a.ts', 'src/b.ts']);
    });

    test('wraps a plain path string in a single-element array', () => {
        expect(normalizeFilesParam('src/a.ts')).toEqual(['src/a.ts']);
    });

    test('drops non-string entries from a JSON-encoded array', () => {
        expect(normalizeFilesParam('["src/a.ts", 42, null, {"p":"x"}, ["y"], "src/b.ts"]'))
            .toEqual(['src/a.ts', 'src/b.ts']);
    });

    test('returns an empty array when a JSON-encoded array has no string entries', () => {
        expect(normalizeFilesParam('[1, 2, null]')).toEqual([]);
    });

    test('unwraps a JSON-encoded single string instead of keeping the quotes', () => {
        expect(normalizeFilesParam('"src/a.ts"')).toEqual(['src/a.ts']);
    });

    test('keeps the raw string when it parses to a non-array, non-string JSON value', () => {
        expect(normalizeFilesParam('123')).toEqual(['123']);
        expect(normalizeFilesParam('null')).toEqual(['null']);
    });
});

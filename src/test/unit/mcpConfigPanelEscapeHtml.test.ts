jest.mock('vscode', () => ({}), { virtual: true });

import { escapeHtml } from '../../mcp/McpConfigPanel';

describe('McpConfigPanel escapeHtml', () => {
    test('escapes HTML-significant characters', () => {
        expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    test('escapes a workspace folder name crafted to break out of an <option> tag', () => {
        const maliciousName = '"><img src=x onerror=alert(1)>';
        const escaped = escapeHtml(maliciousName);
        expect(escaped).not.toContain('<img');
        expect(escaped).not.toContain('">');
        expect(escaped).toBe('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    });

    test('leaves plain workspace names untouched', () => {
        expect(escapeHtml('my-project')).toBe('my-project');
    });

    test('escapes ampersands and single quotes', () => {
        expect(escapeHtml(`A & B's repo`)).toBe('A &amp; B&#39;s repo');
    });
});

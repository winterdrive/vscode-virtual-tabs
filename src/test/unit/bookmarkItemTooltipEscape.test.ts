/**
 * Regression test: BookmarkItem's tooltip used to interpolate the
 * user-provided bookmark label/description and the file's fsPath directly
 * into appendMarkdown(). Markdown syntax in those strings was interpreted,
 * so labels containing '*', '_' or '[' rendered wrongly and Windows paths
 * lost the backslash before punctuation (e.g. 'C:\proj\.vscode' rendered as
 * 'C:\proj.vscode').
 *
 * User-controlled text must now go through appendText(), which escapes it.
 */

jest.mock('vscode', () => {
    class TreeItem {
        constructor(public label: unknown, public collapsibleState?: number) { }
    }
    class ThemeIcon {
        static File = {};
        constructor(public id: string, public color?: unknown) { }
    }
    class ThemeColor {
        constructor(public id: string) { }
    }
    class MarkdownString {
        parts: { kind: 'markdown' | 'text'; value: string }[] = [];
        appendMarkdown(value: string) {
            this.parts.push({ kind: 'markdown', value });
            return this;
        }
        appendText(value: string) {
            this.parts.push({ kind: 'text', value });
            return this;
        }
    }
    return {
        TreeItem,
        ThemeIcon,
        ThemeColor,
        MarkdownString,
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 }
    };
}, { virtual: true });

import { BookmarkItem } from '../../treeItems';
import type { VTBookmark } from '../../types';

type Part = { kind: 'markdown' | 'text'; value: string };

function tooltipParts(bookmark: VTBookmark, fsPath: string): Part[] {
    const fileUri = { fsPath, toString: () => `file:///${fsPath}` };
    const item = new BookmarkItem(bookmark, fileUri as any, 0);
    return (item.tooltip as unknown as { parts: Part[] }).parts;
}

function markdownOnly(parts: Part[]): string {
    return parts.filter(p => p.kind === 'markdown').map(p => p.value).join('');
}

describe('BookmarkItem tooltip escaping', () => {
    const fsPath = 'C:\\proj\\.vscode\\my_file[1].ts';
    const bookmark = {
        line: 4,
        label: 'fix *this* [now](http://x)',
        description: 'see __init__ and `code`',
        created: 0
    } as VTBookmark;

    test('label, description and path are appended as escaped text', () => {
        const parts = tooltipParts(bookmark, fsPath);
        const texts = parts.filter(p => p.kind === 'text').map(p => p.value);

        expect(texts).toEqual([bookmark.label, bookmark.description, fsPath]);
    });

    test('user-controlled strings never reach appendMarkdown', () => {
        const markdown = markdownOnly(tooltipParts(bookmark, fsPath));

        expect(markdown).not.toContain(bookmark.label);
        expect(markdown).not.toContain(bookmark.description as string);
        expect(markdown).not.toContain(fsPath);
    });

    test('keeps the bold label, line number and italic description structure', () => {
        const parts = tooltipParts(bookmark, fsPath);

        expect(parts.slice(0, 6)).toEqual([
            { kind: 'markdown', value: '**' },
            { kind: 'text', value: bookmark.label },
            { kind: 'markdown', value: '** (line 5)\n\n' },
            { kind: 'markdown', value: '*' },
            { kind: 'text', value: bookmark.description },
            { kind: 'markdown', value: '*\n\n' }
        ]);
    });

    test('omits the description block when there is no description', () => {
        const parts = tooltipParts({ ...bookmark, description: undefined }, fsPath);
        const texts = parts.filter(p => p.kind === 'text').map(p => p.value);

        expect(texts).toEqual([bookmark.label, fsPath]);
    });
});

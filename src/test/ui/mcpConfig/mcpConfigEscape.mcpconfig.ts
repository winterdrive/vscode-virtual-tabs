/**
 * Real E2E test for the MCP config webview (`VirtualTabs: Show MCP Config`) rendering hostile
 * workspace folder names (#146).
 *
 * Workspace folder names can come from an untrusted `.code-workspace` file. This opens a real VS Code
 * window on a dedicated workspace whose folder names are `<b>x</b>` and a string that tries to close
 * the page's own `<script>` block and inject an `<img onerror>`, opens the real webview, and inspects
 * the DOM the user would actually get.
 *
 * Run in isolation (it needs its own workspace, separate from the shared multi-root fixture):
 *   npx tsc -p tsconfig.test.ui.json && extest setup-and-run "out/test/ui/mcpConfig/**\/*.mcpconfig.js" \
 *     -e ".vscode-test/extensions" -r "test-resources/mcp-config/hostile-names.code-workspace" -c 1.96.0
 */

import {
    EditorView,
    VSBrowser,
    WebView,
    Workbench
} from 'vscode-extension-tester';
import { expect } from 'chai';

const COMMAND = 'VirtualTabs: Show MCP Config';
const EDITOR_TITLE = 'VirtualTabs MCP Server Configuration';
const NAME_A = '<b>x</b>';
const NAME_B = '</script><img src=x onerror="window.__vtXss=1"><script>';

async function dismissOnboardingOverlay(): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(async () => {
        return await driver.executeScript(`
            for (const el of document.querySelectorAll('.onboarding-a-overlay, [aria-label="Welcome to Visual Studio Code"][role="dialog"]')) { el.remove(); }
            return true;
        `) as boolean;
    }, 5_000, 'Onboarding overlay did not disappear');
}

describe('Virtual Tabs - MCP config webview with hostile workspace folder names', function () {
    this.timeout(180_000);

    let webview: WebView;

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();
        await dismissOnboardingOverlay();

        await new Workbench().executeCommand(COMMAND);
        await VSBrowser.instance.driver.wait(async () => {
            try {
                return (await new EditorView().getOpenEditorTitles()).includes(EDITOR_TITLE);
            } catch { return false; }
        }, 30_000, `Editor "${EDITOR_TITLE}" did not open`);
        await new EditorView().openEditor(EDITOR_TITLE);

        webview = new WebView();
        await webview.wait(15_000);
        await webview.switchToFrame(15_000);
        // The page fills this node from its own script, so it doubles as "the script ran".
        await VSBrowser.instance.driver.wait(async () => {
            const text = await VSBrowser.instance.driver.executeScript(
                `const n = document.getElementById('workspace-path'); return n ? (n.textContent || '').trim() : '';`
            ) as string;
            return text.length > 0;
        }, 15_000, 'Webview script did not render the workspace path (page script broken?)');
    });

    after(async function () {
        try { await webview.switchBack(); } catch { /* frame already gone */ }
        await new EditorView().closeAllEditors();
    });

    const inPage = async <T>(script: string): Promise<T> =>
        await VSBrowser.instance.driver.executeScript(script) as T;

    it('lists both folder names as plain text in the selector', async function () {
        const options = await inPage<string[]>(
            `return Array.from(document.querySelectorAll('#workspace-select option')).map(o => o.textContent);`
        );
        expect(options).to.deep.equal([NAME_A, NAME_B]);
    });

    it('does not turn "<b>x</b>" into a real <b> element', async function () {
        const bold = await inPage<number>(`return document.querySelectorAll('#workspace-select b').length;`);
        expect(bold).to.equal(0);
    });

    it('the script-closing name injects no element and runs no handler', async function () {
        // typeof, because WebDriver serialises `undefined` as `null`.
        const injected = await inPage<{ imgs: number; xss: string }>(
            `return { imgs: document.querySelectorAll('img').length, xss: typeof window.__vtXss };`
        );
        expect(injected.imgs, 'an <img> was injected into the page').to.equal(0);
        expect(injected.xss, 'the injected onerror handler ran').to.equal('undefined');
    });

    it('the page keeps working: it shows the first folder, and switching to the hostile one works', async function () {
        const first = await inPage<string>(`return document.getElementById('workspace-path').textContent;`);
        expect(first).to.include('Folder-A');

        await inPage<void>(`
            const select = document.getElementById('workspace-select');
            select.selectedIndex = 1;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        `);
        const second = await inPage<string>(`return document.getElementById('workspace-path').textContent;`);
        expect(second).to.include('Folder-B');
        expect(await inPage<number>(`return document.querySelectorAll('img').length;`)).to.equal(0);
    });
});

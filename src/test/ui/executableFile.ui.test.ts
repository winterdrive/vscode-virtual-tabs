/**
 * E2E 測試：Executable File 項目（virtualTabsFileCustomExec / virtualTabsFileBuiltInExec）
 *
 * 依據 DEVELOPMENT.md §Menu Availability Matrix：
 *   - "Run File (Inline)" button 應出現在 .bat / .exe 檔案上
 *   - 一般（非 exec）檔案不應出現 "Run" inline button
 *
 * Suites:
 *   Suite 6: Executable file in Custom Group (virtualTabsFileCustomExec)
 *     - Verifies "Run" inline button IS present
 *     - Verifies all other file-level context menu items are also present
 *   Suite 7: Executable file in Built-in Group (virtualTabsFileBuiltInExec)
 *     - Verifies "Run" inline button IS present for built-in-group exec files
 *   Suite 8: Non-executable file in Custom Group — regression
 *     - Verifies "Run" inline button is NOT present for plain .ts files
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    ActivityBar,
    CustomTreeSection,
    EditorView,
    SideBarView,
    TreeItem,
    ViewControl,
    VSBrowser
} from 'vscode-extension-tester';
import { By, Key, WebElement } from 'selenium-webdriver';
import { expect } from 'chai';

// ─── Fixture paths ─────────────────────────────────────────────────────────────

const fixtureRoot = path.resolve(__dirname, '../../../test-resources/multi-root');
const repoAPath = path.join(fixtureRoot, 'Repo-A');
const repoAConfigPath = path.join(repoAPath, '.vscode', 'virtualTab.json');
const repoAOriginal = [{ id: 'repo-a-existing', name: 'Repo A Existing', files: [] }];

const execFileRelPath = 'src/exec-test.bat';
const execFileAbsPath = path.join(repoAPath, execFileRelPath);

const plainFileRelPath = 'src/plain-exec-regression.ts';
const plainFileAbsPath = path.join(repoAPath, plainFileRelPath);

// ─── Config helpers ─────────────────────────────────────────────────────────────

function writeConfig(configPath: string, groups: object[]): void {
    fs.writeFileSync(configPath, `${JSON.stringify(groups, null, 2)}\n`);
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

async function dismissOnboardingOverlay(): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(async () => {
        return await driver.executeScript(`
            const styleId = 'vt-e2e-exec-hide-onboarding';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = '.onboarding-a-overlay { display: none !important; }';
                document.head.appendChild(style);
            }
            for (const el of document.querySelectorAll(
                '.onboarding-a-overlay, [aria-label="Welcome to Visual Studio Code"][role="dialog"]'
            )) { el.remove(); }
            return document.querySelectorAll('.onboarding-a-overlay.visible').length === 0;
        `) as boolean;
    }, 5_000, 'Onboarding overlay did not disappear');
}

async function dismissContextViews(): Promise<void> {
    const driver = VSBrowser.instance.driver;
    const isMenuOpen = async (): Promise<boolean> => {
        const menus = await driver.findElements(By.css('.context-view.monaco-menu-container'));
        for (const menu of menus) {
            try { if (await menu.isDisplayed()) return true; } catch { /* stale */ }
        }
        return false;
    };
    if (!(await isMenuOpen())) return;
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
    await driver.sleep(150);
    await driver.actions().sendKeys(Key.ESCAPE).perform().catch(() => undefined);
    const closed = await driver.wait(async () => !(await isMenuOpen()), 2_000).catch(() => false);
    if (!closed) {
        const blocks = await driver.findElements(By.css('.context-view-block'));
        for (const b of blocks) { try { await b.click(); } catch { /* stale */ } }
        await driver.sleep(200);
    }
}
async function getVisibleTreeLabels(): Promise<string[]> {
    const driver = VSBrowser.instance.driver;
    return await driver.executeScript(`
        return Array.from(document.querySelectorAll('.monaco-list-row'))
            .map(row => row.textContent ? row.textContent.trim().replace(/\\s+/g, ' ') : '')
            .filter(Boolean);
    `) as string[];
}

async function waitForTreeLabel(label: string | RegExp, timeoutMs = 15_000): Promise<void> {
    await VSBrowser.instance.driver.wait(async () => {
        const labels = await getVisibleTreeLabels();
        return typeof label === 'string'
            ? labels.some(t => t.includes(label))
            : labels.some(t => label.test(t));
    }, timeoutMs, `Tree item matching "${label}" not found within ${timeoutMs}ms`);
}

async function openVirtualTabsView(): Promise<SideBarView> {
    await dismissOnboardingOverlay();
    const activityBar = new ActivityBar();
    const viewControl = await VSBrowser.instance.driver.wait(async () => {
        await dismissOnboardingOverlay();
        return await activityBar.getViewControl('Virtual Tabs') as ViewControl | undefined;
    }, 30_000, 'Virtual Tabs icon not found in Activity Bar');
    if (!viewControl) {
        throw new Error('Virtual Tabs icon not found in Activity Bar');
    }

    let sidebar: SideBarView;
    try {
        sidebar = await viewControl.openView() as SideBarView;
    } catch {
        await dismissOnboardingOverlay();
        await viewControl.getDriver().executeScript('arguments[0].click()', viewControl);
        sidebar = await new SideBarView().wait();
    }

    await VSBrowser.instance.driver.wait(async () => {
        const labels = await getVisibleTreeLabels();
        return labels.length > 0;
    }, 30_000, 'Virtual Tabs extension did not activate within 30s');

    return sidebar;
}

async function clickToolbarButton(sidebar: SideBarView, titlePattern: RegExp): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(async () => {
        try {
            const actions = await sidebar.getTitlePart().getActions();
            for (const action of actions) {
                const title = await action.getTitle();
                if (titlePattern.test(title)) {
                    await action.click();
                    return true;
                }
            }
            return false;
        } catch (error) {
            const name = (error as Error).name;
            if (name === 'StaleElementReferenceError' || name === 'ElementClickInterceptedError') {
                return false;
            }
            throw error;
        }
    }, 10_000, `Toolbar button matching "${titlePattern}" not found`);
}

async function reloadVirtualTabsView(): Promise<SideBarView> {
    await dismissContextViews();
    const sidebar = await openVirtualTabsView();
    await clickToolbarButton(sidebar, /refresh/i);
    return sidebar;
}

async function getVirtualTabsSection(sidebar: SideBarView): Promise<CustomTreeSection> {
    const content = sidebar.getContent();
    return await content.getSection<CustomTreeSection>(
        section => section.getTitle().then(title => title.toLowerCase().includes('virtual tabs')),
        CustomTreeSection
    );
}

async function findTreeItem(section: CustomTreeSection, label: string, timeoutMs = 10_000): Promise<TreeItem> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(
        async () => (await section.findItem(label)) !== undefined,
        timeoutMs,
        `Tree item "${label}" not found`
    );
    return (await section.findItem(label)) as TreeItem;
}

/**
 * Right-click the tree row matching `rowLabel`, collect top-level context menu item
 * labels, then dismiss with Escape.
 */
async function getContextMenuItemsFor(rowLabelOrElement: string | RegExp | WebElement, timeoutMs = 12_000, preClick = false): Promise<string[]> {
    const driver = VSBrowser.instance.driver;

    await dismissContextViews();

    // A caller may pass an already-resolved WebElement (e.g. from
    // TreeItem.findChildItem()) to target a specific row unambiguously,
    // instead of a global basename search that can match an unrelated row
    // with the same displayed text (see the "Executable File (Custom Group)"
    // and "Non-exec File regression" suites).
    const row = rowLabelOrElement instanceof WebElement
        ? rowLabelOrElement
        : await driver.wait(async () => {
            const rows = await driver.findElements(By.css('.monaco-list-row'));
            for (const r of rows) {
                try {
                    const text = (await r.getText()).trim();
                    const matches = typeof rowLabelOrElement === 'string'
                        ? text.includes(rowLabelOrElement)
                        : rowLabelOrElement.test(text);
                    if (matches) { return r; }
                } catch { /* stale ref — retry */ }
            }
            return null;
        }, timeoutMs, `Tree row matching "${rowLabelOrElement}" not found for context menu`) as Awaited<ReturnType<typeof driver.findElement>>;

    if (preClick) {
        await driver.actions().click(row).perform();
        await driver.sleep(400);
    }

    await driver.actions().contextClick(row).perform();

    await driver.wait(async () => {
        try {
            const menu = await driver.findElement(By.css('.context-view.monaco-menu-container'));
            return await menu.isDisplayed();
        } catch { return false; }
    }, 6_000, 'Context menu did not appear');

    await driver.sleep(350);

    const itemEls = await driver.findElements(
        By.css('.context-view.monaco-menu-container .action-item:not(.separator) .action-label')
    );
    const labels: string[] = [];
    for (const el of itemEls) {
        try {
            const txt = (await el.getText()).trim();
            if (txt) { labels.push(txt); }
        } catch { /* stale — skip */ }
    }

    await dismissContextViews();
    await driver.sleep(250);

    return [...new Set(labels)];
}

/**
 * Hover over the tree row matching `rowLabel` and return aria-labels of visible
 * inline action buttons.
 */
async function getInlineActionLabelsFor(rowLabelOrElement: string | RegExp | WebElement, timeoutMs = 12_000): Promise<string[]> {
    const driver = VSBrowser.instance.driver;

    const row = rowLabelOrElement instanceof WebElement
        ? rowLabelOrElement
        : await driver.wait(async () => {
            const rows = await driver.findElements(By.css('.monaco-list-row'));
            for (const r of rows) {
                try {
                    const text = (await r.getText()).trim();
                    const matches = typeof rowLabelOrElement === 'string'
                        ? text.includes(rowLabelOrElement)
                        : rowLabelOrElement.test(text);
                    if (matches) { return r; }
                } catch { /* stale */ }
            }
            return null;
        }, timeoutMs, `Tree row matching "${rowLabelOrElement}" not found for inline actions`) as Awaited<ReturnType<typeof driver.findElement>>;

    await driver.actions().move({ origin: row }).perform();
    await driver.sleep(400);

    const buttons = await row.findElements(By.css('.action-item .action-label[aria-label]'));
    const labels: string[] = [];
    for (const btn of buttons) {
        try {
            const lbl = (await btn.getAttribute('aria-label')) || (await btn.getText()).trim();
            if (lbl) { labels.push(lbl); }
        } catch { /* stale */ }
    }

    return labels;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6: Executable File in Custom Group (virtualTabsFileCustomExec)
// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Availability Matrix – Executable File (Custom Group) (virtualTabsFileCustomExec)', function () {
    this.timeout(90_000);

    const GROUP_NAME = 'CTX-Exec-Custom-Group';
    const EXEC_BASENAME = path.basename(execFileAbsPath);

    let ctxItems: string[];
    let inlineLabels: string[];

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();

        fs.mkdirSync(path.dirname(execFileAbsPath), { recursive: true });
        fs.writeFileSync(execFileAbsPath, '@echo off\necho exec-test-fixture\n');

        writeConfig(repoAConfigPath, [
            { id: 'ctx-exec-custom-group', name: GROUP_NAME, files: [execFileRelPath] }
        ]);

        const sidebar = await reloadVirtualTabsView();
        await waitForTreeLabel(GROUP_NAME);

        const section = await getVirtualTabsSection(sidebar);
        const groupItem = await findTreeItem(section, GROUP_NAME);
        await groupItem.expand();
        await waitForTreeLabel(EXEC_BASENAME);

        const driver = VSBrowser.instance.driver;

        // Resolve the file row scoped to this specific custom group rather than
        // a global basename search. Left-clicking opens the file in the editor,
        // which makes the built-in "Currently Open Files" group surface its own
        // row with the same basename above this group — a plain-text search
        // would grab that built-in row instead.
        const fileItem = await driver.wait(async () => {
            try { return (await groupItem.findChildItem(EXEC_BASENAME)) ?? false; }
            catch { return false; }
        }, 10_000, `Could not find file "${EXEC_BASENAME}" inside group "${GROUP_NAME}"`) as TreeItem;

        // Left-click to set virtualTabs:hasFileSelected and virtualTabs:hasCustomFileSelected
        await fileItem.click();
        await driver.sleep(500);

        ctxItems = await getContextMenuItemsFor(fileItem, 12_000, true);
        inlineLabels = await getInlineActionLabelsFor(fileItem);

        expect(ctxItems.length, `Context menu returned no items for "${EXEC_BASENAME}". Items: [${ctxItems.join(', ')}]`).to.be.greaterThan(0);
        expect(inlineLabels.length, `No inline action buttons found for "${EXEC_BASENAME}". Labels: [${inlineLabels.join(', ')}]`).to.be.greaterThan(0);
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        if (fs.existsSync(execFileAbsPath)) { fs.unlinkSync(execFileAbsPath); }
        writeConfig(repoAConfigPath, repoAOriginal);
    });

    // ── Positive: inline "Run" button ─────────────────────────────────────────

    it('has "Run" inline action button (exec file exclusive)', function () {
        expect(inlineLabels.some(l => l === 'Run'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });

    // ── Positive: shared file-level context menu items ────────────────────────

    it('context menu contains "Open Selected Files"', function () {
        expect(ctxItems.some(i => i === 'Open Selected Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Close Selected Files"', function () {
        expect(ctxItems.some(i => i === 'Close Selected Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Reveal in File Explorer"', function () {
        expect(ctxItems.some(i => i === 'Reveal in File Explorer'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Send to..."', function () {
        expect(ctxItems.some(i => i === 'Send to...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Delete File"', function () {
        expect(ctxItems.some(i => i === 'Delete File'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Remove Selected Files from Group"', function () {
        expect(ctxItems.some(i => i === 'Remove Selected Files from Group'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Copy..." submenu trigger', function () {
        expect(ctxItems.some(i => i === 'Copy...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    // ── Negative: group-only items must NOT appear ────────────────────────────

    it('context menu does NOT contain "Add Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Add Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Add Sub-Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Add Sub-Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Rename Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Rename Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Sort Files" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Sort Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Auto Group by Extension" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Extension'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Jump to Bookmark" (bookmark-only)', function () {
        expect(ctxItems.some(i => i === 'Jump to Bookmark'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    // ── Negative: built-in-file-only inline button ────────────────────────────

    it('does NOT have "Close File" inline action button (built-in-group file only)', function () {
        expect(inlineLabels.some(l => l === 'Close File'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7: Executable File in Built-in Group (virtualTabsFileBuiltInExec)
// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Availability Matrix – Executable File (Built-in Group) (virtualTabsFileBuiltInExec)', function () {
    this.timeout(90_000);

    const EXEC_BASENAME = path.basename(execFileAbsPath);

    let inlineLabels: string[];

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();

        fs.mkdirSync(path.dirname(execFileAbsPath), { recursive: true });
        fs.writeFileSync(execFileAbsPath, '@echo off\necho exec-builtin-test\n');

        writeConfig(repoAConfigPath, repoAOriginal);
        await reloadVirtualTabsView();

        // Open the .bat file so it appears in "Currently Open Files"
        await VSBrowser.instance.openResources(execFileAbsPath);
        await reloadVirtualTabsView();

        // Give the extension time to process tabGroups.onDidChangeTabs,
        // then expand the built-in group so the file is visible in tree rows.
        const driver = VSBrowser.instance.driver;
        await driver.sleep(800);
        await driver.wait(async () => {
            const rows = await driver.findElements(By.css('.monaco-list-row'));
            for (const r of rows) {
                try {
                    const text = (await r.getText()).trim();
                    if (/currently open|open files|已開啟|目前開啟/i.test(text)) {
                        const expanded = await r.getAttribute('aria-expanded');
                        if (expanded === 'false') { await r.click(); }
                        return true;
                    }
                } catch { /* stale */ }
            }
            return false;
        }, 10_000, 'Built-in group not found for expansion after openResources()');

        await waitForTreeLabel(EXEC_BASENAME);

        // Left-click to set hasFileSelected context key
        await driver.wait(async () => {
            const rows = await driver.findElements(By.css('.monaco-list-row'));
            for (const r of rows) {
                try {
                    if ((await r.getText()).includes(EXEC_BASENAME)) {
                        await r.click();
                        return true;
                    }
                } catch { /* stale */ }
            }
            return false;
        }, 10_000, `Could not click built-in exec file row "${EXEC_BASENAME}"`);
        await driver.sleep(500);

        inlineLabels = await getInlineActionLabelsFor(EXEC_BASENAME);

        expect(inlineLabels.length, `No inline action buttons found for built-in exec file. Labels: [${inlineLabels.join(', ')}]`).to.be.greaterThan(0);
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        if (fs.existsSync(execFileAbsPath)) { fs.unlinkSync(execFileAbsPath); }
        writeConfig(repoAConfigPath, repoAOriginal);
    });

    it('has "Run" inline action button for .bat file in built-in group', function () {
        expect(inlineLabels.some(l => l === 'Run'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });

    it('has "Close File" inline action button (built-in group file exclusive)', function () {
        expect(inlineLabels.some(l => l === 'Close File'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });

    it('does NOT have "Remove" inline action button (custom-group-only)', function () {
        expect(inlineLabels.some(l => l === 'Remove'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8: Non-executable File — "Run" inline button absence (regression)
// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Availability Matrix – Non-exec File regression: no "Run" button', function () {
    this.timeout(90_000);

    const GROUP_NAME = 'CTX-NonExec-Regression';
    const PLAIN_BASENAME = path.basename(plainFileAbsPath);

    let inlineLabels: string[];

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();

        fs.mkdirSync(path.dirname(plainFileAbsPath), { recursive: true });
        fs.writeFileSync(plainFileAbsPath, '// non-exec regression fixture\nexport const x = 1;\n');

        writeConfig(repoAConfigPath, [
            { id: 'ctx-nonexec-regression', name: GROUP_NAME, files: [plainFileRelPath] }
        ]);

        const sidebar = await reloadVirtualTabsView();
        await waitForTreeLabel(GROUP_NAME);

        const section = await getVirtualTabsSection(sidebar);
        const groupItem = await findTreeItem(section, GROUP_NAME);
        await groupItem.expand();
        await waitForTreeLabel(PLAIN_BASENAME);

        const driver = VSBrowser.instance.driver;

        // Resolve the file row scoped to this specific custom group rather than
        // a global basename search — see the "Executable File (Custom Group)"
        // suite above for why a plain-text search is unsafe here.
        const fileItem = await driver.wait(async () => {
            try { return (await groupItem.findChildItem(PLAIN_BASENAME)) ?? false; }
            catch { return false; }
        }, 10_000, `Could not find file "${PLAIN_BASENAME}" inside group "${GROUP_NAME}"`) as TreeItem;

        await fileItem.click();
        await driver.sleep(500);
        inlineLabels = await getInlineActionLabelsFor(fileItem);

        // Guard: the "Remove" button confirms we have a real custom file item.
        expect(inlineLabels.some(l => l === 'Remove'), `"Remove" not found — wrong item? Labels: [${inlineLabels.join(', ')}]`).to.be.true;
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        if (fs.existsSync(plainFileAbsPath)) { fs.unlinkSync(plainFileAbsPath); }
        writeConfig(repoAConfigPath, repoAOriginal);
    });

    it('does NOT have "Run" inline action button for a plain .ts file', function () {
        expect(inlineLabels.some(l => l === 'Run'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });

    it('has "Remove" inline action button (confirming it is a custom file item)', function () {
        expect(inlineLabels.some(l => l === 'Remove'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });
});

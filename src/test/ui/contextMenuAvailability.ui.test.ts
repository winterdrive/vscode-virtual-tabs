/**
 * E2E 測試：Context Menu Availability Matrix
 *
 * 依據 DEVELOPMENT.md §Context Menu Configuration → Menu Availability Matrix，
 * 驗證每種 item type 的 right-click context menu 與 inline action button
 * 是否出現正確的指令，以及不應出現的指令確實沒有出現。
 *
 * Item types covered:
 *   - virtualTabsGroup        (Custom Group)
 *   - virtualTabsGroupBuiltIn (Built-in Group)
 *   - virtualTabsFileCustom   (File in Custom Group)
 *   - virtualTabsFileBuiltIn  (File in Built-in / Currently Open Files group)
 *   - virtualTabsBookmark     (Bookmark)
 *
 * Design notes:
 *   - Each suite collects context menu items ONCE in before(), not per-it().
 *     This prevents negative tests from trivially passing if the menu opens
 *     successfully on one call but silently returns [] on a subsequent call.
 *   - before() asserts ctxItems.length > 0 and inlineLabels.length > 0.
 *     If either guard fails, the entire suite fails with a clear setup error
 *     rather than silently "passing" negative tests on an empty array.
 *   - Regex patterns are pinned to exact label text from package.nls.json to
 *     avoid false positives from unrelated items that share keywords.
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

const testFileRelPath = 'src/ctx-menu-test.ts';
const testFileAbsPath = path.join(repoAPath, testFileRelPath);

// ─── Config helpers ────────────────────────────────────────────────────────────

function writeConfig(configPath: string, groups: object[]): void {
    fs.writeFileSync(configPath, `${JSON.stringify(groups, null, 2)}\n`);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

async function dismissOnboardingOverlay(): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(async () => {
        return await driver.executeScript(`
            const styleId = 'vt-e2e-ctx-hide-onboarding';
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
 * Right-click the tree row matching `rowLabel`, wait for the context menu to
 * render, collect all visible top-level action labels, then dismiss with Escape.
 *
 * Throws if:
 *   - no row matching `rowLabel` is found within `timeoutMs`
 *   - the context menu element never becomes displayed (6 s hard timeout)
 *
 * Returns a deduplicated, non-empty-string array.  Callers should guard that
 * the array is non-empty before using it for negative assertions.
 */
async function getContextMenuItemsFor(rowLabelOrElement: string | RegExp | WebElement, timeoutMs = 12_000, preClick = false): Promise<string[]> {
    const driver = VSBrowser.instance.driver;

    // Dismiss first so the row is found fresh (no stale references from a prior menu).
    await dismissContextViews();

    // A caller may pass an already-resolved WebElement (e.g. from
    // TreeItem.findChildItem()) to target a specific row unambiguously,
    // instead of a global basename search that can match an unrelated row
    // with the same displayed text (see the "File (Custom Group)" suite).
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

    // Re-establish tree selection so hasFileSelected context key is true when the
    // context menu opens (ESC in dismissContextViews may have cleared selection).
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

    // Collect top-level menu action labels (regular items AND submenu triggers).
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
 * Hover over the tree row matching `rowLabel` and return the aria-labels of
 * visible inline action buttons.
 *
 * Returns an empty array if no buttons are found (hover may not trigger them in
 * all environments).  Callers should assert length > 0 before using for negative
 * tests.
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
// Suite 1: Custom Group (virtualTabsGroup)
// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Availability Matrix – Custom Group (virtualTabsGroup)', function () {
    this.timeout(90_000);

    const GROUP_NAME = 'CTX-Custom-Alpha';

    // Collected once in before() so negative tests cannot trivially pass on [].
    let ctxItems: string[];
    let inlineLabels: string[];

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();
        writeConfig(repoAConfigPath, [
            { id: 'ctx-custom-alpha', name: GROUP_NAME, files: [] }
        ]);
        await reloadVirtualTabsView();
        await waitForTreeLabel(GROUP_NAME);

        ctxItems = await getContextMenuItemsFor(GROUP_NAME);
        inlineLabels = await getInlineActionLabelsFor(GROUP_NAME);

        // Hard guard: if these are empty the tree or context menu isn't working,
        // and every negative test below would pass trivially — fail fast instead.
        expect(ctxItems.length, `Context menu returned no items for "${GROUP_NAME}". Items: [${ctxItems.join(', ')}]`).to.be.greaterThan(0);
        expect(inlineLabels.length, `No inline action buttons found for "${GROUP_NAME}". Labels: [${inlineLabels.join(', ')}]`).to.be.greaterThan(0);
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        writeConfig(repoAConfigPath, repoAOriginal);
    });

    // ── Positive: items that MUST appear ─────────────────────────────────────

    it('context menu contains "Add Group"', function () {
        expect(ctxItems.some(i => i === 'Add Group'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Add Sub-Group"', function () {
        expect(ctxItems.some(i => i === 'Add Sub-Group'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Rename Group"', function () {
        expect(ctxItems.some(i => i === 'Rename Group'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Duplicate Group"', function () {
        expect(ctxItems.some(i => i === 'Duplicate Group'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Move Up"', function () {
        expect(ctxItems.some(i => i === 'Move Up'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Move Down"', function () {
        expect(ctxItems.some(i => i === 'Move Down'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Open All Group Files"', function () {
        expect(ctxItems.some(i => i === 'Open All Group Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Close All Group Files"', function () {
        expect(ctxItems.some(i => i === 'Close All Group Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Sort Files" submenu trigger', function () {
        expect(ctxItems.some(i => i === 'Sort Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Auto Group by Extension"', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Extension'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Auto Group by Modified Date"', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Modified Date'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Send to... (Include Group Folder)"', function () {
        expect(ctxItems.some(i => i === 'Send to... (Include Group Folder)'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Send to... (Exclude Group Folder)"', function () {
        expect(ctxItems.some(i => i === 'Send to... (Exclude Group Folder)'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Copy..." submenu trigger', function () {
        expect(ctxItems.some(i => i === 'Copy...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    // ── Negative: items that must NOT appear ──────────────────────────────────
    // ctxItems is guaranteed non-empty from before(), so these are meaningful.

    it('context menu does NOT contain "Add Sub-Group" items reserved for built-in group', function () {
        // Built-in group uses duplicateBuiltInGroup, custom uses duplicateGroup.
        // Verify the built-in-only command title is absent.
        expect(ctxItems.some(i => i === 'Duplicate Group (Currently Open Files)'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Open Selected Files" (file-only command)', function () {
        expect(ctxItems.some(i => i === 'Open Selected Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Close Selected Files" (file-only command)', function () {
        expect(ctxItems.some(i => i === 'Close Selected Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Jump to Bookmark" (bookmark-only command)', function () {
        expect(ctxItems.some(i => i === 'Jump to Bookmark'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    // ── Inline buttons ────────────────────────────────────────────────────────
    // inlineLabels is guaranteed non-empty from before().

    it('has "Remove" inline action button', function () {
        expect(inlineLabels.some(l => l === 'Remove'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });

    it('does NOT have "Refresh" inline action button (built-in-group exclusive)', function () {
        expect(inlineLabels.some(l => l === 'Refresh'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Send to..." (file-only command)', function () {
        expect(ctxItems.some(i => i === 'Send to...'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Remove Selected Files from Group" (file-only command)', function () {
        expect(ctxItems.some(i => i === 'Remove Selected Files from Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Delete File" (file-only command)', function () {
        expect(ctxItems.some(i => i === 'Delete File'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Reveal in File Explorer" (file/bookmark-only command)', function () {
        expect(ctxItems.some(i => i === 'Reveal in File Explorer'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: Built-in Group (virtualTabsGroupBuiltIn)
// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Availability Matrix – Built-in Group (virtualTabsGroupBuiltIn)', function () {
    this.timeout(90_000);

    const BUILTIN_RE = /currently open|open files|已開啟|目前開啟/i;

    let ctxItems: string[];
    let inlineLabels: string[];

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();
        writeConfig(repoAConfigPath, repoAOriginal);
        await reloadVirtualTabsView();
        await waitForTreeLabel(BUILTIN_RE);

        ctxItems = await getContextMenuItemsFor(BUILTIN_RE);
        inlineLabels = await getInlineActionLabelsFor(BUILTIN_RE);

        expect(ctxItems.length, `Context menu returned no items for built-in group. Items: [${ctxItems.join(', ')}]`).to.be.greaterThan(0);
        expect(inlineLabels.length, `No inline action buttons found for built-in group. Labels: [${inlineLabels.join(', ')}]`).to.be.greaterThan(0);
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        writeConfig(repoAConfigPath, repoAOriginal);
    });

    // ── Positive ──────────────────────────────────────────────────────────────

    it('context menu contains "Add Group"', function () {
        expect(ctxItems.some(i => i === 'Add Group'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Duplicate Group (Currently Open Files)"', function () {
        expect(ctxItems.some(i => i === 'Duplicate Group (Currently Open Files)'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Sort Files" submenu trigger', function () {
        expect(ctxItems.some(i => i === 'Sort Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Auto Group by Extension"', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Extension'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Auto Group by Modified Date"', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Modified Date'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Send to... (Include Group Folder)"', function () {
        expect(ctxItems.some(i => i === 'Send to... (Include Group Folder)'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Send to... (Exclude Group Folder)"', function () {
        expect(ctxItems.some(i => i === 'Send to... (Exclude Group Folder)'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Copy..." submenu trigger', function () {
        expect(ctxItems.some(i => i === 'Copy...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    // ── Negative ──────────────────────────────────────────────────────────────

    it('context menu does NOT contain "Add Sub-Group" (custom-group-only)', function () {
        expect(ctxItems.some(i => i === 'Add Sub-Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Rename Group" (custom-group-only)', function () {
        expect(ctxItems.some(i => i === 'Rename Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Move Up" (custom-group-only)', function () {
        expect(ctxItems.some(i => i === 'Move Up'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Move Down" (custom-group-only)', function () {
        expect(ctxItems.some(i => i === 'Move Down'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Open All Group Files" (custom-group-only)', function () {
        expect(ctxItems.some(i => i === 'Open All Group Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Close All Group Files" (custom-group-only)', function () {
        expect(ctxItems.some(i => i === 'Close All Group Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Open Selected Files" (file-only)', function () {
        expect(ctxItems.some(i => i === 'Open Selected Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    // ── Inline buttons ────────────────────────────────────────────────────────

    it('has "Refresh" inline action button', function () {
        expect(inlineLabels.some(l => l === 'Refresh'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });

    it('does NOT have "Remove" inline action button (custom-group-exclusive)', function () {
        expect(inlineLabels.some(l => l === 'Remove'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Send to..." (file-only command)', function () {
        expect(ctxItems.some(i => i === 'Send to...'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Remove Selected Files from Group" (file-only command)', function () {
        expect(ctxItems.some(i => i === 'Remove Selected Files from Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Delete File" (file-only command)', function () {
        expect(ctxItems.some(i => i === 'Delete File'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Reveal in File Explorer" (file/bookmark-only command)', function () {
        expect(ctxItems.some(i => i === 'Reveal in File Explorer'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3: File in Custom Group (virtualTabsFileCustom)
// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Availability Matrix – File (Custom Group) (virtualTabsFileCustom)', function () {
    this.timeout(90_000);

    const GROUP_NAME = 'CTX-FileCustom-Group';
    const FILE_BASENAME = path.basename(testFileAbsPath);

    let ctxItems: string[];
    let inlineLabels: string[];

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();

        fs.mkdirSync(path.dirname(testFileAbsPath), { recursive: true });
        fs.writeFileSync(testFileAbsPath, '// context menu test fixture\nexport const ctxMenuTest = true;\n');

        writeConfig(repoAConfigPath, [
            { id: 'ctx-file-custom-group', name: GROUP_NAME, files: [testFileRelPath] }
        ]);

        const sidebar = await reloadVirtualTabsView();
        await waitForTreeLabel(GROUP_NAME);

        const section = await getVirtualTabsSection(sidebar);
        const groupItem = await findTreeItem(section, GROUP_NAME);
        await groupItem.expand();
        await waitForTreeLabel(FILE_BASENAME);

        const driver = VSBrowser.instance.driver;

        // Resolve the file row scoped to this specific custom group rather than
        // a global basename search. Left-clicking a file row opens it in the
        // editor (TempFileItem's command), which makes VS Code's built-in
        // "Currently Open Files" group surface its own row with the same
        // basename above this group — a plain-text search across all rows
        // would grab that built-in row instead and every assertion below
        // would be checking the wrong item's menu.
        const fileItem = await driver.wait(async () => {
            try { return (await groupItem.findChildItem(FILE_BASENAME)) ?? false; }
            catch { return false; }
        }, 10_000, `Could not find file "${FILE_BASENAME}" inside group "${GROUP_NAME}"`) as TreeItem;

        // Left-click to set the virtualTabs:hasFileSelected context key.
        // Right-clicking does NOT change the selection in VS Code's tree view, so the
        // key remains set when getContextMenuItemsFor right-clicks the same row.
        await fileItem.click();

        // Wait for the extension to propagate the context key
        await driver.sleep(500);

        ctxItems = await getContextMenuItemsFor(fileItem, 12_000, true);
        inlineLabels = await getInlineActionLabelsFor(fileItem);

        expect(ctxItems.length, `Context menu returned no items for "${FILE_BASENAME}". Items: [${ctxItems.join(', ')}]`).to.be.greaterThan(0);
        // "Delete File" is always present for custom files regardless of selection state;
        // its presence confirms we got a real file-item context menu.
        expect(ctxItems.some(i => i === 'Delete File'), `"Delete File" not found — wrong item type? Items: [${ctxItems.join(', ')}]`).to.be.true;

        expect(inlineLabels.length, `No inline action buttons found for "${FILE_BASENAME}". Labels: [${inlineLabels.join(', ')}]`).to.be.greaterThan(0);
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        if (fs.existsSync(testFileAbsPath)) { fs.unlinkSync(testFileAbsPath); }
        writeConfig(repoAConfigPath, repoAOriginal);
    });

    // ── Positive ──────────────────────────────────────────────────────────────

    it('context menu contains "Open Selected Files" (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Open Selected Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Close Selected Files" (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Close Selected Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Reveal in File Explorer" (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Reveal in File Explorer'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Send to..." (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Send to...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Delete File"', function () {
        expect(ctxItems.some(i => i === 'Delete File'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Remove Selected Files from Group" (requires hasCustomFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Remove Selected Files from Group'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Copy..." submenu trigger (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Copy...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    // ── Negative ──────────────────────────────────────────────────────────────

    it('context menu does NOT contain "Add Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Add Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Add Sub-Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Add Sub-Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Open All Group Files" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Open All Group Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Send to... (Include Group Folder)" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Send to... (Include Group Folder)'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Send to... (Exclude Group Folder)" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Send to... (Exclude Group Folder)'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Jump to Bookmark" (bookmark-only)', function () {
        expect(ctxItems.some(i => i === 'Jump to Bookmark'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    // ── Inline buttons ────────────────────────────────────────────────────────

    it('has "Remove" inline action button (Remove from Group)', function () {
        expect(inlineLabels.some(l => l === 'Remove'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });

    it('does NOT have "Close File" inline action button (built-in-group-only)', function () {
        expect(inlineLabels.some(l => l === 'Close File'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });

    it('does NOT have "Run" inline action button (exec-file-only)', function () {
        expect(inlineLabels.some(l => l === 'Run'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Sort Files" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Sort Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Auto Group by Extension" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Extension'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Auto Group by Modified Date" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Modified Date'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Rename Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Rename Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Move Up" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Move Up'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Move Down" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Move Down'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4: File in Built-in Group (virtualTabsFileBuiltIn)
// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Availability Matrix – File (Built-in Group) (virtualTabsFileBuiltIn)', function () {
    this.timeout(90_000);

    const FILE_BASENAME = path.basename(testFileAbsPath);

    let ctxItems: string[];
    let inlineLabels: string[];

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();

        fs.mkdirSync(path.dirname(testFileAbsPath), { recursive: true });
        fs.writeFileSync(testFileAbsPath, '// built-in group ctx menu test\nexport const builtInTest = true;\n');

        writeConfig(repoAConfigPath, repoAOriginal);
        await reloadVirtualTabsView();

        // Open the file so it appears under "Currently Open Files"
        await VSBrowser.instance.openResources(testFileAbsPath);

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

        await waitForTreeLabel(FILE_BASENAME);

        // Select to set hasFileSelected
        await driver.wait(async () => {
            const rows = await driver.findElements(By.css('.monaco-list-row'));
            for (const r of rows) {
                try {
                    if ((await r.getText()).includes(FILE_BASENAME)) {
                        await r.click();
                        return true;
                    }
                } catch { /* stale */ }
            }
            return false;
        }, 10_000, `Could not click built-in file row "${FILE_BASENAME}"`);
        await driver.sleep(500);

        ctxItems = await getContextMenuItemsFor(FILE_BASENAME, 12_000, true);
        inlineLabels = await getInlineActionLabelsFor(FILE_BASENAME);

        expect(ctxItems.length, `Context menu returned no items for built-in file "${FILE_BASENAME}". Items: [${ctxItems.join(', ')}]`).to.be.greaterThan(0);
        expect(ctxItems.some(i => i === 'Delete File'), `"Delete File" not found — wrong item type? Items: [${ctxItems.join(', ')}]`).to.be.true;

        expect(inlineLabels.length, `No inline action buttons for built-in file. Labels: [${inlineLabels.join(', ')}]`).to.be.greaterThan(0);
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        if (fs.existsSync(testFileAbsPath)) { fs.unlinkSync(testFileAbsPath); }
        writeConfig(repoAConfigPath, repoAOriginal);
    });

    // ── Positive ──────────────────────────────────────────────────────────────

    it('context menu contains "Open Selected Files" (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Open Selected Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Close Selected Files" (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Close Selected Files'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Reveal in File Explorer" (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Reveal in File Explorer'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Send to..." (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Send to...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Delete File"', function () {
        expect(ctxItems.some(i => i === 'Delete File'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Copy..." submenu trigger (requires hasFileSelected)', function () {
        expect(ctxItems.some(i => i === 'Copy...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    // ── Negative ──────────────────────────────────────────────────────────────

    it('context menu does NOT contain "Remove Selected Files from Group" (custom-group-only)', function () {
        expect(ctxItems.some(i => i === 'Remove Selected Files from Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Add Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Add Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Open All Group Files" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Open All Group Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Send to... (Include Group Folder)" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Send to... (Include Group Folder)'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    // ── Inline buttons ────────────────────────────────────────────────────────

    it('has "Close File" inline action button (v0.4.6+)', function () {
        expect(inlineLabels.some(l => l === 'Close File'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });

    it('does NOT have "Remove" inline action button (custom-group-only)', function () {
        expect(inlineLabels.some(l => l === 'Remove'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });

    it('does NOT have "Run" inline action button (exec-file-only)', function () {
        expect(inlineLabels.some(l => l === 'Run'), `unexpected inline label in: ${inlineLabels.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Sort Files" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Sort Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Auto Group by Extension" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Extension'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Auto Group by Modified Date" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Modified Date'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Rename Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Rename Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Move Up" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Move Up'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Move Down" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Move Down'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5: Bookmark (virtualTabsBookmark)
// ─────────────────────────────────────────────────────────────────────────────

describe('Menu Availability Matrix – Bookmark (virtualTabsBookmark)', function () {
    this.timeout(90_000);

    const GROUP_NAME = 'CTX-Bookmark-Group';
    const BOOKMARK_LABEL = 'CTX Test Bookmark';

    let ctxItems: string[];
    let inlineLabels: string[];

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();

        fs.mkdirSync(path.dirname(testFileAbsPath), { recursive: true });
        fs.writeFileSync(testFileAbsPath, '// bookmark ctx menu test\nexport const bookmarkTest = true;\n');

        const fileUri = testFileRelPath;

        writeConfig(repoAConfigPath, [
            {
                id: 'ctx-bookmark-group',
                name: GROUP_NAME,
                files: [testFileRelPath],
                bookmarks: {
                    [fileUri]: [
                        { id: 'ctx-bm-1', line: 0, label: BOOKMARK_LABEL, created: Date.now() }
                    ]
                }
            }
        ]);

        const sidebar = await reloadVirtualTabsView();
        await waitForTreeLabel(GROUP_NAME);

        const section = await getVirtualTabsSection(sidebar);
        const groupItem = await findTreeItem(section, GROUP_NAME);
        await groupItem.expand();

        const fileBasename = path.basename(testFileAbsPath);
        await waitForTreeLabel(fileBasename);

        const fileItem = await findTreeItem(section, fileBasename);
        await fileItem.expand();
        await waitForTreeLabel(BOOKMARK_LABEL);

        ctxItems = await getContextMenuItemsFor(BOOKMARK_LABEL);
        inlineLabels = await getInlineActionLabelsFor(BOOKMARK_LABEL);

        expect(ctxItems.length, `Context menu returned no items for bookmark "${BOOKMARK_LABEL}". Items: [${ctxItems.join(', ')}]`).to.be.greaterThan(0);
        // "Jump to Bookmark" is always present for bookmarks; confirms we got the right item type.
        expect(ctxItems.some(i => i === 'Jump to Bookmark'), `"Jump to Bookmark" not found — wrong item type? Items: [${ctxItems.join(', ')}]`).to.be.true;

        expect(inlineLabels.length, `No inline action buttons for bookmark. Labels: [${inlineLabels.join(', ')}]`).to.be.greaterThan(0);
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        if (fs.existsSync(testFileAbsPath)) { fs.unlinkSync(testFileAbsPath); }
        writeConfig(repoAConfigPath, repoAOriginal);
    });

    // ── Positive ──────────────────────────────────────────────────────────────

    it('context menu contains "Jump to Bookmark"', function () {
        expect(ctxItems.some(i => i === 'Jump to Bookmark'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Edit Bookmark Label"', function () {
        expect(ctxItems.some(i => i === 'Edit Bookmark Label'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Edit Bookmark Description"', function () {
        expect(ctxItems.some(i => i === 'Edit Bookmark Description'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Reveal in File Explorer"', function () {
        expect(ctxItems.some(i => i === 'Reveal in File Explorer'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    it('context menu contains "Copy..." submenu trigger', function () {
        expect(ctxItems.some(i => i === 'Copy...'), `items: ${ctxItems.join(' | ')}`).to.be.true;
    });

    // ── Negative ──────────────────────────────────────────────────────────────

    it('context menu does NOT contain "Add Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Add Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Add Sub-Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Add Sub-Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Open All Group Files" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Open All Group Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Close All Group Files" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Close All Group Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Send to... (Include Group Folder)" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Send to... (Include Group Folder)'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Delete File" (not applicable to bookmarks)', function () {
        expect(ctxItems.some(i => i === 'Delete File'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Open Selected Files" (file-only)', function () {
        expect(ctxItems.some(i => i === 'Open Selected Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    // ── Inline buttons ────────────────────────────────────────────────────────

    it('has "Remove Bookmark" inline action button', function () {
        expect(inlineLabels.some(l => l === 'Remove Bookmark'), `inline labels: ${inlineLabels.join(' | ')}`).to.be.true;
    });

    it('context menu does NOT contain "Close Selected Files" (file-only)', function () {
        expect(ctxItems.some(i => i === 'Close Selected Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Remove Selected Files from Group" (file-only)', function () {
        expect(ctxItems.some(i => i === 'Remove Selected Files from Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Send to..." (file-only)', function () {
        expect(ctxItems.some(i => i === 'Send to...'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Sort Files" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Sort Files'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Auto Group by Extension" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Extension'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Auto Group by Modified Date" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Auto Group by Modified Date'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Rename Group" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Rename Group'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });

    it('context menu does NOT contain "Move Up" (group-only)', function () {
        expect(ctxItems.some(i => i === 'Move Up'), `unexpected item in: ${ctxItems.join(' | ')}`).to.be.false;
    });
});

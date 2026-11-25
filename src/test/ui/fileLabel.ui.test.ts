import * as fs from 'fs';
import * as path from 'path';
import {
    ActivityBar,
    By,
    CustomTreeSection,
    EditorView,
    InputBox,
    SideBarView,
    TreeItem,
    ViewControl,
    VSBrowser,
    WebElement
} from 'vscode-extension-tester';
import { expect } from 'chai';

const fixtureRoot = path.resolve(__dirname, '../../../test-resources/multi-root');
const repoAPath = path.join(fixtureRoot, 'Repo-A');
const repoAConfigPath = path.join(repoAPath, '.vscode', 'virtualTab.json');
const repoAOriginal = [{ id: 'repo-a-existing', name: 'Repo A Existing', files: [] }];

// Two files with the same name in different folders: the scenario from issue #163.
const GROUP_ID = 'file-label-ui';
const GROUP_NAME = 'File Label UI';
const fileADir = path.join(repoAPath, 'src', 'file-label-pkg-a');
const fileBDir = path.join(repoAPath, 'src', 'file-label-pkg-b');
const fileARelative = 'src/file-label-pkg-a/index.ts';
const fileBRelative = 'src/file-label-pkg-b/index.ts';

type StoredGroup = {
    id?: string;
    name?: string;
    files?: string[];
    fileMeta?: Record<string, { label?: string; description?: string }>;
};

function writeConfig(groups: object[]): void {
    fs.writeFileSync(repoAConfigPath, `${JSON.stringify(groups, null, 2)}\n`);
}

function readGroup(): StoredGroup | undefined {
    const groups = JSON.parse(fs.readFileSync(repoAConfigPath, 'utf8')) as StoredGroup[];
    return groups.find(group => group.id === GROUP_ID);
}

/** The single fileMeta entry whose key points at the pkg-a file, if any. */
function readFileAMeta(): { label?: string; description?: string } | undefined {
    const meta = readGroup()?.fileMeta;
    const key = meta && Object.keys(meta).find(k => k.replace(/\\/g, '/').endsWith(fileARelative));
    return key ? meta![key] : undefined;
}

async function dismissOnboardingOverlay(): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(async () => {
        return await driver.executeScript(`
            const styleId = 'virtual-tabs-e2e-hide-onboarding-file-label';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = '.onboarding-a-overlay { display: none !important; }';
                document.head.appendChild(style);
            }
            for (const el of document.querySelectorAll('.onboarding-a-overlay, [aria-label="Welcome to Visual Studio Code"][role="dialog"]')) {
                el.remove();
            }
            return document.querySelectorAll('.onboarding-a-overlay.visible').length === 0;
        `) as boolean;
    }, 5_000, 'Onboarding overlay did not disappear');
}

async function getRowTexts(): Promise<string[]> {
    return await VSBrowser.instance.driver.executeScript(`
        return Array.from(document.querySelectorAll('.monaco-list-row'))
            .map(row => row.textContent ? row.textContent.trim().replace(/\\s+/g, ' ') : '')
            .filter(Boolean);
    `) as string[];
}

async function waitForRows(predicate: (rows: string[]) => boolean, message: string, timeoutMs = 15_000): Promise<void> {
    await VSBrowser.instance.driver.wait(async () => predicate(await getRowTexts()), timeoutMs, message);
}

async function openVirtualTabsView(): Promise<SideBarView> {
    await dismissOnboardingOverlay();
    const viewControl = (await new ActivityBar().getViewControl('Virtual Tabs')) as ViewControl;
    expect(viewControl, 'Virtual Tabs icon not found in Activity Bar').to.not.be.undefined;
    let sidebar: SideBarView;
    try {
        sidebar = await viewControl.openView() as SideBarView;
    } catch {
        await dismissOnboardingOverlay();
        await viewControl.getDriver().executeScript('arguments[0].click()', viewControl);
        sidebar = await new SideBarView().wait();
    }
    await VSBrowser.instance.driver.wait(async () => (await getRowTexts()).length > 0, 30_000,
        'Virtual Tabs extension did not activate within 30 s');
    return sidebar;
}

async function getSection(sidebar: SideBarView): Promise<CustomTreeSection> {
    return await sidebar.getContent().getSection<CustomTreeSection>(
        section => section.getTitle().then(title => title.toLowerCase().includes('virtual tabs')),
        CustomTreeSection
    );
}

async function clickRefresh(sidebar: SideBarView): Promise<void> {
    await VSBrowser.instance.driver.wait(async () => {
        try {
            for (const action of await sidebar.getTitlePart().getActions()) {
                if (/refresh/i.test(await action.getTitle())) {
                    await action.click();
                    return true;
                }
            }
            return false;
        } catch {
            return false;
        }
    }, 10_000, 'Refresh button not found');
}

async function dismissContextViews(): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.actions().sendKeys('').perform(); // Escape
    await driver.sleep(200);
}

/** First tree row whose text contains `text`. */
async function findRow(text: string): Promise<WebElement> {
    const driver = VSBrowser.instance.driver;
    return await driver.wait(async () => {
        for (const row of await driver.findElements(By.css('.monaco-list-row'))) {
            try {
                if ((await row.getText()).includes(text)) {
                    return row;
                }
            } catch { /* stale row, retry */ }
        }
        return null;
    }, 10_000, `Tree row containing "${text}" not found`) as WebElement;
}

/** Select the row, right-click it, and run a context-menu action by its exact title. */
async function runContextAction(rowText: string, actionTitle: string): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await dismissContextViews();
    const row = await findRow(rowText);
    await driver.actions().click(row).perform();
    await driver.sleep(400);
    await driver.actions().contextClick(row).perform();

    await driver.wait(async () => {
        try {
            return await (await driver.findElement(By.css('.context-view.monaco-menu-container'))).isDisplayed();
        } catch { return false; }
    }, 6_000, 'Context menu did not appear');
    await driver.sleep(350);

    const labels = await driver.findElements(
        By.css('.context-view.monaco-menu-container .action-item:not(.separator) .action-label')
    );
    for (const label of labels) {
        try {
            if ((await label.getText()).trim() === actionTitle) {
                await label.click();
                return;
            }
        } catch { /* stale, keep looking */ }
    }
    throw new Error(`Context menu action "${actionTitle}" not found for row "${rowText}"`);
}

async function submitInput(text: string): Promise<InputBox> {
    const input = await InputBox.create();
    await input.setText(text);
    await input.confirm();
    return input;
}

describe('Virtual Tabs - Custom file label (issue #163)', function () {
    this.timeout(120_000);

    let sidebar: SideBarView;

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();
        await dismissOnboardingOverlay();

        fs.mkdirSync(fileADir, { recursive: true });
        fs.mkdirSync(fileBDir, { recursive: true });
        fs.writeFileSync(path.join(fileADir, 'index.ts'), 'export const a = 1;\n');
        fs.writeFileSync(path.join(fileBDir, 'index.ts'), 'export const b = 2;\n');
        writeConfig([{ id: GROUP_ID, name: GROUP_NAME, files: [fileARelative, fileBRelative] }]);

        sidebar = await openVirtualTabsView();
        await clickRefresh(sidebar);
        const section = await getSection(sidebar);
        await VSBrowser.instance.driver.wait(async () => (await section.findItem(GROUP_NAME)) !== undefined, 10_000,
            `Group "${GROUP_NAME}" not found`);
        await ((await section.findItem(GROUP_NAME)) as TreeItem).expand();
    });

    after(async function () {
        await dismissContextViews();
        await new EditorView().closeAllEditors();
        fs.rmSync(fileADir, { recursive: true, force: true });
        fs.rmSync(fileBDir, { recursive: true, force: true });
        writeConfig(repoAOriginal);
    });

    it('shows both same-named files as "index.ts" before any label is set', async function () {
        await waitForRows(
            rows => rows.filter(text => text === 'index.ts').length === 2,
            'Expected two rows labelled "index.ts"'
        );
    });

    it('a custom label tells same-named files apart and is persisted to the group config', async function () {
        await runContextAction('index.ts', 'Edit File Label');
        await submitInput('pkg-a index');

        await waitForRows(
            rows => rows.includes('pkg-a index') && rows.filter(text => text === 'index.ts').length === 1,
            'Labelled file should show "pkg-a index" while the other keeps "index.ts"'
        );
        await VSBrowser.instance.driver.wait(() => readFileAMeta()?.label === 'pkg-a index', 15_000,
            'Label was not written to virtualTab.json fileMeta');
        expect(readGroup()?.files).to.deep.equal([fileARelative, fileBRelative]);
    });

    it('the label survives a reload from disk', async function () {
        await clickRefresh(sidebar);
        await waitForRows(rows => rows.includes('pkg-a index'), 'Label disappeared after refresh');
    });

    it('a description is shown next to the label and persisted', async function () {
        await runContextAction('pkg-a index', 'Edit File Description');
        await submitInput('entry point');

        await waitForRows(
            rows => rows.some(text => text.includes('pkg-a index') && text.includes('entry point')),
            'Description should appear next to the label'
        );
        await VSBrowser.instance.driver.wait(() => readFileAMeta()?.description === 'entry point', 15_000,
            'Description was not written to virtualTab.json fileMeta');
        expect(readFileAMeta()?.label).to.equal('pkg-a index');
    });

    it('the hover tooltip keeps the real file path and includes the description', async function () {
        const driver = VSBrowser.instance.driver;
        await dismissContextViews();
        const row = await findRow('pkg-a index');
        // Move away first so the hover is re-triggered even if the pointer was already on the row.
        await driver.actions().move({ x: 5, y: 5 }).perform();
        await driver.actions().move({ origin: row }).perform();

        let hoverText = '';
        await driver.wait(async () => {
            const hovers = await driver.findElements(By.css('.monaco-hover'));
            for (const hover of hovers) {
                try {
                    const text = (await hover.getText()).replace(/\\/g, '/');
                    if (text.includes('file-label-pkg-a/index.ts')) {
                        hoverText = text;
                        return true;
                    }
                } catch { /* stale hover, retry */ }
            }
            return false;
        }, 15_000, 'Tooltip with the real file path did not appear');
        expect(hoverText).to.include('entry point');
        await driver.actions().move({ x: 5, y: 5 }).perform();
    });

    it('a blank label restores the file name and keeps the description', async function () {
        await runContextAction('pkg-a index', 'Edit File Label');
        await submitInput('');

        await waitForRows(
            rows => !rows.some(text => text.includes('pkg-a index')) &&
                rows.some(text => text.startsWith('index.ts') && text.includes('entry point')),
            'Blank label should restore "index.ts" and keep the description'
        );
        await VSBrowser.instance.driver.wait(() => {
            const meta = readFileAMeta();
            return !!meta && meta.label === undefined && meta.description === 'entry point';
        }, 15_000, 'Label was not cleared from fileMeta');
    });

    it('clearing the last field removes the fileMeta entry from the config', async function () {
        await runContextAction('entry point', 'Edit File Description');
        await submitInput('');

        await waitForRows(
            rows => rows.filter(text => text === 'index.ts').length === 2,
            'Both files should show "index.ts" again'
        );
        await VSBrowser.instance.driver.wait(() => readGroup()?.fileMeta === undefined, 15_000,
            'Empty fileMeta should be removed from virtualTab.json');
    });
});

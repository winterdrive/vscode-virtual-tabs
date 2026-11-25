import * as fs from 'fs';
import * as path from 'path';
import {
    ActivityBar,
    By,
    CustomTreeSection,
    EditorView,
    SideBarView,
    TreeItem,
    ViewControl,
    VSBrowser,
    WebElement
} from 'vscode-extension-tester';
import { expect } from 'chai';

/**
 * Right-click "Delete File" on a file inside a group.
 *
 * Drives the real context menu and the real modal confirmation. The command moves the file on disk
 * to the Recycle Bin / Trash and removes it from the group, so these tests create real files, and
 * the files that are confirmed for deletion end up in the OS trash. That is by design: the point is
 * to watch the real behaviour, including for a file that lives on a different drive than the workspace.
 */

const repoAPath = path.resolve(__dirname, '../../../test-resources/multi-root/Repo-A');
const configPath = path.join(repoAPath, '.vscode', 'virtualTab.json');
const repoAOriginal = [{ id: 'repo-a-existing', name: 'Repo A Existing', files: [] }];

const GROUP_ID = 'delete-file-ui';
const GROUP_NAME = 'Delete File UI';
const KEEP_FILE = 'README.md';

const PROJECT_FILE = 'vt-ui-delete-project.txt';
const projectFilePath = path.join(repoAPath, PROJECT_FILE);

// A real file on a different drive than the workspace (Windows only).
const workspaceDrive = path.parse(repoAPath).root.charAt(0).toLowerCase();
const otherDrive = workspaceDrive === 'd' ? 'c' : 'd';
const OTHER_DIR = `${otherDrive.toUpperCase()}:\\vt-ui-delete-test`;
const OTHER_FILE = 'vt-ui-delete-other-drive.txt';
const otherFilePath = path.join(OTHER_DIR, OTHER_FILE);
const OTHER_URI = `file:///${otherDrive}:/vt-ui-delete-test/${OTHER_FILE}`;

type StoredGroup = { id: string; files: string[] };

function writeConfig(groups: object[]): void {
    fs.writeFileSync(configPath, `${JSON.stringify(groups, null, 2)}\n`);
}

function readGroup(): StoredGroup {
    const groups = JSON.parse(fs.readFileSync(configPath, 'utf8')) as StoredGroup[];
    const found = groups.find(g => g.id === GROUP_ID);
    if (!found) {
        throw new Error(`Group "${GROUP_ID}" not found in virtualTab.json`);
    }
    return found;
}

function normalised(entry: string): string {
    let value = entry;
    try { value = decodeURIComponent(entry); } catch { /* keep raw */ }
    return value.replace(/\\/g, '/').toLowerCase();
}

function groupHas(fileName: string): boolean {
    const name = fileName.toLowerCase();
    return readGroup().files.some(f => normalised(f).endsWith(`/${name}`) || normalised(f) === name);
}

async function dismissOnboardingOverlay(): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(async () => {
        return await driver.executeScript(`
            for (const el of document.querySelectorAll('.onboarding-a-overlay, [aria-label="Welcome to Visual Studio Code"][role="dialog"]')) { el.remove(); }
            return true;
        `) as boolean;
    }, 5_000, 'Onboarding overlay did not disappear');
}

async function getRowTexts(): Promise<string[]> {
    const raw = await VSBrowser.instance.driver.executeScript(
        `return Array.from(document.querySelectorAll('.monaco-list-row')).map(r => r.textContent || '');`
    ) as string[];
    return raw.map(t => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

async function waitForRows(predicate: (rows: string[]) => boolean, message: string): Promise<void> {
    await VSBrowser.instance.driver.wait(async () => predicate(await getRowTexts()), 15_000, message);
}

/**
 * The tree rows that sit below the group row `groupName`, down to the next row that is not nested in it.
 *
 * Rows must be looked up inside the group: a file that is open in an editor is also listed under the
 * built-in "Currently Open Files" group, which comes first in the tree, so a plain "first row with this
 * text" lookup can hit that one instead (a different group, so Delete File would act on it).
 */
async function rowsUnderGroup(groupName: string): Promise<string[]> {
    return await VSBrowser.instance.driver.executeScript(`
        const rows = Array.from(document.querySelectorAll('.monaco-list-row'));
        const text = r => (r.textContent || '').replace(/\\s+/g, ' ').trim();
        const out = [];
        let level = null;
        for (const r of rows) {
            const rowLevel = Number(r.getAttribute('aria-level'));
            if (level === null) {
                if (text(r) === arguments[0]) { level = rowLevel; }
                continue;
            }
            if (!(rowLevel > level)) { break; }
            out.push(text(r));
        }
        return out;
    `, groupName) as string[];
}

async function waitForRowsUnder(groupName: string, predicate: (rows: string[]) => boolean, message: string): Promise<void> {
    await VSBrowser.instance.driver.wait(async () => predicate(await rowsUnderGroup(groupName)), 15_000, message);
}

/** The row for `text` that is nested under the group row `groupName`. */
async function findRowInGroup(groupName: string, text: string): Promise<WebElement> {
    const driver = VSBrowser.instance.driver;
    return await driver.wait(async () => {
        let level: number | null = null;
        for (const row of await driver.findElements(By.css('.monaco-list-row'))) {
            try {
                const rowText = (await row.getText()).replace(/\s+/g, ' ').trim();
                const rowLevel = Number(await row.getAttribute('aria-level'));
                if (level === null) {
                    if (rowText === groupName) {
                        level = rowLevel;
                    }
                    continue;
                }
                if (!(rowLevel > level)) {
                    return null;
                }
                if (rowText === text) {
                    return row;
                }
            } catch { /* stale row, retry */ }
        }
        return null;
    }, 10_000, `Row "${text}" not found under group "${groupName}"`) as WebElement;
}

async function dismissContextViews(): Promise<void> {
    await VSBrowser.instance.driver.actions().sendKeys('').perform();
    await VSBrowser.instance.driver.sleep(200);
}

/** Select the row, right-click it, and run a context-menu action by its exact title. */
async function runContextAction(rowText: string, actionTitle: string): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await dismissContextViews();
    const row = await findRowInGroup(GROUP_NAME, rowText);
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

/** Text of the open modal dialog (VS Code's own DOM; extest's ModalDialog selectors do not match 1.96). */
async function dialogMessage(): Promise<string> {
    const driver = VSBrowser.instance.driver;
    return await driver.wait(async () => {
        const text = await driver.executeScript(`
            const box = document.querySelector('.monaco-dialog-box');
            if (!box) { return ''; }
            const msg = box.querySelector('.monaco-dialog-message-text') || box.querySelector('.monaco-dialog-message-body');
            return ((msg || box).textContent || '').trim();
        `) as string;
        return text || null;
    }, 10_000, 'Modal dialog did not appear') as string;
}

async function pushDialogButton(label: string): Promise<void> {
    const driver = VSBrowser.instance.driver;
    await driver.wait(async () => {
        for (const button of await driver.findElements(By.css('.monaco-dialog-box .dialog-buttons .monaco-button'))) {
            try {
                if ((await button.getText()).trim() === label) {
                    await button.click();
                    return true;
                }
            } catch { /* stale, retry */ }
        }
        return false;
    }, 10_000, `Dialog button "${label}" not found`);
}

async function closeOpenDialog(): Promise<void> {
    const driver = VSBrowser.instance.driver;
    if ((await driver.findElements(By.css('.monaco-dialog-box'))).length > 0) {
        await driver.actions().sendKeys('').perform(); // Escape
        await driver.sleep(300);
    }
}

async function toastMessages(): Promise<string[]> {
    return await VSBrowser.instance.driver.executeScript(`
        return Array.from(document.querySelectorAll('.notifications-toasts .notification-list-item-message'))
            .map(el => (el.textContent || '').trim());
    `) as string[];
}

describe('Virtual Tabs - right-click Delete File', function () {
    this.timeout(180_000);

    let sidebar: SideBarView;
    let section: CustomTreeSection;

    async function clickRefresh(): Promise<void> {
        await VSBrowser.instance.driver.wait(async () => {
            try {
                for (const action of await sidebar.getTitlePart().getActions()) {
                    if (/refresh/i.test(await action.getTitle())) {
                        await action.click();
                        return true;
                    }
                }
            } catch { /* retry */ }
            return false;
        }, 10_000, 'Refresh button not found');
    }

    async function loadGroup(files: string[]): Promise<void> {
        writeConfig([{ id: GROUP_ID, name: GROUP_NAME, files }]);
        await clickRefresh();
        await waitForRows(rows => rows.includes(GROUP_NAME), `Group "${GROUP_NAME}" did not appear`);
        await ((await section.findItem(GROUP_NAME)) as TreeItem).expand();
    }

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();
        await dismissOnboardingOverlay();
        fs.writeFileSync(projectFilePath, 'project file\n');
        if (process.platform === 'win32') {
            fs.mkdirSync(OTHER_DIR, { recursive: true });
            fs.writeFileSync(otherFilePath, 'other drive file\n');
        }

        const viewControl = (await new ActivityBar().getViewControl('Virtual Tabs')) as ViewControl;
        expect(viewControl, 'Virtual Tabs icon not found in Activity Bar').to.not.be.undefined;
        sidebar = await viewControl.openView() as SideBarView;
        await VSBrowser.instance.driver.wait(async () => (await getRowTexts()).length > 0, 30_000,
            'Virtual Tabs extension did not activate within 30 s');
        section = await sidebar.getContent().getSection<CustomTreeSection>(
            s => s.getTitle().then(title => title.toLowerCase().includes('virtual tabs')),
            CustomTreeSection
        );
    });

    afterEach(async function () {
        await closeOpenDialog();
    });

    after(async function () {
        await new EditorView().closeAllEditors();
        fs.rmSync(projectFilePath, { force: true });
        if (process.platform === 'win32') {
            fs.rmSync(OTHER_DIR, { recursive: true, force: true });
        }
        writeConfig(repoAOriginal);
    });

    it('asks for confirmation, and Cancel keeps the file on disk and in the group', async function () {
        await loadGroup([PROJECT_FILE, KEEP_FILE]);

        await runContextAction(PROJECT_FILE, 'Delete File');
        expect(await dialogMessage()).to.include(PROJECT_FILE);
        await pushDialogButton('Cancel');
        await VSBrowser.instance.driver.sleep(1_500);

        expect(fs.existsSync(projectFilePath), 'file must still exist on disk').to.equal(true);
        expect(groupHas(PROJECT_FILE), 'file must still be in the group').to.equal(true);
        expect(await rowsUnderGroup(GROUP_NAME)).to.include(PROJECT_FILE);
    });

    it('Move to Trash deletes a project file from disk and removes it from the group', async function () {
        await loadGroup([PROJECT_FILE, KEEP_FILE]);

        await runContextAction(PROJECT_FILE, 'Delete File');
        expect(await dialogMessage()).to.include(PROJECT_FILE);
        await pushDialogButton('Move to Trash');

        await waitForRowsUnder(GROUP_NAME, rows => !rows.includes(PROJECT_FILE), 'File row did not disappear from the group');
        await VSBrowser.instance.driver.wait(() => !groupHas(PROJECT_FILE), 15_000, 'File was not removed from virtualTab.json');
        expect(fs.existsSync(projectFilePath), 'file must be gone from disk').to.equal(false);
        expect(groupHas(KEEP_FILE), 'unrelated file stays in the group').to.equal(true);
        expect(await toastMessages()).to.satisfy((m: string[]) => m.some(t => t.includes(`Deleted: ${PROJECT_FILE}`)));
    });

    (process.platform === 'win32' ? it : it.skip)('Move to Trash deletes a file on another drive and removes it from the group', async function () {
        await loadGroup([OTHER_URI, KEEP_FILE]);

        await runContextAction(OTHER_FILE, 'Delete File');
        expect(await dialogMessage()).to.include(OTHER_FILE);
        await pushDialogButton('Move to Trash');

        await waitForRowsUnder(GROUP_NAME, rows => !rows.includes(OTHER_FILE), 'Other-drive file row did not disappear from the group');
        await VSBrowser.instance.driver.wait(() => !groupHas(OTHER_FILE), 15_000, 'Other-drive file was not removed from virtualTab.json');
        expect(fs.existsSync(otherFilePath), 'file must be gone from disk').to.equal(false);
        expect(groupHas(KEEP_FILE), 'unrelated file stays in the group').to.equal(true);
    });
});

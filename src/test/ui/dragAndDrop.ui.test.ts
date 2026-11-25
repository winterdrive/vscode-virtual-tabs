import * as fs from 'fs';
import * as path from 'path';
import {
    ActivityBar,
    By,
    CustomTreeSection,
    SideBarView,
    TreeItem,
    ViewControl,
    VSBrowser,
    WebElement
} from 'vscode-extension-tester';
import { expect } from 'chai';

/**
 * Real drag-and-drop through VS Code's tree view.
 *
 * The drag is a real pointer gesture (W3C actions: press, move, release), so VS Code's own
 * tree DnD machinery runs and hands the extension a genuine DataTransfer. Nothing here calls
 * the extension's drop handler directly. Every "rejected" scenario is paired with a positive
 * control, so "nothing changed" cannot be a symptom of the drag silently doing nothing.
 */

const repoAPath = path.resolve(__dirname, '../../../test-resources/multi-root/Repo-A');
const configPath = path.join(repoAPath, '.vscode', 'virtualTab.json');
const repoAOriginal = [{ id: 'repo-a-existing', name: 'Repo A Existing', files: [] }];

const PROJECT_FILE = 'dnd-project-file.txt';
// A file on a different drive than the workspace: the shape behind the duplicate-on-drag bug.
// It is only ever referenced from the config, never created on disk.
const workspaceDrive = path.parse(repoAPath).root.charAt(0).toLowerCase();
const otherDrive = workspaceDrive === 'd' ? 'c' : 'd';
const OTHER_DRIVE_DIR = 'vt-ui-dnd-test';
const OTHER_DRIVE_FILE = 'dnd-other-drive-file.txt';
const OTHER_DRIVE_URI = `file:///${otherDrive}:/${OTHER_DRIVE_DIR}/${OTHER_DRIVE_FILE}`;

type StoredGroup = { id: string; name?: string; files: string[]; parentGroupId?: string };

function writeConfig(groups: object[]): void {
    fs.writeFileSync(configPath, `${JSON.stringify(groups, null, 2)}\n`);
}

function readGroups(): StoredGroup[] {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as StoredGroup[];
}

function group(id: string): StoredGroup {
    const found = readGroups().find(g => g.id === id);
    if (!found) {
        throw new Error(`Group "${id}" not found in virtualTab.json`);
    }
    return found;
}

/** Normalise a stored file entry so encodings (file:///d:/x, d%3A, backslashes, case) compare equal. */
function normalised(entry: string): string {
    let value = entry;
    try { value = decodeURIComponent(entry); } catch { /* keep raw */ }
    return value.replace(/\\/g, '/').toLowerCase();
}

function entriesFor(g: StoredGroup, fileName: string): string[] {
    const name = fileName.toLowerCase();
    return g.files.filter(f => normalised(f).endsWith(`/${name}`) || normalised(f) === name);
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

async function findRow(text: string): Promise<WebElement> {
    const driver = VSBrowser.instance.driver;
    return await driver.wait(async () => {
        for (const row of await driver.findElements(By.css('.monaco-list-row'))) {
            try {
                if ((await row.getText()).replace(/\s+/g, ' ').trim() === text) {
                    return row;
                }
            } catch { /* stale row, retry */ }
        }
        return null;
    }, 10_000, `Tree row "${text}" not found`) as WebElement;
}

/** A real pointer drag from one tree row onto another. */
async function dragRowOnto(sourceText: string, targetText: string): Promise<void> {
    const driver = VSBrowser.instance.driver;
    const source = await findRow(sourceText);
    const target = await findRow(targetText);
    await driver.actions({ async: true })
        .move({ origin: source })
        .press()
        .move({ origin: source, x: 6, y: 6 })
        .move({ origin: target })
        .move({ origin: target, x: 2, y: 2 })
        .release()
        .perform();
}

async function toastMessages(): Promise<string[]> {
    return await VSBrowser.instance.driver.executeScript(`
        return Array.from(document.querySelectorAll('.notifications-toasts .notification-list-item-message'))
            .map(el => (el.textContent || '').trim());
    `) as string[];
}

async function dismissNotifications(): Promise<void> {
    await VSBrowser.instance.driver.executeScript(`
        for (const btn of document.querySelectorAll('.notifications-toasts .codicon-notifications-clear, .notifications-toasts .codicon-close')) { btn.click(); }
    `);
}

async function waitForToast(pattern: RegExp): Promise<string> {
    let found = '';
    await VSBrowser.instance.driver.wait(async () => {
        found = (await toastMessages()).find(m => pattern.test(m)) ?? '';
        return found !== '';
    }, 10_000, `Expected an error notification matching ${pattern}`);
    return found;
}

describe('Virtual Tabs - real drag and drop', function () {
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

    /** Write a scenario to disk, reload it, and expand the named groups. */
    async function loadScenario(groups: object[], firstGroupName: string, expandNames: string[]): Promise<void> {
        writeConfig(groups);
        await clickRefresh();
        await waitForRows(rows => rows.includes(firstGroupName), `Group "${firstGroupName}" did not appear`);
        for (const name of expandNames) {
            const item = await section.findItem(name) as TreeItem;
            await item.expand();
        }
    }

    before(async function () {
        await VSBrowser.instance.waitForWorkbench();
        await dismissOnboardingOverlay();
        fs.writeFileSync(path.join(repoAPath, PROJECT_FILE), 'project file\n');

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
        await dismissNotifications();
    });

    after(function () {
        fs.rmSync(path.join(repoAPath, PROJECT_FILE), { force: true });
        writeConfig(repoAOriginal);
    });

    describe('dragging a file from group A to group B', function () {
        it('moves a project file: it ends up only in B', async function () {
            await loadScenario([
                { id: 'dnd-a', name: 'DnD A', files: [PROJECT_FILE, 'README.md'] },
                { id: 'dnd-b', name: 'DnD B', files: [] }
            ], 'DnD A', ['DnD A']);

            await dragRowOnto(PROJECT_FILE, 'DnD B');

            await VSBrowser.instance.driver.wait(() => entriesFor(group('dnd-b'), PROJECT_FILE).length === 1, 15_000,
                'File never arrived in group B');
            expect(entriesFor(group('dnd-a'), PROJECT_FILE), 'file must leave group A').to.have.length(0);
            expect(group('dnd-a').files, 'unrelated files stay in A').to.have.length(1);
            expect(entriesFor(group('dnd-b'), PROJECT_FILE), 'exactly one copy in B').to.have.length(1);
        });

        (process.platform === 'win32' ? it : it.skip)('moves a file on another drive: it is not left behind or duplicated', async function () {
            await loadScenario([
                { id: 'dnd-a', name: 'DnD A', files: [OTHER_DRIVE_URI] },
                { id: 'dnd-b', name: 'DnD B', files: [] }
            ], 'DnD A', ['DnD A']);

            await dragRowOnto(OTHER_DRIVE_FILE, 'DnD B');

            await VSBrowser.instance.driver.wait(() => entriesFor(group('dnd-b'), OTHER_DRIVE_FILE).length >= 1, 15_000,
                'Other-drive file never arrived in group B');
            expect(entriesFor(group('dnd-a'), OTHER_DRIVE_FILE), 'file must leave group A (issue #154)').to.have.length(0);
            expect(entriesFor(group('dnd-b'), OTHER_DRIVE_FILE), 'exactly one copy in B').to.have.length(1);
        });
    });

    describe('dragging a group onto another group', function () {
        it('control: nests an unrelated group under the target', async function () {
            await loadScenario([
                { id: 'dnd-p', name: 'DnD Parent', files: [] },
                { id: 'dnd-q', name: 'DnD Loose', files: [] }
            ], 'DnD Parent', []);

            await dragRowOnto('DnD Loose', 'DnD Parent');

            await VSBrowser.instance.driver.wait(() => group('dnd-q').parentGroupId === 'dnd-p', 15_000,
                'Control failed: dragging a group onto another group did nothing, so the rejection tests below prove nothing');
            expect(group('dnd-p').parentGroupId).to.equal(undefined);
        });

        it('rejects dragging a group into its own child with an error, and changes nothing', async function () {
            await loadScenario([
                { id: 'dnd-p', name: 'DnD Parent', files: [] },
                { id: 'dnd-c', name: 'DnD Child', files: [], parentGroupId: 'dnd-p' }
            ], 'DnD Parent', ['DnD Parent']);
            await waitForRows(rows => rows.includes('DnD Child'), 'Child group is not visible under its parent');

            await dragRowOnto('DnD Parent', 'DnD Child');

            const message = await waitForToast(/circular nesting/i);
            expect(message).to.include('descendant');
            expect(group('dnd-p').parentGroupId, 'parent must not be nested').to.equal(undefined);
            expect(group('dnd-c').parentGroupId, 'child stays under parent').to.equal('dnd-p');
        });

        it('rejects dragging a group onto itself with an error, and changes nothing', async function () {
            await loadScenario([
                { id: 'dnd-p', name: 'DnD Parent', files: [] }
            ], 'DnD Parent', []);

            await dragRowOnto('DnD Parent', 'DnD Parent');

            const message = await waitForToast(/cannot nest a group into itself/i);
            expect(message).to.be.a('string').and.not.equal('');
            expect(group('dnd-p').parentGroupId).to.equal(undefined);
        });
    });
});

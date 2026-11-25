import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SendTarget } from './types';
import { I18n } from './i18n';

const RECENT_TARGETS_KEY = 'virtualTabs.sendTo.recentPaths';
const MAX_RECENT = 5;

/**
 * SendToManager - Handles "Send to..." file copy operations
 */
export class SendToManager {

    // ──────────────────────────────────────────────
    // Config loading
    // ──────────────────────────────────────────────

    static loadSendTargets(): SendTarget[] {
        const workspaceRoot = this.getWorkspaceRootPath();
        if (!workspaceRoot) {
            return [];
        }

        const vscodeDir = path.join(workspaceRoot, '.vscode');

        // 1. sendTargets.json (new)
        const newConfigPath = path.join(vscodeDir, 'sendTargets.json');
        if (fs.existsSync(newConfigPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(newConfigPath, 'utf8'));
                const targets = Array.isArray(config.sendTargets)
                    ? config.sendTargets.filter(this.isValidSendTarget)
                    : [];
                if (targets.length > 0) {
                    return targets;
                }
            } catch (error) {
                console.error('Failed to load sendTargets.json:', error);
            }
        }

        // 2. transmitConfig.json (legacy fallback)
        const legacyConfigPath = path.join(vscodeDir, 'transmitConfig.json');
        if (fs.existsSync(legacyConfigPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(legacyConfigPath, 'utf8'));
                const rawTargets = config.sendTargets || config.transmitTargets;
                const targets = Array.isArray(rawTargets) ? rawTargets.filter(this.isValidSendTarget) : [];
                if (targets.length > 0) {
                    return targets;
                }
            } catch (error) {
                console.error('Failed to load transmitConfig.json:', error);
            }
        }

        // 3. virtualTab.json (legacy fallback)
        const vtPath = path.join(vscodeDir, 'virtualTab.json');
        if (fs.existsSync(vtPath)) {
            try {
                const config = JSON.parse(fs.readFileSync(vtPath, 'utf8'));
                if (!Array.isArray(config)) {
                    const rawTargets = config.sendTargets || config.transmitTargets;
                    const targets = Array.isArray(rawTargets) ? rawTargets.filter(this.isValidSendTarget) : [];
                    if (targets.length > 0) {
                        return targets;
                    }
                }
            } catch (error) {
                console.error('Failed to load virtualTab.json fallback:', error);
            }
        }

        return [];
    }

    /**
     * Guards against hand-edited config files where a target is missing its
     * `name`/`path`, since a malformed entry (e.g. `path: undefined`) would
     * otherwise reach `path.join()` in sendFile and throw a TypeError.
     */
    private static isValidSendTarget(target: unknown): target is SendTarget {
        if (!target || typeof target !== 'object') {
            return false;
        }
        const candidate = target as Partial<SendTarget>;
        if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
            return false;
        }
        if (typeof candidate.path === 'string') {
            return candidate.path.trim().length > 0;
        }
        if (Array.isArray(candidate.path)) {
            return candidate.path.length > 0 && candidate.path.every(p => typeof p === 'string' && p.trim().length > 0);
        }
        return false;
    }

    private static getWorkspaceRootPath(): string | undefined {
        return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    // ──────────────────────────────────────────────
    // Recent paths (workspaceState)
    // ──────────────────────────────────────────────

    static getRecentPaths(context: vscode.ExtensionContext): string[] {
        const workspaceRecent = context.workspaceState.get<string[]>(RECENT_TARGETS_KEY, []);
        const globalRecent = context.globalState.get<string[]>(RECENT_TARGETS_KEY, []);

        // Prefer workspace ordering, then append any global entries not present.
        const merged = [...workspaceRecent];
        for (const p of globalRecent) {
            if (!merged.includes(p)) {
                merged.push(p);
            }
        }
        return merged;
    }

    private static async addRecentPath(context: vscode.ExtensionContext, folderPath: string): Promise<void> {
        const recent = this.getRecentPaths(context).filter(p => p !== folderPath);
        recent.unshift(folderPath);
        const next = recent.slice(0, MAX_RECENT);

        // Workspace scoped (per folder/workspace) + global fallback (across workspaces).
        await Promise.all([
            context.workspaceState.update(RECENT_TARGETS_KEY, next),
            context.globalState.update(RECENT_TARGETS_KEY, next)
        ]);
    }

    // ──────────────────────────────────────────────
    // Quick Pick selector
    // ──────────────────────────────────────────────

    /**
     * Show the "Send to..." Quick Pick and return the resolved destination path(s).
     * Returns undefined if the user cancelled.
     */
    static async pickDestination(
        context: vscode.ExtensionContext
    ): Promise<string[] | undefined> {
        type QItem = vscode.QuickPickItem & { paths?: string[]; isBrowse?: boolean; isCreateTemplate?: boolean };

        const configuredTargets = this.loadSendTargets();
        const recentPaths = this.getRecentPaths(context);

        // If nothing configured and no recent — go straight to Browse
        if (configuredTargets.length === 0 && recentPaths.length === 0) {
            return this.browseFolderAndRemember(context);
        }

        const items: QItem[] = [];

        // Browse entry
        items.push({
            label: '$(folder-opened) ' + I18n.getMessage('sendTo.quickPick.browse'),
            isBrowse: true
        });

        // Configured targets section
        if (configuredTargets.length > 0) {
            items.push({ label: I18n.getMessage('sendTo.quickPick.configuredSection'), kind: vscode.QuickPickItemKind.Separator });
            for (const t of configuredTargets) {
                const paths = Array.isArray(t.path) ? t.path : [t.path];
                items.push({
                    label: '$(rocket) ' + t.name,
                    description: paths.join(', '),
                    paths
                });
            }
        } else {
            // No configured targets: offer to create a template file on-demand.
            items.push({ label: I18n.getMessage('sendTo.quickPick.configuredSection'), kind: vscode.QuickPickItemKind.Separator });
            items.push({
                label: '$(new-file) ' + I18n.getMessage('sendTo.quickPick.createTemplate'),
                description: I18n.getMessage('sendTo.quickPick.createTemplate.desc'),
                isCreateTemplate: true
            });
        }

        // Recent section
        if (recentPaths.length > 0) {
            items.push({ label: I18n.getMessage('sendTo.quickPick.recentSection'), kind: vscode.QuickPickItemKind.Separator });
            for (const p of recentPaths) {
                items.push({
                    label: '$(history) ' + p,
                    paths: [p]
                });
            }
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: I18n.getMessage('sendTo.quickPick.placeholder'),
            title: I18n.getMessage('sendTo.quickPick.title')
        });

        if (!selected) {
            return undefined;
        }

        if (selected.isBrowse) {
            return this.browseFolderAndRemember(context);
        }

        if (selected.isCreateTemplate) {
            await this.createSendTargetsTemplateAndOpen();
            return undefined;
        }

        return selected.paths;
    }

    private static async createSendTargetsTemplateAndOpen(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage(I18n.getMessage('sendTo.template.noWorkspace'));
            return;
        }

        const vscodeDir = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
        const targetFile = vscode.Uri.joinPath(vscodeDir, 'sendTargets.json');

        await vscode.workspace.fs.createDirectory(vscodeDir);

        // If exists, open it directly
        try {
            await vscode.workspace.fs.stat(targetFile);
            const doc = await vscode.workspace.openTextDocument(targetFile);
            await vscode.window.showTextDocument(doc);
            return;
        } catch {
            // continue to create
        }

        const template = {
            sendTargets: [
                {
                    name: '🚀 Target (single path)',
                    path: 'D:/_send_to_single'
                },
                {
                    name: '🚀 Target (multiple paths)',
                    path: [
                        'D:/_send_to_one',
                        'D:/_send_to_two'
                    ]
                }
            ]
        };

        const content = JSON.stringify(template, null, 4) + '\n';
        await vscode.workspace.fs.writeFile(targetFile, Buffer.from(content, 'utf8'));

        const doc = await vscode.workspace.openTextDocument(targetFile);
        await vscode.window.showTextDocument(doc);
        vscode.window.showInformationMessage(I18n.getMessage('sendTo.template.created'));
    }

    private static async browseFolderAndRemember(
        context: vscode.ExtensionContext
    ): Promise<string[] | undefined> {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: I18n.getMessage('sendTo.browse.selectButton')
        });

        if (!uris || uris.length === 0) {
            return undefined;
        }

        const folderPath = uris[0].fsPath;
        await this.addRecentPath(context, folderPath);
        return [folderPath];
    }

    // ──────────────────────────────────────────────
    // File copy logic
    // ──────────────────────────────────────────────

    /**
     * Copy a single file to one destination folder.
     */
    static async sendFile(
        sourceUri: vscode.Uri,
        destFolder: string,
        confirmOverwrite: boolean = true
    ): Promise<boolean> {
        const sourcePath = sourceUri.fsPath;
        const fileName = path.basename(sourcePath);
        const destPath = path.join(destFolder, fileName);

        if (!fs.existsSync(sourcePath)) {
            vscode.window.showErrorMessage(
                I18n.getMessage('sendTo.error.sourceNotFound', sourcePath)
            );
            return false;
        }

        // Sending a file into the folder it already lives in would otherwise prompt
        // to "overwrite" the file with itself, and on Windows copyFileSync then fails
        // with EBUSY. The file is already at the destination, so treat it as done.
        if (this.isSamePath(sourcePath, destPath)) {
            return true;
        }

        if (fs.existsSync(destPath) && confirmOverwrite) {
            const answer = await vscode.window.showWarningMessage(
                I18n.getMessage('sendTo.confirm.overwrite', fileName, destFolder),
                { modal: true },
                I18n.getMessage('sendTo.button.overwrite'),
                I18n.getMessage('sendTo.button.skip')
            );
            if (answer !== I18n.getMessage('sendTo.button.overwrite')) {
                return false;
            }
        }

        try {
            if (!fs.existsSync(destFolder)) {
                fs.mkdirSync(destFolder, { recursive: true });
            }
            fs.copyFileSync(sourcePath, destPath);
            return true;
        } catch (error) {
            vscode.window.showErrorMessage(
                I18n.getMessage('sendTo.error.failed', fileName, String(error))
            );
            return false;
        }
    }

    private static isSamePath(a: string, b: string): boolean {
        const normalize = (p: string) => {
            const resolved = path.resolve(p);
            return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        };
        return normalize(a) === normalize(b);
    }

    /**
     * Copy multiple files to one or more destination folders, with progress notification.
     */
    static async sendFiles(
        sourceUris: vscode.Uri[],
        destFolders: string[],
        targetLabel: string
    ): Promise<void> {
        if (sourceUris.length === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('sendTo.info.noFiles'));
            return;
        }
        if (destFolders.length === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('sendTo.info.noDestinations'));
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: I18n.getMessage('sendTo.progress.title', targetLabel),
            cancellable: true
        }, async (progress, token) => {
            const total = sourceUris.length * destFolders.length;
            let successCount = 0;
            const step = 100 / total;
            let index = 0;

            outer: for (const uri of sourceUris) {
                for (const folder of destFolders) {
                    if (token.isCancellationRequested) { break outer; }

                    const fileName = path.basename(uri.fsPath);
                    progress.report({
                        increment: step,
                        message: I18n.getMessage('sendTo.progress.file', (++index).toString(), total.toString(), fileName)
                    });

                    const ok = await this.sendFile(uri, folder, true);
                    if (ok) { successCount++; }

                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage(
                    I18n.getMessage('sendTo.info.cancelled', successCount.toString())
                );
            } else {
                vscode.window.showInformationMessage(
                    I18n.getMessage('sendTo.info.complete', successCount.toString(), total.toString(), targetLabel)
                );
            }
        });
    }

    /**
     * Copy multiple files into per-file destination subfolders (relative to each dest folder),
     * with progress notification.
     *
     * `items[i].subdir` should be a relative path (no absolute paths).
     */
    static async sendFilesWithSubdirs(
        items: Array<{ uri: vscode.Uri; subdir: string }>,
        destFolders: string[],
        targetLabel: string
    ): Promise<void> {
        if (items.length === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('sendTo.info.noFiles'));
            return;
        }
        if (destFolders.length === 0) {
            vscode.window.showInformationMessage(I18n.getMessage('sendTo.info.noDestinations'));
            return;
        }

        const sanitizeSegment = (seg: string): string => {
            // Windows-forbidden characters: <>:"/\|?*  (also trim trailing dots/spaces)
            const cleaned = seg.replace(/[<>:"/\\|?*]/g, '_').trim();
            return cleaned.replace(/[. ]+$/g, '') || '_';
        };

        const safeSubdir = (subdir: string): string => {
            const parts = subdir.split(/[\\/]+/).filter(Boolean).map(sanitizeSegment);
            return parts.join(path.sep);
        };

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: I18n.getMessage('sendTo.progress.title', targetLabel),
            cancellable: true
        }, async (progress, token) => {
            const total = items.length * destFolders.length;
            let successCount = 0;
            const step = 100 / total;
            let index = 0;

            outer: for (const item of items) {
                for (const folder of destFolders) {
                    if (token.isCancellationRequested) { break outer; }

                    const fileName = path.basename(item.uri.fsPath);
                    progress.report({
                        increment: step,
                        message: I18n.getMessage('sendTo.progress.file', (++index).toString(), total.toString(), fileName)
                    });

                    const destFolder = path.join(folder, safeSubdir(item.subdir));
                    const ok = await this.sendFile(item.uri, destFolder, true);
                    if (ok) { successCount++; }

                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage(
                    I18n.getMessage('sendTo.info.cancelled', successCount.toString())
                );
            } else {
                vscode.window.showInformationMessage(
                    I18n.getMessage('sendTo.info.complete', successCount.toString(), total.toString(), targetLabel)
                );
            }
        });
    }
}

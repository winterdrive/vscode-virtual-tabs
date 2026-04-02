import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TransmitTarget } from './types';
import { I18n } from './i18n';

/**
 * TransmitManager - Handles file transmission to configured target paths
 */
export class TransmitManager {
    /**
     * Load transmit targets from workspace configuration
     * Reads from .vscode/transmitConfig.json
     */
    static loadTransmitTargets(): TransmitTarget[] {
        const workspaceRoot = this.getWorkspaceRootPath();
        if (!workspaceRoot) {
            return [];
        }

        // Try .vscode/transmitConfig.json first (recommended location)
        const configPath = path.join(workspaceRoot, '.vscode', 'transmitConfig.json');
        if (fs.existsSync(configPath)) {
            try {
                const content = fs.readFileSync(configPath, 'utf8');
                const config = JSON.parse(content);
                return config.transmitTargets || [];
            } catch (error) {
                console.error('Failed to load transmit configuration:', error);
            }
        }

        // Fallback: try virtualTab.json with transmitTargets property
        const fallbackPath = path.join(workspaceRoot, '.vscode', 'virtualTab.json');
        if (fs.existsSync(fallbackPath)) {
            try {
                const content = fs.readFileSync(fallbackPath, 'utf8');
                const config = JSON.parse(content);
                // Only if it's an object format (not array)
                if (!Array.isArray(config) && config.transmitTargets) {
                    return config.transmitTargets;
                }
            } catch (error) {
                console.error('Failed to load fallback configuration:', error);
            }
        }

        return [];
    }

    /**
     * Get workspace root path
     */
    private static getWorkspaceRootPath(): string | undefined {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        return workspaceFolder?.uri.fsPath;
    }

    /**
     * Transmit a single file to target path
     * @param sourceUri Source file URI
     * @param target Transmit target configuration
     * @param confirmOverwrite Whether to confirm before overwriting existing files
     * @returns true if successful, false otherwise
     */
    static async transmitFile(
        sourceUri: vscode.Uri,
        target: TransmitTarget,
        confirmOverwrite: boolean = true
    ): Promise<boolean> {
        const sourcePath = sourceUri.fsPath;
        const fileName = path.basename(sourcePath);
        const destPath = path.join(target.path, fileName);

        // Check if source exists
        if (!fs.existsSync(sourcePath)) {
            vscode.window.showErrorMessage(
                I18n.getMessage('transmit.error.sourceNotFound', sourcePath)
            );
            return false;
        }

        // Check if destination exists and confirm overwrite
        if (fs.existsSync(destPath) && confirmOverwrite) {
            const overwrite = await vscode.window.showWarningMessage(
                I18n.getMessage('transmit.confirm.overwrite', fileName, target.name),
                { modal: true },
                I18n.getMessage('transmit.button.overwrite'),
                I18n.getMessage('transmit.button.skip')
            );

            if (overwrite !== I18n.getMessage('transmit.button.overwrite')) {
                return false;
            }
        }

        try {
            // Ensure target directory exists
            if (!fs.existsSync(target.path)) {
                fs.mkdirSync(target.path, { recursive: true });
            }

            // Copy file
            fs.copyFileSync(sourcePath, destPath);
            return true;
        } catch (error) {
            console.error('Failed to transmit file:', error);
            vscode.window.showErrorMessage(
                I18n.getMessage('transmit.error.failed', fileName, String(error))
            );
            return false;
        }
    }

    /**
     * Transmit multiple files to target path
     * @param sourceUris Array of source file URIs
     * @param target Transmit target configuration
     */
    static async transmitFiles(
        sourceUris: vscode.Uri[],
        target: TransmitTarget
    ): Promise<void> {
        if (sourceUris.length === 0) {
            vscode.window.showInformationMessage(
                I18n.getMessage('transmit.info.noFiles')
            );
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: I18n.getMessage('transmit.progress.title', target.name),
            cancellable: true
        }, async (progress, token) => {
            const total = sourceUris.length;
            let successCount = 0;
            const step = 100 / total;

            for (let i = 0; i < sourceUris.length; i++) {
                if (token.isCancellationRequested) {
                    break;
                }

                const uri = sourceUris[i];
                const fileName = path.basename(uri.fsPath);

                progress.report({
                    increment: step,
                    message: I18n.getMessage('transmit.progress.file', (i + 1).toString(), total.toString(), fileName)
                });

                const success = await this.transmitFile(uri, target, true);
                if (success) {
                    successCount++;
                }

                // Small delay to prevent overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 50));
            }

            if (token.isCancellationRequested) {
                vscode.window.showInformationMessage(
                    I18n.getMessage('transmit.info.cancelled', successCount.toString())
                );
            } else {
                vscode.window.showInformationMessage(
                    I18n.getMessage('transmit.info.complete', successCount.toString(), total.toString(), target.name)
                );
            }
        });
    }

    /**
     * Get all files from a directory recursively
     * @param dirPath Directory path
     * @returns Array of file URIs
     */
    static getFilesInDirectory(dirPath: string): vscode.Uri[] {
        const files: vscode.Uri[] = [];

        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return files;
        }

        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isFile()) {
                files.push(vscode.Uri.file(fullPath));
            } else if (entry.isDirectory()) {
                // Recursively get files from subdirectories
                files.push(...this.getFilesInDirectory(fullPath));
            }
        }

        return files;
    }

    /**
     * Show quick pick to select transmit target
     * @param targets Available targets
     * @returns Selected target or undefined if cancelled
     */
    static async selectTarget(targets: TransmitTarget[]): Promise<TransmitTarget | undefined> {
        if (targets.length === 0) {
            vscode.window.showWarningMessage(
                I18n.getMessage('transmit.error.noTargets')
            );
            return undefined;
        }

        if (targets.length === 1) {
            return targets[0];
        }

        const items = targets.map(target => ({
            label: target.name,
            description: target.path,
            target
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: I18n.getMessage('transmit.quickPick.placeholder'),
            title: I18n.getMessage('transmit.quickPick.title')
        });

        return selected?.target;
    }
}

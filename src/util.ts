import * as vscode from 'vscode';
import { TempGroup } from './types';

/**
 * Returns the root URI of the current workspace.
 * For multi-root workspaces, this is the directory containing the .code-workspace file.
 * For single-folder workspaces, this is the first workspace folder's URI.
 */
export function getWorkspaceRootUri(): vscode.Uri | undefined {
    if (vscode.workspace.workspaceFile) {
        return vscode.Uri.joinPath(vscode.workspace.workspaceFile, '..');
    }
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * Get all files from a group and all its nested child groups (recursive).
 * Uses a visited-Set to prevent infinite loops from circular parent references.
 * Returns a de-duplicated list of file URI strings.
 */
export function getAllFilesInGroupRecursive(groups: TempGroup[], groupId: string): string[] {
    const files = new Set<string>();
    const visited = new Set<string>();

    const collect = (currentId: string) => {
        if (visited.has(currentId)) { return; }
        visited.add(currentId);

        const group = groups.find(g => g.id === currentId);
        if (!group) { return; }

        if (group.files) {
            for (const uri of group.files) {
                files.add(uri);
            }
        }

        const children = groups.filter(g => g.parentGroupId === currentId);
        for (const child of children) {
            if (child.id) { collect(child.id); }
        }
    };

    collect(groupId);
    return Array.from(files);
}

/**
 * Executes an action after prompting for confirmation, based on user configuration.
 * 
 * @param message The confirmation message to display (e.g., "Are you sure?").
 * @param confirmButtonLabel The label for the confirm button (e.g., "Delete").
 * @param action The action to execute if confirmed.
 * @param configKey The configuration key to check (optional, defaults to 'virtualTabs.confirmBeforeDelete').
 */
export async function executeWithConfirmation(
    message: string,
    confirmButtonLabel: string,
    action: () => void | Promise<void>,
    configKey: string = 'virtualTabs.confirmBeforeDelete'
): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    const shouldConfirm = config.get<boolean>(configKey, true);

    if (!shouldConfirm) {
        await action();
        return;
    }

    const choice = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        confirmButtonLabel
    );

    if (choice === confirmButtonLabel) {
        await action();
    }
}

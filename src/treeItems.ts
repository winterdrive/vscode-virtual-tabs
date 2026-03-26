import * as vscode from 'vscode';
import * as path from 'path';
import { VTBookmark } from './types';

// Temporary folder TreeItem
export class TempFolderItem extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly groupIdx: number,
        public readonly groupId: string, // Store Group ID for stable reference
        builtIn?: boolean,
        isSubGroup?: boolean // Indicate if this is a sub-group
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = `virtualTabsGroup:${groupId}`;

        // Visual distinction: Sub-groups use a different icon
        if (isSubGroup) {
            this.iconPath = new vscode.ThemeIcon('folder-library', new vscode.ThemeColor('charts.blue'));
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }

        this.contextValue = builtIn ? 'virtualTabsGroupBuiltIn' : 'virtualTabsGroup'; // Distinguish built-in and custom groups
        // Prevent accidental open on expand
        this.command = undefined;
    }
}

// File TreeItem in group
export class TempFileItem extends vscode.TreeItem {
    constructor(public readonly uri: vscode.Uri, public readonly groupIdx: number, isBuiltInGroup?: boolean, public readonly groupId?: string) {
        super(uri, vscode.TreeItemCollapsibleState.None);
        this.resourceUri = uri;

        // Ensure stable ID for reliable TreeView.reveal matching
        this.id = `virtualTabsFile:${groupId || groupIdx}:${uri.toString()}`;

        const ext = path.extname(uri.fsPath).toLowerCase();
        const isExecutable = ext === '.bat' || ext === '.exe';

        // Click always opens in editor (consistent behavior for all files)
        this.command = {
            command: 'vscode.open',
            title: 'Open File',
            arguments: [uri]
        };
        this.iconPath = vscode.ThemeIcon.File;
        this.tooltip = uri.fsPath;

        // Use base contextValue with capability suffix for better extensibility
        // This allows VS Code's 'when' clause to match patterns like:
        // - viewItem =~ /virtualTabsFile.*Exec/ for any executable
        // - viewItem == virtualTabsFileCustom for exact match
        const baseContext = isBuiltInGroup ? 'virtualTabsFileBuiltIn' : 'virtualTabsFileCustom';
        this.contextValue = isExecutable ? `${baseContext}Exec` : baseContext;
    }
}

/**
 * Editor Group TreeItem
 * Represents a VS Code editor group (split panel) under the built-in "Currently Open Files" group.
 * Shown only when two or more editor groups are open.
 */
export class EditorGroupItem extends vscode.TreeItem {
    constructor(
        label: string,
        public readonly viewColumn: number,
        public readonly builtInGroupIdx: number,
        public readonly builtInGroupId: string,
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `virtualTabsEditorGroup:${viewColumn}`;
        this.iconPath = new vscode.ThemeIcon('layout-panel-left');
        this.contextValue = 'virtualTabsEditorGroup';
        this.command = undefined;
    }
}

/**
 * Bookmark TreeItem (v0.2.0)
 * Represents a code bookmark within a file
 */
export class BookmarkItem extends vscode.TreeItem {
    constructor(
        public readonly bookmark: VTBookmark,
        public readonly fileUri: vscode.Uri,
        public readonly groupIdx: number
    ) {
        super(
            `${bookmark.label} (line ${bookmark.line + 1})`,
            vscode.TreeItemCollapsibleState.None
        );
        this.resourceUri = fileUri;

        this.contextValue = 'virtualTabsBookmark';
        this.iconPath = new vscode.ThemeIcon('bookmark');
        this.tooltip = this.createTooltip();
        this.description = `line ${bookmark.line + 1}`;

        // Click to jump to bookmark
        this.command = {
            command: 'virtualTabs.jumpToBookmark',
            title: 'Jump to Bookmark',
            arguments: [this]
        };
    }

    /**
     * Create rich tooltip with description and code preview
     */
    private createTooltip(): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${this.bookmark.label}** (line ${this.bookmark.line + 1})\n\n`);

        if (this.bookmark.description) {
            tooltip.appendMarkdown(`*${this.bookmark.description}*\n\n`);
        }

        tooltip.appendMarkdown(`📁 ${this.fileUri.fsPath}\n`);
        tooltip.appendMarkdown(`⏰ Created: ${new Date(this.bookmark.created).toLocaleString()}`);

        if (this.bookmark.modified) {
            tooltip.appendMarkdown(`\n✏️ Modified: ${new Date(this.bookmark.modified).toLocaleString()}`);
        }

        return tooltip;
    }
}
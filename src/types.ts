import type * as vscode from 'vscode';

// Sort criteria for files in a group
export type SortCriteria =
    | 'none'        // Insertion order (default)
    | 'name'        // Filename A-Z
    | 'path'        // Full path
    | 'extension'   // File extension
    | 'modified';   // Last modified time

// Group by criteria
export type GroupByCriteria =
    | 'none'
    | 'extension'
    | 'modifiedDate';

// Date group categories
export type DateGroup =
    | 'today'
    | 'yesterday'
    | 'thisWeek'
    | 'lastWeek'
    | 'thisMonth'
    | 'older';

/**
 * Per-file display metadata within a group (custom label / description)
 */
export interface VTFileMeta {
    label?: string;        // Display label shown in the tree instead of the file name
    description?: string;  // Secondary text shown next to the label
}

/**
 * VirtualTabs Bookmark (v0.2.0)
 * Represents a specific code location within a file in a group
 */
export interface VTBookmark {
    /**
     * Unique identifier
     */
    id: string;

    /**
     * Line number (0-based)
     */
    line: number;

    /**
     * Character position (0-based, optional)
     */
    character?: number;

    /**
     * Bookmark label (required)
     * Example: "Login function", "TODO: Refactor", "Bug location"
     */
    label: string;

    /**
     * Detailed description (optional)
     * Example: "This logic needs optimization, current complexity is O(n²)"
     */
    description?: string;

    /**
     * Creation timestamp
     */
    created: number;

    /**
     * Last modified timestamp (optional)
     */
    modified?: number;
}

// Group data structure
export interface TempGroup {
    id: string;                        // Unique identifier (Enforced in v0.3.0)
    name: string;
    files?: string[];                   // Array of file URIs in the group
    readonly builtIn?: boolean;         // Mark if this is a built-in group
    auto?: boolean;                     // Mark if this is an auto group

    // Display preferences (v0.1.0)
    sortBy?: SortCriteria;              // Sort preference
    sortOrder?: 'asc' | 'desc';         // Sort direction
    groupBy?: GroupByCriteria;          // Grouping preference
    autoGroupType?: 'extension' | 'modifiedDate';  // Type of auto-grouping
    parentGroupId?: string;             // Parent group ID (for nested groups)
    sourceGroupId?: string;             // ID of the source group for parallel auto-groups

    // Bookmarks (v0.2.0)
    /**
     * Bookmarks within this group
     * Key: File URI string
     * Value: Array of bookmarks for that file
     */
    bookmarks?: Record<string, VTBookmark[]>;

    /**
     * Per-group display label / description for files.
     * Key: File URI string (same keying as `bookmarks`). Absent when no file has a custom label.
     */
    fileMeta?: Record<string, VTFileMeta>;

    // Display customisation (v0.4.0)
    color?: string;                     // VS Code color theme ID (e.g. "charts.blue")

    // Reserved for future use
    metadata?: Record<string, unknown>;

    /**
     * [執行時專用，不持久化至磁碟]
     * 指向此群組所屬的 ConfigScope.id
     */
    sourceScopeId?: string;
}

/**
 * Bookmark query result (used by MCP tool layer / CLI)
 */
export interface BookmarkInfo {
    id: string;
    groupId: string;
    groupName: string;
    filePath: string;
    line: number;
    label: string;
    description?: string;
    created: number;
}

/**
 * Send Target (v0.6.0)
 * Defines a destination path for file send operation
 */
export interface SendTarget {
    /**
     * Display name for the target
     * Example: "Production Server", "Backup Folder"
     */
    name: string;

    /**
     * Destination path(s) (absolute path, network path, or array of paths)
     * Example: "D:\\Deploy", "\\\\server\\share", ["D:\\Deploy", "\\\\server\\share"]
     */
    path: string | string[];
}

/** @deprecated Use SendTarget instead */
export type TransmitTarget = SendTarget;

/**
 * VirtualTab Configuration File Structure
 * Stored in .vscode/virtualTab.json or .vscode/sendTargets.json
 */
export interface VirtualTabConfig {
    /**
     * Group definitions
     */
    groups?: TempGroup[];

    /**
     * Send targets for file send feature
     */
    sendTargets?: SendTarget[];

    /** @deprecated Use sendTargets instead */
    transmitTargets?: SendTarget[];
}

/**
 * 配置範圍類型
 * - 'workspace': 對應 .code-workspace 檔案所在目錄
 * - 'folder': 對應 workspaceFolders 中的各個資料夾
 */
export type ConfigScopeType = 'workspace' | 'folder';

/**
 * ConfigScope 介面
 * 代表一個配置來源，包含其類型、URI 路徑及所屬群組
 */
export interface ConfigScope {
    /** 唯一識別碼，使用 uri.toString() */
    id: string;

    /** 範圍類型 */
    type: ConfigScopeType;

    /** UI 顯示標籤 */
    label: string;

    /** 配置根目錄 URI（包含 .vscode/ 子目錄） */
    uri: vscode.Uri;

    /** 從此範圍載入的群組（執行時填充） */
    groups: TempGroup[];
}
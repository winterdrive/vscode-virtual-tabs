/**
 * FileManager
 *
 * Handles file path validation, path format conversion, and file add/remove operations.
 *
 * Requirements: 10.1, 10.4
 */

import * as path from 'path';
import { PathUtils } from './PathUtils.js';
import { GroupManager } from './GroupManager.js';
import { matchesStoredFileEntry } from './FileEntryMatcher.js';
import { TempGroup } from '../types.js';

/**
 * Result of the add-files operation
 */
export interface AddFilesResult {
  added: string[];    // Successfully added files
  skipped: string[];  // Already existing files
  invalid: string[];  // Invalid file paths
}

/**
 * Result of the remove-files operation
 */
export interface RemoveFilesResult {
  removed: string[];  // Successfully removed files
  notFound: string[]; // Files not in the group
}

export class FileManager {
  private pathUtils: PathUtils;
  private groupManager: GroupManager;

  constructor(workspaceRoot: string, groupManager: GroupManager) {
    this.pathUtils = new PathUtils(workspaceRoot);
    this.groupManager = groupManager;
  }

  validatePath(filePath: string): boolean {
    return this.pathUtils.validatePath(filePath);
  }

  toRelativePath(filePath: string): string {
    return this.pathUtils.toRelativePath(filePath);
  }

  toAbsolutePath(filePath: string): string {
    return this.pathUtils.toAbsolutePath(filePath);
  }

  toFileUri(filePath: string): string {
    return this.pathUtils.toFileUri(filePath);
  }

  fromFileUri(uri: string): string {
    return this.pathUtils.fromFileUri(uri);
  }

  /**
   * Add files to a group
   */
  addFilesToGroup(groupId: string, filePaths: string[]): AddFilesResult {
    if (!Array.isArray(filePaths)) {
      throw new Error(`Invalid argument: filePaths must be an array. Received: ${typeof filePaths}`);
    }
    const result: AddFilesResult = { added: [], skipped: [], invalid: [] };

    const { groups, version } = this.groupManager.loadGroups();
    const group = this.findGroupInArray(groups, groupId);

    if (!group) {
      throw new Error(`Group ID "${groupId}" does not exist`);
    }

    if (!group.files) {
      group.files = [];
    }

    for (const filePath of filePaths) {
      if (!this.validatePath(filePath)) {
        result.invalid.push(filePath);
        continue;
      }

      const targetFsPath = this.toAbsolutePath(filePath);

      // A blank entry (e.g. an MCP client sending "" or ".") resolves to the
      // workspace root itself; storing that directory as a group "file" would
      // leave an entry that cannot be opened, so report it as invalid instead.
      if (path.relative(this.pathUtils.getWorkspaceRoot(), targetFsPath) === '') {
        result.invalid.push(filePath);
        continue;
      }

      const fileUri = this.toFileUri(filePath);
      const workspaceRoot = this.groupManager.getWorkspaceRoot();

      if (group.files.some(entry => matchesStoredFileEntry(entry, fileUri, targetFsPath, workspaceRoot))) {
        result.skipped.push(filePath);
        continue;
      }

      group.files.push(fileUri);
      result.added.push(filePath);
    }

    if (result.added.length > 0) {
      this.groupManager.saveGroups(groups, version);
    }
    return result;
  }

  /**
   * Remove files from a group
   */
  removeFilesFromGroup(groupId: string, filePaths: string[]): RemoveFilesResult {
    if (!Array.isArray(filePaths)) {
      throw new Error(`Invalid argument: filePaths must be an array. Received: ${typeof filePaths}`);
    }
    const result: RemoveFilesResult = { removed: [], notFound: [] };

    const { groups, version } = this.groupManager.loadGroups();
    const group = this.findGroupInArray(groups, groupId);

    if (!group) {
      throw new Error(`Group ID "${groupId}" does not exist`);
    }

    if (!group.files || group.files.length === 0) {
      result.notFound.push(...filePaths);
      return result;
    }

    const workspaceRoot = this.groupManager.getWorkspaceRoot();

    for (const filePath of filePaths) {
      const fileUri = this.toFileUri(filePath);
      const targetFsPath = this.toAbsolutePath(filePath);
      const index = group.files.findIndex(entry => matchesStoredFileEntry(entry, fileUri, targetFsPath, workspaceRoot));

      if (index === -1) {
        result.notFound.push(filePath);
      } else {
        group.files.splice(index, 1);
        result.removed.push(filePath);

        // Keep bookmarks in sync with group membership: an orphaned bookmark
        // for a file no longer in the group would otherwise persist in the
        // config file indefinitely (the VS Code UI removal path already does
        // this via GroupFileRemoval; this MCP-driven path needs its own copy).
        if (group.bookmarks) {
          for (const bookmarkKey of Object.keys(group.bookmarks)) {
            if (matchesStoredFileEntry(bookmarkKey, fileUri, targetFsPath, workspaceRoot)) {
              delete group.bookmarks[bookmarkKey];
            }
          }
        }
      }
    }

    if (group.bookmarks && Object.keys(group.bookmarks).length === 0) {
      delete group.bookmarks;
    }

    if (result.removed.length > 0) {
      this.groupManager.saveGroups(groups, version);
    }
    return result;
  }

  private findGroupInArray(groups: TempGroup[], groupId: string): TempGroup | undefined {
    return groups.find(g => g.id === groupId);
  }
}

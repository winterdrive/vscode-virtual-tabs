import { AutoGrouper } from '../managers/AutoGrouper.js';
import { GroupManager } from '../managers/GroupManager.js';
import { FileManager } from '../managers/FileManager.js';
import { ProjectExplorer } from '../managers/ProjectExplorer.js';
import { ErrorType, ToolResponse, SortCriteria, TempGroup } from '../types.js';
import { Logger } from '../utils/Logger.js';

export class AutoGroupTools {
  constructor(
    private autoGrouper: AutoGrouper,
    private projectExplorer: ProjectExplorer,
    private groupManager: GroupManager,
    private fileManager: FileManager,
  ) { }

  /**
   * Set sorting criteria for a group
   */
  async setGroupSorting(args: {
    groupId: string,
    sortBy: SortCriteria,
    sortOrder: 'asc' | 'desc'
  }): Promise<ToolResponse<{ groupId: string, sortBy: SortCriteria, sortOrder: 'asc' | 'desc' }>> {
    try {
      const { groupId, sortBy, sortOrder } = args;
      if (!groupId || !sortBy || !sortOrder) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'Arguments groupId, sortBy, and sortOrder are all required');
      }

      this.autoGrouper.setGroupSorting(groupId, sortBy, sortOrder);

      return Logger.createSuccess({
        groupId,
        sortBy,
        sortOrder
      }, `Successfully set group sorting to ${sortBy} (${sortOrder})`);
    } catch (error) {
      Logger.logError('set_group_sorting', error);
      const errMsg = error instanceof Error ? error.message : String(error);

      if (errMsg.includes('does not exist')) {
        return Logger.createError(ErrorType.NOT_FOUND, errMsg);
      }
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to set group sorting: ${errMsg}`);
    }
  }

  /**
   * Auto-create subgroups by file extension
   */
  async autoGroupByExtension(args: { groupId: string }): Promise<ToolResponse<{
    sourceGroupId: string,
    createdGroups: Array<{ id: string, name: string, extension: string, fileCount: number }>,
    totalCreated: number
  }>> {
    try {
      const { groupId } = args;
      if (!groupId) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'Argument groupId is required');
      }

      const result = this.autoGrouper.groupByExtension(groupId);

      return Logger.createSuccess({
        sourceGroupId: groupId,
        createdGroups: result.groups,
        totalCreated: result.created
      }, `Successfully created ${result.created} subgroups by extension`);
    } catch (error) {
      Logger.logError('auto_group_by_extension', error);
      const errMsg = error instanceof Error ? error.message : String(error);

      if (errMsg.includes('does not exist')) {
        return Logger.createError(ErrorType.NOT_FOUND, errMsg);
      }
      if (errMsg.includes('empty')) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, errMsg);
      }
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to auto-group by extension: ${errMsg}`);
    }
  }

  /**
   * Auto-create subgroups by modification date
   */
  async autoGroupByDate(args: { groupId: string }): Promise<ToolResponse<{
    sourceGroupId: string,
    createdGroups: Array<{ id: string, name: string, dateGroup: string, fileCount: number }>,
    totalCreated: number
  }>> {
    try {
      const { groupId } = args;
      if (!groupId) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'Argument groupId is required');
      }

      const result = this.autoGrouper.groupByDate(groupId);

      return Logger.createSuccess({
        sourceGroupId: groupId,
        createdGroups: result.groups,
        totalCreated: result.created
      }, `Successfully created ${result.created} subgroups by date`);
    } catch (error) {
      Logger.logError('auto_group_by_date', error);
      const errMsg = error instanceof Error ? error.message : String(error);

      if (errMsg.includes('does not exist')) {
        return Logger.createError(ErrorType.NOT_FOUND, errMsg);
      }
      if (errMsg.includes('empty')) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, errMsg);
      }
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to auto-group by date: ${errMsg}`);
    }
  }

  /**
   * Create a new group and populate it by scanning the workspace with a glob pattern.
   *
   * This tool eliminates the need for the AI to:
   *   1. Call explore_project to collect file paths
   *   2. Manually assemble a large files[] array
   *   3. Call create_group / add_files_to_group
   *
   * All heavy lifting (glob scan, path conversion, group creation, file insertion)
   * is performed server-side, so the AI only needs to specify the intent.
   */
  async createGroupByPattern(args: {
    groupName: string;
    pattern: string;
    ignorePattern?: string;
    color?: string;
    parentGroupId?: string;
  }): Promise<ToolResponse<{
    groupId: string;
    groupName: string;
    addedFiles: number;
    skippedFiles: number;
    invalidFiles: number;
    matchedFiles: string[];
    warning?: string;
  }>> {
    try {
      const { groupName, pattern, ignorePattern, color, parentGroupId } = args;

      if (!groupName?.trim()) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'groupName is required and cannot be empty');
      }
      if (!pattern?.trim()) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'pattern is required (e.g. "**/*.md")');
      }

      // Validate parentGroupId if provided
      if (parentGroupId) {
        const { groups } = this.groupManager.loadGroups();
        if (!groups.find(g => g.id === parentGroupId)) {
          return Logger.createError(ErrorType.NOT_FOUND, `Parent group ID not found: ${parentGroupId}`);
        }
      }

      // Check for duplicate group name
      const { groups: existingGroups } = this.groupManager.loadGroups();
      if (existingGroups.find(g => g.name === groupName)) {
        return Logger.createError(
          ErrorType.VALIDATION_ERROR,
          `A group named "${groupName}" already exists. Use a different name or rename the existing group first.`
        );
      }

      // Step 1: Scan workspace with the provided pattern (no maxResults cap)
      const scanResult = await this.projectExplorer.exploreProject({
        pattern,
        maxResults: 99999,
      });

      let matchedFiles = scanResult.files;

      // Step 2: Apply ignore pattern if provided
      if (ignorePattern?.trim()) {
        const ignoreResult = await this.projectExplorer.exploreProject({
          pattern: ignorePattern,
          maxResults: 99999,
        });
        const ignoreSet = new Set(ignoreResult.files);
        matchedFiles = matchedFiles.filter(f => !ignoreSet.has(f));
      }

      if (matchedFiles.length === 0) {
        return Logger.createSuccess(
          {
            groupId: '',
            groupName,
            addedFiles: 0,
            skippedFiles: 0,
            invalidFiles: 0,
            matchedFiles: [],
            warning: `No files matched the pattern "${pattern}". Group was NOT created.`,
          },
          `No files matched — group "${groupName}" was not created.`
        );
      }

      // Step 3: Convert absolute paths to workspace-relative paths
      const relativePaths = matchedFiles.map(f => this.fileManager.toRelativePath(f));

      // Step 4: Create the group
      const newGroup: TempGroup = {
        id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        name: groupName,
        files: [],
        ...(parentGroupId ? { parentGroupId } : {}),
        ...(color ? { color } : {}),
      };

      const { groups: currentGroups, version } = this.groupManager.loadGroups();
      this.groupManager.saveGroups([...currentGroups, newGroup], version);

      // Step 5: Add files in bulk using FileManager
      const addResult = this.fileManager.addFilesToGroup(newGroup.id, relativePaths);

      const warningParts: string[] = [];
      if (addResult.invalid.length > 0) {
        warningParts.push(`${addResult.invalid.length} path(s) outside workspace were skipped`);
      }
      if (scanResult.truncated) {
        warningParts.push('scan results were truncated at 99999 — some files may be missing');
      }

      return Logger.createSuccess(
        {
          groupId: newGroup.id,
          groupName,
          addedFiles: addResult.added.length,
          skippedFiles: addResult.skipped.length,
          invalidFiles: addResult.invalid.length,
          matchedFiles: addResult.added,
          ...(warningParts.length > 0 ? { warning: warningParts.join('; ') } : {}),
        },
        `Group "${groupName}" created with ${addResult.added.length} file(s) (pattern: "${pattern}")`
      );
    } catch (error) {
      Logger.logError('create_group_by_pattern', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to create group by pattern: ${errMsg}`);
    }
  }

  /**
   * Remove files from a group that match a glob pattern.
   *
   * Useful when you want to remove many files from a group without listing them manually.
   * The server scans the group's existing files and removes those whose paths match the pattern.
   */
  async removeFilesByPattern(args: {
    groupId: string;
    pattern: string;
  }): Promise<ToolResponse<{
    groupId: string;
    removedFiles: number;
    notFoundFiles: number;
    removedList: string[];
  }>> {
    try {
      const { groupId, pattern } = args;

      if (!groupId?.trim()) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'groupId is required');
      }
      if (!pattern?.trim()) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'pattern is required (e.g. "**/*.test.ts")');
      }

      // Load group and check existence
      const { groups } = this.groupManager.loadGroups();
      const group = groups.find(g => g.id === groupId);
      if (!group) {
        return Logger.createError(ErrorType.NOT_FOUND, `Group ID not found: ${groupId}`);
      }

      if (!group.files || group.files.length === 0) {
        return Logger.createSuccess(
          { groupId, removedFiles: 0, notFoundFiles: 0, removedList: [] },
          `Group "${group.name}" is empty — nothing to remove.`
        );
      }

      // Scan workspace to find files matching the pattern
      const scanResult = await this.projectExplorer.exploreProject({
        pattern,
        maxResults: 99999,
      });
      const matchedAbsoluteSet = new Set(scanResult.files);

      // Find group members whose absolute paths appear in the matched set
      const toRemoveRelative: string[] = [];
      for (const fileUri of group.files) {
        const absolutePath = this.fileManager.toAbsolutePath(
          this.fileManager.fromFileUri(fileUri)
        );
        if (matchedAbsoluteSet.has(absolutePath)) {
          toRemoveRelative.push(this.fileManager.toRelativePath(absolutePath));
        }
      }

      if (toRemoveRelative.length === 0) {
        return Logger.createSuccess(
          { groupId, removedFiles: 0, notFoundFiles: 0, removedList: [] },
          `No files in group "${group.name}" matched pattern "${pattern}".`
        );
      }

      // Remove matched files
      const removeResult = this.fileManager.removeFilesFromGroup(groupId, toRemoveRelative);

      return Logger.createSuccess(
        {
          groupId,
          removedFiles: removeResult.removed.length,
          notFoundFiles: removeResult.notFound.length,
          removedList: removeResult.removed,
        },
        `Removed ${removeResult.removed.length} file(s) from group "${group.name}" (pattern: "${pattern}")`
      );
    } catch (error) {
      Logger.logError('remove_files_by_pattern', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to remove files by pattern: ${errMsg}`);
    }
  }
}

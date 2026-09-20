import { GroupManager, OptimisticLockError } from '../managers/GroupManager.js';
import { FileManager } from '../managers/FileManager.js';
import { ErrorType, TempGroup, GroupSummary, ToolResponse } from '../types.js';
import { Logger } from '../utils/Logger.js';
import { normalizeFilesParam } from '../utils/normalizeParams.js';

/**
 * Group operation tools
 */
export class GroupTools {
  constructor(
    private groupManager: GroupManager,
    private fileManager: FileManager
  ) {}

  /**
   * Optimistic lock retry wrapper.
   * Retries up to 3 times on OptimisticLockError.
   */
  private withRetry<T>(fn: () => T): T {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return fn();
      } catch (e) {
        if (e instanceof OptimisticLockError && attempt < 3) continue;
        throw e;
      }
    }
    throw new Error('Config change conflict — still failing after 3 retries');
  }

  /**
   * List summary information for all groups
   */
  async listGroups(): Promise<ToolResponse<{ groups: GroupSummary[], totalFiles: number, totalGroups: number }>> {
    try {
      const { groups } = this.groupManager.loadGroups();
      
      let totalFiles = 0;
      const totalGroups = groups.length;
      
      groups.forEach(g => {
        if (g.files) {
          totalFiles += g.files.length;
        }
      });
      
      const summaries = this.buildGroupHierarchy(groups);
      
      return Logger.createSuccess({
        groups: summaries,
        totalFiles,
        totalGroups
      });
    } catch (error) {
      Logger.logError('list_groups', error);
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to list groups: ${error}`);
    }
  }

  private buildGroupHierarchy(groups: TempGroup[]): GroupSummary[] {
    const summaryMap = new Map<string, GroupSummary>();
    
    // Build summary for all nodes
    groups.forEach(g => {
      summaryMap.set(g.id, {
        id: g.id,
        name: g.name,
        fileCount: g.files ? g.files.length : 0,
        isSubGroup: !!g.parentGroupId,
        parentGroupId: g.parentGroupId,
        children: []
      });
    });
    
    // Build hierarchy
    const rootGroups: GroupSummary[] = [];
    
    summaryMap.forEach(summary => {
      if (summary.parentGroupId && summaryMap.has(summary.parentGroupId)) {
        const parent = summaryMap.get(summary.parentGroupId)!;
        parent.children!.push(summary);
      } else {
        rootGroups.push(summary);
      }
    });
    
    return rootGroups;
  }

  /**
   * Create a new group
   */
  async createGroup(args: { name: string, parentGroupId?: string, files?: string[] | string }): Promise<ToolResponse<{ group: TempGroup, addedFiles?: number, warning?: string }>> {
    try {
      let { name, parentGroupId } = args;
      // Compatible with MCP clients that send files as a string (try JSON.parse or wrap in a single-element array)
      const filesArray = normalizeFilesParam(args.files);
      
      if (!name?.trim()) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'Group name must not be empty', 'Please provide the name parameter');
      }
      
      let newGroupId: string;
      
      this.withRetry(() => {
        const { groups, version } = this.groupManager.loadGroups();
        
        if (parentGroupId && !groups.find(g => g.id === parentGroupId)) {
          throw Object.assign(new Error(`Parent group ID not found: ${parentGroupId}`), { code: 'NOT_FOUND' });
        }
        
        const newGroup: TempGroup = {
          id: `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
          name,
          parentGroupId,
          files: []
        };
        newGroupId = newGroup.id;
        
        this.groupManager.saveGroups([...groups, newGroup], version);
      });
      
      let addedFilesCount = 0;
      let warningMsg: string | undefined;
      
      if (filesArray && filesArray.length > 0) {
        try {
          const addResult = this.fileManager.addFilesToGroup(newGroupId!, filesArray);
          addedFilesCount = addResult.added.length;
          if (addResult.invalid.length > 0) {
            warningMsg = `Some paths are invalid: ${addResult.invalid.join(', ')}`;
          }
        } catch (fileErr) {
          warningMsg = `Error adding files: ${fileErr}`;
        }
      }
      
      const finalGroup = this.groupManager.findGroupById(newGroupId!) || { id: newGroupId!, name, parentGroupId, files: [] };
      
      return Logger.createSuccess({
        group: finalGroup,
        ...(addedFilesCount > 0 ? { addedFiles: addedFilesCount } : {}),
        ...(warningMsg ? { warning: warningMsg } : {})
      }, `Group "${name}" created successfully`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'NOT_FOUND') {
        return Logger.createError(ErrorType.NOT_FOUND, error instanceof Error ? error.message : String(error));
      }
      Logger.logError('create_group', error);
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to create group: ${error}`);
    }
  }

  /**
   * Rename a group
   */
  async renameGroup(args: { groupId: string, newName: string }): Promise<ToolResponse<{ group: TempGroup }>> {
    try {
      const { groupId, newName } = args;
      
      if (!groupId || !newName?.trim()) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'groupId and newName are required parameters');
      }
      
      let renamedGroup: TempGroup;
      
      this.withRetry(() => {
        const { groups, version } = this.groupManager.loadGroups();
        const idx = groups.findIndex(g => g.id === groupId);
        if (idx === -1) throw Object.assign(new Error(`Group ID not found: ${groupId}`), { code: 'NOT_FOUND' });
        
        groups[idx] = { ...groups[idx], name: newName };
        renamedGroup = groups[idx];
        this.groupManager.saveGroups(groups, version);
      });
      
      return Logger.createSuccess({ group: renamedGroup! }, `Group renamed to "${newName}"`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'NOT_FOUND') {
        return Logger.createError(ErrorType.NOT_FOUND, error instanceof Error ? error.message : String(error));
      }
      Logger.logError('rename_group', error);
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to rename group: ${error}`);
    }
  }

  /**
   * Reorder groups
   */
  async moveGroup(args: { groupId: string, direction: 'up' | 'down' }): Promise<ToolResponse<{ group: TempGroup, message: string }>> {
    try {
      const { groupId, direction } = args;
      
      if (!groupId || !['up', 'down'].includes(direction)) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'groupId is required, and direction must be up or down');
      }
      
      let movedGroup: TempGroup;
      let message: string;
      
      this.withRetry(() => {
        const { groups, version } = this.groupManager.loadGroups();
        const groupIndex = groups.findIndex(g => g.id === groupId);
        if (groupIndex === -1) throw Object.assign(new Error(`Group ID not found: ${groupId}`), { code: 'NOT_FOUND' });
        
        movedGroup = groups[groupIndex];
        const parentGroupId = movedGroup.parentGroupId;
        const siblingsIndices = groups
          .map((g, i) => ({ g, i }))
          .filter(item => item.g.parentGroupId === parentGroupId)
          .map(item => item.i);
        const siblingPos = siblingsIndices.indexOf(groupIndex);
        
        if (direction === 'up' && siblingPos <= 0) {
          message = 'Group is already at the top';
          return;
        }
        if (direction === 'down' && siblingPos >= siblingsIndices.length - 1) {
          message = 'Group is already at the bottom';
          return;
        }
        
        const swapIndex = direction === 'up'
          ? siblingsIndices[siblingPos - 1]
          : siblingsIndices[siblingPos + 1];
        [groups[swapIndex], groups[groupIndex]] = [groups[groupIndex], groups[swapIndex]];
        message = `Group moved ${direction}`;
        this.groupManager.saveGroups(groups, version);
      });
      
      return Logger.createSuccess({ group: movedGroup!, message: message! });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'NOT_FOUND') {
        return Logger.createError(ErrorType.NOT_FOUND, error instanceof Error ? error.message : String(error));
      }
      Logger.logError('move_group', error);
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to move group: ${error}`);
    }
  }

  /**
   * Delete a group
   */
  async deleteGroup(args: { groupId: string }): Promise<ToolResponse<{ deletedCount: number, deletedIds: string[] }>> {
    try {
      const { groupId } = args;
      
      if (!groupId) {
        return Logger.createError(ErrorType.VALIDATION_ERROR, 'groupId is a required parameter');
      }
      
      let deletedIdsArray: string[];
      
      this.withRetry(() => {
        let { groups, version } = this.groupManager.loadGroups();
        if (!groups.find(g => g.id === groupId)) {
          throw Object.assign(new Error(`Group ID not found: ${groupId}`), { code: 'NOT_FOUND' });
        }
        
        // Collect IDs to delete (including subgroups)
        const toDelete = new Set<string>([groupId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const g of groups) {
            if (g.parentGroupId && toDelete.has(g.parentGroupId) && !toDelete.has(g.id)) {
              toDelete.add(g.id);
              changed = true;
            }
          }
        }
        
        deletedIdsArray = Array.from(toDelete);
        this.groupManager.saveGroups(groups.filter(g => !toDelete.has(g.id)), version);
      });
      
      return Logger.createSuccess(
        { deletedCount: deletedIdsArray!.length, deletedIds: deletedIdsArray! },
        `Successfully deleted group and its subgroups (${deletedIdsArray!.length} total)`
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'NOT_FOUND') {
        return Logger.createError(ErrorType.NOT_FOUND, error instanceof Error ? error.message : String(error));
      }
      Logger.logError('delete_group', error);
      return Logger.createError(ErrorType.INTERNAL_ERROR, `Failed to delete group: ${error}`);
    }
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { GroupManager } from './GroupManager.js';
import { FileManager } from './FileManager.js';
import { PathUtils } from './PathUtils.js';
import { BookmarkManager } from './BookmarkManager.js';
import { SortCriteria, DateGroup, TempGroup } from '../types.js';

export class AutoGrouper {
  constructor(
    private groupManager: GroupManager,
    private fileManager: FileManager
  ) {}

  // ─── Static date-grouping utilities (single source of truth) ───

  /**
   * Group file URIs by modification date.
   * Uses *project-relative* dates (newest file in the set as reference).
   */
  static groupByModifiedDate(uris: string[]): Map<DateGroup, string[]> {
    const groups = new Map<DateGroup, string[]>();

    const newestTime = AutoGrouper.getNewestFileTime(uris);
    const referenceDate = new Date(newestTime);

    for (const uri of uris) {
      const group = AutoGrouper.getDateBucket(uri, referenceDate);
      if (!groups.has(group)) {
        groups.set(group, []);
      }
      groups.get(group)!.push(uri);
    }

    return groups;
  }

  /**
   * Return a localised label for a DateGroup key.
   * @param group  DateGroup enum value
   * @param i18n   Object with a `getMessage(key)` method (e.g. the I18n singleton)
   */
  static getDateGroupLabel(group: DateGroup, i18n: { getMessage(key: string): string }): string {
    const labels: Record<DateGroup, string> = {
      'today': i18n.getMessage('dateGroup.today'),
      'yesterday': i18n.getMessage('dateGroup.yesterday'),
      'thisWeek': i18n.getMessage('dateGroup.thisWeek'),
      'lastWeek': i18n.getMessage('dateGroup.lastWeek'),
      'thisMonth': i18n.getMessage('dateGroup.thisMonth'),
      'older': i18n.getMessage('dateGroup.older'),
    };
    return labels[group];
  }

  // ─── Private static helpers ───

  private static getNewestFileTime(uris: string[]): number {
    let newest = 0;
    for (const uri of uris) {
      try {
        const stat = fs.statSync(PathUtils.toFsPath(uri));
        if (stat.mtime.getTime() > newest) {
          newest = stat.mtime.getTime();
        }
      } catch {
        // Skip inaccessible files
      }
    }
    return newest || Date.now();
  }

  private static getDateBucket(uri: string, referenceDate: Date): DateGroup {
    try {
      const stat = fs.statSync(PathUtils.toFsPath(uri));
      const fileDate = new Date(stat.mtime);
      const daysDiff = AutoGrouper.getDaysDifference(fileDate, referenceDate);

      if (daysDiff === 0) return 'today';
      if (daysDiff === 1) return 'yesterday';
      if (daysDiff <= 7) return 'thisWeek';
      if (daysDiff <= 14) return 'lastWeek';
      if (daysDiff <= 30) return 'thisMonth';
      return 'older';
    } catch {
      return 'older';
    }
  }

  private static getDaysDifference(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    const d1 = new Date(date1.getFullYear(), date1.getMonth(), date1.getDate());
    const d2 = new Date(date2.getFullYear(), date2.getMonth(), date2.getDate());
    // Round rather than floor: local midnights that straddle a DST transition
    // are 23h or 25h apart, so flooring would put "yesterday" into "today".
    return Math.round(Math.abs(d2.getTime() - d1.getTime()) / oneDay);
  }

  /**
   * Move each file's bookmarks from the source group to the newly created
   * sub-group, mirroring the same-file-move logic in dragAndDrop.ts.
   * Without this, bookmarks are orphaned on the (now empty) source group
   * and become unreachable from the UI.
   *
   * Looks up the stored bookmark key via BookmarkManager.findBookmarkKey
   * rather than an exact match on fileUri, since the stored key can differ
   * in encoding/casing from the group's `files` entries (see dragAndDrop.ts).
   */
  static moveBookmarks(sourceGroup: TempGroup, targetGroup: TempGroup, fileUris: string[]): void {
    if (!sourceGroup.bookmarks) return;

    for (const fileUri of fileUris) {
      const bookmarkKey = BookmarkManager.findBookmarkKey(sourceGroup, fileUri);
      if (!bookmarkKey || !sourceGroup.bookmarks[bookmarkKey]) continue;

      if (!targetGroup.bookmarks) {
        targetGroup.bookmarks = {};
      }
      targetGroup.bookmarks[bookmarkKey] = sourceGroup.bookmarks[bookmarkKey];
      delete sourceGroup.bookmarks[bookmarkKey];
    }

    if (Object.keys(sourceGroup.bookmarks).length === 0) {
      delete sourceGroup.bookmarks;
    }
  }

  // ─── Instance methods (MCP layer — load/mutate/save) ───

  /**
   * Set the sort criteria for a group
   */
  setGroupSorting(groupId: string, sortBy: SortCriteria, sortOrder: 'asc' | 'desc'): void {
    const { groups, version } = this.groupManager.loadGroups();
    const group = groups.find(g => g.id === groupId);

    if (!group) {
      throw new Error(`Group ID "${groupId}" does not exist`);
    }

    group.sortBy = sortBy;
    group.sortOrder = sortOrder;
    this.groupManager.saveGroups(groups, version);
  }

  /**
   * Auto-create subgroups by file extension
   */
  groupByExtension(groupId: string): { created: number; groups: { id: string; name: string; extension: string; fileCount: number }[] } {
    const { groups, version } = this.groupManager.loadGroups();
    const sourceGroup = groups.find(g => g.id === groupId);

    if (!sourceGroup) {
      throw new Error(`Group ID "${groupId}" does not exist`);
    }

    if (!sourceGroup.files || sourceGroup.files.length === 0) {
      throw new Error('Group is empty — cannot auto-group');
    }

    const filesByExt: Record<string, string[]> = {};
    for (const fileUri of sourceGroup.files) {
      const filePath = this.fileManager.fromFileUri(fileUri);
      let ext = path.extname(filePath).toLowerCase();
      if (!ext) ext = 'no-extension';

      if (!filesByExt[ext]) {
        filesByExt[ext] = [];
      }
      filesByExt[ext].push(fileUri);
    }

    const createdGroups = [];
    const now = Date.now();
    let counter = 0;

    for (const [ext, uriList] of Object.entries(filesByExt)) {
      const newGroup: TempGroup = {
        id: `auto_ext_${now}_${counter++}`,
        name: `Extension: ${ext}`,
        files: uriList,
        parentGroupId: groupId,
        auto: true,
        autoGroupType: 'extension',
        sourceGroupId: groupId
      };

      AutoGrouper.moveBookmarks(sourceGroup, newGroup, uriList);

      groups.push(newGroup);
      createdGroups.push({
        id: newGroup.id,
        name: newGroup.name,
        extension: ext,
        fileCount: uriList.length
      });
    }

    sourceGroup.groupBy = 'extension';
    sourceGroup.files = [];

    this.groupManager.saveGroups(groups, version);

    return {
      created: createdGroups.length,
      groups: createdGroups
    };
  }

  /**
   * Auto-create subgroups by modification date (MCP layer).
   * Uses the same 6-bucket logic as the VS Code layer via the static method.
   */
  groupByDate(groupId: string): { created: number; groups: { id: string; name: string; dateGroup: string; fileCount: number }[] } {
    const { groups, version } = this.groupManager.loadGroups();
    const sourceGroup = groups.find(g => g.id === groupId);

    if (!sourceGroup) {
      throw new Error(`Group ID "${groupId}" does not exist`);
    }

    if (!sourceGroup.files || sourceGroup.files.length === 0) {
      throw new Error('Group is empty — cannot auto-group');
    }

    // Use unified static bucketing
    const dateGroups = AutoGrouper.groupByModifiedDate(sourceGroup.files);

    const createdGroups = [];
    const timestamp = Date.now();
    let counter = 0;
    const dateOrder: DateGroup[] = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'thisMonth', 'older'];

    for (const dateSlot of dateOrder) {
      const uriList = dateGroups.get(dateSlot);
      if (!uriList || uriList.length === 0) continue;

      const newGroup: TempGroup = {
        id: `auto_date_${timestamp}_${counter++}`,
        name: dateSlot,
        files: uriList,
        parentGroupId: groupId,
        auto: true,
        autoGroupType: 'modifiedDate',
        sourceGroupId: groupId
      };

      AutoGrouper.moveBookmarks(sourceGroup, newGroup, uriList);

      groups.push(newGroup);
      createdGroups.push({
        id: newGroup.id,
        name: newGroup.name,
        dateGroup: dateSlot,
        fileCount: uriList.length
      });
    }

    sourceGroup.groupBy = 'modifiedDate';
    sourceGroup.files = [];
    this.groupManager.saveGroups(groups, version);

    return {
      created: createdGroups.length,
      groups: createdGroups
    };
  }
}

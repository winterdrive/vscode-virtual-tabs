import { GroupManager } from './GroupManager.js';
import { FileManager } from './FileManager.js';
import { VTBookmark, BookmarkInfo, TempGroup } from '../types.js';
import { PathUtils } from './PathUtils.js';
import { matchesStoredFileEntry } from './FileEntryMatcher.js';

/**
 * BookmarkManager
 *
 * Instance methods  → MCP layer (stateless disk I/O per operation)
 * Static methods    → VS Code layer (in-memory TempGroup mutation)
 */
export class BookmarkManager {
  constructor(
    private groupManager: GroupManager,
    private fileManager: FileManager
  ) {}

  // ─── Static utility methods (single source of truth) ───

  /** Generate a unique bookmark ID */
  private static generateId(): string {
    return `bm-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Create a bookmark data object (in-memory only, does NOT persist).
   */
  static createBookmarkObject(
    line: number,
    label: string,
    character?: number,
    description?: string
  ): VTBookmark {
    return {
      id: BookmarkManager.generateId(),
      line,
      character,
      label,
      description,
      created: Date.now()
    };
  }

  /** Add a bookmark to a group's in-memory data */
  static addBookmarkToGroup(group: TempGroup, fileUri: string, bookmark: VTBookmark): void {
    if (!group.bookmarks) group.bookmarks = {};
    const bookmarkKey = BookmarkManager.findBookmarkKey(group, fileUri) ?? fileUri;
    if (!group.bookmarks[bookmarkKey]) group.bookmarks[bookmarkKey] = [];
    group.bookmarks[bookmarkKey].push(bookmark);
  }

  /** Return a copy with the label updated */
  static updateLabel(bookmark: VTBookmark, newLabel: string): VTBookmark {
    return { ...bookmark, label: newLabel, modified: Date.now() };
  }

  /** Return a copy with the description updated */
  static updateDescription(bookmark: VTBookmark, newDescription: string | undefined): VTBookmark {
    return { ...bookmark, description: newDescription, modified: Date.now() };
  }

  /** Replace a bookmark in the group's in-memory data. Returns true if found. */
  static updateBookmarkInGroup(
    group: TempGroup,
    fileUri: string,
    bookmarkId: string,
    updatedBookmark: VTBookmark
  ): boolean {
    const bookmarkKey = BookmarkManager.findBookmarkKey(group, fileUri);
    if (!group.bookmarks || !bookmarkKey) return false;
    const entries = group.bookmarks[bookmarkKey];
    if (!Array.isArray(entries)) return false;
    const index = entries.findIndex(b => b.id === bookmarkId);
    if (index === -1) return false;
    entries[index] = updatedBookmark;
    return true;
  }

  /** Remove a bookmark from the group's in-memory data. Returns true if found. */
  static removeBookmarkFromGroup(
    group: TempGroup,
    fileUri: string,
    bookmarkId: string
  ): boolean {
    const bookmarkKey = BookmarkManager.findBookmarkKey(group, fileUri);
    if (!group.bookmarks || !bookmarkKey) return false;
    const entries = group.bookmarks[bookmarkKey];
    if (!Array.isArray(entries)) return false;
    const index = entries.findIndex(b => b.id === bookmarkId);
    if (index === -1) return false;
    entries.splice(index, 1);
    if (entries.length === 0) delete group.bookmarks[bookmarkKey];
    return true;
  }

  /** Get all bookmarks for a file (sorted by line number) */
  static getBookmarksForFile(group: TempGroup, fileUri: string): VTBookmark[] {
    const bookmarkKey = BookmarkManager.findBookmarkKey(group, fileUri);
    if (!group.bookmarks || !bookmarkKey) return [];
    // A hand-edited config may hold a non-array value under a file key;
    // spreading it would throw and break tree rendering for the whole group.
    const entries = group.bookmarks[bookmarkKey];
    if (!Array.isArray(entries)) return [];
    return [...entries].sort((a, b) => a.line - b.line);
  }

  /**
   * Find the actual key used in group.bookmarks for a given file URI, tolerating
   * URI encoding / casing differences (e.g. drag-and-drop payloads vs. stored keys).
   */
  static findBookmarkKey(group: TempGroup, fileUri: string): string | undefined {
    if (!group.bookmarks) return undefined;
    if (group.bookmarks[fileUri]) return fileUri;

    const target = BookmarkManager.normalizeFileKey(fileUri);
    return Object.keys(group.bookmarks).find(key => BookmarkManager.normalizeFileKey(key) === target);
  }

  private static normalizeFileKey(fileUri: string): string {
    try {
      return BookmarkManager.normalizeFsPath(PathUtils.toFsPath(fileUri));
    } catch {
      if (fileUri.startsWith('file://')) {
        try {
          let pathname = decodeURIComponent(new URL(fileUri).pathname);
          pathname = pathname.replace(/^\/([A-Za-z]:)/, '$1');
          return BookmarkManager.normalizeFsPath(pathname);
        } catch {
          // Fall through to raw string normalization below.
        }
      }
      return BookmarkManager.normalizeFsPath(fileUri);
    }
  }

  private static normalizeFsPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  /** Find a bookmark by ID within a single group */
  static findBookmarkInGroup(
    group: TempGroup,
    bookmarkId: string
  ): { bookmark: VTBookmark; fileUri: string } | null {
    if (!group.bookmarks) return null;
    for (const [fileUri, bookmarks] of Object.entries(group.bookmarks)) {
      if (!Array.isArray(bookmarks)) continue;
      const bookmark = bookmarks.find(b => b.id === bookmarkId);
      if (bookmark) return { bookmark, fileUri };
    }
    return null;
  }

  /** Total bookmark count in a group */
  static getTotalBookmarkCount(group: TempGroup): number {
    if (!group.bookmarks) return 0;
    return Object.values(group.bookmarks).reduce((t, bms) => t + (Array.isArray(bms) ? bms.length : 0), 0);
  }

  /** Number of files that have bookmarks in a group */
  static getFilesWithBookmarksCount(group: TempGroup): number {
    if (!group.bookmarks) return 0;
    return Object.keys(group.bookmarks).length;
  }

  // ─── Instance methods (MCP layer — load/mutate/save) ───

  /**
   * Create a bookmark
   */
  createBookmark(
    groupId: string,
    filePath: string,
    line: number,
    label: string,
    description?: string
  ): VTBookmark {
    const { groups, version } = this.groupManager.loadGroups();
    const groupIndex = groups.findIndex(g => g.id === groupId);

    if (groupIndex === -1) {
      throw new Error(`Group ID "${groupId}" does not exist`);
    }

    const group = groups[groupIndex];
    if (!Number.isInteger(line) || line < 0) {
      throw new Error('Line number must be a non-negative integer');
    }
    if (!label || label.trim() === '') {
      throw new Error('Bookmark label must not be empty');
    }

    const fileUri = this.fileManager.toFileUri(filePath);
    const targetFsPath = this.fileManager.toAbsolutePath(filePath);
    const workspaceRoot = this.groupManager.getWorkspaceRoot();
    const fileInGroup = group.files?.some(entry =>
      matchesStoredFileEntry(entry, fileUri, targetFsPath, workspaceRoot)
    );
    if (!fileInGroup) {
      throw new Error(`File is not in group "${group.name}"`);
    }

    const newBookmark = BookmarkManager.createBookmarkObject(line, label, undefined, description);
    BookmarkManager.addBookmarkToGroup(group, fileUri, newBookmark);
    this.groupManager.saveGroups(groups, version);

    return newBookmark;
  }

  /**
   * Delete a bookmark
   */
  deleteBookmark(bookmarkId: string): boolean {
    const { groups, version } = this.groupManager.loadGroups();
    let deleted = false;

    for (const group of groups) {
      if (!group.bookmarks) continue;

      for (const [fileUri, bookmarks] of Object.entries(group.bookmarks)) {
        if (!Array.isArray(bookmarks)) continue;
        const index = bookmarks.findIndex(bm => bm.id === bookmarkId);
        if (index !== -1) {
          bookmarks.splice(index, 1);
          if (bookmarks.length === 0) {
            delete group.bookmarks[fileUri];
          }
          deleted = true;
          break;
        }
      }
      if (deleted) break;
    }

    if (deleted) {
      this.groupManager.saveGroups(groups, version);
    }

    return deleted;
  }

  /**
   * List bookmark information
   */
  listBookmarks(groupId?: string): BookmarkInfo[] {
    const { groups } = this.groupManager.loadGroups();
    const results: BookmarkInfo[] = [];

    const targetGroups = groupId
      ? groups.filter(g => g.id === groupId)
      : groups;

    for (const group of targetGroups) {
      if (!group.bookmarks) continue;

      for (const [fileUri, bookmarks] of Object.entries(group.bookmarks)) {
        if (!Array.isArray(bookmarks)) continue;
        const filePath = this.fileManager.fromFileUri(fileUri);

        for (const bm of bookmarks) {
          results.push({
            id: bm.id,
            groupId: group.id,
            groupName: group.name,
            filePath,
            line: bm.line,
            label: bm.label,
            description: bm.description,
            created: bm.created
          });
        }
      }
    }

    return results;
  }

  /**
   * Find and return bookmark details by ID
   */
  findBookmarkById(bookmarkId: string): { bookmark: VTBookmark; groupId: string; filePath: string } | undefined {
    const { groups } = this.groupManager.loadGroups();

    for (const group of groups) {
      if (!group.bookmarks) continue;

      for (const [fileUri, bookmarks] of Object.entries(group.bookmarks)) {
        if (!Array.isArray(bookmarks)) continue;
        const found = bookmarks.find(bm => bm.id === bookmarkId);
        if (found) {
          return {
            bookmark: found,
            groupId: group.id,
            filePath: this.fileManager.fromFileUri(fileUri)
          };
        }
      }
    }

    return undefined;
  }
}

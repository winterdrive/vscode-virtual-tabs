import { TempGroup, VTFileMeta } from '../types.js';
import { matchesStoredFileEntry } from './FileEntryMatcher.js';
import { PathUtils } from './PathUtils.js';

/**
 * FileMetaManager
 *
 * In-memory helpers for per-group file display metadata (custom label / description).
 * Keyed by file URI like `TempGroup.bookmarks`, so the same "follow the file" rules apply.
 */
export class FileMetaManager {
  /**
   * Find the actual key used in group.fileMeta for a given file URI, tolerating
   * URI encoding / casing differences between the dragged/rendered URI and the stored key.
   */
  static findKey(group: Pick<TempGroup, 'fileMeta'>, fileUri: string, scopeRoot?: string): string | undefined {
    if (!group.fileMeta) return undefined;
    if (group.fileMeta[fileUri]) return fileUri;

    let fsPath: string;
    try {
      fsPath = PathUtils.toFsPath(fileUri);
    } catch {
      return undefined;
    }
    return Object.keys(group.fileMeta).find(key => matchesStoredFileEntry(key, fileUri, fsPath, scopeRoot));
  }

  static get(group: Pick<TempGroup, 'fileMeta'>, fileUri: string): VTFileMeta | undefined {
    const key = FileMetaManager.findKey(group, fileUri);
    return key ? group.fileMeta![key] : undefined;
  }

  /**
   * Merge a patch into a file's metadata. A blank (empty / whitespace-only) or
   * `undefined`-valued field clears that field; an entry with no fields left is dropped.
   */
  static set(group: TempGroup, fileUri: string, patch: VTFileMeta): void {
    const key = FileMetaManager.findKey(group, fileUri) ?? fileUri;
    const merged: VTFileMeta = { ...group.fileMeta?.[key] };
    for (const field of ['label', 'description'] as const) {
      if (!(field in patch)) continue;
      const value = patch[field]?.trim();
      if (value) merged[field] = value;
      else delete merged[field];
    }

    if (!merged.label && !merged.description) {
      if (group.fileMeta) {
        delete group.fileMeta[key];
        FileMetaManager.dropIfEmpty(group);
      }
      return;
    }
    if (!group.fileMeta) group.fileMeta = {};
    group.fileMeta[key] = merged;
  }

  /** Remove the metadata of the file identified by `uri`/`fsPath` (used when the file leaves the group). */
  static remove(group: Pick<TempGroup, 'fileMeta'>, uri: string, fsPath: string, scopeRoot?: string): void {
    if (!group.fileMeta) return;
    for (const key of Object.keys(group.fileMeta)) {
      if (matchesStoredFileEntry(key, uri, fsPath, scopeRoot)) {
        delete group.fileMeta[key];
      }
    }
    FileMetaManager.dropIfEmpty(group);
  }

  /** Move the metadata of the given files from one group to another. */
  static move(sourceGroup: TempGroup, targetGroup: TempGroup, fileUris: string[]): void {
    if (!sourceGroup.fileMeta) return;
    for (const fileUri of fileUris) {
      const key = FileMetaManager.findKey(sourceGroup, fileUri);
      if (!key) continue;
      if (!targetGroup.fileMeta) targetGroup.fileMeta = {};
      targetGroup.fileMeta[key] = sourceGroup.fileMeta[key];
      delete sourceGroup.fileMeta[key];
    }
    FileMetaManager.dropIfEmpty(sourceGroup);
  }

  /** Deep-enough copy of a group's metadata for duplicating the group. */
  static clone(group: Pick<TempGroup, 'fileMeta'>): Record<string, VTFileMeta> | undefined {
    if (!group.fileMeta) return undefined;
    return Object.fromEntries(Object.entries(group.fileMeta).map(([key, meta]) => [key, { ...meta }]));
  }

  /** Remap every key (used to convert between absolute URIs and stored relative paths). */
  static mapKeys(
    fileMeta: Record<string, VTFileMeta>,
    convert: (key: string) => string
  ): Record<string, VTFileMeta> {
    const result: Record<string, VTFileMeta> = {};
    for (const [key, meta] of Object.entries(fileMeta)) {
      result[convert(key)] = meta;
    }
    return result;
  }

  private static dropIfEmpty(group: Pick<TempGroup, 'fileMeta'>): void {
    if (group.fileMeta && Object.keys(group.fileMeta).length === 0) {
      delete group.fileMeta;
    }
  }
}

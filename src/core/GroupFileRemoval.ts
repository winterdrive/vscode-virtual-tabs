import { TempGroup } from '../types';
import { matchesStoredFileEntry } from './FileEntryMatcher';
import { FileMetaManager } from './FileMetaManager';

export interface FileRemovalTarget {
    uri: string;
    fsPath: string;
}

export function removeStoredFileEntriesFromGroup(
    group: Pick<TempGroup, 'files' | 'bookmarks' | 'fileMeta'>,
    targets: FileRemovalTarget[],
    scopeRoot?: string
): boolean {
    if (!group.files || targets.length === 0) {
        return false;
    }

    const originalLength = group.files.length;
    group.files = group.files.filter(storedEntry =>
        !targets.some(target => matchesStoredFileEntry(storedEntry, target.uri, target.fsPath, scopeRoot))
    );

    if (group.bookmarks) {
        for (const bookmarkKey of Object.keys(group.bookmarks)) {
            const shouldDelete = targets.some(target =>
                matchesStoredFileEntry(bookmarkKey, target.uri, target.fsPath, scopeRoot)
            );
            if (shouldDelete) {
                delete group.bookmarks[bookmarkKey];
            }
        }
        if (Object.keys(group.bookmarks).length === 0) {
            delete group.bookmarks;
        }
    }

    for (const target of targets) {
        FileMetaManager.remove(group, target.uri, target.fsPath, scopeRoot);
    }

    return group.files.length !== originalLength;
}

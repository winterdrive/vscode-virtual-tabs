/**
 * 單元測試：外部拖曳檔案時，FileType 位元遮罩（bitmask）判斷邏輯
 *
 * vscode.FileType 為位元遮罩（bitmask），符號連結（symlink）的檔案/資料夾
 * 會回傳 File|SymbolicLink 或 Directory|SymbolicLink 的組合值。
 * 若使用嚴格相等（===）比對 FileType.File / FileType.Directory，
 * 符號連結會被靜默略過，導致使用者拖入的檔案憑空消失。
 * 本測試驗證改用位元運算（&）後，符號連結能被正確辨識，
 * 並驗證遞迴深度上限可防止自我參照符號連結造成無窮遞迴。
 */

// ─── 模擬 vscode.FileType 位元遮罩 ──────────────────────────────────────────

const FileType = {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64
};

const MAX_RECURSIVE_DROP_DEPTH = 50;

interface FakeEntry {
    name: string;
    type: number;
    children?: FakeEntry[];
}

/**
 * 模擬 getFilesInDirectoryRecursive 修正後的核心判斷邏輯：
 * 使用位元運算辨識 File / Directory，並以深度上限防止符號連結循環造成的無窮遞迴。
 */
function getFilesRecursive(entries: FakeEntry[], parentPath = '', depth = 0): string[] {
    if (depth >= MAX_RECURSIVE_DROP_DEPTH) {
        return [];
    }

    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

        if ((entry.type & FileType.Directory) !== 0) {
            if (entry.name.startsWith('.')) {
                continue;
            }
            if (entry.children) {
                const subFiles = getFilesRecursive(entry.children, fullPath, depth + 1);
                files.push(...subFiles);
            }
        } else if ((entry.type & FileType.File) !== 0) {
            files.push(fullPath);
        }
    }

    return files;
}

// ─── 測試 ─────────────────────────────────────────────────────────────────────

describe('外部拖曳檔案時符號連結（symlink）的 FileType 判斷', () => {
    test('symlink 指向的檔案（File|SymbolicLink）應被視為檔案', () => {
        const entries: FakeEntry[] = [
            { name: 'linked-file.ts', type: FileType.File | FileType.SymbolicLink }
        ];

        const result = getFilesRecursive(entries);
        expect(result).toContain('linked-file.ts');
    });

    test('symlink 指向的資料夾（Directory|SymbolicLink）應被視為資料夾並遞迴展開', () => {
        const entries: FakeEntry[] = [
            {
                name: 'linked-dir',
                type: FileType.Directory | FileType.SymbolicLink,
                children: [{ name: 'inner.ts', type: FileType.File }]
            }
        ];

        const result = getFilesRecursive(entries);
        expect(result).toEqual(['linked-dir/inner.ts']);
    });

    test('一般檔案與資料夾（無 SymbolicLink 位元）行為維持不變', () => {
        const entries: FakeEntry[] = [
            { name: 'plain.ts', type: FileType.File },
            { name: 'src', type: FileType.Directory, children: [{ name: 'index.ts', type: FileType.File }] }
        ];

        const result = getFilesRecursive(entries);
        expect(result).toEqual(['plain.ts', 'src/index.ts']);
    });

    test('自我參照的符號連結資料夾不應造成無窮遞迴（受深度上限保護）', () => {
        const cyclicDir: FakeEntry = { name: 'self-link', type: FileType.Directory | FileType.SymbolicLink };
        cyclicDir.children = [cyclicDir];

        // Should terminate (not stack-overflow / hang) once MAX_RECURSIVE_DROP_DEPTH is hit.
        expect(() => getFilesRecursive([cyclicDir])).not.toThrow();
        expect(getFilesRecursive([cyclicDir])).toEqual([]);
    });
});

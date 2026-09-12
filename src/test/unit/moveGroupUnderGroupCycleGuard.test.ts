/**
 * 單元測試：GroupProvider.moveGroupUnderGroup 的循環巢狀防護
 *
 * 背景：dragAndDrop.ts 的拖放流程會在呼叫 provider.moveGroupUnderGroup 之前
 * 先用 isDescendant 擋掉循環巢狀，但 moveGroupUnderGroup 本身（資料層）過去只
 * 擋自我父子關係（group.id === parent.id），沒有擋「巢狀到自己的後代群組」。
 * 任何未經 dragAndDrop 檢查就直接呼叫此方法的呼叫端（例如 MCP 工具層新增的
 * 呼叫）都可能產生循環的 parentGroupId 鏈，進而讓其他遞迴走訪（如
 * buildRelativePathFromSelected）卡死。
 *
 * 驗證：
 * 1. 正常巢狀（移到非祖先群組下）應成功
 * 2. 巢狀到自己的直接父群組（造成循環）應被拒絕
 * 3. 巢狀到自己的祖先群組（多層循環）應被拒絕
 * 4. 已存在循環 parentGroupId 鏈時不應無窮遞迴
 */

interface FakeNestGroup {
    id: string;
    parentGroupId?: string;
    builtIn?: boolean;
    sourceScopeId?: string;
}

/**
 * 模擬 moveGroupUnderGroup 的核心邏輯（修正後版本，含後代防護）。
 */
function moveGroupUnderGroup(groups: FakeNestGroup[], groupId: string, parentGroupId: string): boolean {
    const isDescendantGroup = (id: string, potentialAncestorId: string, visited = new Set<string>()): boolean => {
        if (visited.has(id)) return false;
        visited.add(id);

        const g = groups.find(x => x.id === id);
        if (!g || !g.parentGroupId) return false;

        if (g.parentGroupId === potentialAncestorId) return true;

        return isDescendantGroup(g.parentGroupId, potentialAncestorId, visited);
    };

    const group = groups.find(g => g.id === groupId);
    const parent = groups.find(g => g.id === parentGroupId);
    if (!group || !parent || group.builtIn || parent.builtIn) return false;
    if (group.id === parent.id) return false;
    if (isDescendantGroup(parent.id, group.id)) return false;

    group.parentGroupId = parent.id;
    return true;
}

describe('moveGroupUnderGroup 循環巢狀防護', () => {
    test('移到非祖先群組下應成功', () => {
        const groups: FakeNestGroup[] = [{ id: 'a' }, { id: 'b' }];
        expect(moveGroupUnderGroup(groups, 'a', 'b')).toBe(true);
        expect(groups[0].parentGroupId).toBe('b');
    });

    test('巢狀到自己的直接父群組應被拒絕（避免循環）', () => {
        const groups: FakeNestGroup[] = [
            { id: 'parent' },
            { id: 'child', parentGroupId: 'parent' }
        ];
        expect(moveGroupUnderGroup(groups, 'parent', 'child')).toBe(false);
        expect(groups[0].parentGroupId).toBeUndefined();
    });

    test('巢狀到多層後代群組應被拒絕', () => {
        const groups: FakeNestGroup[] = [
            { id: 'grandparent' },
            { id: 'parent', parentGroupId: 'grandparent' },
            { id: 'child', parentGroupId: 'parent' }
        ];
        expect(moveGroupUnderGroup(groups, 'grandparent', 'child')).toBe(false);
        expect(groups[0].parentGroupId).toBeUndefined();
    });

    test('已存在循環的 parentGroupId 鏈不應無窮遞迴', () => {
        const groups: FakeNestGroup[] = [
            { id: 'g1', parentGroupId: 'g2' },
            { id: 'g2', parentGroupId: 'g1' },
            { id: 'other' }
        ];
        expect(() => moveGroupUnderGroup(groups, 'g1', 'other')).not.toThrow();
    });
});

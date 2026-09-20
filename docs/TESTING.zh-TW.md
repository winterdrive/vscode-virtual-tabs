# 測試指南（VirtualTabs）

<!-- Translation of ./TESTING.md. The English source is canonical; update it first, then sync this file. -->

繁體中文 | [English](./TESTING.md)

這是本儲存庫 **v0.13.0 pre-release 發版列車**自動化測試套件目前維護中的權威參考文件。目前根目錄基準為 **38 個套件／250 個測試**（34 個單元測試套件與 4 個屬性測試套件）。如果您發現有較舊的本地筆記描述特定過往議題的手動測試檢查清單，那些都不能反映目前實際的測試套件——請勿用來判斷目前的行為或覆蓋率。

若您新增、重新命名或移除測試檔案，請在同一個 PR 中一併更新本文件。

## 執行測試

| 腳本 | 指令 | 涵蓋範圍 |
|---|---|---|
| 根目錄單元測試 + 屬性測試 | `npm test` | 先執行 `tsc -p ./`，再對 `**/src/test/**/*.test.ts`（排除 `src/test/ui/`）執行 `jest --runInBand` —— 這個 glob 樣式會在同一次執行中**同時**抓到 `src/test/unit/*.test.ts` 與 `src/test/properties/*.test.ts`，且每個檔案各自模擬（mock）`vscode`，而非透過共用的模擬模組 |
| 覆蓋率 | `npm run test:coverage` | 與 `npm test` 相同，另外加上 `--coverage`；`jest.config.js` 只針對 `FileEntryMatcher.ts`、`GroupFileRemoval.ts`、`GroupFileTargets.ts` 追蹤覆蓋率，門檻為 90/80/90/90（陳述式/分支/函式/行數）——並非整個儲存庫的覆蓋率 |
| 僅執行屬性測試 | `npm run test:properties` | 同一組 Jest 執行，篩選只跑 `src/test/properties` —— 適合只想反覆調整 fast-check 產生器時使用 |
| UI/E2E 設置 | `npm run test:ui:setup` | 執行 `extest setup-tests` —— 下載／準備供所有 `test:ui*` 腳本使用的 VS Code + ChromeDriver 執行個體，但不會實際執行任何測試 |
| 主要 UI/E2E 套件 | `npm run test:ui` | 先以 `tsconfig.test.ui.json` 編譯 UI 測試，再對 `out/test/ui/**/*.test.js` 執行 `extest setup-and-run`，開啟 `test-resources/multi-root/virtual-tabs.code-workspace`，並固定使用 VS Code `1.96.0` |
| 展示錄製 | `npm run test:ui:demo` | **僅**針對 `test-resources/demo-workspace` 執行 `out/test/ui/demo/groupOrganize.demo.js`，並會先寫入產生的 VS Code 設定，以及一份 `test-results/demo-vscode-settings.generated.json` 輸出檔案 —— 詳見下方「Demo script」，這**不是**回歸測試 |
| Self-root E2E 套件 | `npm run test:ui:selfroot` | **僅**針對專屬的 `test-resources/self-root/project.code-workspace` 夾具執行 `out/test/ui/selfRoot/**/*.selfroot.js` —— 之所以與 `test:ui` 分開，是因為它需要一個 *self-root* 工作區（`"folders": [{ "path": "." }]`），這在結構上與其他所有 UI 測試共用開啟的 multi-root 夾具不相容 |

**UI 測試需要一個真實、可見的 VS Code 視窗，且需要數分鐘才能跑完。**
應由人類在自己的機器上執行，而非在沙盒環境中的 AI 代理執行。

三個 `test:ui*` 執行腳本都**沒有**對 `extest` 傳入專案本地的 `-s`/`--storage`
覆寫參數。這是刻意的設計：`vscode-extension-tester` 預設會將下載的 VS Code +
ChromeDriver 二進位檔快取在 `%TEMP%/test-resources` 底下，讓這台機器上每個
基於 `vscode-extension-tester` 的姊妹專案（PromptManager、Edo-Tensei、
editorGrouper/VirtualTabs 本身）共用同一份快取，而不必各自下載自己的一份
約 150MB+ 的 VS Code 1.96.0。若在這裡加上專案專屬的 `-s` 覆寫，會在不知不覺
間讓本儲存庫退出這種共用機制，拖慢日後每一次的首次執行速度。

本儲存庫並沒有獨立的 `mcp-server` 測試套件（不同於 PromptManager 的
`mcp-server/`）——這裡的 `mcp-server/` 純粹只做建置（`tsc`、`esbuild`），
沒有 `src/test/` 目錄。

## 根目錄單元測試（`src/test/unit/`）

| 檔案 | 涵蓋內容 |
|---|---|
| `ConfigScopeDiscovery.test.ts` | `ConfigScopeDiscovery` 的範圍探索（scope-discovery）演算法，涵蓋單一資料夾、multi-root、無工作區，以及 **self-root `.code-workspace`**（工作區檔案的父目錄等於其中一個資料夾）等情境——包括確保 scope id 唯一的 id 碰撞防護機制，避免 `provider.ts` 的 `groupManagers` Map 出現兩個範圍對應到同一個鍵值的情況 |
| `DropUriParser.test.ts` | 解析 `text/uri-list` 拖曳酬載（註解、空白行、CRLF、非字串值），從類似 `DataTransferFile` 的項目中擷取 URI，在保留原始順序的同時去除重複，並將拖曳的檔案格式化為適合聊天輸入的參照格式 |
| `ScopeHeaderItem.test.ts` | `ScopeHeaderItem` 樹狀節點：工作區範圍與資料夾範圍的 label／contextValue、磁碟根目錄資料夾名稱的邊界情況、不可互動（`command === undefined`）時的行為 |
| `addGroupScope.test.ts` | Add Group 的「自動判定 vs. 顯示範圍選擇器」邏輯（issues #17–#19）：當恰好只有一個啟用中的 repo 範圍時會自動選取它；零個、兩個以上，或僅有內建範圍啟用時，則回退為顯示選擇器；`BUILTIN_SCOPE_ID` 不計入「非內建啟用中」的計數 |
| `autoGroupProviderRegression.test.ts` | 驅動**真實**的 `provider.ts` 中 `TempFoldersProvider` 程式碼路徑（而非手動鏡像的複本），測試依副檔名／修改日期自動分組（Auto Group）：書籤會隨檔案一起移動到新的子群組、無副檔名檔案會共用 `no-extension` 群組、來自內建群組的子群組在套用範圍篩選後仍然可見且絕不會被持久化進真實範圍，以及 `resetToDefault(scopeId)` 不會留下重複的內建群組 |
| `autoGroupScopeId.test.ts` | `buildExtAutoGroups`／`buildDateAutoGroups` 會正確從其來源群組繼承 `sourceScopeId`／`sourceGroupId`，包括來源群組沒有 `sourceScopeId` 的情況，並確認非第一個範圍的群組不會被誤存進第一個範圍的設定檔中 |
| `autoGrouperBookmarks.test.ts` | `AutoGrouper.groupByExtension`／`groupByDate` 會將書籤（不只是檔案）一併移動到新的子群組，包括儲存的書籤鍵值與檔案 URI 的 URI 編碼不同的情況，並在來源群組原本沒有書籤時保持其書籤不變 |
| `bookmarkManager.test.ts` | `BookmarkManager` 在查詢用的 URI 序列化結果與儲存鍵值不同時的 URI 比對邏輯、透過正規化比對進行更新／移除、跨群組 `findBookmarkKey` 查詢（用於拖放移動）、針對以工作區相對路徑儲存的 `createBookmark` 測試，以及拒絕非有限值或非整數的行號 |
| `builtInGroupInit.test.ts` | 內建群組的注入條件：修正後的 `!groups.some(g => g.builtIn)` 判斷式，即使使用者群組已經存在也會注入內建群組（不同於舊版有問題的 `groups.length === 0` 判斷式，本檔案也將其列為有記錄的回歸基準一併測試），並確保內建群組永遠排在第一個且不會重複注入 |
| `builtInGroupSyncPersistence.test.ts` | 內建分頁與 editor-group topology 快照會刷新 TreeView 而不重寫設定檔；重複事件會被忽略；scoped create 與 built-in Duplicate 會先呈現 UI，再只 debounce 儲存目標 scope；multi-root Duplicate 會進入 Workspace Config，single-folder 則進入其 folder scope |
| `configReloadNotification.test.ts` | `buildReloadMessage`／`dispatchReloadNotification`：i18n 訊息的備援鏈（fallback chain）、成功時使用 `setStatusBarMessage`（3000ms）而非彈出視窗通知、在內部儲存或重新載入失敗時抑制通知 |
| `copyGroupName.test.ts` | `I18n.stripCopyPostfix`：移除結尾的「copy」後綴（不論是否帶有索引數字）、不符合格式的名稱維持不變，並透過 `getCopyGroupName` 進行往返測試，確保重複複製不會疊加後綴 |
| `dragAndDropHiddenFiles.test.ts` | 拖放資料夾展開時會過濾掉以點號開頭的隱藏資料夾（例如 `.git`），但仍會顯示以點號開頭的隱藏*檔案*（例如 `.gitignore`），並正確跳過隱藏資料夾底下的所有子項目 |
| `dragHandleGroups.test.ts` | `handleDrag` 的群組收集邏輯（內建與自訂群組，包括巢狀子群組、跳過沒有 id 的群組、跨多個被拖曳群組的 URI 去重），以及 `EditorGroupItem` 依 viewColumn 收集／去重檔案的邏輯 |
| `dragIsDescendantCycleGuard.test.ts` | `isDescendant` 針對群組拖放的循環防護機制：直接／多層子系回傳 true、不相關的群組回傳 false，且循環的 `parentGroupId` 鏈與指向自身的群組都會正確終止，而不會無限迴圈 |
| `fileEntryMatcher.test.ts` | `matchesStoredFileEntry` 針對「相對路徑（含／不含 scope root）」、絕對路徑，以及 `file://` URI 等各種儲存路徑格式進行測試，包括字串形式不同但實際指向同一檔案的 URI，以及格式錯誤的 `file://` URI 會回傳 false 而非拋出例外 |
| `fileManagerRelpath.test.ts` | `FileManager.addFilesToGroup`／`removeFilesFromGroup` 能正確辨識並操作以工作區相對路徑儲存的檔案，移除檔案時會同步清除 orphan bookmarks（包括最後一筆書籤移除後的欄位），對於真正不存在的檔案仍會回報 `notFound` |
| `fileSorter.test.ts` | `FileSorter.sortFiles` 針對全部五種排序條件（none／name／path／extension／modified）的測試：「none」時的穩定性與不複製陣列的最佳化、name／path 的遞增／遞減排序且不修改原陣列、extension 排序時無副檔名優先且同副檔名以名稱作為決勝依據、modified 排序在 mtime 查詢失敗時退回 0 |
| `groupAggregation.test.ts` | 跨多個範圍合併群組：總數量正確、每個群組都被注入 `sourceScopeId`、其他欄位維持不變，以及空範圍陣列／空群組的邊界情況 |
| `groupFileRemoval.test.ts` | `removeStoredFileEntriesFromGroup`：當群組沒有檔案或沒有選取目標時不做任何動作，會移除所有被選取的相對路徑檔案，同時保留未比對到的書籤 |
| `groupFileTargets.test.ts` | `groupItemsByGroupIdx`：沒有選取時回傳空 map、選取同一群組時回傳單一群組、跨多個群組時會依插入順序拆分 |
| `groupManagerCacheIsolation.test.ts` | `GroupManager` 的載入快取：修改一次快取未命中（cache-miss）取得的結果，不會污染後續快取命中（cache-hit）的讀取結果，且每次呼叫 `loadGroups()` 都會回傳獨立的複本 |
| `groupManagerNonArrayConfig.test.ts` | 當 `virtualTab.json` 的根節點是物件、純量、`null`，或是損毀檔案的備份本身也失敗時，`GroupManager` 會還原為空陣列的預設值（並嘗試建立備份） |
| `getScopeLabel.test.ts` | Scope label 透過 `scope.label` 使用 VS Code 的 `WorkspaceFolder.name`，涵蓋 multi-root 自訂顯示名稱，以及 `path.basename` 會回傳空值的磁碟根目錄資料夾 |
| `i18nGetMessage.test.ts` | `I18n.getMessage` 的佔位符替換：一般參數、參數中的字面 `$` 不會被當作替換樣式處理、參數中的 `$&`／`$$`／`$1` 樣式不會被展開、多個佔位符會各自獨立替換 |
| `legacyMigration.test.ts` | 將舊版單一值設定 `virtualTabs.activeScope` 遷移至新版 `activeScopes` 陣列：非空的舊值會被包成陣列、只要新鍵存在就優先使用新鍵（即使是空陣列，代表「使用者已清除篩選」也一樣），且兩個鍵都不存在時回傳空值 |
| `projectExplorerMaxResults.test.ts` | `ProjectExplorer.exploreProject` 的 `maxResults` 驗證：負數、零，以及非整數值都會回退為預設值（特別是負數不會從陣列尾端進行切片），有效的正數值仍會正確截斷 |
| `removeFilesFromGroup.test.ts` | 針對重新載入後（以工作區相對路徑儲存）的群組測試 `TempFoldersProvider.removeFilesFromGroup`：單一／多個檔案移除、群組屬於不同資料夾時能正確解析來源範圍根目錄、沒有來源範圍的舊版群組會回退至工作區根目錄、移除檔案時一併移除對應書籤，以及選取內容不符合已儲存項目時不做任何動作 |
| `scopeDescription.test.ts` | `computeScopeDescription`：無篩選（undefined）、僅內建、單一／多個 repo 範圍標籤、「N 個範圍」的計數，以及過期 id 的篩選（不再存在於 `configScopes` 中的 id 不計入計數） |
| `scopeFilterRoot.test.ts` | 套用範圍篩選後的根層級樹狀結構（issues #10–#14）：僅內建、單一 repo 範圍（扁平結構，無 `ScopeHeaderItem`）、單一 repo + 內建、多個 repo 範圍（含 `ScopeHeaderItem`），以及清除篩選後會還原為完整的多範圍檢視 |
| `ScopeHeaderItem.test.ts` | *（見上方）* |
| `selfRootScopeCollisionRegression.test.ts` | **Issue/PR #116** —— 針對一個真實的暫存 self-root 專案目錄，模擬關閉／重新開啟的循環，驅動真實的 `discover()` → `reinitializeScopes()` → `GroupManager` 檔案 I/O → `saveGroupsImmediate()` 管線（搭配最小化模擬的 `vscode`），斷言持久化的群組數量絕不會增加；同時透過一個測試獨立驗證原始根因——證明即使 id 碰撞傳到 `groupManagers`，儲存時群組數量仍會加倍。之所以特別撰寫此測試，是因為 `ConfigScopeDiscovery.test.ts` 只涵蓋探索邏輯的手動鏡像複本，無法捕捉真實持久化路徑中的回歸問題 |
| `sendToLoadTargets.test.ts` | `SendToManager.loadSendTargets` 會清理格式錯誤的目標項目：捨棄缺少 path 或 name 的項目、捨棄 path 陣列為空或非字串的項目、當清單全部格式錯誤時回傳空陣列，並保留有效項目不變 |
| `skillGeneratorBuildSkillBody.test.ts` | 當封裝後的 `SKILL.md` template 缺失時回報可採取行動的錯誤；成功路徑則驗證移除 frontmatter 並代入產生的 script path |
| `sourceScopeId.test.ts` | 用於追蹤群組來源範圍的 `sourceScopeId` 欄位之注入／移除／路由邏輯：注入時不影響其他欄位、移除時會從序列化後的 JSON 中剔除該欄位，路由邏輯則會跳過 `sourceScopeId` 無效或缺失的群組 |

## 基於屬性的測試（`src/test/properties/`）

這些測試會在同一次 `npm test` 執行中一併跑（透過相同的
`**/src/test/**/*.test.ts` glob 樣式比對），使用 `fast-check` 產生器而非
基於範例的測試案例。`npm run test:properties` 只會執行這個子集合。

| 檔案 | 涵蓋內容 |
|---|---|
| `configScope.property.test.ts` | `ConfigScope` 在各種產生的範圍／資料夾組合下的不變性 |
| `discovery.property.test.ts` | `ConfigScopeDiscovery` 在各種產生的工作區資料夾佈局下的不變性（例如 id 唯一性） |
| `pathRouting.property.test.ts` | 路徑路由邏輯在各種產生的相對／絕對／URI 路徑輸入下的不變性 |
| `treeView.property.test.ts` | 樹狀檢視在各種產生的範圍 id 集合下的重建行為，例如修改單一範圍的設定只會重新載入該範圍（對應 `onExternalFileChange(scopeId)` 的行為） |

## UI / E2E 測試（`src/test/ui/`）

主套件中的每個檔案都會透過同一次 `extest setup-and-run` 呼叫，開啟同一個
共用夾具 `test-resources/multi-root/virtual-tabs.code-workspace`（資料夾
`Repo-A` / `Repo-B`）——mocha 會針對這個唯一且已開啟的 VS Code 視窗，依序
執行每個檔案的 `describe` 區塊，且大多數檔案都會在 `before()`／`after()`
中寫入／還原各個 repo 的 `.vscode/virtualTab.json`，確保即使共用同一個
視窗，各套件之間也不會互相洩漏狀態。

大多數檔案都實作了（或引入一份複本）`dismissOnboardingOverlay()` 輔助函式，
用來注入 CSS／移除 VS Code「Welcome」導覽疊層的 DOM 節點——這個疊層在全新
的設定檔（profile）中會攔截點擊事件，否則會讓 Activity Bar／側邊欄互動
變得不穩定或直接失敗。另外有幾個檔案（`contextMenuAvailability`、
`copySubmenu`、`executableFile`）在輪詢虛擬化的 `.monaco-list-row` 樹狀列
時，也會針對 `StaleElementReferenceError` 進行重試，因為 VS Code 在清單
捲動時會回收 DOM 節點。

| 檔案 | 涵蓋內容 |
|---|---|
| `virtualTabs.ui.test.ts` | 基本健全性檢查：Activity Bar 圖示存在、點擊後會開啟側邊欄、側邊欄標題顯示「Virtual Tabs」，以及在 multi-root 工作區中 Add Group 按鈕會被正確隱藏（改為使用各範圍專屬的行內按鈕） |
| `builtInGroup.ui.test.ts` | 內建「目前開啟的檔案」群組的初始化／可見性（手動測試 #5–#7）：即使已有自訂群組也會出現、在空工作區中也會出現、Refresh 後仍然存在，且永遠會渲染在任何 `ScopeHeaderItem` 之前 |
| `multiRootScopes.ui.test.ts` | Multi-root 範圍 UI：每個探索到的專案範圍各自對應一個樹狀區段，底下顯示既有群組；透過範圍標題新增群組時只會持久化到該範圍的設定；以及（issue #56）對 Repo-B 群組執行依副檔名／修改日期自動分組時，其自動群組只會儲存到 Repo-B 的設定中 |
| `scopeFilter.ui.test.ts` | 範圍篩選選擇器 UI（手動測試 #10–#14），透過直接操作 VS Code `canPickMany` QuickPick 的 DOM 達成（因為 `vscode-extension-tester` 對此原生支援有限）：僅內建、單一範圍、範圍+內建、多範圍，以及清除篩選 |
| `configReload.ui.test.ts` | **PR #51** —— 從外部修改 `virtualTab.json` 會在狀態列顯示「Config reloaded」訊息，且*不會*彈出資訊訊息通知 |
| `contextMenuAvailability.ui.test.ts` | 完整的右鍵選單／行內按鈕可用性矩陣（來自 `DEVELOPMENT.md`），涵蓋全部五種項目類型（Custom Group、Built-in Group、File-in-Custom、File-in-Built-in、Bookmark）——每個套件都會在 `before()` 中以「非空」防護收集一次選單，接著斷言所有預期的命令都存在、所有不適用的命令都不存在 |
| `copySubmenu.ui.test.ts` | 「Copy...」子選單的內容（Copy Name / Copy Context for AI / Copy File Name / Copy Relative Path / Copy Absolute Path，以及群組層級的 Copy File Paths），涵蓋相同的五種項目類型 |
| `sortFilesSubmenu.ui.test.ts` | 「Sort Files」子選單的內容（依 Name／Path／Extension／Modified 排序、切換排序方向、清除排序），涵蓋 Custom 與 Built-in 群組 |
| `executableFile.ui.test.ts` | 「Run」行內按鈕只會出現在 `.bat`/`.exe` 類型的可執行檔項目上（custom 與 built-in 群組兩種變體），且對於一般的 `.ts` 檔案會正確地不顯示（回歸防護） |
| `addBookmarkNoDuplicate.ui.test.ts` | 在 Windows 上新增書籤時，即使儲存的檔案 URI 磁碟機代號大小寫與 VS Code 在建立書籤當下回傳的 URI 不同，也不會產生第二個重複的檔案樹項目 |
| `removeSelectedFilesFromGroup.ui.test.ts` | 從群組中移除選取的檔案時，能正確處理重新載入後（以工作區相對路徑儲存）的群組，包括兩個獨立群組都含有相對路徑項目的情況，且不會有跨群組的洩漏 |
| `autoGroupBookmarksAndBuiltIn.ui.test.ts` | 透過手動測試發現的兩個 v0.7.8 回歸問題，以端對端方式重現：（1）**#96** —— 依副檔名自動分組（Auto Group by Extension）過去只會移動檔案，不會移動其書籤，原因是 #81 的修正只動到了 MCP 工具層（`core/AutoGrouper.ts`），從未觸及 `provider.ts` 中真實的樹狀檢視命令路徑；（2）**#99** —— 從內建群組建立的自動子群組，在啟用範圍篩選時會變得不可見，一旦可見後，又會被悄悄持久化到剛好排在第一位的某個真實範圍設定中。之所以刻意撰寫成真正的端對端測試，是因為 #96/#99 當時一併加入的單元測試使用的是手動建構、搭配模擬 `vscode` 模組的 provider 測試工具——而這正是當初讓這兩個錯誤得以上線的那種漏洞類型 |

### `src/test/ui/selfRoot/` —— 專屬的 self-root E2E 套件

`scopeCollision.selfroot.ts` 是針對 **issue/PR #116**（self-root
`.code-workspace` 的 ConfigScope id 碰撞問題，導致使用者每次重新開啟時
`virtualTab.json` 的群組數量都會加倍——實際回報的案例是 41 → 82 筆）的
真實端對端回歸測試。與 `selfRootScopeCollisionRegression.test.ts`（針對
手動模擬的 `vscode` 模組所做的 Jest 測試）不同，這個測試會在一個直接開啟
self-root 工作區的真實 VS Code 執行個體中，啟動真正打包後的擴充套件，
執行觸發該錯誤的確切使用者操作（切換 Virtual Tabs 檢視、點擊 Refresh），
並在三個循環中斷言持久化的群組數量絕不會增加，且樹狀結構絕不會出現重複
的範圍區段。這個套件與對應的單元測試是一起加入的，目的就是為了補齊該
錯誤所暴露出的漏洞，並在當時以「修正前失敗／修正後通過」的方法驗證過。

它採用 `.selfroot.ts` 命名慣例（而非 `.test.ts`），並使用自己專屬的夾具
`test-resources/self-root/project.code-workspace`，原因正是 self-root
工作區佈局無法與共用的 multi-root 夾具共存——因此才會有專屬的
`test:ui:selfroot` 腳本，以及由 `tsconfig.test.ui.json` 編譯出的專屬
`out/test/ui/selfRoot/**/*.selfroot.js` glob 樣式，與 `test:ui` 的其餘
部分完全隔離執行。

### `src/test/ui/demo/` —— 並非測試套件

`groupOrganize.demo.ts`（連同其支援檔案 `demoHelpers.ts`、`recording.ts`、
`write-demo-settings.cjs`）是一份**錄製腳本**，並非回歸測試，儘管它被
結構化成 mocha 的 `describe`／`it` 區塊以便重複使用相同的
`vscode-extension-tester` 驅動管線。執行 `npm run test:ui:demo` 會開啟
一個專屬的 demo-workspace 夾具，設定 zoom／telemetry／walkthrough 等
選項以取得乾淨的錄製畫面，依腳本走過一段「將散落的檔案分組 → 匯出
AI 上下文」的流程，並帶有可見的點擊漣漪提示，最後產生
`test-results/demo-raw.mp4`，用於製作 README／行銷素材。它不會作為
`test:ui` 的一部分執行，也不對正確性做任何有意義的斷言——請勿將這裡的
失敗視為回歸訊號，也不要為它加入真正的覆蓋率斷言。

## 已知限制

- **UI 測試需要一個真實、可見的 VS Code 視窗**，且需要數分鐘才能完成；
  應由人類在自己的機器上執行，而不是在沙盒環境中的 AI 代理。
- **共用的 `%TEMP%/test-resources` extest 快取是刻意設計**，並非疏漏——
  詳見上方「執行測試」。在為任何 `test:ui*` 腳本加上 `-s`/`--storage`
  參數之前，請先確認自己清楚這麼做會讓本儲存庫退出與
  PromptManager/Edo-Tensei 共用快取的機制。
- **`test:ui`、`test:ui:demo` 與 `test:ui:selfroot` 都透過 `extest` 的
  `-c` 參數固定使用 VS Code `1.96.0`**——這與本擴充套件自身的
  `engines.vscode` 相容性下限（`^1.75.0`）無關，後者才是實際出貨給
  使用者的版本。
- **本儲存庫沒有 `mcp-server` 測試套件**——`mcp-server/` 純粹只做建置。
  若日後再次出現像 #96 這類 MCP 工具層的錯誤，請記住
  `autoGroupBookmarksAndBuiltIn.ui.test.ts` 給我們的教訓：修正 MCP
  工具層並不會自動涵蓋 `provider.ts` 中真實的樹狀檢視命令路徑，反之亦然。
- **self-root 的 ConfigScope 碰撞問題（#116）需要真正的 E2E 測試，而不
  只是單元測試**，因為單元層級的回歸測試
  （`selfRootScopeCollisionRegression.test.ts`）是用手動模擬的 `vscode`
  模組來鏡像探索／持久化管線——它對那條特定程式碼路徑而言是很好的回歸
  防護，但無法捕捉 `provider.ts` 串接真實 VS Code API 時未來可能出現的
  *另一種*錯誤。將快速的單元回歸測試與較慢的專屬 E2E 套件搭配用於同一個
  錯誤、並以「修正前失敗／修正後通過」的方式驗證，這個模式值得在未來遇到
  同類碰撞問題時繼續採用。
- **單元測試標題混用繁體中文與英文**，取決於每個檔案撰寫的時間——這是
  歷史因素造成的，新增測試時不需要往哪個方向硬性統一。

# VirtualTabs Release Policy

本文件是 VirtualTabs 發版治理的單一事實來源（SSOT）。規劃或執行任何發版前，
維護者與 AI agent 都必須先確認最新的 `main`、遠端 PR、CI、Marketplace 與
Open VSX 狀態，不得只依賴舊對話、舊報告或本地 branch 推斷目前版本狀態。

## Version Channels

VirtualTabs 以 minor version 的奇偶數決定發佈通道：

- 偶數 minor（例如 `0.14.x`、`0.16.x`）為 stable release。
- 奇數 minor（例如 `0.13.x`、`0.15.x`）為 pre-release。
- stable line 發現緊急問題時，以 patch release（例如 `0.14.1`）修正。
- 下一輪尚在驗證中的變更進入下一個奇數 minor pre-release，成熟後再升下一個
  偶數 minor stable。

實際發佈旗標由 `.github/workflows/publish.yml` 根據 `package.json` 自動判定，
不得手動繞過這項版本規則。

## External Contributor Fast Lane

外部貢獻者提交並已合併的 bug fix，會立即開啟 stable release window。
此處的外部貢獻者，是指 PR 並非由 repository owner、例行維護 automation 或 bot
所提交。

1. 修正可以先經過 pre-release 驗證，但不得長期只停留在 pre-release channel。
2. 若目前 pre-release line 已完成發版驗證，直接升下一個 stable minor。
3. 若目前 pre-release line 尚未成熟，將最小修正 backport 到目前 stable patch line。
4. 不得為了湊 release batch，等待無關的 maintainer-authored routine PR。
5. stable release 的 `CHANGELOG.md` 必須列出 PR number 並明確 credit 貢獻者。
6. Fast Lane 不會取消測試、人工 UI/E2E 或 owner approval；它縮短的是排隊時間，
   不是品質門檻。

### Stable promotion 或 backport

依以下順序決定：

1. 確認目前 stable 與 pre-release 版本，以及外部 PR 的實際相依基底。
2. 若 pre-release 已通過 automated release checks、沒有已知 release blocker，且
   owner 完成發版前人工 UI/E2E，則升下一個 stable minor。
3. 否則，驗證該修正能否以最小差異套用至目前 stable line；可以時發 stable
   patch release。
4. 若 promotion 與 backport 都受阻，必須向 owner 報告具體技術 blocker 與最短
   解法，不得只把修正留在 pre-release 而不建立後續行動。

## Release Train

一般變更依以下流程前進：

1. Candidate PR 各自完成 code review、typecheck、unit/property tests、coverage 與
   VSIX packaging。
2. Candidate PR 不為了搭車自行修改 version；版本與 release CHANGELOG 集中在
   release PR。
3. Release PR 建立後即視為封車。除 release blocker 外，不再臨時加入其他 PR。
4. Release PR body 應列出 Included、Deferred、automated validation、manual
   validation 與 known issues。
5. 外部貢獻者 Fast Lane 的發車時間，不得被未完成的內部候選 PR 延後。

涉及 persistence、migration、multi-root scope routing、group identity 或其他核心
狀態模型的變更，應使用獨立的 pre-release train；不得為了湊版號與低風險修補
混在同一班 stable hotfix。

## Release Gates

### Candidate PR gate

- PR 已更新到足以代表最新 `main` 的基底，且沒有未處理的 merge conflict。
- TypeScript、unit/property tests、coverage 與 VSIX packaging 通過。
- persistence、provider 或 multi-root 變更必須測試 production code path，不得只在
  test file 重新實作一份相同演算法。
- `git diff --check` 乾淨。

### Release PR gate

- `package.json` 與 `package-lock.json` 版本一致。
- `CHANGELOG.md` 列出所有 Included PR；外部貢獻者修正包含 contributor credit。
- `release-ready` label 啟用後，version validation 與其他 required CI 全部通過。
- owner 在本機完成與本次風險相稱的 UI/E2E 與 packaged VSIX smoke test。

真正的 VS Code UI/E2E 是發版前人工 gate，不是每支 PR 的 required remote gate。
`.github/workflows/ui-tests.yml` 僅供經 owner 逐次明確同意後的診斷用途；AI agent
不得自行觸發，也不得把 shared runner 的環境失敗直接判定為產品 regression。

## CHANGELOG Contributor Credit

外部貢獻者的 stable release entry 至少應包含：

- 修正的使用者可見行為。
- PR number。
- GitHub contributor handle。

範例：

```md
- **fix(provider):** prevent persisted built-in groups from duplicating on reload
  ([#149](https://github.com/winterdrive/vscode-virtual-tabs/pull/149),
  thanks [@jianfulin](https://github.com/jianfulin)).
```

## Authorization Boundary

分析、規劃與本機驗證不等於發版授權。建立或更新遠端 PR、加上
`release-ready`、merge release PR、觸發 remote UI workflow、tag 或 publish，皆需
owner 對該次操作的明確授權；先前一次授權不得自動沿用。

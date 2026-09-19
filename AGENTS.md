# Repository Agent Instructions

- 任務報告與規劃文件優先使用繁體中文；保留英文 identifiers、paths 與 commands。
- 回答或修改前，先搜尋 repository 內相近議題、實作與既有決策，不得只依賴對話文字。

## Release Governance

規劃或執行任何 release 前，必須完整閱讀 `docs/RELEASE_POLICY.md`，並重新確認
最新的 `main`、遠端 PR、CI、Marketplace 與 Open VSX 狀態。

- 已合併的 external-contributor bug fix 立即進入 Contributor Fast Lane。
- 此類修正不得長期只停留在 pre-release，也不得為了等待無關的內部 routine PR
  而延後 stable release。
- 若目前 pre-release 已完成發版驗證，升下一個 stable minor；否則將最小修正
  backport 至目前 stable patch line。
- stable `CHANGELOG.md` 必須列出 PR number 並 credit contributor。
- 真正的 UI/E2E 是 owner 在發版前執行的人工 gate，不是一般 PR required gate。
- 未取得 owner 對該次操作的明確授權前，不得建立或修改遠端 release PR、加上
  `release-ready`、merge、觸發 remote UI workflow、tag 或 publish。

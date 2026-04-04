# VirtualTabs – VS Code 虛擬分頁與自定義檔案分組擴充套件

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/winterdrive.virtual-tabs)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/winterdrive.virtual-tabs)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/winterdrive.virtual-tabs?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://winterdrive.github.io/VirtualTabs/llms.txt)

繁體中文 | **[English](readme.md)**

![VirtualTabs - VS Code File Grouping and AI Context Extension](docs/assets/vscode-virtualtabs-grouping-banner.png)

---

## 🚀 什麼是 VirtualTabs？

**VirtualTabs 是一個 VS Code 擴充套件，在原生檔案目錄之外，提供自定義「虛擬檔案目錄」。** 不同於原生目錄，VirtualTabs 幫助您建立 **獨立的邏輯檔案群組**，可依照當前開發主題建立虛擬檔案目錄，同時也提供 **AI 就緒的編程上下文（AI-Ready Context）** 可快速複製。適合 Monorepo 專案或採用 MVVM、MVC 架構的大型專案。

---

### ⚡ VirtualTabs vs. 原生 VS Code 分頁

| 功能特點 | 原生 VS Code 分頁 | VirtualTabs 擴充套件 |
| :--- | :--- | :--- |
| **持久性** | 關閉視窗即清除 | **永久保存** (依工作區記憶) |
| **檔案分組** | 僅限資料夾結構 | **邏輯導向** (支援跨目錄) |
| **AI 上下文** | 需手動一一收集 | **一鍵生成** 給 LLM 的上下文 |

![VirtualTabs 虛擬與實體檔案系統概念圖](docs/assets/virtual_vs_physical_concept.png)

---

### 🧩 解決開發中的痛點

在 MVC/MVVM 或大型專案中，相關聯的檔案往往散布在多個目錄下，切換檔案非常耗時：

```text
❌ 傳統檔案結構：
├── config.json          (根目錄配置)
├── styles/theme.css     (樣式層)
├── src/components/      (元件視圖層)
└── tests/__tests__/     (測試層)

✅ 使用 VirtualTabs 建立的主題目錄：
📁 功能專題：主題系統
  ├── 📁📚 相關配置
  │   └── config.json
  ├── 📁📚 樣式定義
  │   └── theme.css
  ├── 📁📚 元件實作 (View Layer)
  │   └── ThemeProvider.tsx
  │     └── 🔖 第 45 行：Context 初始化邏輯
  └── 📁📚 單元測試 (Testing)
      └── theme.test.ts
```

### 🤖 為 AI 協作而生

在 Copilot 與 ChatGPT 盛行的時代，**「精準的上下文」是得到好結果的關鍵**：

- **精準篩選**：只選取與當前任務 *絕對相關* 的檔案組成群組。
- **一鍵導出**：將整個群組轉換為 AI 友善的 Markdown 格式（v0.3.0）。
- **降低雜訊**：隔離無關代碼，讓 AI 專注於核心邏輯。
- **上下文持久化**：即使重啟專案，開發上下文依然在那裡。

> *「VirtualTabs 讓我能為 AI 圈出最準確的代碼邊界。」*

---

## ✨ 主要功能

### 🛠️ 核心能力

- **📁 跨目錄分組** — 從任何地方組織檔案，突破資料夾限制
- **🔖 任務導向書籤** — 在群組中標記特定程式碼行，快速導航 `(v0.2.0)`
- **📂 子群組與巢狀結構** — 在群組內建立群組，實現更好的層級組織 `(v0.3.0)`
- **🤖 AI 上下文匯出** — 一鍵複製所有檔案為 LLM 就緒的上下文 `(v0.3.0)`
- **▶️ 腳本執行** — `.bat` 與 `.exe` 檔案的 inline 執行按鈕 `(v0.3.2)`
- **💾 便攜設定** — 設定儲存於 `.vscode/virtualTab.json`，方便團隊共享 `(v0.3.2)`
- **🔌 AI Agent 整合 (MCP)** — 讓 AI 代理（Cursor、Copilot、Claude、Kiro、Antigravity）以程序化管理您的群組 `(v0.4.0)`
- **🎯 自動追蹤與同步** — 自動定位作用中檔案並依編輯器分組同步 `(v0.4.5)`
- **❌ 行內關閉按鈕** — 直接從 VirtualTabs 視圖關閉編輯器分頁 `(v0.4.6)`
- **🚀 傳送至...** — 將選取的檔案或整個群組傳送到指定目的地 `(v0.4.8)`
- **⇵ 檔案排序** — 拖放或使用 `Alt+↑/↓` 在自訂群組內重新排列檔案順序 `(v0.4.9)`

### ⚡ 工作流程加速

- **📋 智慧複製選單** — 統一的檔案與群組複製選項 `(v0.3.0)`
- **📁 目錄拖放** — 拖曳資料夾以遞迴加入所有檔案 `(v0.3.0)`
- **✂️ 完整的剪貼簿操作** — 支援檔案與群組的剪下/複製/貼上 `(v0.3.0)`
- **⇵ 群組排序** — 透過右鍵選單輕鬆上下移動群組 `(v0.3.2)`
- **📊 智慧組織** — 依副檔名、修改日期自動分組，或自訂排序準則

---

## ⚡ 最新亮點

**v0.4.9** 引入了自訂群組內的**檔案排序**功能：

- ⇵ **群組內拖放排序** — 在自訂群組內拖曳檔案至新位置即可重新排列。
- ⌨️ **鍵盤快捷鍵** — 使用 `Alt+↑` / `Alt+↓` 上下移動選取的檔案（需先點擊群組名稱使面板獲得焦點）。
- 🖱️ **右鍵選單** — 右鍵任一檔案 → **Move File Up** / **Move File Down**。
- 🔄 **原生單向同步** — 在原生 Open Editors 面板拖曳重排後，VirtualTabs 的內建群組順序也會自動跟著更新。

👉 舊版本發行說明請參閱 [CHANGELOG.md](./CHANGELOG.md)。

---

## 🤖 智慧 AI Agent 整合 (MCP)

VirtualTabs 提供了完整的 AI Agent 整合 — 讓您的 AI 助手透過 **Model Context Protocol** 程序化地管理您的工作區群組：

- 🔌 **MCP Server 整合** — 完整打包的 MCP 伺服器（`dist/mcp/index.js`）隨擴充功能一起提供，包含 15+ 工具供 AI 代理（Cursor, Copilot, Claude, Kiro, Antigravity）建立群組、管理檔案與探索專案。
- 🛡️ **Agent Skill 生成** — 一個指令即可為您的 AI 工具生成專屬技能檔案（Cursor 為 `.mdc`，其餘為 `SKILL.md`）。包含四層安全決策樹，並清楚標示 VirtualTabs 群組為**純虛擬結構** — 磁碟上不會有任何檔案被移動。

  ![安全決策樹](docs/assets/safety_decision_tree_zh.png)
- ⚙️ **MCP 設定面板** — 單擊即可取得適用於各 AI 工具的 MCP 伺服器設定 JSON。
- 📦 **內建 CLI 後備方案** (`vt.bundle.js`) — 當 MCP 工具無法使用時，提供最後手段的獨立 CLI 編輯路徑。

### 在 IDE 中設置 MCP — 各 AI 工具的配置指南

| Cursor | Antigravity (Google) | Kiro |
|:---:|:---:|:---:|
| ![Cursor MCP 設置](docs/assets/mcp_cursor_demo.png) | ![Antigravity MCP 設置](docs/assets/mcp_antigravity_demo.png) | ![Kiro MCP 設置](docs/assets/mcp_kiro_demo.png) |
| 在 Cursor 設定中配置 MCP | 在 Antigravity 環境中配置 MCP | 在 Kiro IDE 中配置 MCP |

> 使用 **MCP 設定面板**（命令：`VirtualTabs: Show MCP Config`）為您選用的 AI 工具生成現成可用的配置代碼。

---

## 🚀 快速開始

### 安裝

1. 開啟 VS Code
2. 按 `Ctrl+Shift+X`（或 `Cmd+Shift+X`）
3. 搜尋 **VirtualTabs** 並點擊安裝

### 首次設定

1. 點擊活動列（左側邊欄）中的 **VirtualTabs** 圖示
2. 在面板中右鍵 → **建立新群組**
3. 將檔案總管中的檔案拖曳到群組中

---

## 📖 使用指南 (User Guide)

### 📁 群組管理

- **建立/重命名**：右鍵面板或群組。
- **子群組**：右鍵群組 → **新增子群組**（或將群組拖入另一群組）。
- **自動同步**：內建的 **「目前開啟的檔案」** 群組會自動追蹤您的分頁。
- **開啟/關閉全部**：會遞迴包含所有子群組的檔案。
- **拖放操作 (Drag & Drop)**：
  - **檔案**：直接拖入群組。
  - **資料夾**：拖入資料夾可遞迴加入所有檔案。
  - **多選**：按住 `Ctrl/Cmd` 多選後一次拖入。

![拖放操作示範](docs/assets/drag_drop_demo.png)

### 🔖 任務導向書籤 (v0.2.0)

1. 在編輯器中右鍵點擊 **任意程式碼行** → **加入書籤到 VirtualTabs**。
2. 書籤會顯示在該檔案下方。
3. 點擊即可瞬間跳轉至該行。
4. 可編輯標籤與描述，記錄 *為什麼* 這一行很重要。

![書籤功能示範](docs/assets/bookmarks_feature.png)

### 🤖 AI 上下文匯出 (v0.3.0)

**LLM 工作流的殺手級功能入。**

1. 將當前任務相關的所有檔案放入一個群組。
2. 右鍵群組 → **複製...** → **複製 AI 上下文 (Copy Context for AI)**。
3. 直接貼上到 ChatGPT 或 Claude。
    - **智慧**：自動跳過二進位檔。過大的檔案 (>50KB) 會幫您開啟以供檢視。
    - **整潔**：所有程式碼皆已格式化為 Markdown 區塊，並附帶路徑。

![AI 上下文示範](docs/assets/ai_context_demo.png)

### 📋 統一複製選單

所有複製功能整合在右鍵的 **「複製...」** 子選單中：

- **複製名稱/路徑**：標準的路徑複製功能。
- **複製上下文**：獲取程式碼內容。
- **多選支援**：選取 5 個檔案 → 複製路徑 → 得到 5 行路徑清單。

### 📊 排序與組織

- **排序**：右鍵群組 → **排序檔案**（名稱、路徑、副檔名、日期）。
- **自動分組**：右鍵群組 → **依副檔名/日期自動分組**。
- **群組排序**：右鍵 → **上移/下移** 手動調整群組順序。
- **檔案排序**：在自訂群組內拖放檔案，或使用 `Alt+↑` / `Alt+↓`（先點群組名稱讓面板取得焦點），或右鍵 → **Move File Up/Down**。

### 🚀 傳送至... (v0.4.8)

- 右鍵選取的檔案或群組 → **傳送至...** → 透過 Quick Pick 選擇目的地。
- 在 `.vscode/sendTargets.json` 定義固定目的地，以利一鍵傳送。
- 瀏覽過的目的地會自動記憶並顯示在「最近」清單中。

---

## 💡 為什麼選擇 VirtualTabs？

### 🎯 適用場景

- **Monorepo 管理**：集中管理跨 Package 的相關設定與邏輯。
- **架構導向開發**：依 MVC 邏輯層次組織檔案，而非受限於物理目錄。
- **AI 輔助開發**：為 AI 建立精確的上下文集，大幅提升 Prompt 準確率。
- **程式碼審查 (CR)**：將變動的檔案集中，提高審查效率。
- **專題學習**：建立關鍵代碼的精選輯，不受其他文件干擾。

---

## 💡 最佳實踐

1. **依任務分組，而非資料夾**：思考您正在做什麼，而非檔案在哪裡
2. **使用子群組**：用巢狀結構組織大型群組（v0.3.0）
3. **用書籤標記邏輯流程**：標記程式碼中的關鍵決策點
4. **建立 AI 上下文群組**：將 5-10 個檔案分組以獲得專注的 AI 協助
5. **提示前先匯出**：在詢問 LLM 前使用「複製 AI 上下文」
6. **定期審查整理**：定期清理未使用的群組以保持組織

---

## ❓ 常見問題

### Q1：我看不到 VirtualTabs 面板？

**檢查：**

- 擴充功能已啟用
- 您的 VS Code 版本是 1.75+
- VirtualTabs 在活動列（左側邊欄）有自己的圖示

### Q2：如何建立子群組？

右鍵任何群組 → **新增子群組**。您也可以將群組拖曳到另一個群組上以進行巢狀。

### Q3：「複製 AI 上下文」如何運作？

它會讀取群組中的所有檔案（包括子群組），將它們格式化為 markdown 程式碼區塊，然後複製到剪貼簿。二進位檔案會自動跳過。

### Q4：可以與團隊分享群組嗎？

可以！群組儲存於工作區的 `.vscode/virtualTab.json`。將此檔案提交至版本控制，即可與團隊共享群組結構。

### Q5：書籤在檔案重命名後還能用嗎？

可以！書籤追蹤檔案路徑，如果您在 VS Code 內重命名檔案，它們會更新。

### Q6：如何將資料夾拖曳到群組中？

只需從檔案總管面板將資料夾拖曳到群組上。VirtualTabs 會自動遞迴加入所有檔案，跳過目錄項目本身。

---

## 🤝 參與貢獻

我們熱烈歡迎社群貢獻！

### 🔧 開發者指南

有興趣貢獻程式碼嗎？請查看 **[DEVELOPMENT.md](./DEVELOPMENT.md)** 了解：

- 開發環境設定
- 除錯與發布指南
- 模組結構說明
- 常見錯誤排除

### 💬 社群參與

- 🐞 **Bug 回報** → [GitHub Issues](https://github.com/winterdrive/virtual-tabs/issues)
- ✨ **功能建議** → [GitHub Discussions](https://github.com/winterdrive/virtual-tabs/discussions)
- 🔧 **程式碼貢獻** → Fork 並提交 PR

---

## 🔥 推薦搭配

### 🔥 Quick Prompt

**VirtualTabs 的完美夥伴。**

**VirtualTabs** 組織您的**上下文**（檔案），**Quick Prompt** 組織您的**指示**（提示）。

- **VirtualTabs**：定義 AI 應該*看哪裡*（檔案群組）
- **Quick Prompt**：定義 AI 應該*做什麼*（提示管理）

兩者結合，創造終極 AI 編程工作流程。

在 [**VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=winterdrive.quick-prompt) | [**Open VSX Registry**](https://open-vsx.org/extension/winterdrive/quick-prompt) 取得 Quick Prompt

---

## 📅 更新日誌

👉 完整版本歷史請見 [CHANGELOG.md](./CHANGELOG.md)。

---

## ❤️ 支持專案

如果您覺得這個擴充功能對您有幫助，歡迎小額贊助支持開發！

<a href="https://ko-fi.com/Q5Q41SR5WO"><img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" height="36" alt="ko-fi" /></a>

## 📄 授權

採用 **MIT 授權**。個人和商業使用皆免費。

---

**更聰明地組織，更快速地編程。** 🚀

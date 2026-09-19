# VirtualTabs – VS Code 虛擬分頁與自定義檔案分組擴充套件

<!-- Translation of ../../README.md. The English source is canonical; update it first, then sync this file. -->

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version-short/winterdrive.virtual-tabs.svg)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs)
[![Open VSX Version](https://img.shields.io/open-vsx/v/winterdrive/virtual-tabs)](https://open-vsx.org/extension/winterdrive/virtual-tabs)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/winterdrive/virtual-tabs)](https://open-vsx.org/extension/winterdrive/virtual-tabs)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://winterdrive.github.io/vscode-virtual-tabs/llms.txt)
[![Presented at COSCUP 2026](https://img.shields.io/badge/Presented%20at-COSCUP%202026-orange?style=flat-square)](https://coscup.org/2026/session/9CYHJT/)
<!-- [![VS Marketplace Installs](https://vsmarketplacebadges.dev/installs-short/winterdrive.virtual-tabs.svg)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs) -->
<!-- [![VS Marketplace Downloads](https://vsmarketplacebadges.dev/downloads-short/winterdrive.virtual-tabs.svg)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs) -->

繁體中文 | **[English](../../README.md)** | [日本語](../ja/README.md) | [한국어](../ko/README.md) | [简体中文](../zh-CN/README.md)

![VirtualTabs - VS Code File Grouping and AI Context Extension](../assets/vscode-virtualtabs-grouping-banner.png)

---

## 🚀 什麼是 VirtualTabs？

**VirtualTabs 是一個 VS Code 擴充套件，在原生檔案目錄之外，提供自定義「虛擬檔案目錄」。** 不同於原生目錄，VirtualTabs 幫助您建立 **獨立的邏輯檔案群組**，可依照當前開發主題建立虛擬檔案目錄——即使在複雜的工作區中也能維持您的空間方向感。同時也提供 **AI 就緒的編程上下文（AI-Ready Context）** 可快速複製。適合 Monorepo 專案或採用 MVVM、MVC 架構的大型專案。

---

### ⚡ VirtualTabs vs. 原生 VS Code 分頁

| 功能特點 | 原生 VS Code 分頁 | VirtualTabs 擴充套件 |
| :--- | :--- | :--- |
| **持久性** | 關閉視窗即清除 | **永久保存** (依工作區記憶) |
| **檔案分組** | 僅限資料夾結構 | **邏輯導向** (支援跨目錄) |
| **空間感知** | 分頁堆積，缺乏任務脈絡 | **任務導向群組**，搭配自動追蹤與同步 |
| **AI 上下文** | 需手動一一收集 | **一鍵生成** 給 LLM 的上下文 |

![VirtualTabs 虛擬與實體檔案系統概念圖](../assets/virtual_vs_physical_concept.png)

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

*為什麼會有 VirtualTabs？[閱讀完整理念](PHILOSOPHY.md) → 曾在 [COSCUP 2026](https://coscup.org/2026/session/9CYHJT/) 發表*

---

## 🚀 快速開始 (Quick Start)

![VirtualTabs 產品示範](../assets/virtualtabs-product-demo.gif)

### 安裝

1. 開啟 VS Code。
2. 按 `Ctrl+Shift+X` (或 `Cmd+Shift+X`)。
3. 搜尋 **VirtualTabs** 並點擊 **安裝**。

### 首次設定

1. 點擊左側活動列中的 **VirtualTabs 圖示**。
2. 在面板中右鍵點擊 → **建立新群組**。
3. 從檔案總管將檔案 **直接拖曳** 進群組。

---

## ✨ 主要功能

### 📁 核心能力

- **跨目錄分組** — 從任何地方組織檔案，突破物理資料夾限制。
- **任務導向書籤** — 在群組中標記特定程式碼行，快速導航定位。
- **子群組與巢狀結構** — 在群組內建立群組，實現更好的層級組織。
- **AI 上下文匯出** — 一鍵複製所有檔案為 LLM 就緒的 Markdown 格式。
- **便攜設定** — 設定儲存於 `.vscode/virtualTab.json`，方便團隊共享。
- **AI Agent 整合 (MCP)** — 讓 AI 代理（Cursor、Claude 等）程序化管理您的群組。
- **Agent Skill 支援** — 正式 `virtualtabs` skill 的目前安裝步驟請參閱 [MCP 設定指南](../mcp-setup.zh-TW.md)。
- **Multi-root 工作區範圍** — 在 multi-root 專案中依每個工作區資料夾分開保存群組。
- **自動追蹤與同步** — 自動定位作用中檔案，並與原生編緝器分組同步。
- **傳送至...** — 快速將選取的檔案或整個群組傳送到指定目的地。
- **檔案重排序** — 支援拖放或鍵盤快捷鍵進行自定義手動排序。

### ⚡ 工作流程加速

- **智慧複製選單** — 統一的檔案名稱、路徑與內容複製選項。
- **目錄拖放** — 拖曳資料夾以遞迴加入內部檔案，並略過隱藏資料夾。
- **剪貼簿操作** — 完整的檔案與群組剪下 / 複製 / 貼上支援。
- **智慧組織** — 依副檔名、日期自動分組，或自訂排序準則。

---

## 📖 使用指南 (User Guide)

### 📁 群組管理

- **建立/重命名**：右鍵點擊面板或群組進行管理。
- **Multi-root 範圍**：在 multi-root 工作區中，每個偵測到的專案都會顯示為獨立區段。可從範圍標題新增群組、開啟該範圍設定、顯示儲存位置，或只清空該範圍。
- **子群組**：右鍵群組 → **新增子群組** (或將一個群組拖入另一群組)。
- **自動同步**：內建的「目前開啟的檔案」群組會自動追蹤您的分頁。
- **拖放操作**：
  - **檔案**：直接拖入群組。
  - **資料夾**：拖入資料夾可遞迴加入內部檔案；會略過名稱以 `.` 開頭的資料夾，但仍會加入 `.gitignore` 等 dotfile。
  - **多選**：按住 `Ctrl/Cmd` 選取多個檔案後一次拖入。

![拖放操作示範](../assets/drag_drop_demo.png)

### 🔖 任務導向書籤

1. 在編輯器中右鍵點擊 **任意程式碼行** → **加入書籤到 VirtualTabs**。
2. 書籤會顯示在該檔案下方。
3. 點擊即可瞬間跳轉至該行。
4. 可編輯標籤與描述，記錄 *為什麼* 這一行很重要。

![書籤功能示範](../assets/bookmarks_feature.png)

### 🤖 AI 上下文匯出

**LLM 工作流的強力功能。**

1. 定義一個與當面任務相關的檔案群組。
2. 右鍵點擊群組 → **複製...** → **複製 AI 上下文 (Copy Context for AI)**。
3. 貼上到 ChatGPT 或 Claude。
    - **智慧**：自動跳過二進位檔；過大的檔案 (>50KB) 會幫您開啟以供檢視。
    - **整潔**：所有程式碼皆已格式化為帶有路徑的 Markdown 區塊。

![AI 上下文示範](../assets/ai_context_demo.png)

---

## 🤖 智慧 AI Agent 整合 (MCP)

VirtualTabs 透過 **Model Context Protocol (MCP)** 提供完整的 AI Agent 整合。讓您的 AI 助手（Cursor, Antigravity, Kiro 等）能夠透過程式化管理您的工作區。

- 🔌 **標準化工具**：提供 MCP 工具管理群組與探索專案；目前能力目錄請參考 [MCP server reference](../../mcp-server/README.md)。
- 🛡️ **安全性**：以 canonical [VirtualTabs Agent Skill](../../skills/virtualtabs/SKILL.md) 規範安全的工具使用及 fallback 流程。
- ⚙️ **設定**：目前的 client configuration 與 Agent Skill 安裝步驟請參閱 [MCP 設定指南](../mcp-setup.zh-TW.md)。

---

## 💡 最佳實踐

1. **依任務分組，而非資料夾**：專注於功能開發而非路徑。
2. **用書籤標記邏輯流程**：在代碼中的關鍵決策點標記書籤。
3. **精簡 AI 上下文**：只將必要的檔案 (5-10 個) 放入專屬群組，提升 AI 回報準確率並節省 Token。
4. **團隊共享**：提交各專案的 `.vscode/virtualTab.json` 檔案，讓團隊成員共享精選的專案視圖。

---

## ❓ 常見問題

**Q：我看不到 VirtualTabs 面板？**  
檢查擴充功能是否已啟用，且 VS Code 版本為 1.75+。查看活動列是否有 VirtualTabs 圖示。

**Q：如何將資料夾加入群組？**  
直接從檔案總管將資料夾拖曳到 VirtualTabs 面板中的群組，系統會自動遞迴掃描並加入檔案，同時略過名稱以 `.` 開頭的隱藏資料夾；`.gitignore` 等 dotfile 仍會加入。

**Q：我可以手動調整群組順序嗎？**  
可以，右鍵點擊群組並使用 **Move Up/Down** 指令。

---

## 🤝 參與貢獻

我們熱烈歡迎社群貢獻！請從 **[CONTRIBUTING.md](../../CONTRIBUTING.md)** 開始，並依其中連結閱讀開發與測試指南。

- 🐞 [Bug 回報/功能建議](https://github.com/winterdrive/vscode-virtual-tabs/issues)

---

## 🔥 推薦搭配

### 🔥 Quick Prompt

**VirtualTabs 的完美夥伴。**

**VirtualTabs** 讓工作區保持整齊。**Quick Prompt** 讓你的思緒在 IDE 內保持整齊。

- **VirtualTabs**：跨任何目錄，把檔案依任務分組——持久保存，跨 session 不消失
- **Quick Prompt**：Agent 執行任務時，隨手記下下一步想法——無需切換視窗，不打斷思維流

兩者結合，大幅降低 AI 輔助開發的認知負荷。

在 [**VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=winterdrive.quick-prompt) | [**Open VSX Registry**](https://open-vsx.org/extension/winterdrive/quick-prompt) 取得 Quick Prompt

### 🔁 Edo Tensei

**當需要搬動的不只是檔案，而是 AI session 本身。**

VirtualTabs 解決的是「我在工作區的哪裡」。[Edo Tensei](https://github.com/Pain-Labs/Edo-Tensei) 解決的是 AI 額度用盡或任務中途要切換 IDE 時的問題——它會擷取本機的 session 歷史，打包成交接提示詞，讓下一個 agent 能從上一個中斷的地方接手。

在 [**VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) | [**Open VSX Registry**](https://open-vsx.org/extension/Pain-Labs/edo-tensei) 取得 Edo Tensei

---

## 📅 更新日誌

👉 完整版本歷史請見 [CHANGELOG.md](../../CHANGELOG.md)。

---

## ❤️ 支持專案

如果您覺得這個擴充功能對您有幫助，歡迎小額贊助支持開發！

<a href="https://ko-fi.com/Q5Q41SR5WO"><img src="https://storage.ko-fi.com/cdn/kofi2.png?v=3" height="36" alt="ko-fi" /></a>

**授權碼**: [MIT](../../LICENSE)

**更聰明地組織，更快速地編寫。** 🚀

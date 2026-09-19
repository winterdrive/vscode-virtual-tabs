# 為什麼會有 VirtualTabs

<!-- Translation of ../PHILOSOPHY.md. The English source is canonical; update it first, then sync this file. -->

[繁體中文](./PHILOSOPHY.md) | [日本語](../ja/PHILOSOPHY.md) | [한국어](../ko/PHILOSOPHY.md) | [简体中文](../zh-CN/PHILOSOPHY.md) | [English](../PHILOSOPHY.md)

AI Agent 接手的執行工作越多，人要扛的脈絡負擔就越重。這個論點在 [COSCUP 2026](https://coscup.org/2026/session/9CYHJT/) 講過：AI 跑得越快，我們反而越容易在螢幕前迷路？

## VirtualTabs 是什麼

VirtualTabs 最早其實跟 AI 沒什麼關係，第一筆 commit 只做了群組管理跟拖曳排序，讓你可以在原生檔案系統之外把檔案按邏輯分組存起來，單純想解決「這個功能的檔案到底放哪了」這種很平凡的問題。AI-Ready Context、後來的 MCP 整合，都是專案跑了一段時間之後才慢慢加上去的能力。

工具的核心一直沒變：它顧的是你的空間感，不是 AI 相關功能堆得有多深。

## 為什麼空間感在 AI 時代反而更重要

Agent 開始幫你跑任務之後，你手上的並行工作量只會變多，不會變少。可能同時盯著好幾個 Agent 在做不同的事，還得記得自己上一秒改了哪個檔案、這個群組是為了哪個任務建的。這種「我現在在哪」的感覺，在多工並行時特別容易弄丟，而它跟 AI 能力強不強其實沒有直接關係——Agent 再聰明，還是得靠你自己記得工作區長什麼樣子。

VirtualTabs 做的 Auto Reveal Active File、拖曳排序這些功能，處理的就是這件事：不管背景有多少工作在跑，讓你隨時看得出自己在哪個脈絡裡。

## 放進更大的脈絡裡看

VirtualTabs 顧的是空間那一半：多工並行時你人在工作區的哪裡。它的搭檔 [Quick Prompt](https://github.com/winterdrive/vscode-quick-prompt)（[理念](https://github.com/winterdrive/vscode-quick-prompt/blob/main/docs/zh-TW/PHILOSOPHY.md)）顧的是時間那一半：你接下來想做什麼。[Edo Tensei](https://github.com/Pain-Labs/Edo-Tensei) 顧第三塊：Agent 或額度用完的時候，把這個 session 的脈絡帶去下一個 IDE。

三個放一起看，與其說是三個 VS Code 擴充套件，不如說是同一個問題的三種處理方式：當 Agent 接手越來越多執行工作時，人要維持方向感，到底需要什麼。

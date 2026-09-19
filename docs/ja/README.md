# VirtualTabs - VS Code の仮想タブ / カスタムファイルグループ拡張

<!-- Translation of ../../README.md. The English source is canonical; update it first, then sync this file. -->

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version-short/winterdrive.virtual-tabs.svg)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs)
[![Open VSX Version](https://img.shields.io/open-vsx/v/winterdrive/virtual-tabs)](https://open-vsx.org/extension/winterdrive/virtual-tabs)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/winterdrive/virtual-tabs)](https://open-vsx.org/extension/winterdrive/virtual-tabs)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://winterdrive.github.io/vscode-virtual-tabs/llms.txt)
[![Presented at COSCUP 2026](https://img.shields.io/badge/Presented%20at-COSCUP%202026-orange?style=flat-square)](https://coscup.org/2026/session/9CYHJT/)

[繁體中文](../zh-TW/README.md) | [English](../../README.md) | 日本語 | [한국어](../ko/README.md) | [简体中文](../zh-CN/README.md)

![VirtualTabs - VS Code File Grouping and AI Context Extension](../assets/vscode-virtualtabs-grouping-banner.png)

---

## VirtualTabs とは？

**VirtualTabs は、実際のファイルシステムとは別に、タスク単位の「仮想ファイルディレクトリ」を作れる VS Code 拡張です。** ファイルを移動したりコピーしたりせず、現在の作業テーマに合わせて永続的な論理グループを作成し、複雑なワークスペースでも空間的な見通しを保ちます。AI-ready context としての一括コピーにも対応しています。Monorepo、MVC、MVVM、大規模プロジェクトに向いています。

---

![VirtualTabs vs Physical File System](../assets/virtual_vs_physical_concept.png)

*VirtualTabs はなぜ存在するのか？[理念を読む](PHILOSOPHY.md) → [COSCUP 2026](https://coscup.org/2026/session/9CYHJT/) にて発表*

---

## Quick Start

![VirtualTabs product demo](../assets/virtualtabs-product-demo.gif)

1. VS Code Marketplace で **VirtualTabs** を検索してインストールします。
2. Activity Bar から **VirtualTabs** ビューを開きます。
3. パネルまたはスコープ見出しを右クリックして、新しいグループを作成します。
4. Explorer からファイルやフォルダーをグループへドラッグします。
5. グループを右クリックし、**Copy... -> Copy Context for AI** で ChatGPT、Claude、Copilot 向けの文脈をコピーします。

## 主な機能

- **クロスディレクトリのグループ化**：場所が違う関連ファイルを同じ論理グループにまとめます。
- **タスク指向ブックマーク**：重要なコード行をグループ内で記録し、すぐに戻れます。
- **サブグループとネスト**：複雑な機能を階層構造で整理できます。
- **AI Context Export**：グループ内のファイルを LLM が読みやすい Markdown としてコピーします。
- **ポータブル設定**：グループ情報は `.vscode/virtualTab.json` に保存され、チームで共有できます。
- **MCP 連携**：Model Context Protocol 経由で AI agent がグループを操作できます。
- **Agent Skill 対応**：公式 `virtualtabs` skill の現在のインストール手順は [MCP Setup Guide](../mcp-setup.md) を参照してください。
- **Multi-root scope**：multi-root workspace ではプロジェクトごとにグループを分離します。
- **Send to...**：選択したファイルやグループを設定済みの送信先へ送れます。
- **ファイル順序変更**：ドラッグ＆ドロップまたはショートカットで順序を調整できます。

## MCP と Agent Skills

VirtualTabs には MCP server が組み込まれており、AI agent がワークスペースのグループを管理できます。現在の機能一覧は [MCP server reference](../../mcp-server/README.md)、agent の安全な操作規則は [VirtualTabs Agent Skill](../../skills/virtualtabs/SKILL.md) を参照してください。

クライアント設定と Agent Skill のインストール手順は [MCP Setup Guide](../mcp-setup.md) を参照してください。

## 推奨コンパニオン

**Quick Prompt** は VirtualTabs と相性の良い補助ツールです。VirtualTabs はファイルをタスク単位で整理し、Quick Prompt は IDE 内でアイデアや次の作業を記録します。

**Edo Tensei** は別の課題を解決します。VirtualTabs が「ワークスペースの中で自分が今どこにいるか」を解決するのに対し、[Edo Tensei](https://github.com/Pain-Labs/Edo-Tensei) は AI の利用枠が尽きたときや、作業の途中で IDE を乗り換えるときの課題を解決します——ローカルの session 履歴を抽出し、引き継ぎ用のプロンプトにまとめることで、次の agent が前の agent の続きから作業できるようにします。[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) または [Open VSX Registry](https://open-vsx.org/extension/Pain-Labs/edo-tensei) から入手できます。

## Support

- [Bug reports / feature requests](https://github.com/winterdrive/vscode-virtual-tabs/issues)
- [Changelog](../../CHANGELOG.md)
- [Contributing guide](../../CONTRIBUTING.md)

**License**: [MIT](../../LICENSE)

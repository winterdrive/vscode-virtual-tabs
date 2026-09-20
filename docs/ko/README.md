# VirtualTabs - VS Code 가상 탭 및 사용자 지정 파일 그룹 확장

<!-- Translation of ../../README.md. The English source is canonical; update it first, then sync this file. -->

[![Visual Studio Marketplace Version](https://vsmarketplacebadges.dev/version-short/winterdrive.virtual-tabs.svg)](https://marketplace.visualstudio.com/items?itemName=winterdrive.virtual-tabs)
[![Open VSX Version](https://img.shields.io/open-vsx/v/winterdrive/virtual-tabs)](https://open-vsx.org/extension/winterdrive/virtual-tabs)
[![Open VSX Downloads](https://img.shields.io/open-vsx/dt/winterdrive/virtual-tabs)](https://open-vsx.org/extension/winterdrive/virtual-tabs)
[![AI-Ready Context](https://img.shields.io/badge/AI--Ready-LLMS.txt-blue?style=flat-square)](https://winterdrive.github.io/vscode-virtual-tabs/llms.txt)
[![Presented at COSCUP 2026](https://img.shields.io/badge/Presented%20at-COSCUP%202026-orange?style=flat-square)](https://coscup.org/2026/session/9CYHJT/)

[繁體中文](../zh-TW/README.md) | [English](../../README.md) | [日本語](../ja/README.md) | 한국어 | [简体中文](../zh-CN/README.md)

![VirtualTabs - VS Code File Grouping and AI Context Extension](../assets/vscode-virtualtabs-grouping-banner.png)

---

## VirtualTabs란?

**VirtualTabs는 실제 파일 시스템 밖에 작업 중심의 "가상 파일 디렉터리"를 만드는 VS Code 확장입니다.** 파일을 이동하거나 복사하지 않고, 현재 작업 주제에 맞는 영구적인 논리 그룹을 만들어 복잡한 워크스페이스에서도 공간적 방향 감각을 유지할 수 있습니다. AI-ready context로의 일괄 복사도 지원합니다. Monorepo, MVC, MVVM, 대규모 프로젝트에 적합합니다.

---

![VirtualTabs vs Physical File System](../assets/virtual_vs_physical_concept.png)

*VirtualTabs가 존재하는 이유는? [철학 읽어보기](PHILOSOPHY.md) → [COSCUP 2026](https://coscup.org/2026/session/9CYHJT/)에서 발표*

---

## Quick Start

![VirtualTabs product demo](../assets/virtualtabs-product-demo.gif)

1. VS Code Marketplace에서 **VirtualTabs**를 검색해 설치합니다.
2. Activity Bar에서 **VirtualTabs** 뷰를 엽니다.
3. 패널 또는 scope 헤더를 우클릭해 새 그룹을 만듭니다.
4. Explorer에서 파일이나 폴더를 그룹으로 드래그합니다.
5. 그룹을 우클릭하고 **Copy... -> Copy Context for AI**를 사용해 ChatGPT, Claude, Copilot에 붙여 넣을 context를 복사합니다.

## 주요 기능

- **디렉터리 경계를 넘는 그룹화**: 서로 다른 위치의 관련 파일을 하나의 논리 그룹으로 묶습니다.
- **작업 중심 북마크**: 중요한 코드 라인을 그룹 안에 기록하고 바로 이동합니다.
- **하위 그룹과 중첩 구조**: 복잡한 기능을 계층적으로 정리합니다.
- **AI Context Export**: 그룹 내 파일을 LLM이 읽기 쉬운 Markdown으로 복사합니다.
- **휴대 가능한 설정**: 그룹 정보는 `.vscode/virtualTab.json`에 저장되어 팀과 공유할 수 있습니다.
- **MCP 통합**: Model Context Protocol을 통해 AI agent가 그룹을 프로그래밍 방식으로 관리합니다.
- **Agent Skill 지원**: 공식 `virtualtabs` skill의 현재 설치 절차는 [MCP Setup Guide](../mcp-setup.md)를 참고하세요.
- **Multi-root scope**: multi-root workspace에서 프로젝트별로 그룹을 분리합니다.
- **Send to...**: 선택한 파일이나 그룹을 미리 설정한 대상으로 보냅니다.
- **파일 순서 변경**: 드래그 앤 드롭 또는 키보드 단축키로 순서를 조정합니다.

## MCP 및 Agent Skills

VirtualTabs에는 MCP server가 내장되어 있어 AI agent가 워크스페이스 그룹을 관리할 수 있습니다. 현재 기능 목록은 [MCP server reference](../../mcp-server/README.md), agent의 안전한 동작 규칙은 [VirtualTabs Agent Skill](../../skills/virtualtabs/SKILL.md)을 참고하세요.

클라이언트 설정과 Agent Skill 설치 절차는 [MCP Setup Guide](../mcp-setup.md)를 참고하세요.

## 추천 companions

**Quick Prompt**는 VirtualTabs와 함께 쓰기 좋은 도구입니다. VirtualTabs는 파일을 작업 단위로 정리하고, Quick Prompt는 IDE 안에서 아이디어와 다음 작업을 기록합니다.

**Edo Tensei**는 또 다른 문제를 해결합니다. VirtualTabs가 "워크스페이스 안에서 내가 지금 어디에 있는지"를 해결한다면, [Edo Tensei](https://github.com/Pain-Labs/Edo-Tensei)는 AI 사용량이 바닥나거나 작업 도중 IDE를 옮겨야 할 때의 문제를 해결합니다——로컬 session 기록을 추출해 인계용 프롬프트로 정리해 두어서, 다음 agent가 이전 agent가 멈춘 지점부터 이어서 작업할 수 있게 해줍니다. [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Pain-Labs.edo-tensei) 또는 [Open VSX Registry](https://open-vsx.org/extension/Pain-Labs/edo-tensei)에서 받을 수 있습니다.

## Support

- [Bug reports / feature requests](https://github.com/winterdrive/vscode-virtual-tabs/issues)
- [Changelog](../../CHANGELOG.md)
- [Contributing guide](../../CONTRIBUTING.md)

**License**: [MIT](../../LICENSE)

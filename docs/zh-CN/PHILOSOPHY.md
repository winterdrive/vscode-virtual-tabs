# 为什么会有 VirtualTabs

<!-- Translation of ../PHILOSOPHY.md. The English source is canonical; update it first, then sync this file. -->

[繁體中文](../zh-TW/PHILOSOPHY.md) | [日本語](../ja/PHILOSOPHY.md) | [한국어](../ko/PHILOSOPHY.md) | [简体中文](./PHILOSOPHY.md) | [English](../PHILOSOPHY.md)

AI Agent 接手的执行工作越多，人要扛的上下文负担就越重。这个论点在 [COSCUP 2026](https://coscup.org/2026/session/9CYHJT/) 讲过：*AI 跑得越快，我们反而越容易在屏幕前迷路？*

## VirtualTabs 是什么

VirtualTabs 最早其实跟 AI 没什么关系，第一笔 commit 只做了群组管理和拖拽排序，让你可以在原生文件系统之外把文件按逻辑分组存起来，单纯想解决"这个功能的文件到底放哪了"这种很平常的问题。AI-Ready Context、后来的 MCP 集成，都是项目跑了一段时间之后才慢慢加上去的能力。

工具的核心一直没变：它顾的是你的空间感，不是 AI 相关功能堆得有多深。

## 为什么空间感在 AI 时代反而更重要

Agent 开始帮你跑任务之后，你手上的并行工作量只会变多，不会变少。可能同时盯着好几个 Agent 在做不同的事，还得记得自己上一秒改了哪个文件、这个群组是为了哪个任务建的。这种"我现在在哪"的感觉，在多任务并行时特别容易弄丢，而它跟 AI 能力强不强其实没有直接关系，Agent 再聪明，还是得靠你自己记得工作区长什么样子。

VirtualTabs 做的 Auto Reveal Active File、拖拽排序这些功能，处理的就是这件事：不管后台有多少工作在跑，让你随时看得出自己在哪个脉络里。

## 放进更大的脉络里看

VirtualTabs 顾的是空间那一半：多任务并行时你人在工作区的哪里。它的搭档 [Quick Prompt](https://github.com/winterdrive/vscode-quick-prompt)（[理念](https://github.com/winterdrive/vscode-quick-prompt/blob/main/docs/zh-CN/PHILOSOPHY.md)）顾的是时间那一半：你接下来想做什么。[Edo Tensei](https://github.com/Pain-Labs/Edo-Tensei) 顾第三块：Agent 或额度用完的时候，把这个 session 的上下文带去下一个 IDE。

三个放一起看，与其说是三个 VS Code 扩展，不如说是同一个问题的三种处理方式：当 Agent 接手越来越多执行工作时，人要维持方向感，到底需要什么。

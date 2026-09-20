# VirtualTabs가 존재하는 이유

<!-- Translation of ../PHILOSOPHY.md. The English source is canonical; update it first, then sync this file. -->

[繁體中文](../zh-TW/PHILOSOPHY.md) | [日本語](../ja/PHILOSOPHY.md) | [한국어](./PHILOSOPHY.md) | [简体中文](../zh-CN/PHILOSOPHY.md) | [English](../PHILOSOPHY.md)

AI 에이전트가 실행을 더 많이 떠맡을수록, 인간이 짊어지는 컨텍스트도 늘어납니다. 이 생각은 [COSCUP 2026](https://coscup.org/2026/session/9CYHJT/)에서 발표되었습니다: *AI Runs Faster, So Why Are Developers Getting More Lost?*

## VirtualTabs가 뭔가

VirtualTabs는 처음엔 AI와 별 상관이 없었습니다. 첫 커밋은 그룹 관리와 드래그 앤 드롭만 구현했는데, 네이티브 파일 시스템 밖에서 파일을 논리적인 그룹으로 정리할 수 있게 해주는 것이었습니다. "이 기능의 파일을 어디에 뒀더라"라는 꽤 평범한 문제를 풀기 위해서였죠. AI-Ready Context, 그리고 나중의 MCP 통합은 프로젝트가 어느 정도 진행된 뒤에 붙은 기능입니다.

이 도구의 핵심은 계속 같습니다. 깊어지는 건 AI 기능이 아니라 당신의 공간 감각입니다.

## AI 시대에 공간 감각이 오히려 더 중요해지는 이유

에이전트가 작업을 대신 실행하기 시작하면, 당신이 감당해야 할 병렬 작업량은 늘어나기만 합니다. 여러 에이전트가 각자 다른 일을 하는 걸 동시에 지켜보면서, 방금 어떤 파일을 고쳤는지, 이 그룹이 어떤 작업을 위한 건지 계속 기억해야 합니다. "내가 지금 어디에 있는가"라는 감각은 여러 일이 동시에 진행될 때 쉽게 흐트러지는데, 이건 AI 성능과는 직접적인 관계가 없습니다. 에이전트가 아무리 똑똑해져도, 워크스페이스가 어떤 모습인지 기억하는 건 결국 당신 몫입니다.

Auto Reveal Active File, 드래그 앤 드롭 재정렬 같은 기능들이 다루는 게 바로 이겁니다. 백그라운드에서 얼마나 많은 일이 돌아가든, 지금 자신이 어떤 맥락에 있는지 항상 알 수 있게 하는 것.

## 더 큰 그림 속에서

VirtualTabs가 다루는 건 이 문제의 공간적 절반입니다: 여러 작업이 병렬로 진행될 때 워크스페이스의 어디에 있는지. 동반자인 [Quick Prompt](https://github.com/winterdrive/vscode-quick-prompt)([철학](https://github.com/winterdrive/vscode-quick-prompt/blob/main/docs/ko/PHILOSOPHY.md))가 다루는 건 시간적 절반: 다음에 뭘 하려고 했는지. [Edo Tensei](https://github.com/Pain-Labs/Edo-Tensei)가 다루는 건 세 번째 조각: 에이전트나 쿼터가 소진됐을 때 세션의 컨텍스트를 다음 IDE로 옮기는 것.

셋을 합치면 "세 개의 VS Code 확장"이라기보다, 같은 질문에 대한 세 가지 답에 가깝습니다: 에이전트가 실행을 더 많이 떠맡게 될수록, 사람이 방향을 잃지 않으려면 실제로 뭐가 필요한가.

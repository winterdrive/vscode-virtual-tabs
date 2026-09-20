# VirtualTabs が存在する理由

<!-- Translation of ../PHILOSOPHY.md. The English source is canonical; update it first, then sync this file. -->

[繁體中文](../zh-TW/PHILOSOPHY.md) | [日本語](./PHILOSOPHY.md) | [한국어](../ko/PHILOSOPHY.md) | [简体中文](../zh-CN/PHILOSOPHY.md) | [English](../PHILOSOPHY.md)

AI エージェントが実行を引き受けるほど、人が抱えるコンテキストは増えていきます。この考えは [COSCUP 2026](https://coscup.org/2026/session/9CYHJT/) で発表されました：*AI Runs Faster, So Why Are Developers Getting More Lost?*

## VirtualTabs とは何か

VirtualTabs は最初、AI とはあまり関係ありませんでした。最初のコミットはグループ管理とドラッグ＆ドロップだけを実装していて、ネイティブのファイルシステムの外でファイルを論理的なグループに整理できるようにするものでした。「この機能のファイル、どこに置いたっけ」という、わりとありふれた問題を解決するためです。AI-Ready Context、そして後の MCP 統合は、プロジェクトがしばらく動いてから加わった機能です。

このツールの核はずっと変わっていません。深めているのは AI 機能ではなく、あなたの空間的な感覚です。

## AI 時代に空間感覚がむしろ重要になる理由

エージェントがタスクを実行し始めると、手元の並行作業量は増える一方です。複数のエージェントが別々のことをしているのを同時に見ながら、さっきどのファイルを変更したか、このグループはどのタスクのために作ったのかを覚えておく必要があります。「自分は今どこにいるのか」という感覚は、複数のことが並行して進むと簡単に見失われますが、それは AI の性能とは直接関係ありません。エージェントがどれだけ賢くなっても、ワークスペースの様子を覚えておくのは結局自分自身です。

Auto Reveal Active File やドラッグ＆ドロップの並べ替えといった機能は、まさにこれに対応しています。バックグラウンドでどれだけ動いていても、自分が今どの文脈にいるか常にわかるようにする、というものです。

## より大きな全体像の中で

VirtualTabs が担うのはこの問題の空間的な半分です：複数のタスクが並行する中でワークスペースのどこにいるか。仲間の [Quick Prompt](https://github.com/winterdrive/vscode-quick-prompt)（[理念](https://github.com/winterdrive/vscode-quick-prompt/blob/main/docs/ja/PHILOSOPHY.md)）が担うのは時間的な半分：次に何をするつもりだったか。[Edo Tensei](https://github.com/Pain-Labs/Edo-Tensei) が担うのは三つ目の部分：エージェントやクォータが尽きたときに、セッションのコンテキストを次の IDE へ運ぶことです。

三つ合わせると、「三つの VS Code 拡張機能」というより、同じ問いに対する三つの答えと言えます：エージェントが実行のより多くを引き受けるようになるとき、人が方向を見失わないために本当に必要なものは何か。

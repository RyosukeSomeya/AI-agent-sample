# AIエージェントサンプル

## プロジェクト概要

Strands Agents（AWS Bedrock系）を使ったAIエージェントシステム開発のサンプル（学習用）。
天気データ分析をテーマに、AgentCoreワークショップで学んだ構成パターンを段階的に実装する。

## リポジトリ構成

モノレポ構成。パッケージ構成は段階的に追加する。

```
packages/
  agents/                 # Strands Agents エージェント群（Python）
    collector/            # 収集エージェント
    analyst/              # 分析エージェント
    crosscut/             # 横断分析エージェント
    alert/                # 異常検知エージェント
    shared/               # 共通ライブラリ
  infra/                  # AWS CDK（TypeScript）
```

## 技術スタック

- 言語: Python (エージェント), TypeScript (CDK)
- フレームワーク: Strands Agents SDK
- クラウド: AWS (Bedrock, AgentCore, Lambda, Step Functions, EventBridge, S3)
- インフラ: AWS CDK
- パッケージマネージャー: uv (Python), npm (CDK)

## コマンド

```bash
# 依存関係インストール
uv sync

# テスト実行
# TODO

# リント
# TODO
```

## コードスタイル

- Python: PEP 8 準拠
- 型ヒント: 必須
- docstring: Google スタイル
- <!-- TODO: リンター/フォーマッター確定後に記入（ruff / black / mypy 等） -->

## ディレクトリ構成

```
/
├── CLAUDE.md
├── packages/
│   ├── agents/            # エージェント群（Python / uv）
│   └── infra/             # AWS CDK（TypeScript）
├── docs/
│   ├── requirements/      # 要件定義書
│   ├── specs/             # 仕様書
│   ├── designs/           # 設計書（構成図含む）
│   └── knowledge/         # ナレッジ（ワークショップ資料等）
└── .claude/
    └── skills/            # Claude Code スキル
```

## コミュニケーション

- AIへの指示・回答はすべて日本語で行う

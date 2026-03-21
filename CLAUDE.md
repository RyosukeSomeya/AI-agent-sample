# AIエージェントサンプル

## プロジェクト概要

Strands Agents（AWS Bedrock系）を使ったAIエージェントシステム開発のサンプル（学習用）。

## リポジトリ構成

モノレポ構成。パッケージ構成は段階的に追加する。

```
packages/
  <!-- TODO: パッケージ追加時に更新 -->
```

## 技術スタック

- 言語: Python
- フレームワーク: Strands Agents SDK
- クラウド: AWS (Bedrock)
- DB: なし
- パッケージマネージャー: uv

## コマンド

<!-- TODO: プロジェクト構築後に記入 -->

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
├── packages/              # モノレポパッケージ群
├── docs/
│   ├── requirements/      # 要件定義書
│   ├── specs/             # 仕様書
│   ├── designs/           # 設計書
│   └── knowledge/         # ナレッジ
└── .claude/
    └── skills/            # Claude Code スキル
```

## コミュニケーション

- AIへの指示・回答はすべて日本語で行う

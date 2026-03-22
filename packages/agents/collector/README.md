# 収集エージェント（Collector）

## 学習テーマ

**AgentCore ワークショップ Lab 1 対応**

Strands Agents SDK の基本を学ぶ最初のステップ。以下の3要素を理解する:

1. **`@tool` デコレータ** — 関数をツール化する仕組み。引数の型ヒントが Bedrock に渡されるツールスキーマになる
2. **`Agent` クラス** — `system_prompt`（役割定義）+ `tools`（ツールリスト）でエージェントを組み立てる
3. **Bedrock 連携** — `agent("ユーザー入力")` で推論→ツール実行→回答生成が自動で回る

## このエージェントの役割

天気データと災害情報を外部APIから取得し、ユーザーにわかりやすく報告する。

### ツール一覧

| ツール名 | 説明 | 外部API |
|----------|------|---------|
| `get_weather` | 指定都市の天気予報・過去データを取得 | Open-Meteo API |
| `get_disaster_info` | 災害警報・注意報を取得 | 気象庁 防災情報API |

## 動作確認手順

```bash
# プロジェクトルートで実行
cd /workspace

# 依存関係のインストール
uv sync

# 収集エージェントを起動
uv run python -m collector
```

### 対話例

```
🌤 収集エージェント起動（exitで終了）
==================================================

あなた: 東京の1週間の天気を教えて

エージェント: 🌤 東京の週間天気予報（表形式で表示）

あなた: 災害情報を教えて

エージェント: （現在の災害情報、またはなしの旨を表示）

あなた: exit

👋 終了します
```

## ファイル構成

```
collector/
├── pyproject.toml          # 依存関係（strands-agents, httpx, shared）
├── README.md               # 本ファイル（学習ガイド）
└── src/
    └── collector/
        ├── __init__.py     # パッケージ定義
        ├── __main__.py     # CLI エントリポイント（対話ループ）
        ├── agent.py        # エージェント定義（system_prompt + tools）
        └── tools/
            ├── __init__.py # ツール群パッケージ定義
            ├── weather.py  # get_weather ツール（Open-Meteo API）
            └── disaster.py # get_disaster_info ツール（気象庁API）
```

## なぜこう実装するのか

- **ツールを別モジュールに分離**: 各ツールが独立しており、テストや再利用がしやすい
- **agent.py でエージェントを定義**: ツールの組み合わせとシステムプロンプトを一箇所で管理
- **__main__.py でCLI対話**: 開発中の動作確認が容易。本番では Runtime 経由で呼ばれる

## 本番構成との差分

| 項目 | サンプル | 本番 |
|------|----------|------|
| 天気データ | Open-Meteo API（無料） | S&P Global MCP Server |
| 災害情報 | 気象庁 JSON API | 気象庁XML + リアルタイム通知 |
| 実行環境 | ローカル CLI | AgentCore Runtime（microVM） |
| 呼び出し方 | `python -m collector` | HTTPS API (`invoke_agent()`) |

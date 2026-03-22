# 分析エージェント（Analyst）

## 学習テーマ

**AgentCore ワークショップ Lab 1 対応**

Code Interpreter と自作ツールの組み合わせを学ぶステップ。以下を理解する:

1. **Code Interpreter** — SDK組み込みのツール。インポートして渡すだけでLLMがPythonコードを動的に生成・実行する
2. **自作ツール `save_to_s3`** — 分析結果をAWSのS3ストレージに保存する道具
3. **組み込み + 自作ツールの混在** — 同じ `tools` リストに渡すだけで両方使える

## このエージェントの役割

天気データを受け取り、統計分析・可視化（グラフ生成）・レポート作成を行い、結果をS3に保存する。

### ツール一覧

| ツール名 | 種類 | 説明 |
|----------|------|------|
| `code_interpreter` | SDK組み込み | Pythonコードをサンドボックスで実行（pandas/matplotlib等） |
| `save_to_s3` | 自作ツール | 分析結果をS3バケットに保存 |

## 動作確認手順

```bash
# プロジェクトルートで実行
cd packages/agents

# 依存関係のインストール
uv sync

# 分析エージェントを起動
uv run python -m analyst
```

### 対話例

```
📊 分析エージェント起動（exitで終了）
==================================================

あなた: 以下の天気データの週間トレンドを分析して
（天気データをJSON形式で貼り付け）

エージェント: （Code Interpreterで分析→グラフ生成→要約・詳細・グラフの3部構成で回答）

あなた: exit

👋 終了します
```

### S3保存のテスト

S3保存にはAWSのS3バケットが必要。環境変数で指定する:

```bash
export WEATHER_AGENT_BUCKET=your-bucket-name
```

未設定の場合はデフォルト値 `weather-agent-dev` が使用される。

## ファイル構成

```
analyst/
├── pyproject.toml          # 依存関係（strands-agents, strands-agents-tools, shared）
├── README.md               # 本ファイル（学習ガイド）
└── src/
    └── analyst/
        ├── __init__.py     # パッケージ定義
        ├── __main__.py     # CLI エントリポイント（対話ループ）
        ├── agent.py        # エージェント定義（system_prompt + tools）
        └── tools/
            ├── __init__.py # ツール群パッケージ定義
            └── save_to_s3.py  # S3保存ツール（自作）
```

## なぜこう実装するのか

- **Code Interpreter はインポートだけ**: SDK組み込みなので `@tool` を書く必要がない。LLMが必要に応じてPythonコードを自動生成・実行する
- **save_to_s3 は自作ツール**: S3への保存はアプリ固有の処理なので、`@tool` で自作する
- **shared.s3 ヘルパーを活用**: TASK-001で作った共通モジュールを再利用し、ボイラープレートを減らす

## 本番構成との差分

| 項目 | サンプル | 本番 |
|------|----------|------|
| 分析対象 | 気象データ | S&P Global 財務データ |
| Code Interpreter | 同じ（pandas/matplotlib） | 同じ |
| 保存先 | S3（1バケット） | S3（複数バケット） |
| 実行環境 | ローカル CLI | AgentCore Runtime（microVM） |

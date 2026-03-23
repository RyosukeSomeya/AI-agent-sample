# AI エージェントサンプル

Strands Agents（AWS Bedrock 系）を使った AI エージェントシステム開発のサンプル（学習用）。
天気データ分析をテーマに、AgentCore ワークショップで学んだ構成パターンを段階的に実装する。

※ 動作確認は最後までしていないので、不明です。

## アーキテクチャ

イベント駆動型のマルチエージェント構成。外側を Step Functions（決定的制御）、内側を AgentCore A2A（LLM 動的判断）で制御するハイブリッド方式。

構成図: [`docs/designs/system-architecture.drawio`](docs/designs/system-architecture.drawio)

## リポジトリ構成

モノレポ構成。エージェント（Python）とインフラ（CDK/TypeScript）を分離。

```
packages/
  agents/                 # Strands Agents エージェント群（Python）
    collector/            # 収集エージェント
    analyst/              # 分析エージェント
    crosscut/             # 横断分析エージェント
    alert/                # 異常検知エージェント
    shared/               # 共通ライブラリ
  infra/                  # AWS CDK（TypeScript）
docs/
  requirements/           # 要件定義書
  specs/                  # 仕様書
  designs/                # 設計書（構成図含む）
  knowledge/              # ナレッジ（ワークショップ資料等）
```

## 技術スタック

| 区分           | 技術                                                              |
| -------------- | ----------------------------------------------------------------- |
| エージェント   | Python, Strands Agents SDK                                        |
| クラウド       | AWS (Bedrock, AgentCore, Lambda, Step Functions, EventBridge, S3) |
| インフラ       | AWS CDK (TypeScript)                                              |
| パッケージ管理 | uv (Python), npm (CDK)                                            |

## セットアップ

```bash
# Python 依存関係
uv sync

# CDK 依存関係
cd packages/infra && npm install
```

## 関連ドキュメント

- [要件定義書](docs/requirements/weather-agent-requirements.md)
- [仕様書](docs/specs/weather-agent-spec.md)
- [設計書](docs/designs/weather-agent-design.md)
- [本番構成との比較](docs/designs/architecture-comparison.md)

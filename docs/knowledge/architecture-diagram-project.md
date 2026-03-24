# イベント駆動型AIエージェントシステム プロジェクト構成

## 概要

`architecture.drawio` の構成図をもとに、金融データ分析AIエージェントシステムを構築する場合のディレクトリ構成案。
モノレポ構成で、エージェント（Python）とインフラ（CDK/TypeScript）を分離する。

## ディレクトリ構成

```
AI-agents（仮）/
├── README.md
├── CLAUDE.md
│
├── packages/
│   ├── agents(UC1に該当)/                          # エージェント群（Python / uv）
│   │   ├── pyproject.toml
│   │   ├── research/                    # リサーチエージェント
│   │   │   ├── __init__.py
│   │   │   ├── agent.py                 # Strands Agent 定義・システムプロンプト
│   │   │   ├── tools.py                 # エージェント固有ツール
│   │   │   ├── Dockerfile               # AgentCore カスタムコンテナ
│   │   │   └── prompts/
│   │   │       └── system.md
│   │   ├── analyst/                     # 分析エージェント
│   │   │   ├── __init__.py
│   │   │   ├── agent.py
│   │   │   ├── tools.py
│   │   │   ├── Dockerfile
│   │   │   └── prompts/
│   │   │       └── system.md
│   │   ├── crosscut/                    # 横断分析エージェント
│   │   │   ├── __init__.py
│   │   │   ├── agent.py
│   │   │   ├── tools.py
│   │   │   ├── Dockerfile
│   │   │   └── prompts/
│   │   │       └── system.md
│   │   ├── signal/                      # シグナル検知エージェント
│   │   │   ├── __init__.py
│   │   │   ├── agent.py
│   │   │   ├── tools.py
│   │   │   ├── Dockerfile
│   │   │   └── prompts/
│   │   │       └── system.md
│   │   ├── shared/                      # 共通ライブラリ
│   │   │   ├── __init__.py
│   │   │   ├── models.py                # 共通データモデル（イベント型、レポート型等）
│   │   │   ├── clients.py               # 外部APIクライアント（EDGAR, TDnet等）
│   │   │   └── config.py                # 環境変数・設定管理
│   │   └── scripts/                     # デプロイ補助スクリプト
│   │       ├── deploy_runtime.py        # AgentCore Runtime 作成/更新（boto3）
│   │       └── setup_observability.py   # ログ配信設定（初回のみ）
│   │
│   ├── lambdas/                         # Lambda 関数群（Python）
│   │   ├── pyproject.toml
│   │   ├── ingest_financial/            # データ取得（S&P / EDGAR）
│   │   │   └── handler.py
│   │   ├── ingest_disclosure/           # データ取得（TDnet / ニュース）
│   │   │   └── handler.py
│   │   └── signal_scorer/               # シグナルスコアリング（Bedrock API）
│   │       └── handler.py
│   │
│   ├── skills/                         # codex用のスキル置き場
│   │   ├── codex用のskill
│   │   ├── .....
│   │
│   └── infra/                           # AWS CDK（TypeScript）
│       ├── package.json
│       ├── tsconfig.json
│       ├── bin/
│       │   └── app.ts                   # CDK App エントリポイント
│       └── lib/
│           ├── event-stack.ts           # 取得・イベント層（Scheduler, Lambda, EventBridge, Archive）
│           ├── orchestration-stack.ts   # オーケストレーション層（Step Functions×2, Map/waitForTaskToken）
│           ├── agent-stack.ts           # AIエージェント層（AgentCore Runtime, Gateway, Memory, Observability）
│           ├── storage-stack.ts         # 知識・ストレージ層（Knowledge Bases, S3, DynamoDB, RDS）
│           ├── gateway-stack.ts         # 出力・保護層（Bedrock Guardrails, SNS, SES）
│           └── monitoring-stack.ts      # 監視（CloudWatch Dashboards, Alarms）
│
├── docs/                                # ClaudeCodeの開発用ドキュメント置き場
│   ├── requirements/                    # 要件定義書
│   ├── specs/                           # 仕様書
│   ├── designs/                         # 設計書
│   │   └── architecture.drawio          # システム構成図
│   └── tasks/                           # タスク定義
│
└── tests/                               # この
    ├── unit/                            # 単体テスト
    │   ├── agents/
    │   ├── lambdas/
    │   └── mcp-servers/
    └── integration/                     # 結合テスト
        ├── workflows/                   # Step Functions ワークフロー E2E
        └── agents/                      # エージェント間連携（A2A）

※ プラスでローカル開発用のリソース関係のファイルが追加になるかも

```

## 構成図レイヤーとの対応

**CDKの構成などは怪しいです。**

| 構成図レイヤー | ディレクトリ | CDK Stack |
|---------------|-------------|-----------|
| 外部データソース（S&P Global, EDGAR, TDnet, ニュース） | `packages/mcp-servers/`, `packages/agents/shared/clients.py` | — |
| 取得・イベント層（Scheduler, Lambda×3, EventBridge, Archive） | `packages/lambdas/` | `event-stack.ts` |
| オーケストレーション層（Step Functions×2, Map State, waitForTaskToken） | — (CDKで定義) | `orchestration-stack.ts` |
| AIエージェント層（AgentCore Runtime, 4エージェント, Gateway, Memory, Observability） | `packages/agents/` | `agent-stack.ts` |
| 知識・ストレージ層（Knowledge Bases, S3, DynamoDB, RDS） | — (CDKで定義) | `storage-stack.ts` |
| 出力層（SNS, SES, S3レポート, CloudWatch） | — (CDKで定義) | `gateway-stack.ts`, `monitoring-stack.ts` |
| Bedrock / Guardrails | `packages/agents/` から利用 | `agent-stack.ts`, `gateway-stack.ts` |

## 技術スタック

| 区分 | 技術 |
|------|------|
| エージェント | Python, Strands Agents SDK |
| Lambda | Python |
| MCP サーバー | Python |
| インフラ | AWS CDK (TypeScript) |
| AI基盤 | Amazon Bedrock, AgentCore |
| パッケージ管理 | uv (Python), npm (CDK) |

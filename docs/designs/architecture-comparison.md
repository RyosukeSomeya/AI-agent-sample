# アーキテクチャ比較表

本番構成（architecture.drawio）とサンプルプロジェクト構成の対応表。

## 対応関係

| カテゴリ | 本番構成 | サンプル構成（天気テーマ） | 状態 |
|---|---|---|---|
| **外部データ** | S&P Global MCP Server | Open-Meteo 天気API (MCP) | 再現 |
| | SEC EDGAR API | 災害情報 API | 再現 |
| | TDnet (適時開示) | _(学習用のため省略)_ | 簡略化 |
| | ニュースフィード | _(学習用のため省略)_ | 簡略化 |
| **取得・イベント層** | EventBridge Scheduler | EventBridge Scheduler | 再現 |
| | Lambda データ取得 (S&P / EDGAR) | Lambda データ取得 (天気 / 災害) | 再現 |
| | Lambda データ取得 (TDnet / ニュース) | _(1つのLambdaに統合)_ | 簡略化 |
| | Lambda シグナルスコアリング (Bedrock API) | Lambda 異常気象スコアリング (Bedrock API) | 再現 |
| | Amazon EventBridge | Amazon EventBridge | 再現 |
| | EventBridge Archive (7年以上保持) | EventBridge Archive | 再現 |
| **オーケストレーション層** | Step Functions ディープリサーチWF | Step Functions 天気分析WF | 再現 |
| | Map State (企業単位で並列実行, maxConcurrency=10) | Map State (都市単位で並列実行, maxConcurrency=10) | 再現 |
| | Step Functions シグナル監視WF | Step Functions 異常気象監視WF | 再現 |
| | waitForTaskToken (非同期待機, 待機中は課金なし) | waitForTaskToken (非同期待機, 待機中は課金なし) | 再現 |
| **AIエージェント層** | AgentCore Runtime (microVM隔離) | AgentCore Runtime (microVM隔離) | 再現 |
| | リサーチエージェント | 収集エージェント | 再現 |
| | 分析エージェント | 分析エージェント | 再現 |
| | 横断分析エージェント | 横断分析エージェント | 再現 |
| | シグナル検知エージェント | 異常検知エージェント | 再現 |
| | エージェント間 A2A 通信 | エージェント間 A2A 通信 | 再現 |
| | AgentCore Gateway (MCP) | AgentCore Gateway (MCP) | 再現 |
| | AgentCore Memory (Semantic + Episodic) | AgentCore Memory (Semantic + Episodic) | 再現 |
| | AgentCore Observability | AgentCore Observability | 再現 |
| | Amazon Bedrock | Amazon Bedrock | 再現 |
| | Bedrock Guardrails | Bedrock Guardrails | 再現 |
| **知識・ストレージ層** | Bedrock Knowledge Bases | Bedrock Knowledge Bases | 再現 |
| | S3 Vectors (ベクトルストア) | S3 Vectors (ベクトルストア) | 再現 |
| | S3 (文書保管) | S3 (気象データ保管) | 再現 |
| | DynamoDB (状態管理 / シグナル履歴) | _(S3 + Step Functions + AgentCore Memoryで代替)_ | 簡略化 |
| | RDS PostgreSQL (構造化データ) | _(学習用のため省略。都市マスタは設定ファイル)_ | 簡略化 |
| **出力層** | Amazon SNS | Amazon SNS | 再現 |
| | Amazon SES | Amazon SES | 再現 |
| | S3 (レポート出力) | S3 (レポート出力) | 再現 |
| | Amazon CloudWatch | Amazon CloudWatch | 再現 |
| **設計パターン** | ハイブリッドマルチエージェント方式 | ハイブリッドマルチエージェント方式 | 再現 |
| | 外側: Step Functions（決定的制御） | 外側: Step Functions（決定的制御） | 再現 |
| | 内側: AgentCore A2A（LLM動的判断） | 内側: AgentCore A2A（LLM動的判断） | 再現 |
| **プロダクトライン** | プロダクト1: ディープリサーチ（日次バッチ） | プロダクト1: 天気分析（日次バッチ） | 再現 |
| | プロダクト2: シグナル監視（イベント駆動） | プロダクト2: 異常気象監視（イベント駆動） | 再現 |
| **AgentCore制約** | 非同期ジョブ最大8時間 / アクティブセッション1,000 | 非同期ジョブ最大8時間 / アクティブセッション1,000 | 再現 |

## エージェント対応表

| 本番エージェント | サンプルエージェント | 役割 |
|---|---|---|
| リサーチエージェント | 収集エージェント | 外部APIからデータを取得・整理 |
| 分析エージェント | 分析エージェント | Code Interpreterでデータ分析・グラフ生成 |
| 横断分析エージェント | 横断分析エージェント | 複数都市・複数データソースの横断比較 |
| シグナル検知エージェント | 異常検知エージェント | 急激な気温変化・災害警報の検知・アラート |

#!/usr/bin/env node
/**
 * CDK アプリケーション エントリポイント
 *
 * 学習ポイント:
 *   - CDK アプリは bin/ 配下のエントリポイントからスタックをインスタンス化する
 *   - 各スタックは独立してデプロイ可能（`cdk deploy StorageStack` のように個別指定）
 *   - AgentCore ワークショップ Lab 2 に対応
 *
 * 本番構成との違い:
 *   - 本番では環境ごと（dev/stg/prod）にスタックを分けるが、
 *     サンプルでは単一環境のみ定義している
 */
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { StorageStack } from "../lib/storage-stack";
import { RuntimeStack } from "../lib/runtime-stack";
import { MemoryStack } from "../lib/memory-stack";
import { ObservabilityStack } from "../lib/observability-stack";
import { EventStack } from "../lib/event-stack";
import { OrchestrationStack } from "../lib/orchestration-stack";
import { GatewayStack } from "../lib/gateway-stack";

const app = new cdk.App();

// Step 2: S3バケット（データ保存先）
// cdk deploy StorageStack でデプロイできる
const storageStack = new StorageStack(app, "StorageStack", {
  description: "天気データ分析エージェント - S3ストレージ",
});

// Step 4: AgentCore Runtime（エージェント実行環境）
// StorageStack に依存する（S3バケット名を参照するため）
const runtimeStack = new RuntimeStack(app, "RuntimeStack", {
  description: "天気データ分析エージェント - AgentCore Runtime",
  dataBucket: storageStack.dataBucket,
});
runtimeStack.addDependency(storageStack);

// Step 5: AgentCore Memory（記憶機能）
// RuntimeStack のロールに Memory API アクセス権限を追加する
// 学習ポイント: Memory はリソースを別途作成するのではなく、
// IAM 権限を付与してエージェントコード側で MemoryClient を使うだけで利用開始できる（Lab 3 対応）
const memoryStack = new MemoryStack(app, "MemoryStack", {
  description: "天気データ分析エージェント - AgentCore Memory",
  runtimeRole: runtimeStack.runtimeRole,
});
memoryStack.addDependency(runtimeStack);

// Step 6: Observability（CloudWatch ダッシュボード・アラーム）
// RuntimeStack のロールに CloudWatch 権限を追加し、ダッシュボード・アラームを構築する
// 学習ポイント: AgentCore は OTel トレースを自動生成するため、
// CloudWatch でEnd-to-End の監視が可能になる（Lab 4 対応）
const observabilityStack = new ObservabilityStack(app, "ObservabilityStack", {
  description: "天気データ分析エージェント - CloudWatch Observability",
  runtimeRole: runtimeStack.runtimeRole,
});
observabilityStack.addDependency(runtimeStack);

// Step 7: EventBridge + Lambda（イベント駆動基盤）
// Scheduler → Lambda(ingest/scorer) → EventBridge → (Step Functions は TASK-013)
// 学習ポイント: イベント駆動パイプラインで「対話型」と「バッチ型」を統合する（Step 7 対応）
const eventStack = new EventStack(app, "EventStack", {
  description: "天気データ分析エージェント - EventBridge + Lambda",
  dataBucket: storageStack.dataBucket,
});
eventStack.addDependency(storageStack);

// Step 8: Step Functions ワークフロー（ハイブリッドオーケストレーション）
// 天気分析WF: WeatherDataFetched → 都市並列分析 → 横断分析 → レポート
// 異常気象監視WF: WeatherAnomalyDetected → エージェント分析 → 重要度判定 → 通知/保存
// 学習ポイント: 外側の Step Functions（決定的制御）が内側の AgentCore（LLM動的判断）を呼ぶ
// ハイブリッドオーケストレーションパターン（Step 8 対応）
const orchestrationStack = new OrchestrationStack(app, "OrchestrationStack", {
  description: "天気データ分析エージェント - Step Functions ワークフロー",
  dataBucket: storageStack.dataBucket,
  eventBus: eventStack.eventBus,
});
orchestrationStack.addDependency(eventStack);
orchestrationStack.addDependency(runtimeStack);

// Step 9: Gateway + Guardrails + 通知（本番構成の仕上げ）
// AgentCore Gateway (MCP)、Bedrock Guardrails、Knowledge Bases、SNS/SES
// 学習ポイント: MCP で外部 API を統一し、Guardrails で安全性を確保し、
// Knowledge Bases で RAG を実現し、SNS/SES で通知する（Lab 6, 7, 8 対応）
const gatewayStack = new GatewayStack(app, "GatewayStack", {
  description: "天気データ分析エージェント - Gateway + Guardrails + 通知",
  dataBucket: storageStack.dataBucket,
  runtimeRole: runtimeStack.runtimeRole,
  // notificationEmail: "your-email@example.com",  // デプロイ時にコメントを外す
});
gatewayStack.addDependency(runtimeStack);
gatewayStack.addDependency(orchestrationStack);

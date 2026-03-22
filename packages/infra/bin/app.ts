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

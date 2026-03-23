import * as cdk from "aws-cdk-lib";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/**
 * EventStack のプロパティ
 */
export interface EventStackProps extends cdk.StackProps {
  /** StorageStack で作成した S3 バケット（Lambda の環境変数に渡す） */
  dataBucket: s3.IBucket;
}

/**
 * EventStack - イベント駆動基盤（Step 7）
 *
 * 学習ポイント:
 *   - EventBridge Scheduler で Lambda を定時起動する（cron 式で毎日 9:00 JST）
 *   - EventBridge Rule で detail-type ごとにイベントをフィルタリングし、
 *     後続の Step Functions にルーティングする
 *   - EventBridge Archive で全イベントを自動保存し、リプレイ可能にする
 *   - CDK で Lambda + EventBridge を組み合わせる構成パターン
 *
 * 本番構成との違い:
 *   - 本番では Lambda をVPC内に配置し、S3/Bedrock へは VPC エンドポイント経由でアクセスするが、
 *     サンプルではパブリックアクセスを使用する
 *   - 本番では Lambda Layer に共通ライブラリを分離するが、
 *     サンプルではソースコードをそのままパッケージングする
 *   - 本番ではDLQ（Dead Letter Queue）でエラーイベントを退避するが、
 *     サンプルではログ出力のみ
 */
export class EventStack extends cdk.Stack {
  /** EventBridge Rule: WeatherDataFetched（OrchestrationStack でターゲットを追加する） */
  public readonly weatherDataFetchedRule: events.Rule;
  /** EventBridge Rule: WeatherAnomalyDetected（OrchestrationStack でターゲットを追加する） */
  public readonly weatherAnomalyDetectedRule: events.Rule;
  /** EventBridge Bus（カスタムイベントバス） */
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: EventStackProps) {
    super(scope, id, props);

    // --- EventBridge カスタムイベントバス ---
    // 学習ポイント: デフォルトイベントバスを使うこともできるが、
    // カスタムバスを作ることで「このアプリのイベント」を他と分離できる。
    // 本番では環境ごとにバスを分ける（dev-weather-agent-bus 等）。
    this.eventBus = new events.EventBus(this, "WeatherAgentBus", {
      eventBusName: "weather-agent-bus",
    });

    // --- EventBridge Archive ---
    // 学習ポイント: Archive は全イベントを自動保存する機能。
    // 障害発生時にイベントをリプレイ（再送）して復旧できる。
    // 仕様書 4.3: 「EventBridge Archive は CDK の new events.Archive() で作成」
    new events.Archive(this, "WeatherAgentArchive", {
      sourceEventBus: this.eventBus,
      archiveName: "weather-agent-archive",
      description: "天気エージェントの全イベントをアーカイブ（リプレイ用）",
      // すべてのイベントを保存（フィルタなし）
      eventPattern: {
        source: events.Match.prefix("weather-agent"),
      },
      retention: cdk.Duration.days(30),
    });

    // --- Lambda 用 IAM ロール ---
    // 学習ポイント: Lambda がS3/EventBridge/Bedrockにアクセスするための権限。
    // ingest と scorer で共通のロールを使用する。
    const lambdaRole = new iam.Role(this, "LambdaExecutionRole", {
      roleName: "weather-agent-lambda-role",
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: "IAM role for weather agent Lambda functions",
      managedPolicies: [
        // CloudWatch Logs への書き込み権限（Lambda 基本権限）
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
      ],
    });

    // S3 読み書き権限
    props.dataBucket.grantReadWrite(lambdaRole);

    // EventBridge イベント発行権限
    // 学習ポイント: Lambda が put_events() でカスタムバスにイベントを発行するために必要
    this.eventBus.grantPutEventsTo(lambdaRole);

    // Bedrock モデル呼び出し権限（scorer Lambda 用）
    // 学習ポイント: scorer Lambda は Bedrock InvokeModel API を直接呼ぶ。
    // エージェント（Strands SDK）経由ではなく、boto3 で直接 API を叩くバッチ型パターン。
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockInvoke",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: ["*"],
      })
    );

    // --- Lambda 関数: ingest ---
    // 学習ポイント: Lambda 関数は CDK の lambda.Function で定義する。
    // runtime（Python 3.12）、handler（エントリポイント）、code（ソースの場所）を指定。
    // 仕様書: Lambda タイムアウト 30秒
    const ingestLambda = new lambda.Function(this, "IngestLambda", {
      functionName: "weather-agent-ingest",
      description: "天気データ取得Lambda — get_weather ツールを再利用してデータ収集・S3保存・イベント発行",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "lambdas.ingest.handler",
      // 学習ポイント: code は Lambda のソースコードの場所を指定する。
      // デプロイ前に packages/agents/lambda-package/ にパッケージを事前ビルドする。
      // ビルド手順: cd packages/agents && pip install --target lambda-package ./shared ./collector ./lambdas
      // 本番では Lambda Layer に共通ライブラリを分離するが、サンプルでは同梱する。
      //
      // 注意: Docker が使えない環境（devcontainer 等）では CDK の bundling は使用できない。
      // そのため事前ビルドした lambda-package ディレクトリを直接参照する方式を採用。
      code: lambda.Code.fromAsset("../../packages/agents/lambda-package"),
      role: lambdaRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        WEATHER_AGENT_BUCKET: props.dataBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      },
      logGroup: new logs.LogGroup(this, "IngestLambdaLogGroup", {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // --- Lambda 関数: scorer ---
    // 学習ポイント: scorer は Bedrock API を直接呼び出してスコアリングする。
    // ingest と同じソースコードベースだが、handler が異なる。
    const scorerLambda = new lambda.Function(this, "ScorerLambda", {
      functionName: "weather-agent-scorer",
      description: "異常気象スコアリングLambda — Bedrock API直接呼び出しでスコア算出・イベント発行",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "lambdas.scorer.handler",
      code: lambda.Code.fromAsset("../../packages/agents/lambda-package"),
      role: lambdaRole,
      // scorer は Bedrock API 呼び出しがあるため長めに設定
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        WEATHER_AGENT_BUCKET: props.dataBucket.bucketName,
        EVENT_BUS_NAME: this.eventBus.eventBusName,
      },
      logGroup: new logs.LogGroup(this, "ScorerLambdaLogGroup", {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // --- EventBridge Scheduler ---
    // 学習ポイント: Scheduler は cron 式で Lambda を定時起動する。
    // EventBridge Scheduler は EventBridge Rule の cron とは別サービス。
    // Scheduler のほうが柔軟（タイムゾーン指定、1回限り実行等が可能）。
    //
    // 本番構成との違い:
    //   本番では Scheduler Group で環境ごとに管理するが、サンプルではデフォルトグループ。

    // Scheduler 用 IAM ロール
    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      roleName: "weather-agent-scheduler-role",
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "IAM role for EventBridge Scheduler to invoke Lambda",
    });
    ingestLambda.grantInvoke(schedulerRole);
    scorerLambda.grantInvoke(schedulerRole);

    // Scheduler: ingest Lambda を毎日 9:00 JST に起動
    // 学習ポイント: cron 式は UTC で指定する。JST 9:00 = UTC 0:00。
    // ScheduleExpression は "cron(分 時 日 月 曜日 年)" 形式。
    new scheduler.CfnSchedule(this, "IngestSchedule", {
      name: "weather-agent-ingest-schedule",
      description: "毎日 9:00 JST に天気データ取得 Lambda を起動",
      scheduleExpression: "cron(0 0 * * ? *)",
      scheduleExpressionTimezone: "Asia/Tokyo",
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: ingestLambda.functionArn,
        roleArn: schedulerRole.roleArn,
      },
      state: "ENABLED",
    });

    // Scheduler: scorer Lambda を毎日 9:30 JST に起動
    // 学習ポイント: ingest が 9:00 にデータを取得した後、
    // 30分後に scorer が取得データをスコアリングする。
    // 本番では ingest 完了イベントをトリガーにする方が確実だが、
    // サンプルでは時間差で簡略化している。
    new scheduler.CfnSchedule(this, "ScorerSchedule", {
      name: "weather-agent-scorer-schedule",
      description: "毎日 9:30 JST に異常気象スコアリング Lambda を起動",
      scheduleExpression: "cron(30 0 * * ? *)",
      scheduleExpressionTimezone: "Asia/Tokyo",
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: scorerLambda.functionArn,
        roleArn: schedulerRole.roleArn,
      },
      state: "ENABLED",
    });

    // --- EventBridge Rule ---
    // 学習ポイント: Rule はイベントをフィルタリングして後続サービスにルーティングする。
    // detail-type でイベント種別を指定し、マッチするイベントだけをターゲットに転送する。
    // ターゲット（Step Functions）は OrchestrationStack（TASK-013）で追加する。

    // Rule: WeatherDataFetched → 天気分析WF
    // 学習ポイント: eventPattern で source と detailType を指定してフィルタリングする。
    // 仕様書 4.3 のイベントスキーマに対応。
    this.weatherDataFetchedRule = new events.Rule(
      this,
      "WeatherDataFetchedRule",
      {
        ruleName: "weather-agent-data-fetched",
        description:
          "WeatherDataFetched イベントを天気分析 WF にルーティング",
        eventBus: this.eventBus,
        eventPattern: {
          source: ["weather-agent.ingest"],
          detailType: ["WeatherDataFetched"],
        },
        // ターゲットは OrchestrationStack で追加する
      }
    );

    // Rule: WeatherAnomalyDetected → 異常気象監視WF
    this.weatherAnomalyDetectedRule = new events.Rule(
      this,
      "WeatherAnomalyDetectedRule",
      {
        ruleName: "weather-agent-anomaly-detected",
        description:
          "WeatherAnomalyDetected イベントを異常気象監視 WF にルーティング",
        eventBus: this.eventBus,
        eventPattern: {
          source: ["weather-agent.scorer"],
          detailType: ["WeatherAnomalyDetected"],
        },
        // ターゲットは OrchestrationStack で追加する
      }
    );

    // --- CloudFormation 出力 ---
    new cdk.CfnOutput(this, "EventBusName", {
      value: this.eventBus.eventBusName,
      description: "EventBridge カスタムバス名",
      exportName: "WeatherAgentEventBusName",
    });

    new cdk.CfnOutput(this, "EventBusArn", {
      value: this.eventBus.eventBusArn,
      description: "EventBridge カスタムバス ARN",
      exportName: "WeatherAgentEventBusArn",
    });

    new cdk.CfnOutput(this, "IngestLambdaArn", {
      value: ingestLambda.functionArn,
      description: "ingest Lambda 関数 ARN",
      exportName: "WeatherAgentIngestLambdaArn",
    });

    new cdk.CfnOutput(this, "ScorerLambdaArn", {
      value: scorerLambda.functionArn,
      description: "scorer Lambda 関数 ARN",
      exportName: "WeatherAgentScorerLambdaArn",
    });
  }
}

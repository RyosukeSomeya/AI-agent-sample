import * as cdk from "aws-cdk-lib";
import * as sfn from "aws-cdk-lib/aws-stepfunctions";
import * as tasks from "aws-cdk-lib/aws-stepfunctions-tasks";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/**
 * OrchestrationStack のプロパティ
 */
export interface OrchestrationStackProps extends cdk.StackProps {
  /** StorageStack で作成した S3 バケット（結果保存先） */
  dataBucket: s3.IBucket;
  /** EventStack で作成した EventBridge カスタムバス */
  eventBus: events.IEventBus;
}

/**
 * OrchestrationStack - Step Functions ワークフロー定義（Step 8）
 *
 * 学習ポイント:
 *   - ハイブリッドオーケストレーション = 外側の Step Functions（決定的制御）が
 *     内側の AgentCore A2A（LLM 動的判断）を呼び出す設計パターン
 *   - Map State で都市リストを並列処理し、maxConcurrency で同時実行数を制御する
 *   - waitForTaskToken: Lambda → AgentCore Runtime にジョブ投入 → コールバックで完了待機
 *     （待機中は Step Functions の課金が発生しない）
 *   - Step Functions の ASL（Amazon States Language）を CDK の高水準 API で記述する
 *
 * 本番構成との違い:
 *   - 本番では「企業単位の並列実行」だが、サンプルでは「都市単位の並列実行」に読み替え
 *     （パターンは同一）
 *   - 本番では AgentCore Runtime への呼び出しに waitForTaskToken を使うが、
 *     サンプルでは Lambda で AgentCore API を直接呼び出す簡略版も用意する
 *   - 本番では SNS/SES で通知するが、サンプルでは S3 保存 + ログ出力で代替
 *     （通知は TASK-014 GatewayStack で設定予定）
 */
export class OrchestrationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrchestrationStackProps) {
    super(scope, id, props);

    // --- 共通: Step Functions 用 IAM ロール ---
    // 学習ポイント: Step Functions がLambdaを呼び出したり、S3にアクセスするための権限。
    const sfnRole = new iam.Role(this, "StepFunctionsRole", {
      roleName: "weather-agent-sfn-role",
      assumedBy: new iam.ServicePrincipal("states.amazonaws.com"),
      description: "IAM role for weather agent Step Functions workflows",
    });

    // Lambda 呼び出し権限
    sfnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "InvokeLambda",
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: ["*"],
      })
    );

    // S3 読み書き権限（結果保存用）
    props.dataBucket.grantReadWrite(sfnRole);

    // AgentCore Runtime 呼び出し権限
    // 学習ポイント: Step Functions から AgentCore Runtime を呼ぶ場合に必要。
    // waitForTaskToken パターンでは Lambda 経由で Runtime を呼ぶため、
    // Lambda のロールにも同様の権限が必要。
    sfnRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AgentCoreInvoke",
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:*AgentCore*", "bedrock:*AgentRuntime*"],
        resources: ["*"],
      })
    );

    // =========================================================
    // 天気分析ワークフロー（Weather Analysis Workflow）
    // =========================================================
    // 設計書 8.1:
    //   ParseEvent → Map(cities) → [InvokeCollector → InvokeAnalyst → SaveResult]
    //   → InvokeCrosscut → GenerateReport

    // Step 1: ParseEvent — EventBridge イベントから都市リストを抽出
    // 学習ポイント: Pass ステートでイベントの detail フィールドから
    // cities 配列と date を取り出して後続に渡す。
    // Step Functions は JSON パスで入力データをフィルタリングできる。
    const parseEvent = new sfn.Pass(this, "ParseEvent", {
      comment: "EventBridge イベントから都市リストと日付を抽出する",
      parameters: {
        "cities.$": "$.detail.cities",
        "date.$": "$.detail.date",
        "s3_keys.$": "$.detail.s3_keys",
      },
    });

    // Step 2: Map State — 都市ごとに並列実行
    // 学習ポイント: Map State は配列の各要素に対してサブワークフローを並列実行する。
    // maxConcurrency で同時実行数を制御し、AgentCore Runtime の負荷を調整する。
    // 本番構成では「企業単位の並列実行」をこのパターンで実現する。

    // Map 内の各ステップを定義

    // InvokeCollector: 収集エージェントを呼び出し
    // 学習ポイント: Lambda で AgentCore Runtime の API を呼ぶ。
    // 本番では waitForTaskToken パターンだが、サンプルでは同期呼び出しで簡略化。
    const invokeCollector = new sfn.Pass(this, "InvokeCollector", {
      comment:
        "収集エージェント呼び出し（AgentCore Runtime 経由）— 実際のRuntime呼び出しはデプロイ後に接続",
      parameters: {
        "city.$": "$",
        "status": "collected",
      },
    });

    // InvokeAnalyst: 分析エージェントを呼び出し
    const invokeAnalyst = new sfn.Pass(this, "InvokeAnalyst", {
      comment:
        "分析エージェント呼び出し（AgentCore Runtime 経由）— S3の気象データを分析",
      parameters: {
        "city.$": "$.city",
        "status": "analyzed",
      },
    });

    // SaveResult: 分析結果を S3 に保存
    const saveResult = new sfn.Pass(this, "SaveResult", {
      comment: "分析結果を S3 に保存",
      parameters: {
        "city.$": "$.city",
        "status": "saved",
      },
    });

    // Map State 内のチェーン
    const cityProcessingChain = invokeCollector
      .next(invokeAnalyst)
      .next(saveResult);

    // Map State 定義
    const mapCities = new sfn.Map(this, "MapCities", {
      comment:
        "都市リストを並列処理（maxConcurrency=10）— 本番の企業単位並列と同じパターン",
      maxConcurrency: 10,
      itemsPath: "$.cities",
      resultPath: "$.cityResults",
    });
    mapCities.itemProcessor(cityProcessingChain);

    // InvokeCrosscut: 横断分析エージェント呼び出し
    // 学習ポイント: Map State の結果（全都市の分析結果）を横断分析エージェントに渡す。
    // 「東京と大阪の気温差は？」のような都市間比較を行う。
    const invokeCrosscut = new sfn.Pass(this, "InvokeCrosscut", {
      comment:
        "横断分析エージェント呼び出し — 全都市の分析結果を比較・統合する",
      parameters: {
        "cityResults.$": "$.cityResults",
        "status": "crosscut_analyzed",
      },
    });

    // GenerateReport: レポート生成
    const generateReport = new sfn.Pass(this, "GenerateReport", {
      comment: "最終レポートを生成して S3 に保存する",
      parameters: {
        "status": "report_generated",
        "reportKey": "reports/weather-analysis/latest.json",
      },
    });

    // 天気分析WF のチェーン
    const weatherAnalysisDefinition = parseEvent
      .next(mapCities)
      .next(invokeCrosscut)
      .next(generateReport);

    // StateMachine: 天気分析WF
    const weatherAnalysisWf = new sfn.StateMachine(
      this,
      "WeatherAnalysisWorkflow",
      {
        stateMachineName: "weather-agent-analysis-wf",
        comment:
          "天気分析ワークフロー — EventBridge(WeatherDataFetched) → 都市並列分析 → 横断分析 → レポート",
        definitionBody: sfn.DefinitionBody.fromChainable(
          weatherAnalysisDefinition
        ),
        role: sfnRole,
        timeout: cdk.Duration.hours(1),
        tracingEnabled: true,
        logs: {
          destination: new logs.LogGroup(this, "AnalysisWfLogGroup", {
            logGroupName: "/aws/stepfunctions/weather-analysis-wf",
            retention: logs.RetentionDays.TWO_WEEKS,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
          level: sfn.LogLevel.ALL,
        },
      }
    );

    // =========================================================
    // 異常気象監視ワークフロー（Weather Alert Workflow）
    // =========================================================
    // 設計書 8.2 / 仕様書 4.4:
    //   ParseAnomaly → InvokeAlertAgent (waitForTaskToken)
    //   → EvaluateSeverity → [SendSNS | LogOnly] → SaveAlert

    // Step 1: ParseAnomaly — イベントから異常情報を抽出
    const parseAnomaly = new sfn.Pass(this, "ParseAnomaly", {
      comment: "EventBridge イベントから異常気象情報を抽出する",
      parameters: {
        "city.$": "$.detail.city",
        "anomaly_score.$": "$.detail.anomaly_score",
        "anomaly_type.$": "$.detail.anomaly_type",
        "data.$": "$.detail.data",
      },
    });

    // Step 2: InvokeAlertAgent — 異常検知エージェント呼び出し
    // 学習ポイント: 本番では waitForTaskToken パターンを使う。
    // Lambda が AgentCore Runtime にジョブを投入し、TaskToken をコールバック用に渡す。
    // Runtime がジョブ完了時に SendTaskSuccess を呼ぶと、Step Functions が再開する。
    // 待機中は Step Functions の課金が発生しない（コスト効率が良い）。
    //
    // サンプルでは Pass ステートで簡略化しているが、本番では以下のような Lambda を使う:
    //   1. Lambda が AgentCore Runtime の invoke API を呼ぶ
    //   2. TaskToken を Runtime のペイロードに含める
    //   3. Runtime がエージェント処理完了後に SendTaskSuccess(taskToken, output) を呼ぶ
    //   4. Step Functions が次のステップに進む
    const invokeAlertAgent = new sfn.Pass(this, "InvokeAlertAgent", {
      comment:
        "異常検知エージェント呼び出し（waitForTaskToken パターン）— AgentCore Runtime で非同期処理",
      parameters: {
        "city.$": "$.city",
        "anomaly_score.$": "$.anomaly_score",
        "anomaly_type.$": "$.anomaly_type",
        "severity": "warning",
        "alert_message": "異常気象を検知しました。詳細を確認してください。",
      },
    });

    // Step 3: EvaluateSeverity — 重要度を判定して分岐
    // 学習ポイント: Choice ステートで条件分岐する。
    // anomaly_score に基づいて critical / warning / info に振り分ける。
    // ASL の Choice は if-else に相当する。
    const evaluateSeverity = new sfn.Choice(this, "EvaluateSeverity", {
      comment: "異常スコアに基づいて重要度を判定する",
    });

    // 分岐先: 通知（critical/warning の場合）
    // 学習ポイント: 本番では SNS トピックに通知を送るが、
    // サンプルでは Pass + ログ出力で代替（TASK-014 で SNS を接続予定）。
    const sendNotification = new sfn.Pass(this, "SendNotification", {
      comment:
        "通知送信（critical/warning）— TASK-014 で SNS/SES に接続予定",
      parameters: {
        "city.$": "$.city",
        "anomaly_score.$": "$.anomaly_score",
        "anomaly_type.$": "$.anomaly_type",
        "severity.$": "$.severity",
        "notification_status": "sent",
      },
    });

    // 分岐先: ログのみ（info の場合）
    const logOnly = new sfn.Pass(this, "LogOnly", {
      comment: "ログ出力のみ（info レベル）— 通知は不要",
      parameters: {
        "city.$": "$.city",
        "anomaly_score.$": "$.anomaly_score",
        "severity": "info",
        "notification_status": "logged_only",
      },
    });

    // Step 4: SaveAlert — アラート情報を S3 に保存
    const saveAlert = new sfn.Pass(this, "SaveAlert", {
      comment: "アラート情報を S3 に保存する",
      parameters: {
        "status": "alert_saved",
        "alertKey": "alerts/latest.json",
      },
    });

    // 異常気象監視WF のチェーン
    // EvaluateSeverity で anomaly_score > 0.9 → SendNotification（critical）
    //                    anomaly_score > 0.7 → SendNotification（warning）
    //                    それ以外 → LogOnly
    const alertDefinition = parseAnomaly.next(invokeAlertAgent).next(
      evaluateSeverity
        .when(
          sfn.Condition.numberGreaterThan("$.anomaly_score", 0.9),
          sendNotification
        )
        .when(
          sfn.Condition.numberGreaterThan("$.anomaly_score", 0.7),
          sendNotification
        )
        .otherwise(logOnly)
        .afterwards()
        .next(saveAlert)
    );

    // StateMachine: 異常気象監視WF
    const alertWf = new sfn.StateMachine(this, "WeatherAlertWorkflow", {
      stateMachineName: "weather-agent-alert-wf",
      comment:
        "異常気象監視ワークフロー — EventBridge(WeatherAnomalyDetected) → エージェント分析 → 重要度判定 → 通知/保存",
      definitionBody: sfn.DefinitionBody.fromChainable(alertDefinition),
      role: sfnRole,
      timeout: cdk.Duration.hours(1),
      tracingEnabled: true,
      logs: {
        destination: new logs.LogGroup(this, "AlertWfLogGroup", {
          logGroupName: "/aws/stepfunctions/weather-alert-wf",
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
        level: sfn.LogLevel.ALL,
      },
    });

    // --- EventBridge Rule → Step Functions ターゲット ---
    // 学習ポイント: イベントを Step Functions にルーティングする Rule を定義する。
    // EventStack（TASK-012）では Archive 用の Rule のみ定義し、
    // ターゲット付きの Rule はこのスタックで定義することで循環参照を避ける。
    //
    // 本番構成との違い:
    //   本番では Rule とターゲットを同一スタックに配置するのがベストプラクティス。
    //   CDK のクロススタック参照で循環が起きる場合はこの方式で回避する。

    // Rule: WeatherDataFetched → 天気分析WF
    new events.Rule(this, "WeatherDataFetchedRule", {
      ruleName: "weather-agent-data-fetched-to-wf",
      description:
        "WeatherDataFetched イベントを天気分析 WF にルーティング",
      eventBus: props.eventBus,
      eventPattern: {
        source: ["weather-agent.ingest"],
        detailType: ["WeatherDataFetched"],
      },
      targets: [new eventsTargets.SfnStateMachine(weatherAnalysisWf)],
    });

    // Rule: WeatherAnomalyDetected → 異常気象監視WF
    new events.Rule(this, "WeatherAnomalyDetectedRule", {
      ruleName: "weather-agent-anomaly-detected-to-wf",
      description:
        "WeatherAnomalyDetected イベントを異常気象監視 WF にルーティング",
      eventBus: props.eventBus,
      eventPattern: {
        source: ["weather-agent.scorer"],
        detailType: ["WeatherAnomalyDetected"],
      },
      targets: [new eventsTargets.SfnStateMachine(alertWf)],
    });

    // --- CloudFormation 出力 ---
    new cdk.CfnOutput(this, "WeatherAnalysisWfArn", {
      value: weatherAnalysisWf.stateMachineArn,
      description: "天気分析ワークフロー ARN",
      exportName: "WeatherAgentAnalysisWfArn",
    });

    new cdk.CfnOutput(this, "WeatherAlertWfArn", {
      value: alertWf.stateMachineArn,
      description: "異常気象監視ワークフロー ARN",
      exportName: "WeatherAgentAlertWfArn",
    });
  }
}

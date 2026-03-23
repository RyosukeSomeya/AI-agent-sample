import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as xray from "aws-cdk-lib/aws-xray";
import { Construct } from "constructs";

/**
 * ObservabilityStack のプロパティ
 */
export interface ObservabilityStackProps extends cdk.StackProps {
  /** RuntimeStack で作成した IAM ロール（Observability 権限を追加する） */
  runtimeRole: iam.IRole;
}

/**
 * ObservabilityStack - CloudWatch ダッシュボード・アラーム定義（Step 6）
 *
 * 学習ポイント:
 *   - AgentCore Observability は OTel (OpenTelemetry) トレースを自動生成する（Lab 4 対応）
 *   - エージェントの呼び出しごとにスパンが生成され、CloudWatch に送信される
 *   - CDK で CloudWatch ダッシュボードとアラームを構築し、End-to-End 監視を実現する
 *   - Transaction Search を有効にすると、トレースをフィルタリング・検索できる
 *
 * 本番構成との違い:
 *   - 本番では SNS トピック経由でアラーム通知を PagerDuty / Slack 等に連携するが、
 *     サンプルではアラーム定義のみ（通知先は GatewayStack で設定予定）
 *   - 本番ではカスタムメトリクスを追加してビジネスKPIも監視するが、
 *     サンプルではAgentCore が自動生成する基本メトリクスのみ使用する
 *   - 本番では X-Ray のサンプリングレートを調整するが、サンプルではデフォルト設定
 */
export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // --- CloudWatch Logs ロググループ ---
    // 学習ポイント: AgentCore Runtime はログを CloudWatch Logs に送信する。
    // ロググループを明示的に作成し、保持期間を設定する。
    // ログ配信自体は deploy.sh 内の setup_observability.py で設定する
    // （V2 Vended Logs はリソースベースポリシーが必要で、CDK では設定できないため）。
    const logGroup = new logs.LogGroup(this, "AgentCoreLogGroup", {
      logGroupName: "/aws/vendedlogs/agentcore/weather-agent",
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // --- メトリクス定義 ---
    // 学習ポイント: AgentCore Observability はエージェント呼び出しのメトリクスを
    // 自動的に CloudWatch に送信する。以下のメトリクスが利用可能:
    // - gen_ai.client.operation.duration: エージェント呼び出しのレイテンシ
    // - gen_ai.client.token.usage: トークン使用量
    // これらは OTel 準拠のメトリクス名で CloudWatch Metrics に送信される

    // メトリクス名前空間: AgentCore が自動生成するメトリクスの名前空間
    const metricNamespace = "AgentCore/WeatherAgent";

    // エージェント呼び出し回数メトリクス
    // 学習ポイント: Invocations メトリクスでエージェントの利用状況を把握する
    const invocationMetric = new cloudwatch.Metric({
      namespace: metricNamespace,
      metricName: "Invocations",
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
      label: "呼び出し回数",
    });

    // レイテンシメトリクス（平均応答時間）
    // 学習ポイント: Lab 4 で学ぶ OTel スパンの duration がこのメトリクスに対応する
    const latencyMetric = new cloudwatch.Metric({
      namespace: metricNamespace,
      metricName: "Duration",
      statistic: "Average",
      period: cdk.Duration.minutes(5),
      label: "平均レイテンシ (ms)",
    });

    // エラー回数メトリクス
    const errorMetric = new cloudwatch.Metric({
      namespace: metricNamespace,
      metricName: "Errors",
      statistic: "Sum",
      period: cdk.Duration.minutes(5),
      label: "エラー回数",
    });

    // エラー率メトリクス（MathExpression で算出）
    // 学習ポイント: CloudWatch の MathExpression を使い、
    // エラー回数 / 呼び出し回数 でエラー率を算出する
    const errorRateExpression = new cloudwatch.MathExpression({
      expression: "IF(invocations > 0, errors / invocations * 100, 0)",
      usingMetrics: {
        invocations: invocationMetric,
        errors: errorMetric,
      },
      period: cdk.Duration.minutes(5),
      label: "エラー率 (%)",
    });

    // --- CloudWatch ダッシュボード ---
    // 学習ポイント: ダッシュボードでエージェントの稼働状況を一目で把握する。
    // AgentCore ワークショップ Lab 4 で Transaction Search と合わせて確認する。
    const dashboard = new cloudwatch.Dashboard(this, "AgentDashboard", {
      dashboardName: "WeatherAgent-Monitoring",
      // 学習ポイント: defaultInterval でダッシュボードの初期表示期間を設定する
      defaultInterval: cdk.Duration.hours(3),
    });

    // ダッシュボードにウィジェットを追加
    // 1行目: 呼び出し回数とエラー率
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "エージェント呼び出し回数",
        left: [invocationMetric],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: "エラー率 (%)",
        left: [errorRateExpression],
        width: 12,
        height: 6,
      })
    );

    // 2行目: レイテンシとエラー回数
    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: "平均レイテンシ (ms)",
        left: [latencyMetric],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: "エラー回数",
        left: [errorMetric],
        width: 12,
        height: 6,
      })
    );

    // 3行目: ログインサイトクエリ（最新のエラーログ）
    // 学習ポイント: Logs Insights でエージェントのエラーをリアルタイムに確認できる
    dashboard.addWidgets(
      new cloudwatch.LogQueryWidget({
        title: "最新エラーログ",
        logGroupNames: [logGroup.logGroupName],
        queryLines: [
          "fields @timestamp, @message",
          "filter @message like /ERROR/",
          "sort @timestamp desc",
          "limit 20",
        ],
        width: 24,
        height: 6,
      })
    );

    // --- CloudWatch アラーム ---
    // 学習ポイント: アラームを設定して異常を自動検知する。
    // 本番では SNS トピックに通知を送るが、サンプルではアラーム定義のみ。

    // エラー率アラーム: エラー率 > 5% で ALARM 状態に遷移
    // 学習ポイント: evaluationPeriods と datapointsToAlarm の組み合わせで
    // 一時的なスパイクと持続的な問題を区別する（M of N アラーム）
    const errorRateAlarm = new cloudwatch.Alarm(this, "ErrorRateAlarm", {
      alarmName: "WeatherAgent-HighErrorRate",
      alarmDescription:
        "エージェントのエラー率が5%を超えています。CloudWatch Logs でエラー内容を確認してください。",
      metric: errorRateExpression,
      threshold: 5,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // レイテンシアラーム: 平均レイテンシ > 30秒 で ALARM 状態に遷移
    // 学習ポイント: AgentCore Runtime の microVM コールドスタート等で
    // レイテンシが増加することがある。持続的な場合はスケーリング設定を見直す。
    const latencyAlarm = new cloudwatch.Alarm(this, "LatencyAlarm", {
      alarmName: "WeatherAgent-HighLatency",
      alarmDescription:
        "エージェントの平均レイテンシが30秒を超えています。Runtime のスケーリング設定を確認してください。",
      metric: latencyMetric,
      threshold: 30000,
      evaluationPeriods: 3,
      datapointsToAlarm: 2,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // --- X-Ray トレースグループ ---
    // 学習ポイント: X-Ray グループを作ると、トレースをフィルタ式で絞り込める。
    // AgentCore が自動生成する OTel トレースは X-Ray に送信される（Lab 4 対応）。
    // グループごとに CloudWatch メトリクスが生成されるため、
    // 「エラーになったトレースだけ」のレイテンシ推移なども監視できる。
    //
    // 本番構成との違い:
    //   本番ではサービスごと・環境ごとにグループを分けるが、
    //   サンプルでは全トレースとエラートレースの2グループのみ。
    const traceGroup = new xray.CfnGroup(this, "AgentTraceGroup", {
      groupName: "WeatherAgent-AllTraces",
      // フィルタ式: すべてのトレースを対象にする
      // 本番では service("weather-agent") のようにサービス名で絞り込む
      filterExpression: 'annotation.aws_agent_name = "weather-agent"',
      insightsConfiguration: {
        insightsEnabled: true,
        notificationsEnabled: false, // サンプルでは通知なし（TASK-014 で設定予定）
      },
    });

    // エラートレース専用グループ
    // 学習ポイント: エラーが発生したトレースだけを集めるグループ。
    // 障害調査時に「エラーになった呼び出しだけ」を素早く特定できる。
    const errorTraceGroup = new xray.CfnGroup(this, "ErrorTraceGroup", {
      groupName: "WeatherAgent-Errors",
      filterExpression: 'fault = true OR error = true',
      insightsConfiguration: {
        insightsEnabled: true,
        notificationsEnabled: false,
      },
    });

    // --- X-Ray サンプリングルール ---
    // 学習ポイント: サンプリングルールで「どのリクエストのトレースを記録するか」を制御する。
    // 全リクエストを記録するとコストが高くなるため、本番ではサンプリングレートを下げる。
    // サンプルではトラフィックが少ないため、全リクエスト（100%）を記録する。
    //
    // 本番構成との違い:
    //   本番では fixedRate を 0.05〜0.1（5〜10%）に設定してコストを抑えるが、
    //   サンプルでは 1.0（100%）で全トレースを記録する。
    new xray.CfnSamplingRule(this, "AgentSamplingRule", {
      samplingRule: {
        ruleName: "WeatherAgentSampling",
        priority: 100,
        fixedRate: 1.0, // 100% — サンプルでは全リクエストを記録
        reservoirSize: 1, // 1秒あたり最低1リクエストは必ず記録
        serviceName: "*",
        serviceType: "*",
        host: "*",
        httpMethod: "*",
        urlPath: "*",
        resourceArn: "*",
        version: 1,
      },
    });

    // --- Transaction Search 設定 ---
    // 学習ポイント: Transaction Search を有効にすると、X-Ray トレースを
    // CloudWatch コンソールから検索・フィルタリング・可視化できるようになる。
    // トレースの「保存期間」と「インデックス化するトレースの割合」を設定する。
    //
    // 本番構成との違い:
    //   本番では indexingPercentage を下げてコストを抑える場合があるが、
    //   サンプルでは 100% でインデックス化する。
    new xray.CfnTransactionSearchConfig(this, "TransactionSearchConfig", {
      // Transaction Search のインデックス化割合（100% = 全トレース）
      indexingPercentage: 100,
    });

    // RuntimeStack のロールに CloudWatch 関連の権限を追加
    // 学習ポイント: AgentCore Runtime がメトリクス・ログ・トレースを送信するために必要
    props.runtimeRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "CloudWatchObservability",
        effect: iam.Effect.ALLOW,
        actions: [
          // メトリクス送信
          "cloudwatch:PutMetricData",
          // ログ送信
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          // X-Ray トレース送信（OTel トレースの送信先）
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          // X-Ray トレース読み取り（Insights・Transaction Search で必要）
          "xray:GetTraceSummaries",
          "xray:BatchGetTraces",
          "xray:GetServiceGraph",
        ],
        resources: ["*"],
      })
    );

    // --- CloudFormation 出力 ---
    new cdk.CfnOutput(this, "DashboardUrl", {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=WeatherAgent-Monitoring`,
      description: "CloudWatch ダッシュボード URL",
      exportName: "WeatherAgentDashboardUrl",
    });

    new cdk.CfnOutput(this, "LogGroupName", {
      value: logGroup.logGroupName,
      description: "AgentCore ログ グループ名",
      exportName: "WeatherAgentLogGroupName",
    });

    new cdk.CfnOutput(this, "ErrorRateAlarmArn", {
      value: errorRateAlarm.alarmArn,
      description: "エラー率アラーム ARN（GatewayStack で SNS 通知に使用）",
      exportName: "WeatherAgentErrorRateAlarmArn",
    });

    new cdk.CfnOutput(this, "LatencyAlarmArn", {
      value: latencyAlarm.alarmArn,
      description: "レイテンシアラーム ARN",
      exportName: "WeatherAgentLatencyAlarmArn",
    });

    new cdk.CfnOutput(this, "TraceGroupName", {
      value: traceGroup.groupName!,
      description: "X-Ray トレースグループ名（全トレース）",
      exportName: "WeatherAgentTraceGroupName",
    });

    new cdk.CfnOutput(this, "ErrorTraceGroupName", {
      value: errorTraceGroup.groupName!,
      description: "X-Ray トレースグループ名（エラーのみ）",
      exportName: "WeatherAgentErrorTraceGroupName",
    });
  }
}

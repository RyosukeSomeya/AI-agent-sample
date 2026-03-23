# TASK-010 解説: CDK ObservabilityStack

## 1. このタスクで何を作ったか

**エージェントの「健康診断ダッシュボード」と「異常アラート」を作った。** エージェントが何回呼ばれたか、応答にどれくらい時間がかかっているか、エラーがどれくらい起きているかをグラフで一目で確認できるようにし、エラー率が高くなったら自動で警告が出る仕組みを構築した。

日常の例えでいうと、お店に「来客カウンター」「接客時間の計測器」「クレーム率モニター」を設置したようなものです。さらに、クレーム率が一定を超えると自動で店長に通知が飛ぶ仕組み（アラーム）も付けました。

---

## 2. 作成・変更したファイル一覧

### 2.1 `packages/infra/lib/observability-stack.ts` — 監視基盤の「設計図」（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | CloudWatch ダッシュボード、アラーム、ログ設定を定義する CDK スタック |
| なぜ必要か | エージェントが正常に動いているか確認する手段がないと、障害に気づけない |
| 中身の要点 | メトリクス4種、ダッシュボード3行、アラーム2つ、IAM権限、ログ設定 |
| 関連技術 | AWS CDK（TypeScript）/ CloudWatch / X-Ray |

TSでいう **CDK のカスタムスタッククラス**（`extends cdk.Stack`）です。Laravelでいうと **Telescope のダッシュボード設定** に近い — アプリケーションの稼働状況を可視化する「管理画面」をインフラとして定義しています。

#### ログ設定 — 「日記帳の箱」を用意する

```typescript
const logGroup = new logs.LogGroup(this, "AgentCoreLogGroup", {
  logGroupName: "/aws/vendedlogs/agentcore/weather-agent",
  // ↑ TSでいう winston のログファイルパス指定
  //   Laravelでいう config/logging.php の 'path' 設定
  retention: logs.RetentionDays.ONE_MONTH,  // 1ヶ月で自動削除
  removalPolicy: cdk.RemovalPolicy.DESTROY, // スタック削除時にログも削除
});
```

AgentCore Runtime はエージェントの動作ログを自動的に CloudWatch Logs に送ります。このロググループは「ログの保管場所」を事前に用意しておくもの。Laravelでいう `storage/logs/` フォルダを作っておくイメージです。

#### メトリクス定義 — 「何を計測するか」を決める

メトリクスとは「数値で測れる指標」のことです。お店でいう「来客数」「待ち時間」「クレーム件数」にあたります。

```typescript
const metricNamespace = "AgentCore/WeatherAgent";
// ↑ メトリクスのグループ名。TSでいう import のパス、Laravelでいう namespace と同じ概念

// 呼び出し回数（何回エージェントが使われたか）
const invocationMetric = new cloudwatch.Metric({
  namespace: metricNamespace,
  metricName: "Invocations",    // メトリクス名（来客カウンター）
  statistic: "Sum",             // 合計値を使う
  period: cdk.Duration.minutes(5), // 5分ごとに集計
  // ↑ Laravelでいう Horizon の polling_interval に近い
});

// レイテンシ（応答にかかった時間）
const latencyMetric = new cloudwatch.Metric({
  metricName: "Duration",       // 接客時間の計測器
  statistic: "Average",         // 平均値を使う
  // ...
});

// エラー回数
const errorMetric = new cloudwatch.Metric({
  metricName: "Errors",         // クレームカウンター
  statistic: "Sum",
  // ...
});
```

#### エラー率の計算 — 「数式でメトリクスを組み合わせる」

```typescript
const errorRateExpression = new cloudwatch.MathExpression({
  expression: "IF(invocations > 0, errors / invocations * 100, 0)",
  // ↑ 「呼び出しが0回なら0%、それ以外はエラー数÷呼び出し数×100」
  //   TSでいう三項演算子: invocations > 0 ? (errors / invocations * 100) : 0
  //   Laravelでいう Blade の @if ディレクティブに近い条件分岐
  usingMetrics: {
    invocations: invocationMetric,  // ← 上で定義したメトリクスを変数として使う
    errors: errorMetric,
  },
  label: "エラー率 (%)",
});
```

`MathExpression` は「既存のメトリクスを数式で組み合わせて新しい指標を作る」機能。SQLでいう計算カラム（`SELECT errors * 100.0 / invocations AS error_rate`）に近い考え方です。

#### ダッシュボード — 「監視画面」を組み立てる

```typescript
const dashboard = new cloudwatch.Dashboard(this, "AgentDashboard", {
  dashboardName: "WeatherAgent-Monitoring",
  defaultInterval: cdk.Duration.hours(3),  // 初期表示は直近3時間
});

// 1行目: 呼び出し回数 + エラー率のグラフ
dashboard.addWidgets(
  new cloudwatch.GraphWidget({
    title: "エージェント呼び出し回数",
    left: [invocationMetric],  // ← 左Y軸にこのメトリクスを表示
    width: 12,   // 横幅12（画面の半分。全体は24）
    height: 6,
    // ↑ TSでいう CSS の grid-column / grid-row に近い
    //   Laravelでいう Blade コンポーネントの width props
  }),
  new cloudwatch.GraphWidget({ title: "エラー率 (%)", /* ... */ })
);

// 3行目: エラーログのリアルタイム表示
dashboard.addWidgets(
  new cloudwatch.LogQueryWidget({
    title: "最新エラーログ",
    logGroupNames: [logGroup.logGroupName],
    queryLines: [
      "fields @timestamp, @message",       // 表示する列
      "filter @message like /ERROR/",       // ERROR を含むログだけ
      "sort @timestamp desc",              // 新しい順
      "limit 20",                          // 20件まで
      // ↑ Laravelでいう Log::where('level', 'error')->latest()->take(20)
      //   TSでいう array.filter().sort().slice(0, 20)
    ],
    width: 24,   // 横幅いっぱい
  })
);
```

ダッシュボードは3行構成:
- **1行目:** 呼び出し回数 & エラー率（「今日の来客数」と「クレーム率」）
- **2行目:** レイテンシ & エラー回数（「平均待ち時間」と「クレーム件数」）
- **3行目:** 最新エラーログ（「クレーム台帳の直近20件」）

#### アラーム — 「異常が起きたら自動通知」

```typescript
const errorRateAlarm = new cloudwatch.Alarm(this, "ErrorRateAlarm", {
  alarmName: "WeatherAgent-HighErrorRate",
  metric: errorRateExpression,   // 監視対象: エラー率
  threshold: 5,                  // 5% を超えたら
  evaluationPeriods: 3,          // 直近3回の計測期間（= 15分間）のうち
  datapointsToAlarm: 2,          // 2回以上超えたら ALARM 状態に
  // ↑ これが「M of N アラーム」パターン
  //   3回中2回 = 一時的な1回の spike では鳴らない（誤報防止）
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  // ↑ データがない（エージェント未使用）時はアラームを鳴らさない
});
```

**M of N アラームとは？** 「直近N回の計測のうちM回超えたら警告」という仕組み。1回だけ瞬間的にエラーが出ても鳴らず、「じわじわ悪化」しているときだけ鳴る。お店でいうと「1回クレームが来ただけでは店長呼ばないけど、15分間で2回来たら呼ぶ」というルールです。

レイテンシアラームも同じパターンで、平均30秒超が続くと警告が出ます。

#### IAM 権限 — 「エージェントにログ送信の許可証を渡す」

```typescript
props.runtimeRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    actions: [
      "cloudwatch:PutMetricData",    // メトリクス送信（来客カウンターに数字を書く）
      "logs:CreateLogStream",         // ログストリーム作成（日記帳の新しいページ）
      "logs:PutLogEvents",            // ログ書き込み（日記を書く）
      "xray:PutTraceSegments",        // トレース送信（Lab 4 の OTel トレース）
      "xray:PutTelemetryRecords",     // テレメトリ送信
      // ↑ Laravelでいう Storage::put() の権限を Gate で許可するイメージ
    ],
    resources: ["*"],
  })
);
```

TASK-007 で作った RuntimeStack の IAM ロール（社員証）に「CloudWatch への書き込み権限」を追加しています。TASK-009 で Memory 権限を追加したのと全く同じパターンです。

### 2.2 `packages/infra/bin/app.ts` — CDK アプリのエントリポイント（変更）

| 項目 | 内容 |
|---|---|
| これは何か | CDK アプリ全体の「起動スクリプト」。どのスタックを作るか決める |
| なぜ必要か | ObservabilityStack を追加しないと `cdk deploy` で認識されない |
| 中身の要点 | ObservabilityStack のインポートとインスタンス化を追加 |
| 関連技術 | AWS CDK（TypeScript） |

TSでいう `index.ts`（エントリポイント）、Laravelでいう `routes/web.php` に近い役割。

```typescript
import { ObservabilityStack } from "../lib/observability-stack";
// ↑ TSでいう import { Router } from './router'
//   Laravelでいう use App\Http\Controllers\XxxController

const observabilityStack = new ObservabilityStack(app, "ObservabilityStack", {
  runtimeRole: runtimeStack.runtimeRole,
  // ↑ RuntimeStack のロール（社員証）を渡して「ここに CloudWatch 権限を追加してね」と依頼
});
observabilityStack.addDependency(runtimeStack);
// ↑ 「RuntimeStack が先にデプロイされてからObservabilityStackをデプロイしてね」
//   Laravelでいう マイグレーションの依存順序と同じ考え方
```

**なぜ MemoryStack ではなく RuntimeStack に依存するか？** ObservabilityStack は RuntimeStack のロールに権限を追加するだけで、MemoryStack とは直接の関係がないためです。CDK の依存関係は「最低限必要なもの」だけにするのがベストプラクティスです。

---

## 3. ファイル間の関係図

```
packages/infra/（CDK — TypeScript）

┌─────────────────────────────────────────────────┐
│ bin/app.ts（エントリポイント）                      │
│                                                   │
│  StorageStack ─────→ S3バケット                   │
│      ↓                                            │
│  RuntimeStack ─────→ IAM ロール（社員証）          │
│      ↓         ↓                                  │
│  MemoryStack   ObservabilityStack ← 今回作成!     │
│  (Memory権限)  │                                  │
│                ├─→ ロググループ（ログの保管場所）    │
│                ├─→ ダッシュボード（監視画面）       │
│                │    ├ 呼び出し回数グラフ            │
│                │    ├ エラー率グラフ                │
│                │    ├ レイテンシグラフ              │
│                │    ├ エラー回数グラフ              │
│                │    └ エラーログクエリ              │
│                ├─→ アラーム（自動警告）             │
│                │    ├ エラー率 > 5%                │
│                │    └ レイテンシ > 30秒            │
│                └─→ IAM権限追加                     │
│                     （CloudWatch + X-Ray 書込許可）│
└─────────────────────────────────────────────────┘

データの流れ:
  AgentCore Runtime（エージェント実行環境）
       │
       │ OTel（OpenTelemetry）で自動送信
       │
       ↓
  CloudWatch（AWSの監視サービス）
       ├─→ Metrics（数値データ）→ ダッシュボードのグラフ
       ├─→ Logs（テキストログ）→ ダッシュボードのログクエリ
       └─→ Traces（実行経路）→ Transaction Search
```

---

## 4. 今回登場した技術・用語の解説

### CloudWatch（クラウドウォッチ）

**それは何か:** AWS の監視サービス。アプリケーションの「健康状態」を数値・グラフ・ログで確認できる。

**なぜ使うか:** エージェントが遅くなったり、エラーが増えたりしても、監視がなければ気づけない。CloudWatch があれば「今日エラー率が上がってるぞ」と即座にわかる。

**日常の例え:** 車のダッシュボード。速度計・燃料計・エンジン警告灯がまとめて表示されるのと同じ。CloudWatch はAWSサービスのダッシュボード。

**TS/Laravel対応:** Laravelでいう **Telescope**（ローカル監視）+ **Horizon**（Queueの監視）をクラウド規模にしたもの。TSでいうと Datadog や New Relic に近い位置づけ。

### CloudWatch Metric（メトリクス）

**それは何か:** 「数値で計測できる指標」のこと。呼び出し回数・レイテンシ・エラー回数など。

**なぜ使うか:** 数値化しないと「なんとなく遅い気がする」で終わってしまう。メトリクスがあれば「平均レイテンシが昨日の2倍になっている」と客観的に判断できる。

**日常の例え:** 体温計・血圧計。「体調が悪い」ではなく「38.5度ある」と数値で把握できる。

### CloudWatch Dashboard（ダッシュボード）

**それは何か:** メトリクスやログをグラフ・表で一覧表示するWebページ。

**なぜ使うか:** メトリクスが10個あっても、バラバラに見ていたら全体像がわからない。ダッシュボードに集約すると一目で異常に気づける。

**日常の例え:** 車のダッシュボードそのもの。速度・燃料・エンジン温度が一箇所にまとまっている。

### CloudWatch Alarm（アラーム）

**それは何か:** メトリクスが閾値（しきいち）を超えたら自動で通知する仕組み。

**なぜ使うか:** 24時間ダッシュボードを見張っているわけにはいかない。アラームを設定しておけば、異常時だけ通知が飛ぶ。

**日常の例え:** 火災報知器。煙を検知したら自動でブザーが鳴る。常に監視しなくても安全が保たれる。

### M of N アラーム

**それは何か:** 「直近N回の計測のうちM回超えたら警告」というアラーム条件。

**なぜ使うか:** 1回だけ瞬間的にエラーが出ることはよくある（ネットワークの一時的な問題など）。M of N にすると「たまたま1回」では鳴らず「じわじわ悪化」しているときだけ鳴る。

**日常の例え:** 「1回忘れ物しただけでは注意しないけど、3日間で2回忘れたら注意する」というルール。

### OTel / OpenTelemetry（オープンテレメトリ）

**それは何か:** アプリケーションの「実行経路」を自動記録するオープンソースの標準規格。「この処理にX秒かかった」「次にあの処理を呼んだ」という情報（トレース）を構造化データとして収集する。

**なぜ使うか:** エージェントの内部処理（モデル呼び出し → ツール実行 → 応答生成）のどこがボトルネックかを特定できる。

**日常の例え:** 宅配便の追跡番号。「今どこにいて、各拠点に何時に到着したか」がわかる。OTel はアプリケーション内部の処理を「追跡」する仕組み。

**重要ポイント:** AgentCore は OTel トレースを **自動生成** する（Lab 4 で学ぶ）。開発者が手動でトレースコードを書く必要がない。

### Transaction Search（トランザクションサーチ）

**それは何か:** CloudWatch の機能で、OTel トレースを検索・フィルタリング・可視化できる。「昨日のエラーになった呼び出し」「レイテンシが10秒以上の呼び出し」などで絞り込める。

**なぜ使うか:** 「エラー率が高い」とわかっても「どの呼び出しがエラーだったか」がわからないと修正できない。Transaction Search で問題のある呼び出しを特定する。

**日常の例え:** 防犯カメラの録画検索。「昨日の14時〜15時の映像」を検索して問題の瞬間を特定するのと同じ。

**注意:** CDK では直接設定できないため、CloudWatch コンソールから手動で有効化する。

### X-Ray

**それは何か:** AWS のトレーシングサービス。OTel トレースの送信先の一つ。

**なぜ使うか:** CloudWatch と連携して、トレースをサービスマップ（処理の流れ図）として可視化できる。

### MathExpression（マスエクスプレッション）

**それは何か:** CloudWatch の機能で、複数のメトリクスを数式で組み合わせて新しいメトリクスを作る。

**なぜ使うか:** 「エラー率」は「エラー数」と「呼び出し数」を割り算して算出する必要がある。MathExpression を使えばリアルタイムに計算できる。

**TS/Laravel対応:** SQLの計算カラム（`SELECT errors / invocations * 100 AS error_rate`）、TSでいう computed property、Laravelでいう Accessor（`getErrorRateAttribute()`）に近い。

### Logs Insights（ログ インサイツ）

**それは何か:** CloudWatch Logs に対して SQL ライクなクエリを実行できる機能。

**なぜ使うか:** ログが大量にあるとき、grep で探すのは大変。Logs Insights なら「ERROR を含むログを新しい順に20件」のようなクエリが書ける。

**TS/Laravel対応:** Laravelでいう `Log::where(...)->get()`、TSでいう配列の `filter().sort().slice()` をログに対して実行するイメージ。

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップ対応

| Lab | 関連内容 |
|---|---|
| **Lab 4** | AgentCore Observability の OTel トレース自動生成、CloudWatch での監視 |

Lab 4 の中心テーマは「エージェントの監視・可視化」。今回の TASK-010 は、Lab 4 で学ぶ Observability の概念を CDK で実装したものです。AgentCore が自動生成する OTel トレース・メトリクスを CloudWatch で受け取り、ダッシュボードとアラームで可視化・監視する仕組みを構築しました。

### 本番構成との対応

| 本番構成 | サンプル構成 | 状態 |
|---|---|---|
| CloudWatch ダッシュボード + カスタムメトリクス | 基本メトリクスのみのダッシュボード | 簡略版 |
| SNS → PagerDuty/Slack でアラーム通知 | アラーム定義のみ（通知先なし） | 簡略版 |
| X-Ray サンプリングレート調整 | デフォルト設定 | 簡略版 |
| X-Ray サービスマップ連携 | Logs Insights クエリで代替 | 簡略版 |

### 本番との違い（簡略化した部分）

| 項目 | 本番 | サンプル | 理由 |
|---|---|---|---|
| アラーム通知先 | SNS → Slack / PagerDuty 連携 | 通知先未設定（TASK-014 で設定予定） | GatewayStack でまとめて設定するため |
| カスタムメトリクス | ビジネスKPI（分析完了数、ユーザー満足度等） | AgentCore 標準メトリクスのみ | 学習目的のため基本に絞る |
| X-Ray サンプリング | トラフィックに応じて調整（例: 10%） | 100%（デフォルト） | サンプルはトラフィックが少ないため |
| Transaction Search | CDK or IaC で有効化 | コンソールから手動有効化 | CDK に L2 コンストラクトがないため |
| ログ配信設定 | CDK で完結 | deploy.sh 内で別途設定 | V2 Vended Logs の制約 |

---

## 6. 次のタスクへのつながり

```
TASK-010（今回）                    次のタスクたち
CloudWatch 監視基盤を構築
  │
  ├──→ TASK-012: EventStack
  │     └─ Lambda のメトリクスもダッシュボードで監視できるようになる
  │       （EventBridge Scheduler が正常に動いているか等）
  │
  ├──→ TASK-013: OrchestrationStack（Step Functions）
  │     └─ Step Functions の実行状況（成功/失敗/タイムアウト）も
  │        CloudWatch で監視。アラームと組み合わせて「WF失敗→通知」が可能に
  │
  └──→ TASK-014: GatewayStack（Gateway + Guardrails + 通知）
        └─ このタスクで作ったアラーム ARN を使って
           SNS トピック経由で Slack / メール通知を設定する
           （Laravelでいう Notification を飛ばす先を決める）
```

今回は「監視の仕組み」を構築しましたが、まだ「異常が起きたときに誰かに通知する」部分は未設定です（アラームは鳴るが、通知先がない状態）。TASK-014 の GatewayStack で SNS トピックを作成し、アラームと紐づけることで「エラー率5%超 → Slack に通知」という本番運用に近い監視フローが完成します。

また、TASK-010 で作った `ErrorRateAlarmArn` と `LatencyAlarmArn` は CloudFormation の Export として公開されているので、他のスタックから `Fn.importValue()` で参照できます。これは TASK-007 で StorageStack が `DataBucketName` を Export し、RuntimeStack がそれを参照したのと同じパターンです。

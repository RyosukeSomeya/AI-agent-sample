# TASK-012 解説: CDK EventStack（Scheduler + EventBridge + Lambda）

## 1. このタスクで何を作ったか

**前回作った2つのプログラム（天気取得・異常チェック）を「毎朝自動で動かす仕組み」と「結果を次の人に伝える仕組み」を構築した。** 毎朝9時にタイマーが鳴ってデータ収集が始まり、9時半にAIが異常をチェックし、「データ取得完了」「異常発見」のお知らせが自動的に掲示板に貼り出される。

日常の例えでいうと、TASK-011 では「天気を調べる人」と「異常をチェックする人」を雇いましたが、今回は「朝礼で毎日指示を出す司会者（Scheduler）」「各部署に連絡する社内掲示板（EventBridge）」「過去の掲示を保管する倉庫（Archive）」を作ったイメージです。

---

## 2. 作成・変更したファイル一覧

### 2.1 `packages/infra/lib/event-stack.ts` — イベント駆動基盤の「設計図」（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | Lambda、EventBridge、Scheduler をまとめて定義する CDK スタック |
| なぜ必要か | Lambda の「中身」だけでは AWS 上で動かせない。「いつ起動するか」「結果をどう伝えるか」のインフラ設定が必要 |
| 中身の要点 | Lambda x2、Scheduler x2、EventBus、Rule x2、Archive |
| 関連技術 | AWS CDK（TypeScript）/ EventBridge / Lambda |

TSでいう **CDK のカスタムスタッククラス**。Laravelでいうと **`config/queue.php`（Queue設定）+ `app/Console/Kernel.php`（Task Scheduling）+ `routes/channels.php`（Broadcasting）** を1つのファイルにまとめたようなもの。

このファイルは大きく5つのパートに分かれます。

#### パート1: EventBridge カスタムバス — 「専用の掲示板」

```typescript
this.eventBus = new events.EventBus(this, "WeatherAgentBus", {
  eventBusName: "weather-agent-bus",
});
// ↑ Laravelでいう Broadcasting の channel を作るイメージ
//   TSでいう EventEmitter のインスタンスを作成
```

**イベントバスとは？** イベント（メッセージ）が流れる「パイプ」のこと。AWS にはデフォルトのバスがあるが、カスタムバスを作ることで「このアプリのイベントだけ」を分離できる。Laravelでいう `private channel` に近い — 「weather-agent」のイベントだけが流れる専用チャンネル。

#### パート2: Archive — 「掲示板の保管庫」

```typescript
new events.Archive(this, "WeatherAgentArchive", {
  sourceEventBus: this.eventBus,    // どのバスのイベントを保存するか
  archiveName: "weather-agent-archive",
  eventPattern: {
    source: events.Match.prefix("weather-agent"),
    // ↑ source が "weather-agent" で始まるイベントをすべて保存
    //   Laravelでいう Event::listen('weather-agent.*', ...)
  },
  retention: cdk.Duration.days(30),  // 30日間保存
});
```

**なぜ Archive が必要？** 障害が起きたとき「あのイベントをもう一度流したい」ことがある。Archive があれば過去のイベントを「リプレイ」（再送）して復旧できる。Laravelでいう failed_jobs テーブルからジョブを retry するのに似ている。

#### パート3: Lambda 関数定義 — 「従業員を AWS に登録する」

TASK-011 で作った Python コード（ingest.py, scorer.py）を AWS Lambda として登録する。

```typescript
const ingestLambda = new lambda.Function(this, "IngestLambda", {
  functionName: "weather-agent-ingest",
  runtime: lambda.Runtime.PYTHON_3_12,        // Python 3.12 で動かす
  handler: "lambdas.ingest.handler",          // どの関数を呼ぶか
  // ↑ TSでいう "entry point" の指定
  //   Laravelでいう routes で Controller@method を指定するのと同じ

  code: lambda.Code.fromAsset("../../packages/agents/lambda-package"),
  // ↑ ソースコードの場所。事前に pip install でパッケージをビルドしておく
  //   TSでいう webpack の output directory を指定するイメージ

  timeout: cdk.Duration.seconds(30),          // 30秒でタイムアウト
  memorySize: 256,                            // メモリ 256MB
  environment: {
    WEATHER_AGENT_BUCKET: props.dataBucket.bucketName,
    // ↑ Laravelでいう .env の S3_BUCKET に相当
    //   TSでいう process.env.BUCKET_NAME
    EVENT_BUS_NAME: this.eventBus.eventBusName,
  },
});
```

**handler の意味:** `lambdas.ingest.handler` は「lambdas パッケージの ingest モジュールの handler 関数」。Laravelでいう `App\Jobs\IngestJob@handle`、TSでいう `export { handler } from './lambdas/ingest'` に対応。

**`code: lambda.Code.fromAsset(...)` の意味:** ローカルのディレクトリをzip化してAWSにアップロードする。TSでいうと `serverless deploy` 時にソースをパッケージングするのと同じ。

**scorer Lambda との違い:** scorer は Bedrock API を呼ぶため、タイムアウトが 60秒と長め（ingest は 30秒）。

#### パート4: Scheduler — 「毎朝の目覚まし時計」

```typescript
new scheduler.CfnSchedule(this, "IngestSchedule", {
  name: "weather-agent-ingest-schedule",
  scheduleExpression: "cron(0 0 * * ? *)",
  // ↑ cron式: 「毎日 0時0分 UTC」= JST 9:00
  //   Laravelでいう $schedule->dailyAt('09:00')
  //   TSでいう node-cron の '0 0 * * *'

  scheduleExpressionTimezone: "Asia/Tokyo",
  // ↑ Scheduler はタイムゾーンを直接指定できる（EventBridge Rule の cron にはない機能）

  flexibleTimeWindow: { mode: "OFF" },
  // ↑ 「ぴったりその時間に起動」（OFF = 柔軟性なし）
  //   ON にすると「前後15分のどこかで起動」になる（コスト削減用）

  target: {
    arn: ingestLambda.functionArn,   // どの Lambda を起動するか
    roleArn: schedulerRole.roleArn,  // どの権限で起動するか
  },
});
```

**Scheduler vs Rule の cron — なぜ Scheduler を使うか？**

EventBridge にはイベントをフィルタリングする Rule にも cron 機能がある。しかし Scheduler のほうが優れている点が多い:

| 比較項目 | EventBridge Rule (cron) | EventBridge Scheduler |
|---|---|---|
| タイムゾーン指定 | 不可（UTC固定） | 可（`Asia/Tokyo` 等） |
| 1回限り実行 | 不可 | 可（at 式） |
| リトライ設定 | なし | あり |
| Laravelでいうと | cron ジョブ | Task Scheduling |

#### パート5: Rule — 「掲示板の仕分けルール」

```typescript
this.weatherDataFetchedRule = new events.Rule(this, "WeatherDataFetchedRule", {
  eventBus: this.eventBus,
  eventPattern: {
    source: ["weather-agent.ingest"],
    detailType: ["WeatherDataFetched"],
    // ↑ 「source が weather-agent.ingest で、
    //    detailType が WeatherDataFetched のイベントだけキャッチ」
    //   Laravelでいう Event::listen(WeatherDataFetched::class, ...)
  },
  // ターゲットは OrchestrationStack（TASK-013）で追加する
});
```

**なぜターゲットがまだないのか？** Rule の「イベントをキャッチするフィルタ」は今回定義するが、「キャッチしたイベントを送る先（Step Functions）」は TASK-013 で構築する。そのため Rule だけ先に作っておき、ターゲットは後で追加する設計。

Laravelでいうと、`Event::listen(WeatherDataFetched::class)` だけ書いて、Listener の実装は別チケットで行うイメージ。

**`public readonly` で公開している理由:** OrchestrationStack から `eventStack.weatherDataFetchedRule` でアクセスして `addTarget()` するため。TSでいう `export` して他のモジュールから import できるようにするのと同じ。

### 2.2 `packages/infra/bin/app.ts` — CDK アプリのエントリポイント（変更）

| 項目 | 内容 |
|---|---|
| これは何か | CDK アプリ全体の「起動スクリプト」 |
| なぜ必要か | EventStack を追加しないと `cdk deploy` で認識されない |
| 中身の要点 | EventStack のインポートとインスタンス化、StorageStack への依存を追加 |
| 関連技術 | AWS CDK（TypeScript） |

```typescript
import { EventStack } from "../lib/event-stack";

const eventStack = new EventStack(app, "EventStack", {
  dataBucket: storageStack.dataBucket,
  // ↑ S3バケット名を Lambda の環境変数に渡すため
});
eventStack.addDependency(storageStack);
// ↑ StorageStack が先にデプロイされてから EventStack をデプロイ
//   Laravelでいう マイグレーションの依存順序
```

**なぜ RuntimeStack ではなく StorageStack に依存するか？** EventStack は S3 バケットの情報だけが必要で、AgentCore Runtime とは直接関係がない。Lambda はエージェント（AgentCore Runtime）とは独立して動く。

### 2.3 `docs/knowledge/cdk-lambda-no-docker-bundling.md` — ナレッジ（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | devcontainer 環境で CDK の Lambda バンドリングが失敗する問題と対処法 |
| なぜ必要か | 同じ問題に再度遭遇したときに解決策をすぐ見つけるため |
| 中身の要点 | Docker なし環境では事前ビルド方式を使う |
| 関連技術 | AWS CDK / Docker |

---

## 3. ファイル間の関係図

```
packages/infra/（CDK — TypeScript）         packages/agents/（Python）
┌─────────────────────────────────┐
│ bin/app.ts（エントリポイント）    │
│                                   │
│  StorageStack ─→ S3バケット      │
│    ↓ dataBucket                  │
│  EventStack ← 今回作成!          │
│    │                              │      ┌─────────────────────┐
│    ├─→ EventBus（掲示板）        │      │ lambda-package/      │
│    │    └─ Archive（保管庫）      │      │  (事前ビルド済み)    │
│    │                              │      │  ├─ lambdas/         │
│    ├─→ ingest Lambda ────────────┼─────→│  │  ├─ ingest.py    │
│    │    (毎日 9:00 JST)          │      │  │  └─ scorer.py    │
│    ├─→ scorer Lambda ────────────┼─────→│  ├─ shared/          │
│    │    (毎日 9:30 JST)          │      │  └─ collector/       │
│    │                              │      └─────────────────────┘
│    ├─→ Scheduler x2（タイマー）  │
│    │    └─ cron式で Lambda を起動 │
│    │                              │
│    └─→ Rule x2（仕分けルール）   │
│         ├─ WeatherDataFetched    │
│         │    → ターゲット未設定  │ ← TASK-013 で Step Functions を接続
│         └─ WeatherAnomalyDetected│
│              → ターゲット未設定  │ ← TASK-013 で Step Functions を接続
│                                   │
│  RuntimeStack, MemoryStack, ...  │
└─────────────────────────────────┘

処理の流れ（毎朝）:
  ┌──────────────┐
  │ Scheduler    │  9:00 JST
  │ (目覚まし)   │──────────→ ingest Lambda
  └──────────────┘                 │
                                   │ get_weather → S3保存
                                   │ put_events("WeatherDataFetched")
                                   ↓
                            ┌──────────────┐
                            │ EventBus     │  掲示板にイベントが貼られる
                            │ (掲示板)     │
                            └───┬──────┬───┘
                                │      │
                      Rule が   │      │  Rule が
                      キャッチ  │      │  キャッチ
                                ↓      ↓
                          (TASK-013)  (TASK-013)
                          天気分析WF  異常監視WF

  ┌──────────────┐
  │ Scheduler    │  9:30 JST
  │ (目覚まし)   │──────────→ scorer Lambda
  └──────────────┘                 │
                                   │ S3読取 → Bedrock スコアリング
                                   │ スコア > 0.7 なら
                                   │ put_events("WeatherAnomalyDetected")
                                   ↓
                            ┌──────────────┐
                            │ EventBus     │
                            │ (掲示板)     │
                            └──────────────┘
```

---

## 4. 今回登場した技術・用語の解説

### EventBridge Scheduler（スケジューラー）

**それは何か:** 決まった時間や間隔で Lambda を自動起動する AWS サービス。「毎朝9時に起動」のようなスケジュールを設定できる。

**なぜ使うか:** 人が毎朝「天気取得して」と手動で実行するわけにはいかない。Scheduler を使えば完全自動化できる。

**日常の例え:** 目覚まし時計。毎朝決まった時間にアラームが鳴り、Lambda を「起こす」。

**TS/Laravel対応:** Laravelでいう **Task Scheduling** (`$schedule->dailyAt('09:00')`)。TSでいうと **node-cron** や Vercel の **Cron Jobs**。

### cron 式

**それは何か:** 「いつ実行するか」を指定する書式。`cron(分 時 日 月 曜日 年)` の形式。

```
cron(0 0 * * ? *)
      │ │ │ │ │ └─ 年（*=毎年）
      │ │ │ │ └─── 曜日（?=指定なし）
      │ │ │ └───── 月（*=毎月）
      │ │ └─────── 日（*=毎日）
      │ └───────── 時（0=0時 UTC = 9時 JST）
      └─────────── 分（0=0分）
```

Laravelの `$schedule->cron('0 0 * * *')` とほぼ同じ。違いは AWS の cron には「年」フィールドがあること。

### EventBridge Rule（ルール）

**それは何か:** 「このイベントが来たら、あのサービスに転送する」という仕分けルール。

**なぜ使うか:** EventBus には様々なイベントが流れる。Rule がなければ、すべてのサービスがすべてのイベントを受け取ってしまう。Rule でフィルタリングすることで「天気データ取得イベントは分析WFへ」「異常検知イベントは監視WFへ」と適切にルーティングできる。

**日常の例え:** 郵便局の仕分け。封筒の宛名（detail-type）を見て「この手紙は東京支店へ」「この手紙は大阪支店へ」と振り分ける。

**TS/Laravel対応:** Laravelでいう **Event Listener のルーティング** (`Event::listen(WeatherDataFetched::class, HandleDataFetched::class)`)。TSでいうと `eventEmitter.on('WeatherDataFetched', handler)` で特定イベントだけ処理する。

### EventBridge Archive（アーカイブ）

**それは何か:** EventBus を流れるイベントを自動保存する機能。保存したイベントは後から「リプレイ」（再送）できる。

**なぜ使うか:** 障害でイベントが処理されなかった場合、Archive からリプレイすれば復旧できる。「昨日のデータ取得イベントをもう一度流す」といった使い方。

**日常の例え:** 会議の議事録。「先週の決定事項を再確認したい」ときに議事録を見返せる。さらに「その決定事項をもう一度実行する」こともできる。

**TS/Laravel対応:** Laravelでいう **failed_jobs テーブル** からのリトライ。TSでいうと Redis の Stream で消費済みメッセージを再処理するパターン。

### EventBridge カスタムバス

**それは何か:** デフォルトのイベントバスとは別に作る専用のイベントバス。

**なぜ使うか:** デフォルトバスは AWS の全サービスが使う共有バス。カスタムバスを作ることで「このアプリのイベントだけ」を分離し、ノイズを減らせる。

**日常の例え:** 社内 Slack のチャンネル。#general ではなく #weather-agent という専用チャンネルを作るイメージ。

### Lambda のパッケージング

**それは何か:** Python コードと依存ライブラリをまとめて AWS にアップロードすること。

**なぜ手動ビルドが必要か？** CDK には Docker を使った自動バンドリング機能があるが、devcontainer 環境では Docker-in-Docker が使えない。そのため `pip install --target lambda-package/` で手動ビルドする方式を採用した。

**TS/Laravel対応:** TSでいう `npm run build` → `dist/` をデプロイ。Laravelでいう `composer install --no-dev` → `vendor/` を含めてデプロイ。

### IAM ロール（Lambda 用）

**それは何か:** Lambda が「何にアクセスできるか」を定義する権限セット。

今回の Lambda ロールは3つの権限を持つ:
1. **S3 読み書き** — 天気データの保存・取得
2. **EventBridge イベント発行** — `put_events()` でイベントを送る
3. **Bedrock モデル呼び出し** — scorer が LLM でスコアリングする

Laravelでいうと Gate/Policy で「この Job は S3 にアクセスできる」と定義するイメージ。

### flexibleTimeWindow

**それは何か:** Scheduler の起動タイミングを「ぴったりその時間」にするか「前後N分のどこかで」にするかの設定。

**`OFF`** = ぴったり9:00に起動。**`FLEXIBLE`** = 9:00〜9:15のどこかで起動（AWS がリソースを最適化しやすくなり、コストが下がる可能性がある）。

サンプルでは `OFF`（ぴったり起動）を使用。

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップ対応

| Lab/Step | 関連内容 |
|---|---|
| **Step 7** | EventBridge + Lambda によるイベント駆動パイプラインの構築 |

Step 7 の中心テーマは「バッチ型の処理をイベント駆動で自動化する」こと。Scheduler で Lambda を定時起動し、Lambda が処理結果を EventBridge イベントとして発行し、Rule が後続のワークフローにルーティングする — この一連の流れを CDK で構築しました。

### 本番構成との対応

| 本番構成 | サンプル構成 | 状態 |
|---|---|---|
| VPC 内 Lambda + VPC エンドポイント | パブリックアクセス | 簡略版 |
| Lambda Layer で共通ライブラリ分離 | 事前ビルドで同梱 | 簡略版 |
| DLQ（Dead Letter Queue）でエラー退避 | ログ出力のみ | 簡略版 |
| Scheduler Group で環境ごと管理 | デフォルトグループ | 簡略版 |
| ingest 完了イベントで scorer をトリガー | 時間差（9:00 → 9:30） | 簡略版 |

### 本番との違い（簡略化した部分）

| 項目 | 本番 | サンプル | 理由 |
|---|---|---|---|
| Lambda ネットワーク | VPC 内 | パブリック | VPC 設定の複雑さを避ける |
| 共通ライブラリ | Lambda Layer に分離 | コード同梱 | Layer 管理の複雑さを避ける |
| エラーハンドリング | DLQ + アラーム | ログ出力 | 学習範囲を限定 |
| scorer 起動 | イベント駆動（ingest完了後） | 時間差（30分後） | 依存関係の簡略化 |
| 環境分離 | dev/stg/prod 別バス | 単一バス | 環境が1つのため |

---

## 6. 次のタスクへのつながり

```
TASK-012（今回）                        次のタスクたち
イベント駆動基盤を構築
  │
  ├──→ TASK-013: CDK OrchestrationStack（Step Functions）
  │     └─ 今回作った EventBridge Rule にターゲットを追加する
  │        weatherDataFetchedRule → 天気分析ワークフロー
  │        weatherAnomalyDetectedRule → 異常気象監視ワークフロー
  │        （Laravelでいう Event Listener の「実装」を追加するイメージ）
  │
  │     EventStack が public readonly で公開している Rule を
  │     OrchestrationStack が addTarget() して接続する:
  │     eventStack.weatherDataFetchedRule.addTarget(sfnTarget)
  │
  └──→ TASK-014: GatewayStack（Gateway + Guardrails + 通知）
        └─ 異常検知ワークフローの最終段で SNS/SES 通知を送る
           scorer → イベント → WF → 通知 の全体フローが完成

全体の流れ（完成図）:
  Scheduler → ingest Lambda → S3保存 → EventBridge
                                             ↓ Rule
                                        Step Functions（TASK-013）
                                             ↓
                                        エージェント分析
                                             ↓
                                        通知（TASK-014）
```

今回の EventStack は「いつ動かすか」と「結果を誰に伝えるか」を定義しました。次の TASK-013 で「伝えた結果をどう処理するか」（Step Functions ワークフロー）を構築すると、Scheduler → Lambda → EventBridge → Step Functions → エージェント の一気通貫のパイプラインが完成します。

# TASK-013 解説: CDK OrchestrationStack（Step Functions）

## 1. このタスクで何を作ったか

**「データ収集→分析→レポート作成」と「異常検知→重要度判定→通知」の2つの業務フローを自動化する「司令塔」を作った。** それぞれの業務を「いつ・何を・どの順番で・並列にいくつ」実行するかを定義し、EventBridge のイベントをトリガーにしてフローが自動で回る仕組みを構築した。

日常の例えでいうと、TASK-011 で「天気を調べる人」「異常をチェックする人」を雇い、TASK-012 で「朝礼で毎日指示を出す司会者」を用意しました。今回は **「業務マニュアル」** を2冊作ったイメージです。マニュアルには「まず東京・大阪・福岡を同時に調査して、全部終わったら横断比較して、レポートを書く」という手順が書いてあり、司令塔（Step Functions）がこのマニュアルどおりに人を動かします。

---

## 2. 作成・変更したファイル一覧

### 2.1 `packages/infra/lib/orchestration-stack.ts` — 業務フローの「マニュアル」（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | 2つの Step Functions ワークフローと EventBridge Rule を定義する CDK スタック |
| なぜ必要か | 「いつ・何を・どの順番で実行するか」を定義しないと、バラバラの Lambda やエージェントが連携できない |
| 中身の要点 | 天気分析WF（Map並列処理）、異常気象監視WF（Choice分岐）、EventBridge Rule → WF 接続 |
| 関連技術 | AWS CDK（TypeScript）/ Step Functions / EventBridge |

Laravelでいうと **Job チェーン + Pipeline** を AWS のサービスとして定義するイメージです。TSでいうと **RxJS の pipe でオペレータを繋ぐ** のに近い。

このファイルは大きく3つのパートに分かれます。

#### パート1: 天気分析ワークフロー — 「3都市を同時に調べて、まとめてレポートを書く」

```typescript
// ステップの「チェーン」を作る（次に何をするか）
const weatherAnalysisDefinition = parseEvent  // ① イベントから都市リスト抽出
  .next(mapCities)                            // ② 都市ごとに並列処理
  .next(invokeCrosscut)                       // ③ 全都市の結果を横断分析
  .next(generateReport);                      // ④ レポート生成
// ↑ Laravelでいう Bus::chain([Job1, Job2, Job3])->dispatch()
//   TSでいう pipe(step1, step2, step3)
```

**今回の一番の学びポイント: Map State（並列処理）**

```typescript
const mapCities = new sfn.Map(this, "MapCities", {
  maxConcurrency: 10,     // 同時に最大10都市まで並列実行
  // ↑ Laravelでいう Queue の --max-jobs=10
  //   TSでいう Promise.all() + concurrency limit

  itemsPath: "$.cities",  // ["東京", "大阪", "福岡"] の各要素に対して実行
  // ↑ Laravelでいう collect($cities)->each(fn($city) => dispatch(new AnalyzeJob($city)))
  //   TSでいう cities.map(city => processCity(city))

  resultPath: "$.cityResults",  // 全都市の結果をここに格納
});
// Map 内のサブワークフロー: 各都市ごとに InvokeCollector → InvokeAnalyst → SaveResult
mapCities.itemProcessor(cityProcessingChain);
```

**Map State とは？** 配列データの各要素に対して「同じ処理」を並列実行するステート。`["東京", "大阪", "福岡"]` を渡すと3つのサブワークフローが同時に起動し、全部終わるまで待ってから次のステップに進む。

Laravelの `Bus::batch([...])->dispatch()` と同じ概念。TSでいうと `Promise.all(cities.map(c => processCity(c)))` と同じ。

**maxConcurrency の意味:** 「同時に何個まで並列実行するか」の上限。10に設定すると、100都市あっても同時に動くのは10個まで。残りは待機。これは AgentCore Runtime の負荷を制御するため。Laravelの Queue Worker の `--max-jobs` に相当。

#### パート2: 異常気象監視ワークフロー — 「異常を発見したら重要度を判定して、対応を振り分ける」

```typescript
const alertDefinition = parseAnomaly       // ① イベントから異常情報を抽出
  .next(invokeAlertAgent)                  // ② 異常検知エージェント呼び出し
  .next(
    evaluateSeverity                       // ③ 重要度判定（Choice = if-else）
      .when(                               //    スコア > 0.9 → 通知（critical）
        sfn.Condition.numberGreaterThan("$.anomaly_score", 0.9),
        sendNotification
      )
      .when(                               //    スコア > 0.7 → 通知（warning）
        sfn.Condition.numberGreaterThan("$.anomaly_score", 0.7),
        sendNotification
      )
      .otherwise(logOnly)                  //    それ以外 → ログのみ（info）
      .afterwards()
      .next(saveAlert)                     // ④ 全ルート共通で S3 に保存
  );
```

**Choice ステートとは？** Step Functions 版の `if-else`。JSON パスで指定した値を条件に、次に進むステップを切り替える。

```
Laravelでいうと:
  if ($score > 0.9) { dispatch(new NotifyCritical()); }
  elseif ($score > 0.7) { dispatch(new NotifyWarning()); }
  else { Log::info("info only"); }

TSでいうと:
  score > 0.9 ? sendCritical() : score > 0.7 ? sendWarning() : logOnly()
```

**`.afterwards().next(saveAlert)` の意味:** 「どのルートに分岐しても、最終的に saveAlert に合流する」。Laravelの Pipeline で `->then()` を付けるのに近い。

#### パート3: EventBridge Rule → Step Functions ターゲット

```typescript
new events.Rule(this, "WeatherDataFetchedRule", {
  eventBus: props.eventBus,      // EventStack のカスタムバス
  eventPattern: {
    source: ["weather-agent.ingest"],
    detailType: ["WeatherDataFetched"],
  },
  targets: [new eventsTargets.SfnStateMachine(weatherAnalysisWf)],
  // ↑ 「このイベントが来たら、この WF を起動する」
  //   Laravelでいう Event::listen(WeatherDataFetched::class, StartAnalysisWf::class)
});
```

**なぜ EventStack ではなくここで Rule を定義するか？** CDK のクロススタック参照で循環依存が発生するため。Rule（EventStack）→ ターゲット（OrchestrationStack）→ Rule への参照（EventStack）で循環する。回避策として Rule とターゲットを同一スタックに配置した。

### 2.2 `packages/infra/lib/event-stack.ts` — EventStack（変更）

| 項目 | 内容 |
|---|---|
| これは何か | TASK-012 で作った EventBridge + Lambda の基盤 |
| なぜ必要か | Rule 定義を OrchestrationStack に移動したため、不要な Rule を削除 |
| 中身の要点 | `weatherDataFetchedRule` / `weatherAnomalyDetectedRule` のプロパティと定義を削除 |
| 関連技術 | AWS CDK（TypeScript） |

### 2.3 `packages/infra/bin/app.ts` — CDK アプリのエントリポイント（変更）

| 項目 | 内容 |
|---|---|
| これは何か | CDK アプリ全体の「起動スクリプト」 |
| なぜ必要か | OrchestrationStack の追加とスタック間依存関係の定義 |
| 中身の要点 | EventStack と RuntimeStack の両方に依存する OrchestrationStack を追加 |
| 関連技術 | AWS CDK（TypeScript） |

```typescript
const orchestrationStack = new OrchestrationStack(app, "OrchestrationStack", {
  dataBucket: storageStack.dataBucket,
  eventBus: eventStack.eventBus,        // EventStack のカスタムバスを渡す
});
orchestrationStack.addDependency(eventStack);    // EventStack が先
orchestrationStack.addDependency(runtimeStack);  // RuntimeStack も先
```

---

## 3. ファイル間の関係図

```
                    EventBridge              Step Functions
                    (イベント配送)           (業務フロー)
┌───────────────────────────────────────────────────────────┐
│ EventStack          OrchestrationStack                    │
│                                                           │
│ Scheduler           Rule                StateMachine      │
│ ┌──────┐     ┌──────────────────┐   ┌────────────────┐   │
│ │9:00  │────→│ ingest Lambda    │   │ 天気分析WF     │   │
│ │JST   │     │ (TASK-011)       │   │                │   │
│ └──────┘     └────────┬─────────┘   │ ParseEvent     │   │
│                       │              │   ↓            │   │
│              put_events()            │ MapCities      │   │
│                       ↓              │ ┌──────────┐   │   │
│              ┌────────────────┐      │ │東京│大阪│福岡│  │
│              │ weather-agent  │      │ │  ↓   ↓   ↓ │   │
│              │ -bus           │      │ │Collect→    │   │
│ Archive ←───│ (カスタムバス)  │      │ │Analyze→    │   │
│ (30日保存)   └────────┬───────┘      │ │Save        │   │
│                       │              │ └──────────┘   │   │
│              Rule がキャッチ          │   ↓            │   │
│              ┌────────┴───────┐      │ InvokeCrosscut │   │
│              │WeatherData    │──────→│   ↓            │   │
│              │Fetched        │      │ GenerateReport │   │
│              └────────────────┘      └────────────────┘   │
│                                                           │
│              ┌────────────────┐      ┌────────────────┐   │
│              │WeatherAnomaly │      │ 異常気象監視WF  │   │
│              │Detected       │──────→│                │   │
│              └────────────────┘      │ ParseAnomaly   │   │
│                                      │   ↓            │   │
│                                      │ InvokeAlert    │   │
│                                      │   ↓            │   │
│                                      │ EvaluateSeverity│  │
│                                      │  ┌──┬──┐       │   │
│                                      │  ↓  ↓  ↓       │   │
│                                      │ SNS Log info   │   │
│                                      │  └──┴──┘       │   │
│                                      │   ↓            │   │
│                                      │ SaveAlert      │   │
│                                      └────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

---

## 4. 今回登場した技術・用語の解説

### Step Functions（ステップファンクションズ）

**それは何か:** AWS のワークフローサービス。「ステップ1 → ステップ2 → ステップ3」のような業務フローを図のように定義し、自動実行する。

**なぜ使うか:** Lambda 単体では「1つの処理を実行する」だけ。「まず収集、次に分析、最後にレポート」のような複数ステップの連携には、全体を管理する「司令塔」が必要。

**日常の例え:** 工場の生産ライン。「部品検査 → 組み立て → 塗装 → 梱包」という流れを自動管理し、各工程が終わったら次の工程に進む。異常があれば別ルートに分岐する。

**TS/Laravel対応:** Laravelでいう **Job チェーン**（`Bus::chain([Job1, Job2, Job3])`）+ **Pipeline**（`Pipeline::send($data)->through([Step1, Step2])->thenReturn()`）。TSでいうと **RxJS の pipe** や **Redux Saga** に近い。

### ASL（Amazon States Language）

**それは何か:** Step Functions のワークフローを定義する JSON 言語。CDK の高水準 API を使うと、TypeScript のコードから ASL が自動生成される。

**なぜ CDK の API を使うか？** ASL を直接 JSON で書くと読みにくい。CDK を使えば TypeScript の型チェック付きで書ける。

### ハイブリッドオーケストレーション

**それは何か:** 「外側は決定的な制御（Step Functions）」、「内側は AI の動的判断（AgentCore）」という二重構造の設計パターン。

**なぜこのパターン？**

```
Step Functions（外側）: 「まず東京、次に大阪、最後にまとめ」→ 順序を厳密に制御
  ↓ 呼び出し
AgentCore エージェント（内側）: 「東京の天気データを見て、自由に分析して」→ AI に判断を任せる
```

外側で「何を・どの順番で」を制御し、内側で「どう分析するか」は AI に委ねる。外側が固定されているから安定し、内側が柔軟だから賢い。

**日常の例え:** レストランの調理工程。「前菜 → メイン → デザート」の順番（外側）は固定だが、各料理をどう作るか（内側）はシェフの判断に任せる。

### Map State（マップステート）

**それは何か:** 配列の各要素に対してサブワークフローを並列実行するステート。

```
入力: ["東京", "大阪", "福岡"]
  → 東京: InvokeCollector → InvokeAnalyst → SaveResult
  → 大阪: InvokeCollector → InvokeAnalyst → SaveResult  ← 3つ同時に実行
  → 福岡: InvokeCollector → InvokeAnalyst → SaveResult
出力: [東京の結果, 大阪の結果, 福岡の結果]
```

**TS/Laravel対応:** TSの `Promise.all(cities.map(c => processCity(c)))`。Laravelの `Bus::batch([new Job($city1), new Job($city2)])->dispatch()`。

### maxConcurrency（最大同時実行数）

**それは何か:** Map State で同時に実行するサブワークフローの上限。10 に設定すると、100都市あっても同時に動くのは10個まで。

**なぜ制限する？** AgentCore Runtime が同時に処理できるセッション数には限りがある。制限なしで100都市を同時に呼ぶと Runtime が過負荷になる。

### Choice State（チョイスステート）

**それは何か:** Step Functions 版の `if-else`。条件に基づいて次に進むステップを切り替える。

```typescript
evaluateSeverity
  .when(sfn.Condition.numberGreaterThan("$.anomaly_score", 0.9), sendNotification)
  // ↑ if (anomaly_score > 0.9) → 通知（critical）
  .when(sfn.Condition.numberGreaterThan("$.anomaly_score", 0.7), sendNotification)
  // ↑ else if (anomaly_score > 0.7) → 通知（warning）
  .otherwise(logOnly)
  // ↑ else → ログのみ
```

### Pass State（パスステート）

**それは何か:** 「何も処理せず、入力を次のステップに渡す」ステート。データの変換やデフォルト値の設定に使う。

**なぜ今回多用している？** サンプル実装では AgentCore Runtime の実際の呼び出しを Pass で「スタブ（仮実装）」している。ワークフローの構造を先に定義し、中身は後から実装する。TSでいうと `// TODO: implement` のプレースホルダーに近い。

### waitForTaskToken パターン

**それは何か:** Step Functions の「非同期待機」パターン。Lambda が外部サービス（AgentCore Runtime）にジョブを投げ、完了するまで Step Functions を「一時停止」する。完了通知（コールバック）が来ると再開する。

**なぜ使う？** エージェントの処理は数分かかることがある。その間 Step Functions を動かし続けると課金が発生する。waitForTaskToken なら **待機中は課金ゼロ** 。

**日常の例え:** 「出前を頼んで、届くまで他のことをする」パターン。電話で注文（Lambda → Runtime）→ 電話を切る → 届いたら再開。「電話口でずっと待っている」（同期呼び出し）より効率的。

サンプルでは Pass ステートで簡略化しているが、本番ではこのパターンを使う。

### CDK クロススタック循環参照

**それは何か:** スタック A がスタック B を参照し、スタック B もスタック A を参照すると発生するエラー。

**今回の問題:** EventStack の Rule に OrchestrationStack の StateMachine をターゲットとして追加すると、EventStack → OrchestrationStack と OrchestrationStack → EventStack の双方向依存が生じて循環する。

**解決策:** Rule とターゲットを同一スタック（OrchestrationStack）に配置し、EventStack からは eventBus だけを渡す。

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップ対応

| Lab/Step | 関連内容 |
|---|---|
| **Step 8** | ハイブリッドオーケストレーション（Step Functions + AgentCore） |

Step 8 の中心テーマは「決定的な制御（Step Functions）と動的な判断（AI）を組み合わせる」ハイブリッドオーケストレーション。本番構成のコアパターンそのもの。

### 本番構成との対応

| 本番構成 | サンプル構成 | 状態 |
|---|---|---|
| 企業単位の Map 並列処理 | 都市単位の Map 並列処理 | パターン同一 |
| waitForTaskToken で AgentCore 呼び出し | Pass ステートで簡略化 | 簡略版 |
| SNS/SES 通知 | Pass ステート（TASK-014 で接続予定） | 簡略版 |
| 本番の maxConcurrency チューニング | 固定 10 | 簡略版 |

### 本番との違い（簡略化した部分）

| 項目 | 本番 | サンプル | 理由 |
|---|---|---|---|
| AgentCore 呼び出し | waitForTaskToken（非同期待機） | Pass ステート | Runtime 接続の複雑さを回避 |
| エラーハンドリング | Catch + Retry パターン | なし | 学習範囲を限定 |
| 通知 | SNS → Slack / メール | Pass ステート | TASK-014 で実装予定 |
| Map 並列数 | ビジネス要件に応じて調整 | 固定 10 | 都市が少ないため十分 |
| タイムアウト | ジョブごとに個別設定 | WF全体で1時間 | 簡略化 |

---

## 6. 次のタスクへのつながり

```
TASK-013（今回）                        次のタスク
Step Functions ワークフロー 2本を構築
  │
  └──→ TASK-014: GatewayStack（Gateway + Guardrails + 通知）
        └─ 今回 Pass ステートで簡略化した部分を本番仕様に差し替え:
           ① SendNotification → SNS トピック → Slack / メール 通知
           ② InvokeCollector/Analyst → AgentCore Gateway 経由のエージェント呼び出し
           ③ Guardrails でエージェント出力の安全性チェック

完成後の全体フロー:
  Scheduler(毎朝9:00)
    → ingest Lambda（天気データ取得）
      → EventBridge("WeatherDataFetched")
        → Step Functions 天気分析WF
          → Map(東京,大阪,福岡) 並列
            → AgentCore Runtime（収集→分析）← TASK-014 で接続
          → 横断分析 → レポート生成

  Scheduler(毎朝9:30)
    → scorer Lambda（AIスコアリング）
      → EventBridge("WeatherAnomalyDetected")
        → Step Functions 異常気象監視WF
          → 異常検知エージェント ← TASK-014 で接続
          → 重要度判定
            → critical/warning → SNS通知 ← TASK-014 で接続
            → info → ログのみ
          → S3保存
```

今回で **イベント駆動パイプラインの骨格が完成** しました。Scheduler → Lambda → EventBridge → Step Functions の一気通貫の流れが動くようになっています。残りの TASK-014 で「Pass ステートの中身」を本番仕様に差し替えると、全体が完成します。

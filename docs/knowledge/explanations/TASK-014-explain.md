# TASK-014 解説: CDK GatewayStack（Gateway + Guardrails + 通知）

## 1. このタスクで何を作ったか

**エージェントの「安全装置」「知識データベース」「通知システム」「外部API統合窓口」を一気に追加した。** これは本番構成の最後の仕上げで、エージェントが安全に動作し、知識を活用して回答し、異常時に人に通知できるようにする5つの機能を構築した。

日常の例えでいうと、これまで作ってきた「天気分析お店」に最後の仕上げを行ったイメージです:
- **Guardrails** = お店の「接客マニュアル」（不適切な発言を禁止、個人情報を隠す）
- **Knowledge Bases** = お店の「参考書棚」（気象用語辞書を置いて、質問されたら調べられる）
- **SNS** = お店の「緊急連絡網」（異常気象を検知したら店長にメール）
- **SES** = お店の「日報メール」（毎日のレポートをメールで送る）
- **Gateway (MCP)** = お店の「仕入れ窓口の統一」（バラバラだった仕入れ先を一本化）

---

## 2. 作成・変更したファイル一覧

### 2.1 `packages/infra/lib/gateway-stack.ts` — 本番構成の仕上げ（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | 5つの本番機能（SNS, SES, Guardrails, Knowledge Bases, Gateway）を定義する CDK スタック |
| なぜ必要か | エージェントを安全に運用し、通知・検索・API統合を行うため |
| 中身の要点 | SNS トピック、SES テンプレート、Guardrails フィルタ、KB 設定、Gateway 権限 |
| 関連技術 | AWS CDK（TypeScript）/ SNS / SES / Bedrock Guardrails / Knowledge Bases |

このファイルは5つのパートに分かれます。

#### パート1: SNS — 「緊急連絡網」

```typescript
this.alertTopic = new sns.Topic(this, "WeatherAlertTopic", {
  topicName: "weather-agent-alerts",
  displayName: "天気エージェント 異常気象アラート",
});
// ↑ Laravelでいう Notification チャンネルの定義
//   TSでいう EventEmitter の「アラート」チャンネル

// メールで通知を受け取る人を登録
if (props.notificationEmail) {
  this.alertTopic.addSubscription(
    new snsSubscriptions.EmailSubscription(props.notificationEmail)
    // ↑ 登録後、確認メールが届く → クリックして承認しないと届かない
    //   Laravelでいう $user->notify(new WeatherAlert())
  );
}
```

**SNS のポイント:** トピック（掲示板）を作り、サブスクリプション（購読者）を登録する。メッセージをトピックに発行すると、登録者全員に通知が届く。Laravelの `Notification` と同じ概念。

#### パート2: SES — 「日報メールのテンプレート」

```typescript
new ses.CfnTemplate(this, "WeatherReportTemplate", {
  template: {
    templateName: "weather-agent-daily-report",
    subjectPart: "【天気エージェント】日次レポート {{date}}",
    // ↑ {{date}} はテンプレート変数。送信時に実際の日付に置換される
    //   Laravelでいう Blade の {{ $date }}
    //   TSでいう テンプレートリテラルの ${date}
    htmlPart: [
      "<h1>天気分析レポート</h1>",
      "<p>日付: {{date}}</p>",
      "<h2>分析結果サマリ</h2>",
      "<p>{{summary}}</p>",
      // ...
    ].join("\n"),
  },
});
```

**SES テンプレートとは？** メールの「ひな形」。毎回同じレイアウトのメールを送るとき、変わる部分だけ変数にしておく。Laravelの `Mail::send()` で Blade テンプレートを使うのと同じ。TSでいう Handlebars テンプレート。

#### パート3: Guardrails — 「AIの安全装置」（一番重要な学び）

```typescript
const guardrail = new bedrock.CfnGuardrail(this, "WeatherAgentGuardrail", {
  name: "weather-agent-guardrail",

  // ブロックされたときのメッセージ
  blockedInputMessaging: "この入力は処理できません。天気に関する質問をお願いします。",
  blockedOutputsMessaging: "この回答は安全性の基準を満たしていないため表示できません。",

  // コンテンツフィルタ: 有害なコンテンツをブロック
  contentPolicyConfig: {
    filtersConfig: [
      { type: "SEXUAL", inputStrength: "HIGH", outputStrength: "HIGH" },
      { type: "VIOLENCE", inputStrength: "HIGH", outputStrength: "HIGH" },
      { type: "HATE", inputStrength: "HIGH", outputStrength: "HIGH" },
      // ↑ 「入力も出力も、これらのカテゴリはHIGH（厳格に）フィルタ」
      //   Laravelでいう Middleware でリクエスト/レスポンスを検査するのに近い
    ],
  },

  // PII（個人情報）フィルタ
  sensitiveInformationPolicyConfig: {
    piiEntitiesConfig: [
      { type: "EMAIL", action: "ANONYMIZE" },
      // ↑ メールアドレスが含まれていたら [EMAIL] に置換（マスキング）
      //   BLOCK にすると回答自体を拒否する
      { type: "PHONE", action: "ANONYMIZE" },
      { type: "NAME", action: "ANONYMIZE" },
      { type: "ADDRESS", action: "ANONYMIZE" },
    ],
  },

  // トピック制限: 天気以外の話題を拒否
  topicPolicyConfig: {
    topicsConfig: [{
      name: "off-topic",
      definition: "天気、気象、気候、災害に関係のないトピック",
      type: "DENY",
      examples: ["今日の株価を教えて", "おすすめの映画は？"],
      // ↑ 「こういう質問は拒否してね」という例を LLM に教える
    }],
  },
});
```

**Guardrails の3層フィルタ:**

| 層 | 何をする | 日常の例え |
|---|---|---|
| **コンテンツフィルタ** | 暴力・差別等の有害コンテンツをブロック | 「店内では乱暴な言葉を使わないでください」 |
| **PII フィルタ** | 個人情報を検出してマスキング | 「お客様の名前は伏せて記録します」 |
| **トピック制限** | 関係ない話題を拒否 | 「天気以外のご質問はお受けできません」 |

**なぜ Guardrails が重要？** LLM は「何でも答えようとする」性質がある。「爆弾の作り方」と聞かれても答えようとしてしまう。Guardrails はその「暴走」を防ぐ安全装置。本番運用には必須。

#### パート4: Knowledge Bases — 「参考書棚」（RAG）

```typescript
// S3 の data/knowledge/ 配下に気象用語辞書や過去レポートを配置する
const knowledgeBasePrefix = "data/knowledge/";

// Knowledge Bases 検索権限を RuntimeRole に追加
props.runtimeRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    actions: [
      "bedrock:Retrieve",               // セマンティック検索
      "bedrock:RetrieveAndGenerate",     // 検索 + LLM で回答生成（RAG）
      // ↑ Laravelでいう Scout::search() + LLM で回答
    ],
    resources: ["*"],
  })
);
```

**RAG とは？** Retrieval-Augmented Generation（検索拡張生成）。LLM が「知らないこと」を S3 のドキュメントから検索して、回答に含める技術。「ラニーニャ現象とは？」と聞かれたとき、LLM 単体では古い知識しかないが、RAG があれば S3 に置いた最新の気象辞書から正確な情報を引き出せる。

Laravelでいうと **Laravel Scout（全文検索）+ LLM** の組み合わせ。TSでいうと **Algolia + OpenAI** のパターン。

#### パート5: Gateway (MCP) — 「API の統一窓口」

```typescript
// Gateway (MCP) 関連権限
props.runtimeRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    actions: ["bedrock:*AgentCoreGateway*", "bedrock:*McpServer*"],
    // ↑ MCP Server を呼ぶための権限
    resources: ["*"],
  })
);
```

**MCP（Model Context Protocol）とは？** 外部 API へのアクセスを標準化するプロトコル。Step 1 では `httpx` で Open-Meteo API を直接呼んでいたが、MCP を使うと「API の接続情報を Gateway で管理し、エージェントは MCP プロトコルで統一的にアクセスする」ことができる。

TSでいうと **API Gateway + SDK の自動生成**、Laravelでいうと **Service Container + API ラッパークラス** に近い。API の接続先を変更しても、エージェントのコードは変更不要。

### 2.2 `packages/infra/bin/app.ts` — CDK アプリのエントリポイント（変更）

| 項目 | 内容 |
|---|---|
| これは何か | CDK アプリ全体の「起動スクリプト」 |
| なぜ必要か | GatewayStack を追加しないと `cdk deploy` で認識されない |
| 中身の要点 | GatewayStack のインポートとインスタンス化を追加 |
| 関連技術 | AWS CDK（TypeScript） |

```typescript
const gatewayStack = new GatewayStack(app, "GatewayStack", {
  dataBucket: storageStack.dataBucket,      // Knowledge Bases のデータソース
  runtimeRole: runtimeStack.runtimeRole,    // IAM 権限を追加する対象
  // notificationEmail: "your-email@example.com",  // デプロイ時にコメントを外す
});
gatewayStack.addDependency(runtimeStack);
gatewayStack.addDependency(orchestrationStack);
```

---

## 3. ファイル間の関係図

```
全7スタックの最終構成（Step 2〜9）:

bin/app.ts
 │
 ├─ StorageStack (Step 2)
 │   └─ S3バケット
 │       ├─ data/weather/     ← 天気データ
 │       ├─ data/knowledge/   ← 気象用語辞書（Knowledge Bases 用）← NEW
 │       ├─ reports/          ← 分析レポート
 │       └─ alerts/           ← アラート情報
 │
 ├─ RuntimeStack (Step 4)
 │   └─ IAM ロール（社員証）
 │       ├─ S3 読み書き
 │       ├─ Bedrock モデル呼び出し
 │       ├─ Memory API              ← MemoryStack で追加
 │       ├─ CloudWatch / X-Ray      ← ObservabilityStack で追加
 │       ├─ Guardrails              ← GatewayStack で追加 NEW
 │       ├─ Knowledge Bases 検索    ← GatewayStack で追加 NEW
 │       ├─ SNS 発行                ← GatewayStack で追加 NEW
 │       ├─ SES 送信                ← GatewayStack で追加 NEW
 │       └─ Gateway (MCP)           ← GatewayStack で追加 NEW
 │
 ├─ MemoryStack (Step 5)
 ├─ ObservabilityStack (Step 6)
 ├─ EventStack (Step 7)
 │   ├─ Scheduler → ingest Lambda (9:00)
 │   ├─ Scheduler → scorer Lambda (9:30)
 │   ├─ EventBus + Archive
 │   └─ (Rule は OrchestrationStack に移動)
 │
 ├─ OrchestrationStack (Step 8)
 │   ├─ 天気分析WF（Step Functions）
 │   ├─ 異常気象監視WF（Step Functions）
 │   └─ EventBridge Rule → WF 接続
 │
 └─ GatewayStack (Step 9) ← 今回作成! 最後の仕上げ
     ├─ SNS Topic（緊急連絡網）
     ├─ SES Template（日報メール）
     ├─ Guardrails（安全装置）
     ├─ Knowledge Bases S3 設定（参考書棚）
     └─ Gateway (MCP) 権限（API統一窓口）
```

---

## 4. 今回登場した技術・用語の解説

### SNS（Simple Notification Service）

**それは何か:** AWS のプッシュ型通知サービス。「トピック」に「メッセージ」を発行すると、登録者全員に通知が届く。

**なぜ使うか:** 異常気象を検知したとき、関係者全員にすぐ知らせたい。SNS なら「トピックにメッセージを1回送るだけ」で全員に届く。

**日常の例え:** LINE グループ。グループにメッセージを送ると、メンバー全員に届く。

**TS/Laravel対応:** Laravelでいう `Notification::send($users, new WeatherAlert())`。TSでいうと EventEmitter + WebSocket。

### SES（Simple Email Service）

**それは何か:** AWS のメール送信サービス。テンプレートを定義して、変数を差し替えてメールを送れる。

**なぜ使うか:** 毎日のレポートをメールで送りたい。SES なら大量メールも安定して送れる。

**TS/Laravel対応:** Laravelでいう `Mail::send(new DailyReport($data))`。TSでいうと Nodemailer + テンプレートエンジン。

### Bedrock Guardrails（ガードレール）

**それは何か:** AI エージェントの入出力を自動チェックする「安全フィルタ」。個人情報の検出、有害コンテンツのブロック、トピック制限ができる。

**なぜ使うか:** LLM は「何でも答えようとする」性質がある。Guardrails がないと、不適切な回答をしたり、個人情報を漏洩するリスクがある。本番運用には必須。

**日常の例え:** 高速道路のガードレール。車が道路を逸脱しないように防ぐ。AI のガードレールは、AI の回答が「安全な範囲」を逸脱しないように防ぐ。

**3つのフィルタ:**
- **コンテンツフィルタ:** 暴力・差別表現をブロック → Laravelの `Middleware` に近い
- **PII フィルタ:** 個人情報をマスキング → Laravelの `$hidden` プロパティに近い
- **トピック制限:** 関係ない話題を拒否 → Laravelの `authorize()` に近い

### PII（Personally Identifiable Information）

**それは何か:** 個人を特定できる情報。名前、メールアドレス、電話番号、住所など。

**なぜフィルタする？** エージェントの回答に「田中太郎さん（090-1234-5678）」のような情報が含まれると個人情報漏洩になる。PII フィルタで自動的に `[NAME]（[PHONE]）` にマスキングする。

### ANONYMIZE vs BLOCK

| アクション | 動作 | 日常の例え |
|---|---|---|
| **ANONYMIZE** | 個人情報をマスキングして回答する | 名前を黒塗りにして書類を渡す |
| **BLOCK** | 回答自体を拒否する | 書類ごと「お見せできません」と拒否 |

### Knowledge Bases / RAG

**それは何か:** S3 に保存したドキュメントを「意味で検索」できるようにし、LLM の回答に組み込む技術。RAG = Retrieval-Augmented Generation（検索拡張生成）。

**なぜ使うか:** LLM は訓練時の知識しか持っていない。「最新の気象用語」や「過去のレポート」は知らない。Knowledge Bases があれば S3 のドキュメントから最新情報を検索して回答に含められる。

**日常の例え:** 試験で「持ち込みOK」の参考書。何も見ずに答えるより、参考書を見ながら答えるほうが正確。RAG は LLM に「参考書を見る能力」を与える。

**TS/Laravel対応:** Laravelでいう **Laravel Scout（全文検索）** だが、「キーワード一致」ではなく「意味が近い」で検索できる点が進化。

### MCP（Model Context Protocol）

**それは何か:** 外部 API へのアクセスを標準化するプロトコル。エージェントが様々な API を「同じ方法」で呼べるようにする。

**なぜ使うか:** Step 1 では `httpx` で Open-Meteo API を直接呼んでいた。API が増えるたびにツールを書き直すのは大変。MCP なら Gateway で API を一元管理し、エージェントは統一インターフェースで呼ぶだけ。

**日常の例え:** USB-C。以前はスマホ・PC・カメラで充電ケーブルがバラバラだったが、USB-C に統一されて1本で済むようになった。MCP は API 版の USB-C。

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップ対応

| Lab | 関連内容 |
|---|---|
| **Lab 7** | AgentCore Gateway (MCP) — 外部 API アクセスの統一 |
| **Lab 8** | Bedrock Guardrails — エージェント出力の安全性確保 |

### 本番構成との対応

| 本番構成 | サンプル構成 | 状態 |
|---|---|---|
| Gateway MCP Server 複数定義 | IAM 権限のみ（コンソールで Gateway 作成） | 簡略版 |
| Guardrails カスタムフィルタ | 基本フィルタ（コンテンツ + PII + トピック） | ほぼ再現 |
| Knowledge Bases + OpenSearch | S3 プレフィックス + IAM 権限のみ | 簡略版 |
| SNS → Lambda → Slack/PagerDuty | SNS → Email のみ | 簡略版 |
| SES ドメイン DNS 検証 | テンプレート定義のみ | 簡略版 |

### 本番との違い（簡略化した部分）

| 項目 | 本番 | サンプル | 理由 |
|---|---|---|---|
| Gateway | CDK or IaC で MCP Server 定義 | コンソール/boto3 で手動作成 | CDK L2 コンストラクト未提供 |
| Knowledge Bases | OpenSearch Serverless をベクトルストア | S3 + マネージドストア | インフラ簡略化 |
| SNS 通知先 | Slack, PagerDuty, SMS | Email のみ | 設定の簡略化 |
| SES 送信元 | ドメイン DNS 検証（SPF, DKIM） | テンプレートのみ | DNS 設定が必要なため |
| Guardrails | カスタムワードフィルタ + 細かいトピック制限 | 基本フィルタ | 学習目的のため |

---

## 6. 全体の振り返りと完成図

TASK-014 で **全14タスクの実装が完了** しました。Step 1〜9 で段階的に構築してきたシステム全体を振り返ります。

```
完成したシステム全体像:

【対話型】ユーザーが質問
  → AgentCore Runtime（microVM）
    → collector（天気取得）→ analyst（分析）→ crosscut（横断比較）→ alert（異常検知）
    → orchestrator が4エージェントを A2A 連携
    → Memory で過去の会話を記憶
    → Guardrails で安全性チェック ← NEW
    → Knowledge Bases で気象用語を RAG ← NEW
  → ユーザーに回答

【バッチ型】毎朝自動実行
  → Scheduler (9:00) → ingest Lambda → S3保存 → EventBridge
    → Step Functions 天気分析WF → 都市並列分析 → レポート
    → SES でメール送信 ← NEW
  → Scheduler (9:30) → scorer Lambda → Bedrock スコアリング
    → Step Functions 異常気象監視WF → 重要度判定
    → critical/warning → SNS → メール通知 ← NEW

【監視】
  → CloudWatch ダッシュボード（呼び出し回数、レイテンシ、エラー率）
  → CloudWatch アラーム（エラー率 > 5%、レイテンシ > 30秒）
  → X-Ray トレース（End-to-End 可視化）

【インフラ】CDK 7スタック
  StorageStack → RuntimeStack → MemoryStack
                              → ObservabilityStack
               → EventStack  → OrchestrationStack
                              → GatewayStack ← NEW（最後の仕上げ）
```

Step 1 の「天気を聞いたら教えてくれるだけ」の素朴なエージェントから始まり、最終的には「毎朝自動でデータを収集し、AI が分析し、異常があれば通知し、安全に運用できる」本番構成に近いシステムが完成しました。

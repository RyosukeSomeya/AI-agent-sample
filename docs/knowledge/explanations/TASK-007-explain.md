# TASK-007 解説: CDK StorageStack + RuntimeStack

## 1. このタスクで何を作ったか

**AWSにインフラ（S3バケットやIAMロール）を自動作成するための「設計図」をTypeScriptで書いた。**

これまで TASK-001〜006 で作ってきたエージェント（Python）は、すべてローカルPCで動いていました。今回は「AWSクラウド上にエージェントの居場所を用意する」ための土台を作りました。

日常の例えでいうと、これまでは「自分の机の上で作業していた」のを、「オフィスを借りて、ファイルキャビネット（S3）と社員証（IAMロール）を用意した」イメージです。

---

## 2. 作成・変更したファイル一覧

### 2.1 `packages/infra/package.json` — プロジェクトの部品リスト

| 項目 | 内容 |
|---|---|
| これは何か | CDKプロジェクトが使うライブラリの一覧。TSの `package.json` そのもの |
| なぜ必要か | `npm install` でCDK関連ライブラリをインストールするため |
| 関連技術 | AWS CDK / TypeScript |

TSをメインで書いている方にはおなじみの `package.json` です。Pythonの `pyproject.toml`、Laravelの `composer.json` と同じ役割。

主な依存パッケージ:

```json
{
  "dependencies": {
    "aws-cdk-lib": "^2.170.0",   // ← CDKの本体。AWSリソースを定義するクラスが全部入り
    "constructs": "^10.0.0"       // ← CDKの基盤ライブラリ（すべてのリソースの親クラス）
  }
}
```

### 2.2 `packages/infra/tsconfig.json` — TypeScriptのコンパイル設定

| 項目 | 内容 |
|---|---|
| これは何か | TypeScriptコンパイラの設定ファイル |
| なぜ必要か | `strict: true` で型チェックを厳しくし、バグを防ぐ |
| 関連技術 | TypeScript |

TSプロジェクトではおなじみのファイル。Laravelだと `.php-cs-fixer.php`（コーディングスタイル設定）に近い立ち位置です。`"strict": true` にして型安全性を確保しています。

### 2.3 `packages/infra/cdk.json` — CDK専用の設定ファイル

| 項目 | 内容 |
|---|---|
| これは何か | CDKにアプリのエントリポイントを教える設定ファイル |
| なぜ必要か | `cdk synth` や `cdk deploy` を実行するときに、CDKが「どのファイルから始めるか」を知るため |
| 関連技術 | AWS CDK |

```json
{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts"
  //      ↑ 「bin/app.ts を ts-node で実行してね」という指示
  //        Laravelでいう bootstrap/app.php のパスを指定するようなイメージ
}
```

### 2.4 `packages/infra/bin/app.ts` — CDKアプリのエントリポイント

| 項目 | 内容 |
|---|---|
| これは何か | CDKアプリの「入口」。ここからスタックを呼び出す |
| なぜ必要か | どのスタックをどの順番で作るかを定義する司令塔 |
| 関連技術 | AWS CDK |

TSでいう `src/index.ts`（アプリのメイン）、Laravelでいう `bootstrap/app.php` に相当します。

```typescript
const app = new cdk.App();   // ← CDKアプリを作成（Laravelでいう Application::create()）

// Step 2: S3バケット
const storageStack = new StorageStack(app, "StorageStack", { ... });

// Step 4: AgentCore Runtime（S3バケットを受け取る）
const runtimeStack = new RuntimeStack(app, "RuntimeStack", {
  dataBucket: storageStack.dataBucket,  // ← スタック間でバケットを共有
});
runtimeStack.addDependency(storageStack);
// ↑ 「RuntimeStack は StorageStack の後にデプロイしてね」という依存関係の宣言
//   TSでいう Promise のチェーンに近い考え方
```

**ポイント: `addDependency()` でスタック間の順序を制御する。** StorageStack でS3バケットを先に作らないと、RuntimeStack がバケットを参照できない。

### 2.5 `packages/infra/lib/storage-stack.ts` — S3バケットの定義

| 項目 | 内容 |
|---|---|
| これは何か | 天気データや分析レポートを保存する「ファイルキャビネット」の設計図 |
| なぜ必要か | エージェントが分析結果を保存する場所がないと、結果が消えてしまう |
| 関連技術 | AWS CDK / AWS S3 |

Laravelでいう `Storage::disk('s3')` の裏側にある「S3バケット自体を作る」コード。Laravelでは `.env` に `AWS_BUCKET=xxx` と書くだけでしたが、CDKでは「そのバケットを自動で作成する」ところまで定義します。

```typescript
export class StorageStack extends cdk.Stack {
  // ↑ cdk.Stack を継承（TSでいう extends、Laravelでいう extends Controller みたいなもの）
  //   1つの Stack = 1つの CloudFormation スタック = AWSリソースのグループ

  public readonly dataBucket: s3.Bucket;
  // ↑ 他のスタックから使えるように public にする
  //   TSの export と同じ考え方

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.dataBucket = new s3.Bucket(this, "WeatherAgentDataBucket", {

      // バケット名を動的に生成（世界中でユニークにする必要がある）
      bucketName: `weather-agent-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      // ↑ Laravelでいう config('app.name') . '-' . config('aws.account') のような動的解決

      encryption: s3.BucketEncryption.S3_MANAGED,
      // ↑ 暗号化ON。保存データを自動で暗号化する（セキュリティの基本）

      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // ↑ 「このバケットは絶対に外部公開しない」という設定

      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // ↑ 開発用: スタックを削除したらバケットも消す
      //   本番では RETAIN にして「スタック消してもデータは残す」にする

      lifecycleRules: [{
        transitions: [{ storageClass: s3.StorageClass.GLACIER, transitionAfter: cdk.Duration.days(90) }],
        expiration: cdk.Duration.days(365),
      }],
      // ↑ ライフサイクル: 90日後に安い保存先（Glacier）に移動、1年後に削除
      //   Laravelでいう Log::channel('daily') の maxFiles 設定に近い考え方
    });
  }
}
```

### 2.6 `packages/infra/lib/runtime-stack.ts` — AgentCore Runtime の定義

| 項目 | 内容 |
|---|---|
| これは何か | エージェントがクラウドで動くための「社員証」（IAMロール）の設計図 |
| なぜ必要か | エージェントがS3やBedrockにアクセスするには「許可証」が必要 |
| 関連技術 | AWS CDK / AWS IAM / AgentCore |

Laravelでいうと、`.env` に `AWS_ACCESS_KEY_ID` を書く代わりに「IAMロール」という仕組みでアクセス権を管理します。IAMロールは「この人（サービス）はこれをしていいよ」という許可証のようなものです。

```typescript
export interface RuntimeStackProps extends cdk.StackProps {
  dataBucket: s3.IBucket;  // ← StorageStack からバケットを受け取る
  // TSでいう interface の extends と同じ
}

export class RuntimeStack extends cdk.Stack {
  public readonly runtimeRole: iam.Role;

  constructor(scope: Construct, id: string, props: RuntimeStackProps) {
    super(scope, id, props);

    // IAMロールを作成: 「Bedrockサービスがこのロールを使える」と宣言
    this.runtimeRole = new iam.Role(this, "AgentCoreRuntimeRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      // ↑ 「Bedrockというサービスがこのロールを着る」
      //   Laravelでいう Gate::define() でポリシーを定義するのに近い
    });

    // S3への読み書き権限を付与
    props.dataBucket.grantReadWrite(this.runtimeRole);
    // ↑ 「このロールはこのバケットに読み書きしていいよ」
    //   Laravelでいう $user->givePermissionTo('edit articles') に近い

    // Bedrockモデル呼び出し権限
    this.runtimeRole.addToPolicy(new iam.PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: ["*"],
    }));
    // ↑ 「AIモデル（Claude等）を呼び出していいよ」という権限
  }
}
```

**なぜ IAM ロールが必要か？** AWSでは「何もかもデフォルトでは禁止」です。エージェントが S3 にデータを保存したり、Bedrock で AI を使ったりするには、明示的に「この操作をしていいよ」と許可する必要があります。これが IAM ロールの役割です。

---

## 3. ファイル間の関係図

```
cdk.json
  │  「エントリポイントは bin/app.ts だよ」
  ▼
bin/app.ts  ─────── エントリポイント（司令塔）
  │
  ├──→ lib/storage-stack.ts  ─── S3バケットを定義
  │         │
  │         │  dataBucket（バケットの参照を渡す）
  │         ▼
  └──→ lib/runtime-stack.ts  ─── IAMロールを定義
              │                    └── S3読み書き権限
              │                    └── Bedrockモデル呼び出し権限
              │                    └── AgentCore API権限
              │
package.json ─── 依存ライブラリ（aws-cdk-lib, constructs）
tsconfig.json ── TypeScriptのコンパイル設定
```

**データの流れ:**
1. `cdk synth` を実行すると `bin/app.ts` が呼ばれる
2. `app.ts` が `StorageStack` と `RuntimeStack` をインスタンス化する
3. CDKがTypeScriptのコードを **CloudFormation テンプレート（JSON）** に変換する
4. `cdk deploy` でそのテンプレートをAWSに送り、実際のリソースが作られる

---

## 4. 今回登場した技術・用語の解説

### AWS CDK（Cloud Development Kit）

**それは何か:** AWSのインフラを「プログラミング言語（TypeScript等）で定義する」ツール。

**なぜ使うか:** AWSコンソール（管理画面）でポチポチ作るのは手間がかかり、再現性がない。CDKなら「コードで書いて、`cdk deploy` 一発でインフラを作れる」。TSでいう「フレームワーク」のインフラ版。

**従来との比較:**
| 方法 | 例えるなら |
|---|---|
| AWSコンソール手動操作 | 手書きの設計図 |
| CloudFormation（JSON/YAML） | CADソフトで書いた設計図（正確だが書くのが大変） |
| CDK（TypeScript） | 設計図を自動生成するプログラム（書きやすい＋正確） |

### CloudFormation スタック

**それは何か:** AWSリソースをグループ化する単位。1つのスタック = 1セットのAWSリソース。

**なぜ使うか:** 「S3バケットとIAMロールをまとめて作る/まとめて消す」ができる。Laravelでいう `php artisan migrate`（まとめてテーブルを作る）と `php artisan migrate:rollback`（まとめて戻す）に似た概念。

### S3（Simple Storage Service）

**それは何か:** AWSの「ファイル置き場」サービス。ほぼ無限に保存でき、高い耐久性を持つ。

**なぜ使うか:** エージェントが分析した天気データやレポートを保存する場所として使う。Laravelの `Storage::disk('s3')` で使ったことがあるかもしれません。今回はその「バケット自体を作る」側のコードです。

### IAM ロール（Identity and Access Management）

**それは何か:** AWSの「許可証」システム。「誰が」「何に」「何をしていいか」を定義する。

**なぜ使うか:** AWSでは明示的に許可しないとすべて禁止。エージェントがS3に保存したりBedrockでAIを呼び出すには、IAMロールで許可が必要。Laravelでいう `Gate` / `Policy`（認可）に相当。

### SSE-S3（Server-Side Encryption with S3 Managed Keys）

**それは何か:** S3に保存するデータを自動で暗号化する仕組み。AWSが暗号化キーを管理してくれる。

**なぜ使うか:** データが漏洩しても中身を読めないようにする基本的なセキュリティ対策。TSでいう `bcrypt` でパスワードをハッシュ化するのと同じ発想。

### ライフサイクルポリシー

**それは何か:** S3のデータを「時間が経ったら安い保存先に移す/削除する」ルール。

**なぜ使うか:** 古いデータを高いストレージに置き続けるとコストがかさむ。90日後にGlacier（安い冷凍庫のようなもの）に移し、365日後に削除する。

### CfnOutput

**それは何か:** CDKデプロイ後に「作ったリソースの情報」を表示・エクスポートする仕組み。

**なぜ使うか:** `cdk deploy` 後に「バケット名は何？ロールARNは何？」を確認できる。他のスタックやスクリプトから参照もできる。TSでいう `export` で値を公開するのに近い。

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップ対応

| Lab | 関連内容 |
|---|---|
| **Lab 2** | AgentCore Runtime の概念（microVM 隔離、デプロイモデル） |

Lab 2 では `agentcore deploy` でエージェントをクラウドにデプロイする流れを学びます。今回はその前段階として「Runtime が必要とするインフラ（S3 + IAMロール）」をCDKで定義しました。

### 本番構成との対応（architecture-comparison.md より）

| 本番構成 | サンプル構成 | 状態 |
|---|---|---|
| S3（文書保管） | S3（気象データ保管）→ **StorageStack** | 再現 |
| AgentCore Runtime (microVM隔離) | AgentCore Runtime → **RuntimeStack** | 再現 |

### 本番との違い（簡略化した部分）

| 項目 | 本番 | サンプル | 理由 |
|---|---|---|---|
| S3暗号化 | KMSカスタムキー（SSE-KMS） | AWSマネージドキー（SSE-S3） | KMSキー管理の学習コストを避けるため |
| バージョニング | 有効 | 無効 | 開発用なのでシンプルに |
| バケットポリシー | 厳密なアクセス制御 | IAMロールベースのみ | 最小限のアクセス制御で十分 |
| Runtime配置 | VPC内 + PrivateLink | パブリックエンドポイント | ネットワーク構成の簡略化 |
| 環境分離 | dev/stg/prod | 単一環境 | 学習用のためシンプルに |
| Runtime CDKリソース | L2 Construct（将来提供予定） | IAMロールのみ定義 | CDK L2 が未提供のため `agentcore deploy` CLI で補完 |

---

## 6. 次のタスクへのつながり

```
TASK-007（今回）          TASK-008（次）
StorageStack              agentcore deploy
  └─ S3バケット      →     エージェントコードをRuntimeにデプロイ
RuntimeStack              HTTPS エンドポイントで動作確認
  └─ IAMロール       →     Runtime がこのロールで S3/Bedrock にアクセス
```

- **TASK-008（AgentCore Runtime デプロイ）**: 今回作った IAM ロールを使って、`agentcore deploy` コマンドでエージェントコード（TASK-001〜006で作ったPythonコード）をクラウドにデプロイする
- **TASK-009（MemoryStack）**: 今回と同じパターンで `lib/memory-stack.ts` を追加し、AgentCore Memory を定義する
- **TASK-010（ObservabilityStack）**: CloudWatch ダッシュボードのスタックを追加する

今回の `StorageStack` で作った S3 バケットは、TASK-004 で実装した `save_to_s3` ツールの保存先になります。ローカル実行時は `AWS_DEFAULT_REGION` と認証情報の設定が必要でしたが、Runtime にデプロイすればIAMロール経由で自動的にアクセスできるようになります。

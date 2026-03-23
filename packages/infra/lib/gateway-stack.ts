import * as cdk from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as ses from "aws-cdk-lib/aws-ses";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import { Construct } from "constructs";

/**
 * GatewayStack のプロパティ
 */
export interface GatewayStackProps extends cdk.StackProps {
  /** StorageStack で作成した S3 バケット（Knowledge Bases のデータソース） */
  dataBucket: s3.IBucket;
  /** RuntimeStack で作成した IAM ロール（Gateway/Guardrails 権限を追加する） */
  runtimeRole: iam.IRole;
  /** 通知先メールアドレス（SNS サブスクリプション用） */
  notificationEmail?: string;
}

/**
 * GatewayStack - 本番構成の仕上げ（Step 9）
 *
 * 学習ポイント:
 *   - AgentCore Gateway (MCP): 外部 API アクセスを MCP プロトコルに統一する（Lab 7 対応）
 *     Step 1 で直接 httpx 呼び出ししていたツールを MCP 経由に切り替えられる
 *   - Bedrock Guardrails: PII 検出・不適切コンテンツのフィルタリング（Lab 8 対応）
 *     エージェント出力の安全性を自動チェックする
 *   - Bedrock Knowledge Bases + S3 Vectors: RAG で気象用語辞書や過去レポートを検索可能にする
 *   - SNS: 異常気象アラートのプッシュ通知
 *   - SES: 日次レポートのメール送信
 *
 * 本番構成との違い:
 *   - 本番では Gateway の MCP Server を複数定義（天気API、災害API 等）するが、
 *     サンプルでは設定の定義のみ（実際の MCP Server 接続はデプロイ後に設定）
 *   - 本番では Guardrails のカスタムワードフィルタやトピック制限を細かく設定するが、
 *     サンプルでは基本的な PII フィルタとコンテンツフィルタのみ
 *   - 本番では SES の送信元ドメインを検証するが、サンプルではメールアドレス検証のみ
 *   - 本番では Knowledge Bases に定期的にデータを同期するが、
 *     サンプルでは手動同期で簡略化
 */
export class GatewayStack extends cdk.Stack {
  /** SNS トピック（異常気象アラート通知用） */
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: GatewayStackProps) {
    super(scope, id, props);

    // =========================================================
    // 1. SNS Topic + Subscription（異常気象アラート通知）
    // =========================================================
    // 学習ポイント: SNS（Simple Notification Service）はプッシュ型の通知サービス。
    // トピックにメッセージを発行すると、サブスクライブしている全員に通知が届く。
    // OrchestrationStack の異常気象監視WF で SendNotification ステップから呼ばれる。
    //
    // 本番構成との違い:
    //   本番では SNS → Lambda → Slack/PagerDuty 連携や、
    //   SNS → SQS → バッチ処理 のパターンも使うが、
    //   サンプルではメール通知のみ。
    this.alertTopic = new sns.Topic(this, "WeatherAlertTopic", {
      topicName: "weather-agent-alerts",
      displayName: "天気エージェント 異常気象アラート",
    });

    // メールサブスクリプション（通知先メールアドレスが指定されている場合のみ）
    // 学習ポイント: サブスクリプション作成後、メールで確認リンクが届く。
    // リンクをクリックして承認しないと通知が届かない（スパム防止）。
    if (props.notificationEmail) {
      this.alertTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(props.notificationEmail)
      );
    }

    // =========================================================
    // 2. SES Email Template（日次レポートメール送信）
    // =========================================================
    // 学習ポイント: SES（Simple Email Service）はメール送信サービス。
    // テンプレートを定義しておき、変数を差し替えてメールを送信する。
    // 天気分析WF の GenerateReport ステップから呼ばれる。
    //
    // 本番構成との違い:
    //   本番では送信元ドメインの DNS 検証（SPF, DKIM）が必要だが、
    //   サンプルではテンプレート定義のみ（実際の送信はデプロイ後に設定）。
    new ses.CfnTemplate(this, "WeatherReportTemplate", {
      template: {
        templateName: "weather-agent-daily-report",
        subjectPart: "【天気エージェント】日次レポート {{date}}",
        htmlPart: [
          "<h1>天気分析レポート</h1>",
          "<p>日付: {{date}}</p>",
          "<h2>分析対象都市</h2>",
          "<p>{{cities}}</p>",
          "<h2>分析結果サマリ</h2>",
          "<p>{{summary}}</p>",
          "<h2>異常気象検知</h2>",
          "<p>{{anomalies}}</p>",
          "<hr>",
          "<p>このメールは天気データ分析エージェントから自動送信されています。</p>",
        ].join("\n"),
        textPart:
          "天気分析レポート\n日付: {{date}}\n分析対象: {{cities}}\nサマリ: {{summary}}\n異常: {{anomalies}}",
      },
    });

    // =========================================================
    // 3. Bedrock Guardrails（エージェント出力の安全性チェック）
    // =========================================================
    // 学習ポイント: Guardrails はエージェントの入出力を自動チェックするフィルタ。
    // PII（個人情報）の検出や不適切コンテンツのブロックを行う（Lab 8 対応）。
    // エージェントが生成した回答に個人情報が含まれていないか、
    // 不適切な表現がないかを自動でチェックし、問題があればブロックする。
    //
    // 本番構成との違い:
    //   本番ではカスタムワードフィルタ（業界用語のブラックリスト）や
    //   トピック制限（天気以外の話題を拒否）を細かく設定するが、
    //   サンプルでは基本的なフィルタのみ。
    const guardrail = new bedrock.CfnGuardrail(this, "WeatherAgentGuardrail", {
      name: "weather-agent-guardrail",
      description:
        "天気エージェントの入出力を安全にするガードレール（PII検出・コンテンツフィルタ）",
      blockedInputMessaging:
        "申し訳ありませんが、この入力は処理できません。天気に関する質問をお願いします。",
      blockedOutputsMessaging:
        "申し訳ありませんが、この回答は安全性の基準を満たしていないため表示できません。",

      // コンテンツフィルタ: 有害なコンテンツをブロック
      // 学習ポイント: filtersConfig で各カテゴリの入力/出力フィルタ強度を設定する。
      // NONE / LOW / MEDIUM / HIGH の4段階。HIGH にすると厳しくフィルタされる。
      contentPolicyConfig: {
        filtersConfig: [
          {
            type: "SEXUAL",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "VIOLENCE",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "HATE",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "INSULTS",
            inputStrength: "HIGH",
            outputStrength: "HIGH",
          },
          {
            type: "MISCONDUCT",
            inputStrength: "MEDIUM",
            outputStrength: "MEDIUM",
          },
        ],
      },

      // PII（個人情報）フィルタ: 個人情報を自動検出してマスキングする
      // 学習ポイント: sensitiveInformationPolicyConfig で PII の検出と
      // アクション（BLOCK / ANONYMIZE）を設定する。
      // ANONYMIZE はマスキング（例: 田中太郎 → [NAME]）、BLOCK は応答拒否。
      sensitiveInformationPolicyConfig: {
        piiEntitiesConfig: [
          { type: "EMAIL", action: "ANONYMIZE" },
          { type: "PHONE", action: "ANONYMIZE" },
          { type: "NAME", action: "ANONYMIZE" },
          { type: "ADDRESS", action: "ANONYMIZE" },
        ],
      },

      // トピック制限: 天気に関係ない話題を拒否
      // 学習ポイント: topicPolicyConfig でエージェントが扱うべきトピックを制限する。
      // 天気エージェントに「株価を教えて」と聞かれても拒否する。
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: "off-topic",
            definition:
              "天気、気象、気候、災害に関係のないトピック（例: 株価、政治、エンターテインメント）",
            type: "DENY",
            examples: [
              "今日の株価を教えて",
              "おすすめの映画は？",
              "政治について意見を聞かせて",
            ],
          },
        ],
      },
    });

    // Guardrail バージョン（デプロイ時に DRAFT → バージョン1 に昇格）
    // 学習ポイント: Guardrail は DRAFT 状態で作成され、
    // バージョンを発行して初めてエージェントから利用可能になる。
    const guardrailVersion = new bedrock.CfnGuardrailVersion(
      this,
      "GuardrailVersion",
      {
        guardrailIdentifier: guardrail.attrGuardrailId,
        description: "初期バージョン（TASK-014 で作成）",
      }
    );

    // =========================================================
    // 4. Knowledge Bases 用 S3 設定
    // =========================================================
    // 学習ポイント: Knowledge Bases は S3 に保存されたドキュメントを
    // ベクトル化（埋め込み）して、セマンティック検索（意味で探す検索）を可能にする。
    // エージェントが「ラニーニャ現象とは？」と聞かれたとき、
    // S3 に保存された気象用語辞書から関連情報を検索して回答に含める（RAG パターン）。
    //
    // 本番構成との違い:
    //   本番では OpenSearch Serverless や Aurora PostgreSQL をベクトルストアに使うが、
    //   サンプルでは S3 + Bedrock のマネージドベクトルストアで簡略化。
    //   Knowledge Bases リソース自体は CDK L2 コンストラクトがまだ限定的なため、
    //   ここではデータソースの S3 プレフィックスと IAM 権限のみ定義する。
    //   実際の Knowledge Bases 作成はコンソールまたは boto3 で行う。

    // Knowledge Bases 用の S3 プレフィックスを定義
    // data/knowledge/ 配下に気象用語辞書や過去レポートを配置する
    const knowledgeBasePrefix = "data/knowledge/";

    // =========================================================
    // 5. AgentCore Gateway (MCP) 設定
    // =========================================================
    // 学習ポイント: AgentCore Gateway は外部 API アクセスを MCP（Model Context Protocol）
    // プロトコルに統一するサービス（Lab 7 対応）。
    // Step 1 で直接 httpx 呼び出ししていた天気 API ツールを、
    // MCP 経由に切り替えることで以下のメリットがある:
    //   - API アクセスの一元管理（認証情報、レートリミット等）
    //   - ツールの追加・変更が容易（エージェントコードを変更せずに API を差し替え可能）
    //   - アクセスログの自動記録
    //
    // 本番構成との違い:
    //   本番では Gateway の MCP Server を複数定義（天気API、災害API、社内API等）するが、
    //   サンプルでは CDK で権限設定のみ行い、
    //   実際の Gateway 作成はコンソールまたは boto3 で行う。
    //   （AgentCore Gateway の CDK L2 コンストラクトはまだ提供されていない）

    // --- IAM 権限の追加 ---
    // RuntimeStack のロールに Gateway / Guardrails / Knowledge Bases 関連の権限を追加

    // Guardrails 呼び出し権限
    // 学習ポイント: エージェントが ApplyGuardrail API を呼んで
    // 入出力をチェックするための権限。
    props.runtimeRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "GuardrailsAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:ApplyGuardrail",
          "bedrock:GetGuardrail",
          "bedrock:ListGuardrails",
        ],
        resources: ["*"],
      })
    );

    // Knowledge Bases 検索権限
    // 学習ポイント: エージェントが Retrieve API を呼んで
    // Knowledge Bases からセマンティック検索するための権限。
    props.runtimeRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "KnowledgeBasesAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:Retrieve",
          "bedrock:RetrieveAndGenerate",
          "bedrock:ListKnowledgeBases",
        ],
        resources: ["*"],
      })
    );

    // SNS 発行権限（Step Functions / Lambda から通知を送るため）
    // 学習ポイント: クロススタック循環参照を避けるため、
    // リソース ARN をワイルドカードで指定する。
    // 本番では特定の Topic ARN に限定する。
    props.runtimeRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "SNSPublish",
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: ["*"],
      })
    );

    // SES 送信権限
    props.runtimeRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "SESSendEmail",
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendTemplatedEmail",
          "ses:SendRawEmail",
        ],
        resources: ["*"],
      })
    );

    // Gateway (MCP) 関連権限
    // 学習ポイント: AgentCore Gateway の API を呼ぶための権限。
    // Gateway 経由で外部 API を呼ぶ際にこの権限が必要。
    props.runtimeRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "AgentCoreGatewayAccess",
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:*AgentCoreGateway*", "bedrock:*McpServer*"],
        resources: ["*"],
      })
    );

    // --- CloudFormation 出力 ---
    new cdk.CfnOutput(this, "AlertTopicArn", {
      value: this.alertTopic.topicArn,
      description: "異常気象アラート SNS トピック ARN",
      exportName: "WeatherAgentAlertTopicArn",
    });

    new cdk.CfnOutput(this, "GuardrailId", {
      value: guardrail.attrGuardrailId,
      description: "Bedrock Guardrail ID",
      exportName: "WeatherAgentGuardrailId",
    });

    new cdk.CfnOutput(this, "GuardrailVersionNumber", {
      value: guardrailVersion.attrVersion,
      description: "Bedrock Guardrail バージョン番号",
      exportName: "WeatherAgentGuardrailVersion",
    });

    new cdk.CfnOutput(this, "KnowledgeBaseS3Prefix", {
      value: `s3://${props.dataBucket.bucketName}/${knowledgeBasePrefix}`,
      description:
        "Knowledge Bases のデータソース S3 プレフィックス（気象用語辞書・過去レポートを配置）",
      exportName: "WeatherAgentKnowledgeBaseS3Prefix",
    });

    new cdk.CfnOutput(this, "SesTemplateName", {
      value: "weather-agent-daily-report",
      description: "SES メールテンプレート名",
      exportName: "WeatherAgentSesTemplateName",
    });

    new cdk.CfnOutput(this, "GatewayInstructions", {
      value:
        "Create AgentCore Gateway via console or boto3. CDK L2 construct is not yet available.",
      description:
        "AgentCore Gateway 作成手順（コンソールまたは boto3 で作成する）",
    });

    new cdk.CfnOutput(this, "KnowledgeBasesInstructions", {
      value:
        "Create Knowledge Bases via console or boto3 with the S3 prefix above as data source.",
      description:
        "Knowledge Bases 作成手順（コンソールまたは boto3 で作成する）",
    });
  }
}

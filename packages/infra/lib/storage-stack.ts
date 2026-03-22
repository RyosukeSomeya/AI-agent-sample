import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

/**
 * StorageStack - S3バケット定義（Step 2）
 *
 * 学習ポイント:
 *   - CDK で S3 バケットを定義する基本パターン（Lab 2 対応）
 *   - 暗号化（SSE-S3）とライフサイクルポリシーの設定方法
 *   - RemovalPolicy で開発用バケットの削除挙動を制御する
 *
 * 本番構成との違い:
 *   - 本番では KMS カスタムキーによる暗号化（SSE-KMS）を使用するが、
 *     サンプルでは SSE-S3（AWS マネージドキー）に簡略化している
 *   - 本番ではバケットポリシーでアクセス制御を厳密にするが、サンプルでは省略
 *   - 本番では versioning を有効にするが、サンプルでは無効にしている
 */
export class StorageStack extends cdk.Stack {
  /** 他のスタックから参照するための S3 バケット */
  public readonly dataBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3バケット: 天気データ・分析レポート・アラートを保存する
    // バケット名に AWS アカウントID とリージョンを含めてグローバル一意にする
    // （仕様書 4.1 S3バケット構成 参照）
    this.dataBucket = new s3.Bucket(this, "WeatherAgentDataBucket", {
      // バケット名: weather-agent-{account-id}-{region}
      // CDK の Aws.ACCOUNT_ID / Aws.REGION で動的に解決する
      bucketName: `weather-agent-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,

      // 暗号化: SSE-S3（AWS マネージドキー）
      // 学習ポイント: S3 のサーバーサイド暗号化は最低限 SSE-S3 を有効にする
      encryption: s3.BucketEncryption.S3_MANAGED,

      // ブロックパブリックアクセス: すべてブロック（セキュリティのベストプラクティス）
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      // 開発用: スタック削除時にバケットも削除する
      // 本番では RETAIN にしてデータを保護する
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,

      // ライフサイクルポリシー: 90日後に Glacier へ移行、365日後に削除
      // 学習ポイント: コスト最適化のためにライフサイクルルールを設定する
      lifecycleRules: [
        {
          id: "archive-old-data",
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
      ],
    });

    // CloudFormation 出力: バケット名と ARN を出力する
    // 他のスタックやデプロイスクリプトから参照できるようにする
    new cdk.CfnOutput(this, "DataBucketName", {
      value: this.dataBucket.bucketName,
      description: "天気データ保存用S3バケット名",
      exportName: "WeatherAgentDataBucketName",
    });

    new cdk.CfnOutput(this, "DataBucketArn", {
      value: this.dataBucket.bucketArn,
      description: "天気データ保存用S3バケットARN",
      exportName: "WeatherAgentDataBucketArn",
    });
  }
}

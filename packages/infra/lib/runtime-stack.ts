import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/**
 * RuntimeStack のプロパティ
 */
export interface RuntimeStackProps extends cdk.StackProps {
  /** StorageStack で作成した S3 バケット */
  dataBucket: s3.IBucket;
}

/**
 * RuntimeStack - AgentCore Runtime 定義（Step 4）
 *
 * 学習ポイント:
 *   - AgentCore Runtime は microVM でエージェントのセッションを隔離する（Lab 2 対応）
 *   - CDK では Runtime の設定（IAM ロール等）を定義し、`agentcore deploy` でコードをプッシュする
 *   - エンドポイント URL は `agentcore deploy` 後に発行される
 *
 * 本番構成との違い:
 *   - 本番では VPC 内に Runtime を配置し、PrivateLink 経由でアクセスするが、
 *     サンプルではパブリックエンドポイントを使用する
 *   - 本番では AutoScaling（minWorkers/maxWorkers）を調整するが、
 *     サンプルではデフォルト設定のまま
 *
 * 注意:
 *   AgentCore Runtime リソース自体は CDK L2 コンストラクトがまだ提供されていないため、
 *   ここでは Runtime が使用する IAM ロール（S3 アクセス権限等）を定義する。
 *   実際の Runtime 作成は `agentcore deploy` CLI で行う（TASK-008）。
 */
export class RuntimeStack extends cdk.Stack {
  /** AgentCore Runtime が使用する IAM ロール */
  public readonly runtimeRole: iam.Role;

  constructor(scope: Construct, id: string, props: RuntimeStackProps) {
    super(scope, id, props);

    // AgentCore Runtime 用 IAM ロール
    // 学習ポイント: AgentCore Runtime は microVM 内でエージェントコードを実行する。
    // エージェントが S3 や Bedrock にアクセスするための権限をこのロールで付与する。
    this.runtimeRole = new iam.Role(this, "AgentCoreRuntimeRole", {
      roleName: "weather-agent-runtime-role",
      // AgentCore Runtime のサービスプリンシパルは bedrock-agentcore.amazonaws.com
      // bedrock.amazonaws.com ではないので注意（Lab 2 で学ぶハマりポイント）
      assumedBy: new iam.ServicePrincipal("bedrock-agentcore.amazonaws.com"),
      description:
        "IAM role for AgentCore Runtime to execute weather agent code",
    });

    // S3 アクセス権限: データバケットへの読み書き
    // 学習ポイント: 最小権限の原則に従い、必要なバケットのみにアクセスを限定する
    props.dataBucket.grantReadWrite(this.runtimeRole);

    // Bedrock モデル呼び出し権限
    // 学習ポイント: Strands Agents は内部で Bedrock の InvokeModel API を呼び出す。
    // Runtime ロールにこの権限がないとエージェントがモデルを使用できない。
    this.runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "BedrockModelInvocation",
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        // サンプルではすべてのモデルを許可（本番では特定モデルに限定する）
        resources: ["*"],
      })
    );

    // AgentCore 関連の権限
    // 学習ポイント: AgentCore の API（Code Interpreter 等）を使用するための権限
    this.runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "AgentCoreAccess",
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:*AgentCore*", "bedrock:*AgentRuntime*"],
        resources: ["*"],
      })
    );

    // ECR 権限: コンテナデプロイ時にイメージを取得するために必要
    // 学習ポイント: コンテナデプロイでは Runtime が ECR からイメージを pull する
    this.runtimeRole.addToPolicy(
      new iam.PolicyStatement({
        sid: "ECRAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "ecr:GetAuthorizationToken",
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
        ],
        resources: ["*"],
      })
    );

    // ログ配信設定:
    // AllowVendedLogDeliveryForResource は IAM ポリシーではなく
    // AgentCore Runtime リソース自体のリソースベースポリシーであり、
    // CloudFormation では設定できない（V2 Vended Logs の制約）。
    // deploy.sh 内の setup_observability.py（boto3）で設定する。
    // 参考: https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AWS-logs-infrastructure-V2-service-specific.html

    // CloudFormation 出力
    new cdk.CfnOutput(this, "RuntimeRoleArn", {
      value: this.runtimeRole.roleArn,
      description: "AgentCore Runtime 用 IAM ロール ARN",
      exportName: "WeatherAgentRuntimeRoleArn",
    });

    // agentcore deploy 時の手順メモを出力
    // 学習ポイント: CDK でインフラを作った後、agentcore CLI でエージェントコードをデプロイする
    new cdk.CfnOutput(this, "DeployInstructions", {
      value:
        "Run: agentcore deploy --role-arn <RuntimeRoleArn> to deploy agents",
      description: "AgentCore Runtime デプロイ手順",
    });
  }
}

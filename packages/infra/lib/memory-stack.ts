import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

/**
 * MemoryStack のプロパティ
 */
export interface MemoryStackProps extends cdk.StackProps {
  /** RuntimeStack で作成した IAM ロール（Memory API アクセス権限を追加する） */
  runtimeRole: iam.IRole;
}

/**
 * MemoryStack - AgentCore Memory 定義（Step 5）
 *
 * 学習ポイント:
 *   - AgentCore Memory は短期記憶（会話内）と長期記憶（セマンティック検索可能）を提供する（Lab 3 対応）
 *   - MemoryClient の create_event() で記憶を保存し、retrieve_memories() で検索する
 *   - Memory Strategy により短期記憶が自動的に長期記憶に変換される
 *   - CDK では Memory API へのアクセス権限を RuntimeStack のロールに追加する
 *
 * 本番構成との違い:
 *   - 本番では namespace を環境ごとに分離（/prod/weather-analysis 等）するが、
 *     サンプルでは単一 namespace（/weather-analysis）のみ
 *   - 本番では Memory の保持期間や容量制限をカスタマイズするが、
 *     サンプルではデフォルト設定を使用する
 */
export class MemoryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MemoryStackProps) {
    super(scope, id, props);

    // AgentCore Memory API へのアクセス権限を RuntimeStack のロールに追加
    // 学習ポイント: AgentCore Memory は Bedrock の API として提供される。
    // Runtime ロールに Memory 関連のアクションを許可することで、
    // エージェントコードから MemoryClient を使えるようになる。
    // create_event()（記憶の保存）と retrieve_memories()（記憶の検索）の両方に必要。
    props.runtimeRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: "AgentCoreMemoryAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          // Memory の読み書き操作
          // Lab 3 で学ぶ: create_event / retrieve_memories に対応する API アクション
          "bedrock:CreateAgentCoreMemory",
          "bedrock:RetrieveAgentCoreMemory",
          "bedrock:DeleteAgentCoreMemory",
          "bedrock:ListAgentCoreMemories",
          // Memory Strategy（短期→長期変換ルール）の管理
          "bedrock:*AgentCoreMemory*",
        ],
        resources: ["*"],
      })
    );

    // CloudFormation 出力: Memory の namespace を出力
    // エージェント側の MemoryClient 初期化時にこの namespace を使用する
    new cdk.CfnOutput(this, "MemoryNamespace", {
      value: "/weather-analysis",
      description:
        "AgentCore Memory の namespace（エージェント側で MemoryClient に渡す）",
      exportName: "WeatherAgentMemoryNamespace",
    });

    // 設定メモを出力
    // 学習ポイント: Memory は Runtime と異なり CDK でリソースを作成するのではなく、
    // エージェントコード側で MemoryClient を初期化するだけで利用開始できる
    new cdk.CfnOutput(this, "MemoryInstructions", {
      value:
        "Memory is enabled via MemoryClient in agent code. No separate resource creation needed.",
      description: "AgentCore Memory 利用手順",
    });
  }
}

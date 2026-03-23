"""CLI エントリポイント。

学習ポイント:
    uv run python -m orchestrator で起動する。
    他のエージェントと同じ対話ループだが、内部では
    オーケストレータが4つの専門エージェントを A2A で連携させる。
    (ワークショップ外 / 発展: マルチエージェント設計)

    ユーザーから見ると1つのエージェントと話しているだけだが、
    裏では収集→分析→横断分析→異常検知が自動で連携する。

    Memory 連携（Lab 3 対応）:
    起動時に Memory リソースを作成し、analyst / crosscut に渡す。
    分析結果が自動的に記憶され、「先週と比較して」に答えられるようになる。

本番構成との違い:
    本番では Step Functions が外側の制御を担い、
    AgentCore Runtime 上のエージェントを HTTPS で呼び出す。
    本番では Memory ID を環境変数から取得する。
    このCLI対話は開発・テスト用。
"""
from __future__ import annotations

import uuid

from orchestrator.agent import create_orchestrator
from shared.memory import create_memory


def main() -> None:
    """対話ループを実行する。"""
    # Memory リソースを作成（Lab 3 対応）
    # analyst / crosscut が共有する Memory を初期化する
    print("🧠 Memory リソースを初期化中...")
    memory_id = create_memory()

    # セッション ID / アクター ID を生成
    session_id = f"orchestrator-session-{uuid.uuid4().hex[:8]}"
    actor_id = "local-user"

    agent = create_orchestrator(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=actor_id,
    )
    print("🎼 オーケストレータ起動（exitで終了）")
    print("  収集・分析・横断分析・異常検知の4エージェントを統合")
    print("=" * 50)

    while True:
        try:
            user_input = input("\nあなた: ").strip()
            if user_input.lower() in ("exit", "quit"):
                break
            if not user_input:
                continue

            # agent() を呼ぶだけで、オーケストレータが判断し
            # 必要なエージェントを自動で呼び分ける（A2A連携）
            # 例: "東京と大阪の天気を比較して" →
            #   collector(東京) → collector(大阪) → analyst → crosscut
            # Memory が有効なため、分析結果が自動的に記憶される
            response = agent(user_input)
            print(f"\nエージェント: {response}")

        except KeyboardInterrupt:
            break

    print("\n👋 終了します")


if __name__ == "__main__":
    main()

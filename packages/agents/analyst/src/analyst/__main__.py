"""CLI エントリポイント。

学習ポイント:
    uv run python -m analyst で起動する。
    collector の __main__.py と同じ対話ループパターン。
    (Lab 1 対応)

    Memory 連携（Lab 3 対応）:
    起動時に AgentCore Memory リソースを作成（または既存を取得）し、
    セッション ID とアクター ID を生成して Memory を有効化する。
    会話の内容が自動的に短期・長期記憶に保存される。

本番構成との違い:
    本番では AgentCore Runtime の HTTPS エンドポイント経由で呼び出す。
    本番では Memory ID を環境変数から取得するが、サンプルでは毎回作成する。
    このCLI対話は開発・テスト用。
"""
from __future__ import annotations

import uuid

from analyst.agent import create_analyst_agent
from shared.memory import create_memory


def main() -> None:
    """対話ループを実行する。"""
    # Memory リソースを作成（Lab 3 対応）
    # 学習ポイント: Memory はエージェント起動時に1回作成すればよい。
    # 返された memory_id を使って SessionManager を初期化する。
    print("🧠 Memory リソースを初期化中...")
    memory_id = create_memory()

    # セッション ID / アクター ID を生成
    # session_id: 1回の会話を識別（会話ごとに新しい UUID）
    # actor_id: ユーザーを識別（本番ではログインユーザー ID を使う）
    session_id = f"analyst-session-{uuid.uuid4().hex[:8]}"
    actor_id = "local-user"

    agent = create_analyst_agent(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=actor_id,
    )
    print("📊 分析エージェント起動（exitで終了）")
    print("=" * 50)

    while True:
        try:
            user_input = input("\nあなた: ").strip()
            if user_input.lower() in ("exit", "quit"):
                break
            if not user_input:
                continue

            # agent() を呼ぶだけでBedrock推論→ツール実行→回答生成が自動で行われる
            # Code Interpreter が必要と判断されれば、LLMがPythonコードを生成して実行する
            # Memory が有効なため、会話の内容が自動的に記憶される
            response = agent(user_input)
            print(f"\nエージェント: {response}")

        except KeyboardInterrupt:
            break

    print("\n👋 終了します")


if __name__ == "__main__":
    main()

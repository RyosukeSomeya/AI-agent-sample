"""CLI エントリポイント。

学習ポイント:
    uv run python -m crosscut で起動する。
    collector / analyst と同じ対話ループパターン。
    (ワークショップ外 / 発展: マルチエージェント設計)

    単体で起動して横断分析を試すことも、
    オーケストレータ（TASK-006）から呼び出すこともできる。
    エージェントの実装がデプロイ形態に依存しないのが Strands Agents の特徴。

    Memory 連携（Lab 3 対応）:
    analyst と同じく、起動時に Memory リソースを作成してセッションを開始する。

本番構成との違い:
    本番では AgentCore Runtime の HTTPS エンドポイント経由で呼び出す。
    本番では Memory ID を環境変数から取得するが、サンプルでは毎回作成する。
    このCLI対話は開発・テスト用。
"""
from __future__ import annotations

import uuid

from crosscut.agent import create_crosscut_agent
from shared.memory import create_memory


def main() -> None:
    """対話ループを実行する。"""
    # Memory リソースを作成（Lab 3 対応）
    print("🧠 Memory リソースを初期化中...")
    memory_id = create_memory()

    # セッション ID / アクター ID を生成
    session_id = f"crosscut-session-{uuid.uuid4().hex[:8]}"
    actor_id = "local-user"

    agent = create_crosscut_agent(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=actor_id,
    )
    print("🔀 横断分析エージェント起動（exitで終了）")
    print("=" * 50)

    while True:
        try:
            user_input = input("\nあなた: ").strip()
            if user_input.lower() in ("exit", "quit"):
                break
            if not user_input:
                continue

            # agent() を呼ぶだけでBedrock推論→ツール実行→回答生成が自動で行われる
            # 複数都市のデータを渡すと、Code Interpreter で比較分析を実行する
            # Memory が有効なため、過去の横断分析結果を記憶から参照できる
            response = agent(user_input)
            print(f"\nエージェント: {response}")

        except KeyboardInterrupt:
            break

    print("\n👋 終了します")


if __name__ == "__main__":
    main()

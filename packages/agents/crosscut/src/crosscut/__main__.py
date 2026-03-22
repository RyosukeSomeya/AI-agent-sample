"""CLI エントリポイント。

学習ポイント:
    uv run python -m crosscut で起動する。
    collector / analyst と同じ対話ループパターン。
    (ワークショップ外 / 発展: マルチエージェント設計)

    単体で起動して横断分析を試すことも、
    オーケストレータ（TASK-006）から呼び出すこともできる。
    エージェントの実装がデプロイ形態に依存しないのが Strands Agents の特徴。

本番構成との違い:
    本番では AgentCore Runtime の HTTPS エンドポイント経由で呼び出す。
    このCLI対話は開発・テスト用。
"""
from __future__ import annotations

from crosscut.agent import create_crosscut_agent


def main() -> None:
    """対話ループを実行する。"""
    agent = create_crosscut_agent()
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
            response = agent(user_input)
            print(f"\nエージェント: {response}")

        except KeyboardInterrupt:
            break

    print("\n👋 終了します")


if __name__ == "__main__":
    main()

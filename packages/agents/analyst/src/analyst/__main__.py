"""CLI エントリポイント。

学習ポイント:
    uv run python -m analyst で起動する。
    collector の __main__.py と同じ対話ループパターン。
    (Lab 1 対応)

本番構成との違い:
    本番では AgentCore Runtime の HTTPS エンドポイント経由で呼び出す。
    このCLI対話は開発・テスト用。
"""
from __future__ import annotations

from analyst.agent import create_analyst_agent


def main() -> None:
    """対話ループを実行する。"""
    agent = create_analyst_agent()
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
            response = agent(user_input)
            print(f"\nエージェント: {response}")

        except KeyboardInterrupt:
            break

    print("\n👋 終了します")


if __name__ == "__main__":
    main()

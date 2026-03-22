"""CLI エントリポイント。

学習ポイント:
    uv run python -m collector で起動する。
    agent(user_input) を呼ぶだけで、推論→ツール実行→回答生成が自動で回る。
    (Lab 1 対応)

    対話ループの仕組み:
    1. ユーザーが自然言語で入力
    2. agent(入力) で Bedrock に推論リクエスト
    3. Bedrock がツール呼び出しを判断
    4. ツール実行結果を踏まえて再推論
    5. 最終回答をテキストで表示

本番構成との違い:
    本番では AgentCore Runtime の HTTPS エンドポイント経由で呼び出す。
    このCLI対話は開発・テスト用。コードの大部分（agent.py, tools/）は
    ローカルでもクラウドでも共通。
"""
from __future__ import annotations

from collector.agent import create_collector_agent


def main() -> None:
    """対話ループを実行する。"""
    agent = create_collector_agent()
    print("🌤 収集エージェント起動（exitで終了）")
    print("=" * 50)

    while True:
        try:
            user_input = input("\nあなた: ").strip()
            if user_input.lower() in ("exit", "quit"):
                break
            if not user_input:
                continue

            # agent() を呼ぶだけでBedrock推論→ツール実行→回答生成が自動で行われる
            # これが Strands Agents SDK の中核パターン（Lab 1 で学習）
            response = agent(user_input)
            print(f"\nエージェント: {response}")

        except KeyboardInterrupt:
            break

    print("\n👋 終了します")


if __name__ == "__main__":
    main()

"""CLI エントリポイント。

学習ポイント:
    uv run python -m alert で起動する。
    collector / analyst / crosscut と同じ対話ループパターン。
    (ワークショップ外 / 発展: イベント駆動エージェント設計)

    気象データを入力すると、LLMが閾値ルールに基づいて
    異常を検知し、アラートJSONを生成する。

本番構成との違い:
    本番では EventBridge イベントをトリガーに自動起動される。
    このCLI対話は開発・テスト用。
"""
from __future__ import annotations

from alert.agent import create_alert_agent


def main() -> None:
    """対話ループを実行する。"""
    agent = create_alert_agent()
    print("🚨 異常検知エージェント起動（exitで終了）")
    print("=" * 50)

    while True:
        try:
            user_input = input("\nあなた: ").strip()
            if user_input.lower() in ("exit", "quit"):
                break
            if not user_input:
                continue

            # agent() を呼ぶだけでBedrock推論→アラート判断→回答生成が自動で行われる
            # ツール呼び出しが必要と判断されれば save_to_s3 でアラートを保存する
            response = agent(user_input)
            print(f"\nエージェント: {response}")

        except KeyboardInterrupt:
            break

    print("\n👋 終了します")


if __name__ == "__main__":
    main()

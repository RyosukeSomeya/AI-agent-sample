"""異常検知エージェント定義。

学習ポイント:
    閾値ベースのルールをシステムプロンプトで定義し、LLMが柔軟に判断する設計パターン。
    従来のルールベースシステムでは「if 気温変化 > 10」のようにハードコードするが、
    エージェント設計ではルールをプロンプトに記述し、LLMが文脈を踏まえて判断する。
    (ワークショップ外 / 発展: イベント駆動エージェント設計)

    ポイント:
    - 検知ルール（閾値）はシステムプロンプトに自然言語で記述
    - LLMがルールを解釈し、データに基づいて判断する
    - アラート出力は JSON 形式で構造化（後続の SNS 通知や S3 保存に連携しやすい）
    - ツールを持たない「判断特化型」エージェント — LLMの推論能力だけで動作する

本番構成との違い:
    本番では EventBridge イベントをトリガーに自動起動される
    「シグナル検知エージェント」に相当する。
    Step 7 以降で EventBridge 連携を追加する。
"""
from __future__ import annotations

from strands import Agent

from analyst.tools.save_to_s3 import save_to_s3

# システムプロンプト: 異常検知のルール（閾値ベース）を自然言語で定義
# 仕様書 §2.4 で定義されたプロンプトとアラートフォーマットに準拠
#
# 従来のルールベースシステムとの違い:
# - ハードコード: if temp_change > 10: alert("急激な気温変化")
# - エージェント: プロンプトにルールを書き、LLMが文脈を踏まえて柔軟に判断
# これにより、ルール追加・変更がコード変更なしで可能になる
SYSTEM_PROMPT = """\
あなたは気象異常を検知する監視エージェントです。
気象データを監視し、急激な変化や危険な状況を検知してアラートを生成します。

検知ルール:
- 24時間以内の気温変化が10°C以上 → 急激な気温変化アラート
- 風速が15m/s以上 → 強風アラート
- 降水量が50mm/h以上 → 大雨アラート
- 災害警報が発表中 → 災害アラート

アラートは重要度（critical / warning / info）を付与すること。

アラート出力は以下のJSON形式で生成すること:
{
  "alert_id": "alert-YYYYMMDD-NNN",
  "timestamp": "ISO 8601形式",
  "city": "都市名",
  "type": "temperature_change | strong_wind | heavy_rain | disaster",
  "severity": "critical | warning | info",
  "message": "人が読めるアラートメッセージ",
  "data": {
    "検知に使用した数値データ"
  }
}

利用可能なツール:
- save_to_s3: アラートJSONをS3に保存（キー: alerts/{date}/{alert-id}.json）
"""


def create_alert_agent() -> Agent:
    """異常検知エージェントを生成する。

    学習ポイント:
        このエージェントは save_to_s3 のみをツールとして持つ。
        異常検知の判断自体は LLM の推論で行い、結果を S3 に保存する。
        「ツールを最小限にし、LLM の推論能力を活用する」設計パターン。

        S3保存先は alerts/{date}/{alert-id}.json を想定
        （仕様書 §4.1 S3パスパターン参照）。
    """
    # save_to_s3 のみ — 判断はLLMの推論で行う設計
    # Step 7 以降で EventBridge 連携を追加する際もエージェント本体は変更不要
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[save_to_s3],
    )

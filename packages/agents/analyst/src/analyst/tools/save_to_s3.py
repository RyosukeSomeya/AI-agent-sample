"""S3保存ツール。

学習ポイント:
    自作ツールの例。@tool デコレータで定義するだけで
    Bedrockが「分析結果をS3に保存して」という指示を理解し、
    このツールを自動的に呼び出す。
    (Lab 1: ツール定義パターンの応用)

    collector の get_weather / get_disaster_info と同じ @tool パターン。
    違いは「外部APIを呼ぶ」のではなく「AWSサービス（S3）に書き込む」点。

本番構成との違い:
    本番では保存先を複数バケットに分けるが、
    サンプルでは1バケットにパスパターンで整理する。
"""
from __future__ import annotations

from strands import tool

from shared.s3 import put_object


@tool
def save_to_s3(content: str, s3_key: str, content_type: str = "application/json") -> str:
    """分析結果をS3に保存する。

    Args:
        content: 保存する内容（テキストまたはJSON文字列）
        s3_key: S3のキー（例: reports/2026-03-21/東京/report.html）
        content_type: MIMEタイプ（デフォルト: application/json）
    """
    # shared.s3.put_object() を呼ぶだけ — TASK-001 で作った共通ヘルパーを活用
    # ワークショップ Lab 1 で学んだ「ツールがAWSサービスと連携する」パターン
    uri = put_object(key=s3_key, body=content, content_type=content_type)
    return f"保存完了: {uri}"

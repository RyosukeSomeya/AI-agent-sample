"""災害情報取得ツール。

学習ポイント:
    2つ目のツール定義。get_weather と同じ @tool パターンで、
    別のAPIを呼び出すツールを追加する。
    Agent(tools=[get_weather, get_disaster_info]) のように
    リストで渡すだけで、LLMが状況に応じて使い分ける。
    (Lab 1: ツール定義パターンの応用)

本番構成との違い:
    本番では気象庁の防災情報XML（PULL型）やリアルタイムWebSocket通知を
    組み合わせるが、サンプルでは気象庁の警報・注意報 JSON API を使用。
    APIが利用不可の場合は「情報なし」として扱う。

仕様書の要件:
    - 入力: region（地域名、省略時は全国）
    - 出力: JSON形式の災害情報（警報種別、発表時刻、対象地域等）
    - 情報なし → "現在発表中の警報・注意報はありません" を返す
"""
from __future__ import annotations

import httpx
from strands import tool

from shared.models import DisasterAlert, DisasterInfo

# 気象庁 防災情報 JSON API
# 警報・注意報の一覧を取得するエンドポイント
# 参考: https://www.data.jma.go.jp/developer/xml/feed/
JMA_WARNING_URL = "https://www.jma.go.jp/bosai/warning/data/warning/areaWarning.json"


@tool
def get_disaster_info(region: str = "全国") -> str:
    """指定地域の災害警報・注意報を取得する。

    Args:
        region: 地域名（日本語。例: 東京、大阪。省略時は全国）
    """
    # --- 気象庁 API 呼び出し ---
    # ワークショップ Lab 1 で学んだ「ツールが外部APIを呼ぶ」パターン
    # get_weather と同じく、API呼び出し → パース → 構造化データ返却 の流れ
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.get(JMA_WARNING_URL)
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError:
        # API通信エラー時は「情報なし」として扱う
        # 仕様書: 情報なし → "現在発表中の警報・注意報はありません" を返す
        return _no_alert_message(region)

    # --- レスポンスのパース ---
    # 気象庁APIのレスポンスは地域コードベースの構造
    # サンプルでは簡易的にパースし、該当地域の警報を抽出する
    alerts = _parse_warnings(data, region)

    if not alerts:
        return _no_alert_message(region)

    # Pydantic モデルに変換してJSON文字列で返す
    # get_weather と同じパターン: 構造化データ → model_dump_json()
    disaster_info = DisasterInfo(
        region=region,
        alerts=alerts,
    )
    return disaster_info.model_dump_json(indent=2)


def _parse_warnings(data: dict, region: str) -> list[DisasterAlert]:
    """気象庁APIレスポンスから警報情報を抽出する。

    Args:
        data: 気象庁APIのJSONレスポンス
        region: フィルタする地域名（"全国" の場合はフィルタなし）

    Returns:
        DisasterAlert のリスト。該当なしの場合は空リスト。

    本番構成との違い:
        本番では気象庁XMLの詳細な地域コードマッピングを使用するが、
        サンプルでは簡易的なテキストマッチングで地域を絞り込む。
    """
    alerts: list[DisasterAlert] = []

    # 気象庁APIのレスポンス構造に合わせてパース
    # レスポンスが想定外の形式の場合は空リストを返す
    if not isinstance(data, dict):
        return alerts

    # 警報データの抽出を試行
    # APIの構造が変わる可能性があるため、KeyError を許容する
    try:
        for area_code, area_data in data.items():
            if not isinstance(area_data, dict):
                continue

            area_name = area_data.get("areaName", "")
            warnings = area_data.get("warnings", [])

            # 地域フィルタ: "全国" なら全件、それ以外は地域名で部分一致
            if region != "全国" and region not in area_name:
                continue

            for warning in warnings:
                if not isinstance(warning, dict):
                    continue
                status = warning.get("status", "")
                if status not in ("発表", "継続"):
                    continue

                alerts.append(
                    DisasterAlert(
                        type=warning.get("type", "不明"),
                        issued_at=warning.get("issuedAt", "不明"),
                        target_area=area_name,
                        severity=_classify_severity(warning.get("type", "")),
                    )
                )
    except (AttributeError, TypeError):
        # APIレスポンスが想定外の構造の場合は空リストを返す
        pass

    return alerts


def _classify_severity(warning_type: str) -> str:
    """警報種別から重要度を分類する。

    Args:
        warning_type: 警報の種別名

    Returns:
        "critical"（特別警報・警報）or "warning"（注意報）
    """
    # 「特別警報」「警報」を含む場合は critical、それ以外は warning
    if "特別警報" in warning_type or "警報" in warning_type:
        return "critical"
    return "warning"


def _no_alert_message(region: str) -> str:
    """警報なし時のメッセージを生成する。"""
    if region == "全国":
        return "現在発表中の警報・注意報はありません。"
    return f"{region}で現在発表中の警報・注意報はありません。"

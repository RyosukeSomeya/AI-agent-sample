"""天気データ取得ツール。

学習ポイント:
    @tool デコレータで関数をツール化する。
    引数の型ヒント（city: str, days: int）がそのままBedrockに渡される
    ツールパラメータスキーマになる。docstringがツールの説明文になる。
    (Lab 1: Code Interpreter で学んだツール定義パターン)

本番構成との違い:
    本番では S&P Global MCP Server を使用するが、
    サンプルではフリーの Open-Meteo API を使用している。
    Step 9 で AgentCore Gateway (MCP) を導入すると、
    このツールの実装を MCP プロトコルに置き換えられる。
"""
from __future__ import annotations

import httpx
from strands import tool

from shared.config import find_city
from shared.models import DailyWeather, WeatherData

# Open-Meteo API のベースURL（APIキー不要の無料気象API）
OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast"
# Geocoding API: 都市名 → 緯度経度の変換に使用
GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search"


@tool
def get_weather(city: str, days: int = 7, data_type: str = "forecast") -> str:
    """指定都市の天気データを取得する。

    Args:
        city: 都市名（日本語。例: 東京、大阪）
        days: 取得日数（1〜16、デフォルト7日間）
        data_type: "forecast"（予報）or "historical"（過去データ）
    """
    # --- 都市名 → 緯度経度の解決 ---
    # まず cities.yaml（都市マスタ）を検索し、なければ Geocoding API にフォールバック
    # ワークショップ Lab 1 で学んだ「ツールが外部APIを呼ぶ」パターン
    city_config = find_city(city)
    if city_config:
        lat, lon = city_config.latitude, city_config.longitude
    else:
        # cities.yaml にない都市は Geocoding API で検索
        coords = _geocode(city)
        if coords is None:
            return f"エラー: 都市名「{city}」が見つかりませんでした。正しい都市名を指定してください。"
        lat, lon = coords

    # --- Open-Meteo API 呼び出し ---
    # daily パラメータで取得する気象項目を指定
    # 仕様書の「温度は摂氏、風速はm/s」に合致（Open-Meteo のデフォルト単位）
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code",
        "timezone": "Asia/Tokyo",
        "forecast_days": min(days, 16),
    }

    # 仕様書: API通信エラー → リトライ1回、失敗時はエラーメッセージを返す
    response = _fetch_with_retry(OPEN_METEO_BASE, params)
    if response is None:
        return "エラー: 天気データの取得に失敗しました。しばらく待ってから再試行してください。"

    data = response.json()
    daily = data.get("daily", {})

    # レスポンスを Pydantic モデルに変換
    # 型安全にパースすることで、後続の分析エージェントとのデータ受け渡しが安定する
    weather_data = WeatherData(
        city=city,
        fetched_at=data.get("current_weather", {}).get("time", ""),
        daily=[
            DailyWeather(
                date=d,
                temperature_max=tmax,
                temperature_min=tmin,
                precipitation_sum=prec,
                wind_speed_max=wind,
                weather_code=wc,
            )
            for d, tmax, tmin, prec, wind, wc in zip(
                daily["time"],
                daily["temperature_2m_max"],
                daily["temperature_2m_min"],
                daily["precipitation_sum"],
                daily["wind_speed_10m_max"],
                daily["weather_code"],
            )
        ],
    )

    # model_dump_json() で JSON 文字列に変換して返す
    # エージェントはこの文字列を LLM に渡し、ユーザーへの回答を生成する
    return weather_data.model_dump_json(indent=2)


def _geocode(city: str) -> tuple[float, float] | None:
    """Geocoding APIで都市名を緯度経度に変換する。

    Args:
        city: 都市名（日本語可）

    Returns:
        (latitude, longitude) のタプル。見つからなければ None。
    """
    try:
        with httpx.Client(timeout=5.0) as client:
            response = client.get(
                GEOCODING_BASE,
                params={"name": city, "count": 1, "language": "ja"},
            )
            response.raise_for_status()
            results = response.json().get("results", [])
            if results:
                return results[0]["latitude"], results[0]["longitude"]
    except httpx.HTTPError:
        pass
    return None


def _fetch_with_retry(
    url: str, params: dict, max_retries: int = 1
) -> httpx.Response | None:
    """HTTP GETリクエストをリトライ付きで実行する。

    仕様書の要件:
        5秒タイムアウト、1回リトライ。失敗時は None を返す。

    Args:
        url: リクエスト先URL
        params: クエリパラメータ
        max_retries: 最大リトライ回数（デフォルト1回）

    Returns:
        成功時は httpx.Response、全リトライ失敗時は None。
    """
    for attempt in range(1 + max_retries):
        try:
            with httpx.Client(timeout=5.0) as client:
                response = client.get(url, params=params)
                response.raise_for_status()
                return response
        except httpx.HTTPError:
            if attempt == max_retries:
                return None
    return None

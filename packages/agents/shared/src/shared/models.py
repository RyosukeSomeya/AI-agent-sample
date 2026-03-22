"""共通データモデル。

学習ポイント:
    Pydanticモデルでデータの型を明示することで、
    エージェント間のデータ受け渡しやS3保存時の整合性を担保する。
    model_dump_json() でJSON文字列に変換、model_validate_json() でJSONからパースできる。

    エージェントのツール出力 → 別エージェントの入力 → S3保存
    というデータフローで、型が一貫していることが重要。
"""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class DailyWeather(BaseModel):
    """1日分の気象データ。Open-Meteo APIのレスポンスに対応する。"""

    date: date
    temperature_max: float
    temperature_min: float
    precipitation_sum: float
    wind_speed_max: float
    weather_code: int


class WeatherData(BaseModel):
    """都市の気象データ一式。収集エージェントの出力フォーマット。"""

    city: str
    fetched_at: str
    daily: list[DailyWeather]


class DisasterAlert(BaseModel):
    """個別の災害警報。"""

    type: str  # "大雨警報", "暴風警報" 等
    issued_at: str
    target_area: str
    severity: str  # "warning" or "critical"


class DisasterInfo(BaseModel):
    """災害情報。災害情報APIからのレスポンスに対応する。"""

    region: str
    alerts: list[DisasterAlert]


class AnalysisAlert(BaseModel):
    """異常検知エージェントが生成するアラート。

    学習ポイント:
        構造化されたアラート出力により、後続のSNS通知やS3保存に
        そのまま連携できる。本番構成のシグナル検知エージェントと同じパターン。
    """

    alert_id: str
    timestamp: str
    city: str
    type: str  # "temperature_change", "strong_wind", "heavy_rain", "disaster"
    severity: str  # "critical", "warning", "info"
    message: str
    data: dict

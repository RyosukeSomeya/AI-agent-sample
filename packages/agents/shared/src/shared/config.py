"""設定ファイル読み込みモジュール。

学習ポイント:
    cities.yaml を読み込み、都市情報を提供する。
    本番構成ではDBから取得するが、サンプルではYAMLファイルで管理。
    dataclass(frozen=True) で不変オブジェクトとして定義し、
    設定データが意図せず変更されることを防ぐ。
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class CityConfig:
    """都市設定。cities.yaml の各エントリに対応する。"""

    name: str
    name_en: str
    latitude: float
    longitude: float
    timezone: str


def load_cities() -> list[CityConfig]:
    """cities.yaml から都市一覧を読み込む。

    Returns:
        都市設定のリスト。
    """
    yaml_path = Path(__file__).parent / "cities.yaml"
    with open(yaml_path) as f:
        data = yaml.safe_load(f)
    return [CityConfig(**city) for city in data["cities"]]


def find_city(name: str) -> CityConfig | None:
    """都市名（日本語）で検索する。

    Args:
        name: 都市名（例: "東京"）

    Returns:
        見つかった場合は CityConfig、見つからなければ None。
    """
    cities = load_cities()
    return next((c for c in cities if c.name == name), None)

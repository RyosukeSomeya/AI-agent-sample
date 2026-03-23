"""データ取得Lambda。

学習ポイント:
    EventBridge Scheduler が定時起動 → この Lambda を実行する。
    Lambda は外部APIからデータを取得し、S3に保存し、EventBridgeにイベントを発行する。
    エージェントのツール (get_weather) のロジックを再利用する。
    （Lab 1 で学んだツール定義を、Lab 7 のイベント駆動パイプラインで活用するパターン）

本番構成との違い:
    本番ではデータ取得元が S&P Global MCP Server だが、
    サンプルでは Open-Meteo API を使用する（get_weather ツール経由）。
    本番では取得エラー時に DLQ（Dead Letter Queue）に退避するが、
    サンプルではエラーログ出力のみ。

ワークショップ対応:
    Step 7 — EventBridge + Lambda によるイベント駆動パイプラインの構築
"""
from __future__ import annotations

import json
import logging
from datetime import date

import boto3

from shared.config import load_cities
from shared.s3 import put_object
from collector.tools.weather import get_weather

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def handler(event: dict, context: object) -> dict:
    """データ取得Lambdaのハンドラ。

    学習ポイント:
        Lambda のハンドラは (event, context) の2引数を受け取る。
        event: EventBridge Scheduler から渡されるイベント（今回は空でOK）
        context: Lambda 実行環境の情報（残り実行時間、メモリサイズ等）

    処理フロー:
        1. cities.yaml から都市一覧を取得
        2. 各都市の天気データを get_weather ツールで取得
        3. S3 にデータを保存
        4. EventBridge に WeatherDataFetched イベントを発行

    Args:
        event: EventBridge Scheduler からのイベント
        context: Lambda 実行コンテキスト

    Returns:
        処理結果（statusCode と取得都市数）
    """
    cities = load_cities()
    today = date.today().isoformat()
    s3_keys: list[str] = []

    for city in cities:
        # データ取得（エージェントツールのロジックを再利用）
        # 学習ポイント: get_weather は @tool デコレータ付きの関数。
        # Lambda から呼ぶときは .fn() でデコレータを外した素の関数を呼ぶ。
        # これにより、エージェント経由でもLambda経由でも同じロジックを使える。
        weather_json = get_weather.fn(city=city.name, days=7)

        # エラーチェック: get_weather がエラー文字列を返した場合はスキップ
        if weather_json.startswith("エラー"):
            logger.warning("都市 %s のデータ取得に失敗: %s", city.name, weather_json)
            continue

        # S3 に保存
        # 学習ポイント: S3 キーの設計 — data/weather/{都市名}/{日付}.json
        # 仕様書 4.1 のバケット構成に対応する
        key = f"data/weather/{city.name}/{today}.json"
        put_object(key=key, body=weather_json)
        s3_keys.append(key)
        logger.info("都市 %s のデータを S3 に保存: %s", city.name, key)

    # EventBridge にイベント発行
    # 学習ポイント: put_events() でカスタムイベントを発行する。
    # Source（発行元）と DetailType（イベント種別）の組み合わせで
    # EventBridge Rule がイベントをフィルタリングし、Step Functions にルーティングする。
    events_client = boto3.client("events")
    events_client.put_events(
        Entries=[
            {
                "Source": "weather-agent.ingest",
                "DetailType": "WeatherDataFetched",
                "Detail": json.dumps(
                    {
                        "cities": [c.name for c in cities],
                        "date": today,
                        "s3_keys": s3_keys,
                    }
                ),
            }
        ]
    )
    logger.info(
        "WeatherDataFetched イベントを発行: %d 都市, %d ファイル",
        len(cities),
        len(s3_keys),
    )

    return {"statusCode": 200, "cities": len(cities)}

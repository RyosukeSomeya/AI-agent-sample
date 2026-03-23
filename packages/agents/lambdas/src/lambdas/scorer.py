"""異常気象スコアリングLambda。

学習ポイント:
    Bedrock API を直接呼び出してスコアリングを行う。
    エージェント（対話型）ではなく、Lambda（バッチ型）でのBedrock活用パターン。
    スコアが閾値を超えた場合にイベントを発行し、異常気象監視WFをトリガーする。

    エージェントは「対話しながら考える」のが得意だが、
    スコアリングのように「決まった基準で判定する」タスクは
    Lambda + Bedrock API 直接呼び出しのほうがシンプルで高速。

本番構成との違い:
    本番ではスコアリングモデルを Fine-tuning した専用モデルを使うが、
    サンプルでは汎用の Claude モデルにプロンプトで指示する。
    本番ではスコア閾値をパラメータストアから取得するが、
    サンプルでは定数（0.7）を使用する。

ワークショップ対応:
    Step 7 — Lambda でのBedrock API直接呼び出しパターン
"""
from __future__ import annotations

import json
import logging
import os

import boto3

from shared.s3 import get_object

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# 異常気象と判定するスコアの閾値
# 学習ポイント: 本番ではパラメータストアや環境変数から取得するが、
# サンプルでは定数として定義する
ANOMALY_THRESHOLD = 0.7

# Bedrock モデルID
# 学習ポイント: Lambda から Bedrock を直接呼ぶ場合は InvokeModel API を使う。
# エージェント（Strands SDK）経由ではなく、boto3 で直接 API を叩く。
MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-20250514-v1:0")

# スコアリング用プロンプト
# 学習ポイント: バッチ型のLLM活用では、プロンプトで出力フォーマットを厳密に指定する。
# エージェントのような自由な対話ではなく、構造化されたJSON出力を期待する。
SCORING_PROMPT = """\
あなたは気象異常検知の専門家です。以下の気象データを分析し、異常気象スコアを算出してください。

判定基準:
- 24時間以内の気温変化が10°C以上 → 高スコア
- 風速が15m/s以上 → 高スコア
- 降水量が50mm/h以上 → 高スコア
- 複数の基準に該当する場合はスコアを加算

以下のJSON形式で回答してください。他のテキストは含めないでください:
{
  "anomaly_score": 0.0〜1.0の数値,
  "anomaly_type": "temperature_change" | "strong_wind" | "heavy_rain" | "multiple" | "none",
  "reason": "判定理由（日本語）",
  "data": { "関連する数値データ" }
}

気象データ:
"""


def handler(event: dict, context: object) -> dict:
    """異常気象スコアリングLambdaのハンドラ。

    学習ポイント:
        EventBridge Scheduler から定時呼び出しされる。
        S3 から最新の気象データを取得し、Bedrock API でスコアリングする。
        スコアが閾値（0.7）を超えた都市があれば、WeatherAnomalyDetected イベントを発行する。

    処理フロー:
        1. S3 から最新の気象データを取得
        2. 各都市のデータを Bedrock API に渡してスコアリング
        3. スコア > 0.7 の都市について EventBridge にイベントを発行

    Args:
        event: EventBridge Scheduler からのイベント
        context: Lambda 実行コンテキスト

    Returns:
        処理結果（statusCode とスコアリング結果）
    """
    # S3 から最新の気象データキーを取得
    # 学習ポイント: ingest Lambda が保存したデータを scorer Lambda が読む。
    # Lambda 間の直接通信ではなく、S3 を介したデータ共有パターン。
    s3_client = boto3.client("s3")
    bucket_name = os.environ.get("WEATHER_AGENT_BUCKET", "weather-agent-dev")

    # 最新の気象データファイルを一覧取得
    # data/weather/{city}/ 配下の最新ファイルを探す
    response = s3_client.list_objects_v2(
        Bucket=bucket_name,
        Prefix="data/weather/",
        MaxKeys=100,
    )

    if "Contents" not in response:
        logger.info("S3 にデータが見つかりません")
        return {"statusCode": 200, "scored": 0, "anomalies": 0}

    # 都市ごとに最新のファイルをグループ化
    # 学習ポイント: S3 のキー設計が data/weather/{city}/{date}.json なので、
    # キーをパースして都市名と日付を取得する
    city_files: dict[str, str] = {}
    for obj in response["Contents"]:
        key = obj["Key"]
        parts = key.split("/")
        # data/weather/{city}/{date}.json の形式を期待
        if len(parts) == 4 and parts[3].endswith(".json"):
            city_name = parts[2]
            # 同じ都市のファイルが複数あれば、最新（辞書順で最後）を採用
            if city_name not in city_files or key > city_files[city_name]:
                city_files[city_name] = key

    anomaly_count = 0
    events_client = boto3.client("events")

    for city_name, s3_key in city_files.items():
        # S3 からデータ取得
        weather_data = get_object(key=s3_key).decode("utf-8")

        # Bedrock API でスコアリング
        # 学習ポイント: InvokeModel API を直接呼ぶ。
        # エージェント（Strands SDK の Agent クラス）経由ではなく、
        # boto3 で Bedrock Runtime API を直接叩くバッチ型パターン。
        score_result = _score_weather_data(city_name, weather_data)

        if score_result is None:
            logger.warning("都市 %s のスコアリングに失敗", city_name)
            continue

        logger.info(
            "都市 %s: スコア %.2f, タイプ %s",
            city_name,
            score_result["anomaly_score"],
            score_result["anomaly_type"],
        )

        # スコアが閾値を超えた場合、WeatherAnomalyDetected イベントを発行
        # 学習ポイント: このイベントが EventBridge Rule にマッチすると、
        # Step Functions の異常気象監視WF がトリガーされる（TASK-012, TASK-013 で構築）
        if score_result["anomaly_score"] > ANOMALY_THRESHOLD:
            anomaly_count += 1
            events_client.put_events(
                Entries=[
                    {
                        "Source": "weather-agent.scorer",
                        "DetailType": "WeatherAnomalyDetected",
                        "Detail": json.dumps(
                            {
                                "city": city_name,
                                "anomaly_score": score_result["anomaly_score"],
                                "anomaly_type": score_result["anomaly_type"],
                                "data": score_result.get("data", {}),
                            }
                        ),
                    }
                ]
            )
            logger.info(
                "WeatherAnomalyDetected イベントを発行: %s (スコア: %.2f)",
                city_name,
                score_result["anomaly_score"],
            )

    return {
        "statusCode": 200,
        "scored": len(city_files),
        "anomalies": anomaly_count,
    }


def _score_weather_data(city: str, weather_json: str) -> dict | None:
    """Bedrock API を呼び出して異常気象スコアを算出する。

    学習ポイント:
        boto3 の bedrock-runtime クライアントで InvokeModel API を呼ぶ。
        リクエスト/レスポンスは JSON 文字列でやり取りする。
        Messages API 形式（role: user / assistant）でプロンプトを送信する。

    Args:
        city: 都市名
        weather_json: 気象データ（JSON文字列）

    Returns:
        スコアリング結果の辞書。失敗時は None。
    """
    bedrock = boto3.client("bedrock-runtime")

    prompt = f"{SCORING_PROMPT}\n都市: {city}\n{weather_json}"

    try:
        # Bedrock InvokeModel API 呼び出し
        # 学習ポイント: Messages API 形式でリクエストを送信する。
        # エージェントの場合は Strands SDK が内部でこの API を呼んでいるが、
        # Lambda では直接 boto3 で呼ぶ。
        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(
                {
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 1024,
                    "messages": [
                        {
                            "role": "user",
                            "content": prompt,
                        }
                    ],
                }
            ),
        )

        # レスポンスをパース
        response_body = json.loads(response["body"].read())
        content_text = response_body["content"][0]["text"]

        # JSON 部分を抽出（LLM が余計なテキストを付けることがあるため）
        # 学習ポイント: LLM のレスポンスは常に期待通りとは限らない。
        # JSON パースに失敗した場合のフォールバックを用意する。
        score_result = _extract_json(content_text)
        if score_result is None:
            logger.warning("スコアリング結果の JSON パースに失敗: %s", content_text[:200])
            return None

        # スコアを 0.0〜1.0 の範囲にクランプ
        score_result["anomaly_score"] = max(
            0.0, min(1.0, float(score_result.get("anomaly_score", 0)))
        )
        return score_result

    except Exception:
        logger.exception("Bedrock API 呼び出しに失敗 (都市: %s)", city)
        return None


def _extract_json(text: str) -> dict | None:
    """テキストから JSON オブジェクトを抽出する。

    学習ポイント:
        LLM は「以下がスコアリング結果です:」のようなテキストを JSON の前後に
        付けることがある。{...} の部分だけを抽出してパースする。

    Args:
        text: LLM のレスポンステキスト

    Returns:
        パースされた辞書。失敗時は None。
    """
    # まず全体を JSON としてパースしてみる
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # { ... } の部分を抽出してパース
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and start < end:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    return None

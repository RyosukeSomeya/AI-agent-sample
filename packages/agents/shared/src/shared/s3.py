"""S3操作ヘルパー。

学習ポイント:
    boto3 の S3 クライアントをラップし、エージェントのツールから簡単に使えるようにする。
    バケット名は環境変数 WEATHER_AGENT_BUCKET から取得する。
    CDKでS3バケットをデプロイした後、環境変数にバケット名を設定する（Step 2 / TASK-007）。

本番構成との違い:
    本番では複数バケット（文書保管用・レポート用・ベクトルストア用）を使い分けるが、
    サンプルでは1バケットにパスパターンで整理する。
"""
from __future__ import annotations

import os

import boto3


def get_bucket_name() -> str:
    """S3バケット名を環境変数から取得する。

    Returns:
        バケット名。未設定の場合はデフォルト値 "weather-agent-dev"。
    """
    return os.environ.get("WEATHER_AGENT_BUCKET", "weather-agent-dev")


def put_object(
    key: str,
    body: str | bytes,
    content_type: str = "application/json",
) -> str:
    """S3にオブジェクトを保存し、S3 URIを返す。

    Args:
        key: S3のキー（例: "data/weather/東京/2026-03-21.json"）
        body: 保存する内容
        content_type: MIMEタイプ

    Returns:
        保存先のS3 URI（例: "s3://weather-agent-dev/data/weather/東京/2026-03-21.json"）
    """
    bucket = get_bucket_name()
    s3 = boto3.client("s3")
    s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
    return f"s3://{bucket}/{key}"


def get_object(key: str) -> bytes:
    """S3からオブジェクトを取得する。

    Args:
        key: S3のキー

    Returns:
        オブジェクトの内容（バイト列）
    """
    bucket = get_bucket_name()
    s3 = boto3.client("s3")
    response = s3.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()

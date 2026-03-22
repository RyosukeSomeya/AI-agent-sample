"""AgentCore Runtime エントリポイント（Step 4）。

学習ポイント:
    カスタム Dockerfile + FastAPI で AgentCore Runtime にデプロイする。
    AgentCore Runtime が要求する2つのエンドポイント:
    - POST /invocations: エージェント呼び出し
    - GET /ping: ヘルスチェック
    既存の agent.py は一切変更しない（Lab 2 対応）。

本番構成との違い:
    本番でも同じパターン。FastAPI でエンドポイントを定義し、
    uvicorn で 8080 ポートにサーブする。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request

# 学習ポイント:
# FastAPI アプリをモジュールレベルで作成する。
# Strands SDK のインポートは初回リクエスト時に遅延実行する。
# 理由: コンテナ起動時の /ping ヘルスチェックに素早く応答するため。
app = FastAPI(title="Collector Agent - AgentCore Runtime")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_agent = None


@app.get("/ping")
async def ping() -> dict:
    """ヘルスチェックエンドポイント（AgentCore Runtime 必須）。

    学習ポイント:
        Runtime はこのエンドポイントでコンテナの生存を確認する。
        200 を返すだけでOK。
    """
    return {"status": "healthy"}


@app.post("/invocations")
async def invoke_agent(request: Request) -> dict:
    """エージェント呼び出しエンドポイント（AgentCore Runtime 必須）。

    学習ポイント:
        AgentCore Runtime からのリクエスト形式が不明確なため、
        生の Request を受け取り、柔軟にパースする。
        初回リクエスト時にエージェントを生成する（コールドスタート）。
    """
    global _agent

    # リクエストボディを生で受け取ってログ出力（デバッグ用）
    raw_body = await request.body()
    logger.info("Received request body: %s", raw_body.decode("utf-8", errors="replace"))

    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        body = {"prompt": raw_body.decode("utf-8", errors="replace")}

    # prompt を様々な形式から取得
    prompt = ""
    if isinstance(body, dict):
        prompt = (
            body.get("prompt", "")
            or (body.get("input", {}) or {}).get("prompt", "")
            or body.get("input", "")
        )
    if isinstance(prompt, dict):
        prompt = prompt.get("prompt", str(prompt))
    if not prompt:
        prompt = str(body)

    logger.info("Extracted prompt: %s", prompt)

    if _agent is None:
        # 重い依存（strands, httpx, boto3 等）はここで初めてインポートされる
        from collector.agent import create_collector_agent

        _agent = create_collector_agent()

    try:
        result = _agent(prompt)
        return {
            "output": {
                "message": result.message,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        }
    except Exception as e:
        logger.exception("Agent processing failed")
        raise HTTPException(
            status_code=500,
            detail=f"Agent processing failed: {e}",
        )

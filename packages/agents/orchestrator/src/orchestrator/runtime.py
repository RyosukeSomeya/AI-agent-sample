"""AgentCore Runtime エントリポイント（Step 4）。

学習ポイント:
    FastAPI で /invocations と /ping を公開する。
    Strands SDK は初回リクエスト時に遅延読み込みする。
    (Lab 2 対応)
"""
from __future__ import annotations

import json
import logging

from fastapi import FastAPI, Request

app = FastAPI(title="Orchestrator - AgentCore Runtime")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_agent = None


@app.get("/ping")
async def ping() -> dict:
    return {"status": "healthy"}


@app.post("/invocations")
async def invoke_agent(request: Request) -> dict:
    global _agent

    raw_body = await request.body()
    logger.info("Request: %s", raw_body.decode("utf-8", errors="replace"))

    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        body = {"prompt": raw_body.decode("utf-8", errors="replace")}

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

    if _agent is None:
        from orchestrator.agent import create_orchestrator
        _agent = create_orchestrator()

    try:
        result = _agent(prompt)
        message = result.message
        if not isinstance(message, str):
            message = json.dumps(message, ensure_ascii=False, default=str)
        return {"output": {"message": message}}
    except Exception as e:
        logger.exception("Agent failed")
        return {"output": {"error": str(e)}}

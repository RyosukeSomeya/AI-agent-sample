FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

COPY shared/pyproject.toml ./shared/
COPY collector/pyproject.toml ./collector/
COPY analyst/pyproject.toml ./analyst/
COPY crosscut/pyproject.toml ./crosscut/
COPY alert/pyproject.toml ./alert/
COPY orchestrator/pyproject.toml ./orchestrator/

COPY shared/src/ ./shared/src/
COPY collector/src/ ./collector/src/
COPY analyst/src/ ./analyst/src/
COPY crosscut/src/ ./crosscut/src/
COPY alert/src/ ./alert/src/
COPY orchestrator/src/ ./orchestrator/src/

RUN uv pip install --system --no-cache ./shared ./collector ./analyst ./crosscut ./alert ./orchestrator
RUN uv pip install --system --no-cache fastapi uvicorn

EXPOSE 8080
CMD ["uvicorn", "orchestrator.runtime:app", "--host", "0.0.0.0", "--port", "8080"]

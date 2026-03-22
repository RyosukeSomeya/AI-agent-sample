# Strands Agents: Code Interpreter のインポート方法

## 問題

設計書に記載されていた `from strands.tools.agentcore import code_interpreter` はモジュールが存在せず動作しない。

## 正しいインポート方法

```python
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

# インスタンスを生成
_code_interpreter_provider = AgentCoreCodeInterpreter()

# .code_interpreter 属性がツール関数（DecoratedFunctionTool）
Agent(tools=[_code_interpreter_provider.code_interpreter, ...])
```

## 必要な依存パッケージ

```toml
dependencies = [
    "strands-agents>=0.1",
    "strands-agents-tools>=0.1",
    "bedrock-agentcore>=1.4",   # ← これが必要（strands-agents-tools の依存に含まれない場合がある）
]
```

## パッケージ構造メモ

- `strands` — Strands Agents SDK 本体（`Agent`, `@tool`）
- `strands_tools` — ツール集（code_interpreter, a2a_client 等）。PyPI名は `strands-agents-tools`
- `bedrock_agentcore` — AgentCore SDK（Code Interpreter のバックエンド）。PyPI名は `bedrock-agentcore`

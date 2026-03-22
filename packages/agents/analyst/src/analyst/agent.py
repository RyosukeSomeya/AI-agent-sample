"""分析エージェント定義。

学習ポイント:
    Code Interpreter は strands_tools パッケージの AgentCoreCodeInterpreter を使う。
    インスタンスを生成し、.code_interpreter 属性をツールとしてエージェントに渡す。
    LLMがPythonコードを動的に生成して、AgentCoreのサンドボックス環境で実行する。
    サンドボックス内では pandas / NumPy / matplotlib が利用可能。
    (Lab 1: Code Interpreter 対応)

    ポイント:
    - AgentCoreCodeInterpreter はサンドボックス環境を管理するクラス
    - .code_interpreter 属性が @tool デコレータ付きのツール関数
    - save_to_s3 は自作ツール（@tool デコレータで定義）
    - SDK提供ツールと自作ツールを同じ tools リストに渡せる

本番構成との違い:
    本番では財務データの分析だが、分析パターン（時系列・比較）は同じ。
"""
from __future__ import annotations

from strands import Agent

# Code Interpreter は strands-agents-tools パッケージで提供される
# AgentCoreCodeInterpreter をインスタンス化し、.code_interpreter をツールとして渡す
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

from analyst.tools.save_to_s3 import save_to_s3

# システムプロンプト: 分析エージェントの役割・ルールを定義
# collector と同じパターンだが、「分析」に特化した指示を与えている
SYSTEM_PROMPT = """\
あなたは気象データ分析の専門家です。
天気データを受け取り、統計分析・可視化・レポート生成を行います。

利用可能なツール:
- code_interpreter: Pythonコードを実行して分析・グラフ生成
- save_to_s3: 分析結果をS3に保存

分析のルール:
- データ分析にはpandas、NumPyを使用すること
- グラフ生成にはmatplotlibを使用すること
- 分析結果は必ず「要約」「詳細」「グラフ」の3部構成にすること
- グラフの日本語表示にはjapanize-matplotlibを使用すること
"""

# AgentCore Code Interpreter のインスタンスを生成
# サンドボックス環境の管理（セッション作成・破棄等）を担当する
_code_interpreter_provider = AgentCoreCodeInterpreter()


def create_analyst_agent() -> Agent:
    """分析エージェントを生成する。

    学習ポイント:
        _code_interpreter_provider.code_interpreter（SDK提供ツール）と
        save_to_s3（自作ツール）を同じ tools リストに渡す。
        Agent は区別なく扱う。
    """
    # SDK提供ツールと自作ツールを同列で渡せる — Strands Agents の柔軟性
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[_code_interpreter_provider.code_interpreter, save_to_s3],
    )

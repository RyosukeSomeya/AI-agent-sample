"""横断分析エージェント定義。

学習ポイント:
    マルチエージェント構成における「専門エージェント」の設計パターン。
    収集エージェントや分析エージェントと同じ Agent + tools の構成だが、
    「複数都市のデータを受け取り比較分析する」という専門性を持つ。
    オーケストレータ（TASK-006）からA2A連携で呼び出される。
    (ワークショップ外 / 発展: マルチエージェント設計)

    ポイント:
    - analyst と同じく Code Interpreter + save_to_s3 をツールに持つ
    - システムプロンプトで「横断比較」という専門性を定義
    - エージェントの専門性はプロンプトで決まる — コードの構造は他と同じ
    - 1つのエージェントに何でもやらせるのではなく、役割で分離するのがマルチエージェントの設計思想

本番構成との違い:
    本番では AgentCore Runtime にデプロイし、A2A プロトコルで通信する。
    ローカルではオーケストレータが直接 Agent インスタンスをツールとして呼び出す。
"""
from __future__ import annotations

from strands import Agent

# analyst と同じツール構成 — Code Interpreter + S3保存
# 横断分析もデータ分析・グラフ生成が必要なため同じツールセットを使う
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

from analyst.tools.save_to_s3 import save_to_s3

# システムプロンプト: 横断分析に特化した指示
# 仕様書 §2.3 で定義されたプロンプトに準拠
SYSTEM_PROMPT = """\
あなたは複数都市の気象データを横断的に比較分析する専門家です。
各都市の分析結果を受け取り、都市間の比較・相関分析・トレンド比較を行います。

利用可能なツール:
- code_interpreter: 横断分析のPythonコード実行
- save_to_s3: 横断分析レポートの保存

分析のルール:
- 最低2都市以上のデータを比較すること
- 都市間の差異を明確に示すこと
- 共通トレンドと個別傾向を分離して報告すること
"""

# AgentCore Code Interpreter のインスタンスを生成
# analyst と同じパターン — サンドボックス環境で pandas / matplotlib が利用可能
_code_interpreter_provider = AgentCoreCodeInterpreter()


def create_crosscut_agent() -> Agent:
    """横断分析エージェントを生成する。

    学習ポイント:
        analyst と同じツール構成（Code Interpreter + save_to_s3）だが、
        システムプロンプトで「横断比較」という専門性を与えている。
        エージェントの役割はコードではなくプロンプトで決まる。

        S3保存先は reports/{date}/crosscut/report.html を想定
        （仕様書 §4.1 S3パスパターン参照）。
    """
    # SDK提供ツール（code_interpreter）と自作ツール（save_to_s3）を同列で渡す
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[_code_interpreter_provider.code_interpreter, save_to_s3],
    )

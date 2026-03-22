"""オーケストレータ エージェント定義。

学習ポイント:
    Agent をツールとして別の Agent に渡す = A2A連携の基本パターン。
    オーケストレータは各専門エージェントを「ツール」として認識し、
    ユーザーの指示に応じて適切なエージェントを呼び分ける。
    (ワークショップ外 / 発展: マルチエージェント設計)

    これが本番構成の「ハイブリッドマルチエージェント」の
    内側（AgentCore A2A / LLM動的判断）に相当する。

    ポイント:
    - 各専門エージェント（Agent インスタンス）を tools リストに渡す
    - Strands Agents は Agent を自動的にツールとして扱う
    - オーケストレータのLLMが「どのエージェントに何を頼むか」を動的に判断
    - 人間のチームリーダーが部下に仕事を振るのと同じ構造

本番構成との違い:
    本番では外側を Step Functions（決定的制御）、
    内側を AgentCore A2A（LLM動的判断）で構成する
    「ハイブリッドマルチエージェント方式」。
    ローカルではオーケストレータ Agent が内側の動的判断を担当する。
    外側の Step Functions は Step 8（TASK-013）で実装する。
"""
from __future__ import annotations

from strands import Agent

from collector.agent import create_collector_agent
from analyst.agent import create_analyst_agent
from crosscut.agent import create_crosscut_agent
from alert.agent import create_alert_agent

# システムプロンプト: オーケストレータの役割と作業手順を定義
# 仕様書 §2.3 の A2A 通信仕様に準拠した作業フローを指示
SYSTEM_PROMPT = """\
あなたは気象データ分析チームのリーダーです。
ユーザーの指示に応じて、適切な専門エージェントに仕事を振り分けます。

利用可能なエージェント:
- collector: 天気データ・災害情報を取得する
- analyst: データを分析しレポートを生成する
- crosscut: 複数都市のデータを横断比較する
- alert: 異常気象を検知しアラートを生成する

作業の進め方:
1. まず collector でデータを取得する
2. analyst で個別都市の分析を行う
3. 複数都市の場合は crosscut で横断分析する
4. 異常が検出された場合は alert でアラートを生成する
"""


def create_orchestrator() -> Agent:
    """オーケストレータを生成する。

    学習ポイント:
        各エージェントのファクトリ関数（create_xxx_agent）で
        Agent インスタンスを生成し、そのまま tools リストに渡す。
        Strands Agents は Agent インスタンスをツールとして自動認識し、
        オーケストレータの LLM が必要に応じて呼び出す。

        これが A2A（Agent-to-Agent）連携の実装パターン。
        「エージェントをツールとして渡す」だけで実現できるシンプルさが
        Strands Agents の設計の特徴。
    """
    # 各エージェントをツールとしてオーケストレータに渡す
    # Agent インスタンスがそのままツールになる — Strands Agents の A2A パターン
    collector = create_collector_agent()
    analyst = create_analyst_agent()
    crosscut = create_crosscut_agent()
    alert_agent = create_alert_agent()

    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[collector, analyst, crosscut, alert_agent],
    )

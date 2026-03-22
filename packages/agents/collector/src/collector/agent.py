"""収集エージェント定義。

学習ポイント:
    Agent クラスの初期化パターン。
    system_prompt でエージェントの役割を定義し、
    tools で利用可能なツールのリストを渡す。
    Bedrock (Claude) が推論し、必要なツールを自動選択して実行する。
    (Lab 1 対応)

    ポイント:
    - system_prompt はエージェントの「人格」を定義する自然言語テキスト
    - tools にはリストで複数のツール関数を渡せる
    - Agent は渡されたツールの docstring と型ヒントから
      Bedrock に送る JSON Schema を自動生成する

本番構成との違い:
    本番では AgentCore Runtime にデプロイし、HTTPS API で呼び出す。
    ローカル実行時と同じ Agent コードがそのままクラウドで動く
    （Lab 2 で学習）。
"""
from __future__ import annotations

from strands import Agent

from collector.tools.disaster import get_disaster_info
from collector.tools.weather import get_weather

# システムプロンプト: エージェントの役割・ルールを自然言語で定義
# Lab 1 で学んだ「プロンプトエンジニアリング」の実践
# ツール一覧を明示することで、LLM がツール選択の精度を高める
SYSTEM_PROMPT = """\
あなたは気象データ収集の専門家です。
ユーザーの指示に基づいて、天気データや災害情報を取得し、わかりやすく整理して報告します。

利用可能なツール:
- get_weather: 指定都市の天気予報・過去データを取得
- get_disaster_info: 災害警報・注意報を取得

回答のルール:
- データは必ずツールを使って取得すること（推測しない）
- 取得したデータは表形式で見やすく整理すること
- 温度は摂氏、風速はm/sで表示すること
"""


def create_collector_agent() -> Agent:
    """収集エージェントを生成する。

    学習ポイント:
        Agent() に system_prompt と tools を渡すだけでエージェントが完成する。
        tools リストに渡した関数の @tool デコレータ情報から、
        Bedrock が理解できるツールスキーマが自動生成される。
    """
    # Agent(tools=[...]) にリストで渡す — Lab 1 で学んだ基本パターン
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[get_weather, get_disaster_info],
    )

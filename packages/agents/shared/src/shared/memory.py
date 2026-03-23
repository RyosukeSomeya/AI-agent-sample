"""AgentCore Memory 共通設定。

学習ポイント:
    AgentCore Memory は STM（短期記憶）と LTM（長期記憶）を提供する（Lab 3 対応）。

    STM: 会話の内容をセッション内で保持する（ブラウザの sessionStorage に近い）。
    LTM: Memory Strategy により短期記憶が自動的に長期記憶に変換される。
         セマンティック検索（意味で探す検索）で過去の記憶を取得できる。

    Memory Strategy は3種類:
    - semanticMemoryStrategy: 事実情報を抽出・保存（天気分析結果の記憶に使用）
    - summaryMemoryStrategy: セッションを自動要約（会話の要約に使用）
    - userPreferenceMemoryStrategy: ユーザーの好みを学習（分析スタイルの好みに使用）

    このモジュールは Memory リソースの作成と SessionManager の生成を共通化する。
    analyst / crosscut から同じ設定で Memory を利用するための共通基盤。

本番構成との違い:
    本番では Memory ID を環境変数や Parameter Store から取得するが、
    サンプルでは create_memory_and_wait() で動的に作成する。
    本番では namespace を環境ごとに分離するが、サンプルでは単一設定。
"""
from __future__ import annotations

from bedrock_agentcore.memory import MemoryClient
from bedrock_agentcore.memory.integrations.strands.config import (
    AgentCoreMemoryConfig,
    RetrievalConfig,
)
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)

# Memory リソース名: 全エージェントで共有する Memory インスタンス
MEMORY_NAME = "WeatherAnalysisMemory"
MEMORY_DESCRIPTION = "天気データ分析エージェント用 Memory（STM + LTM）"

# Memory Strategy 定義（Lab 3 対応）
# 短期記憶→長期記憶への自動変換ルールを3つ定義する
# 学習ポイント: Strategy ごとに namespace が分かれる。
# namespace のテンプレート変数 {actorId} / {sessionId} は
# AgentCoreMemoryConfig で渡す actor_id / session_id に自動置換される。
MEMORY_STRATEGIES: list[dict] = [
    {
        # 事実抽出 Strategy
        # 天気データ分析の結果（「東京の先週の平均気温は25度」等）を
        # 自動的に長期記憶に保存する。
        # 学習ポイント: semanticMemoryStrategy は会話から「事実」を抽出して保存する。
        # 「先週の分析と比較して」と聞かれたとき、ここから過去の事実を検索する。
        "semanticMemoryStrategy": {
            "name": "WeatherFactExtractor",
            "namespaces": ["/facts/{actorId}/"],
        }
    },
    {
        # セッション要約 Strategy
        # 各分析セッション（1回の会話）の内容を自動要約して保存する。
        # 学習ポイント: summaryMemoryStrategy は会話全体を要約してくれる。
        # 「昨日はどんな分析をしたっけ？」に答えるための記憶。
        "summaryMemoryStrategy": {
            "name": "AnalysisSessionSummarizer",
            "namespaces": ["/summaries/{actorId}/{sessionId}/"],
        }
    },
    {
        # ユーザー好み学習 Strategy
        # ユーザーの分析スタイルの好み（「棒グラフが好き」「週次で見たい」等）を
        # 自動的に学習して保存する。
        # 学習ポイント: userPreferenceMemoryStrategy はユーザーの好みを検出して保存する。
        # 次回の分析で好みに合わせた出力を自動的に行うための記憶。
        "userPreferenceMemoryStrategy": {
            "name": "AnalysisPreferenceLearner",
            "namespaces": ["/preferences/{actorId}/"],
        }
    },
]

# 検索設定: 各 namespace からの検索パラメータ
# 学習ポイント: top_k は「最大何件取得するか」、relevance_score は「どれくらい関連度が高ければヒットとみなすか」。
# 事実情報は幅広く取得し（低い閾値）、好みは確信度の高いものだけ取得する（高い閾値）。
RETRIEVAL_CONFIG: dict[str, RetrievalConfig] = {
    "/facts/{actorId}/": RetrievalConfig(
        top_k=10,             # 事実情報は多めに取得（過去の分析結果をなるべく網羅する）
        relevance_score=0.3,  # 閾値は低めで幅広くヒットさせる
    ),
    "/summaries/{actorId}/{sessionId}/": RetrievalConfig(
        top_k=5,              # セッション要約は直近5件
        relevance_score=0.5,  # 中程度の関連度
    ),
    "/preferences/{actorId}/": RetrievalConfig(
        top_k=5,              # 好みは5件で十分
        relevance_score=0.7,  # 確信度の高いものだけ取得
    ),
}


def create_memory(region_name: str = "us-east-1") -> str:
    """Memory リソースを作成し、Memory ID を返す。

    学習ポイント:
        create_memory_and_wait() は Memory リソースの作成完了を待つ同期メソッド。
        strategies パラメータで Memory Strategy を定義する。
        一度作成すれば、以降は返された memory_id を使い回す。

        本番では Memory ID を環境変数や Parameter Store に保存して再利用するが、
        サンプルでは毎回作成する（既存のものがあればそれを使うロジックは省略）。

    Args:
        region_name: AWS リージョン名。

    Returns:
        作成された Memory の ID。
    """
    client = MemoryClient(region_name=region_name)
    memory = client.create_memory_and_wait(
        name=MEMORY_NAME,
        description=MEMORY_DESCRIPTION,
        strategies=MEMORY_STRATEGIES,
    )
    return memory["id"]


def create_session_manager(
    memory_id: str,
    session_id: str,
    actor_id: str,
    region_name: str = "us-east-1",
) -> AgentCoreMemorySessionManager:
    """AgentCoreMemorySessionManager を生成する。

    学習ポイント:
        SessionManager は Agent の session_manager パラメータに渡すオブジェクト。
        これを渡すことで、STM（会話の保存）と LTM（Strategy による自動変換・検索）の
        両方が有効になる。

        session_id: 1回の会話を識別する ID。同じ ID なら同じ会話が続く。
        actor_id: ユーザーを識別する ID。同じユーザーの記憶を横断検索するのに使う。

    Args:
        memory_id: create_memory() で取得した Memory ID。
        session_id: セッション ID（会話ごとに一意）。
        actor_id: ユーザー/アクター ID（ユーザーごとに一意）。
        region_name: AWS リージョン名。

    Returns:
        AgentCoreMemorySessionManager インスタンス。
    """
    config = AgentCoreMemoryConfig(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=actor_id,
        retrieval_config=RETRIEVAL_CONFIG,
    )
    return AgentCoreMemorySessionManager(
        agentcore_memory_config=config,
        region_name=region_name,
    )

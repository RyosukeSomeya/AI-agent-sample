"""横断分析エージェント定義。

学習ポイント:
    マルチエージェント構成における「専門エージェント」の設計パターン。
    収集エージェントや分析エージェントと同じ Agent + tools の構成だが、
    「複数都市のデータを受け取り比較分析する」という専門性を持つ。
    オーケストレータ（TASK-006）からA2A連携で呼び出される。
    (ワークショップ外 / 発展: マルチエージェント設計)

    Memory 連携（Lab 3 対応）:
    - analyst と同じ Memory リソース（memory_id）を共有する
    - 同じ Memory Strategy が適用されるため、analyst の分析結果（事実・要約）を
      crosscut がセマンティック検索で横断参照できる
    - 「先週の横断比較と今週を比較して」のようなクエリに対応

    ポイント:
    - analyst と同じく Code Interpreter + save_to_s3 をツールに持つ
    - システムプロンプトで「横断比較」という専門性を定義
    - エージェントの専門性はプロンプトで決まる — コードの構造は他と同じ
    - 1つのエージェントに何でもやらせるのではなく、役割で分離するのがマルチエージェントの設計思想

本番構成との違い:
    本番では AgentCore Runtime にデプロイし、A2A プロトコルで通信する。
    ローカルではオーケストレータが直接 Agent インスタンスをツールとして呼び出す。
    本番では Memory ID を環境変数から取得するが、サンプルでは引数で渡す。
"""
from __future__ import annotations

from strands import Agent

# analyst と同じツール構成 — Code Interpreter + S3保存
# 横断分析もデータ分析・グラフ生成が必要なため同じツールセットを使う
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

# AgentCore Memory: shared パッケージの共通設定を使う（Lab 3 対応）
# analyst と同じ Memory リソースを共有し、記憶を横断参照する
from shared.memory import create_session_manager

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


def create_crosscut_agent(
    memory_id: str,
    session_id: str,
    actor_id: str,
) -> Agent:
    """横断分析エージェントを生成する。

    学習ポイント:
        analyst と同じツール構成（Code Interpreter + save_to_s3）だが、
        システムプロンプトで「横断比較」という専門性を与えている。
        エージェントの役割はコードではなくプロンプトで決まる。

        session_manager で Memory を有効化（Lab 3 対応）。
        analyst と同じ memory_id を渡すため、analyst が保存した
        「東京の先週の平均気温は25度」のような事実情報を
        セマンティック検索で横断参照できる。

        S3保存先は reports/{date}/crosscut/report.html を想定
        （仕様書 §4.1 S3パスパターン参照）。

    Args:
        memory_id: AgentCore Memory の ID（analyst と同じものを渡す）。
        session_id: セッション ID（会話ごとに一意）。
        actor_id: ユーザー ID（ユーザーごとに一意）。
    """
    # Memory SessionManager を生成（shared/memory.py の共通設定を使用）
    # analyst と同じ memory_id を渡す — 記憶の横断参照が可能
    # 例: analyst が保存した「東京の先週の分析」を crosscut が検索して比較に使う
    session_manager = create_session_manager(
        memory_id=memory_id,
        session_id=session_id,
        actor_id=actor_id,
    )

    # SDK提供ツール（code_interpreter）と自作ツール（save_to_s3）を同列で渡す
    # session_manager で Memory を有効化 — analyst と記憶を共有する
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[_code_interpreter_provider.code_interpreter, save_to_s3],
        session_manager=session_manager,  # Lab 3: analyst と同じ Memory を共有
    )

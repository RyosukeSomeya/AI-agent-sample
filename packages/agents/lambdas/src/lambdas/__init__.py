"""Lambda関数群パッケージ。

学習ポイント:
    Lambda関数はエージェント（対話型）とは別の実行モデル（バッチ型）。
    EventBridge Scheduler → Lambda → EventBridge → Step Functions の
    イベント駆動パイプラインで使用する（Step 7、本番構成の「取得・イベント層」に相当）。

    エージェントのツールロジック（get_weather）をLambdaから再利用することで、
    対話型（エージェント経由）とバッチ型（Lambda経由）の両方でデータ取得が可能になる。
"""

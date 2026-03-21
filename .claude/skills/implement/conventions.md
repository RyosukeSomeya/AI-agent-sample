# 実装規約

## 言語・スタイル

- Python 3.12+
- 型ヒント必須（`from __future__ import annotations` 使用）
- PEP 8 準拠
- docstring: Google スタイル

## コーディング規約

<!-- TODO: プロジェクト固有のルールを追記 -->

### 命名規則

- 変数・関数: snake_case
- クラス: PascalCase
- 定数: UPPER_SNAKE_CASE
- プライベート: _prefix

### インポート

- 標準ライブラリ → サードパーティ → ローカル の順
- 各グループ間は空行で区切る

### エラーハンドリング

- 裸の `except` は禁止
- 具体的な例外クラスを指定する

## テスト

<!-- TODO: テストフレームワーク確定後に記入（pytest 等） -->

## 学習用解説（実装時の必須事項）

本プロジェクトは学習用サンプルのため、実装時に以下の解説を含めること。

### docstring

各モジュール・クラス・関数の docstring に以下を含める:

```python
"""天気データを取得するツール。

学習ポイント:
    - Strands Agents のツール定義方法（@tool デコレータ）
    - Open-Meteo API のパラメータ設計
    - AgentCore ワークショップ Lab 1 に対応

本番構成との違い:
    - 本番では S&P Global MCP Server を使用するが、
      サンプルではフリーの Open-Meteo API を使用している
"""
```

### コメント

重要な設計判断や AgentCore 固有の処理には、理由を補足するコメントを入れる:

```python
# AgentCore Runtime は microVM で隔離されるため、
# セッション間でメモリは共有されない（Lab 2 で学習）
```

### ステップ単位の README

各パッケージ（collector / analyst / crosscut / alert）に README.md を作成し、以下を含める:

- このエージェントの役割と学習テーマ
- 対応する AgentCore ワークショップ Lab
- 動作確認手順
- 本番構成との差分

## その他

<!-- TODO: プロジェクト固有の規約を追記 -->

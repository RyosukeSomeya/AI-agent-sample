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

## その他

<!-- TODO: プロジェクト固有の規約を追記 -->

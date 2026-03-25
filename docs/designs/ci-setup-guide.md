# GitHub Actions CI セットアップガイド

## このドキュメントで学ぶこと

- ゼロからプロジェクトを立ち上げるための前提条件と初期化手順
- GitHub Actions を導入する前に必要なローカル開発ツールの準備
- AIエージェント開発におけるテスト戦略（テストピラミッド）
- 必要最低限のCIワークフロー構成

## ワークショップ対応

- Lab 1〜2 で実装したモデル・ツールのテスト方法
- Lab 全体を通じた品質管理の仕組み

---

## Step 0: ローカルマシンの準備（前提条件）

まっさらな状態からプロジェクトを始める場合、まずローカルマシンに開発ツールをインストールする。

### 必須ツール

| ツール | 用途 | インストール方法 |
|-------|------|----------------|
| **Git** | バージョン管理 | OS標準 or `brew install git` |
| **Python 3.12+** | エージェント開発 | https://python.org/ or `brew install python` |
| **uv** | Python パッケージ管理（pip/venv の代替。高速） | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Node.js (LTS)** | CDK 実行に必要 | https://nodejs.org/ or `brew install node` |
| **AWS CDK CLI** | インフラのコード化・デプロイ | `npm install -g aws-cdk` |

### あると便利（任意）

| ツール | 用途 |
|-------|------|
| **AWS CLI** | AWS認証・リソースの動作確認 |
| **Docker** | CDK の一部アセットビルドで必要な場合がある |
| **VS Code** | エディタ（devcontainer 対応） |

### インストール確認コマンド

```bash
git --version        # 2.x 以上
python3 --version    # 3.12 以上
uv --version         # インストール済みか確認
node --version       # LTS バージョン
cdk --version        # 2.x 以上
```

### プロジェクト初期化（空のリポジトリから始める場合）

自分で細かくディレクトリを掘る必要はない。`uv init` や `cdk init` が雛形を自動生成してくれる。手で作るのは親ディレクトリだけ。

```bash
# 1. リポジトリ作成
mkdir my-project && cd my-project
git init

# 2. モノレポの親ディレクトリだけ作る
mkdir -p packages/agents packages/infra .github/workflows

# 3. Python 側の初期化（uv が pyproject.toml 等を生成）
cd packages/agents
uv init --name my-agent
# → pyproject.toml, .venv/ などが生成される

# 4. CDK 側の初期化（cdk が TypeScript プロジェクトを生成）
cd ../infra
npx cdk init app --language typescript
# → package.json, tsconfig.json, bin/, lib/ などが生成される

# 5. CIワークフローファイルを作成
touch ../../.github/workflows/ci.yml
```

**なぜこの手順か：** 各ツールの `init` コマンドは、そのツールが期待する構成（ファイル配置・設定の初期値）を正しく作ってくれる。手動で作ると設定漏れや構成ミスの原因になるため、ツールに任せるのが安全。

---

## 準備の全体像（3ステップ）

```
Step 1: ローカル開発ツールの設定  ← まずここ（CIの前提条件）
Step 2: テストの雛形を作る        ← CIで回すものがないと意味がない
Step 3: GitHub Actions を追加     ← 上2つが揃って初めて効果を発揮
```

**なぜこの順番か：** CI は「ローカルで動くチェックをクラウドで自動実行する」だけなので、まずローカルで動く状態を作るのが先。逆にすると「CIは作ったけど何もチェックしてない」という形骸化したパイプラインになる。

---

## Step 1: ローカル開発ツールの設定

### Python側（ruff + mypy + pytest）

`packages/agents/pyproject.toml` に追記する内容：

```toml
# --- 開発用依存関係 ---
[dependency-groups]
dev = [
    "ruff>=0.8.0",
    "mypy>=1.13.0",
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",   # strands-agentsはasyncを多用
    "boto3-stubs[s3]>=1.35.0",  # boto3の型スタブ（mypyで必要）
]

# --- ruff（フォーマッター + リンター一体型） ---
[tool.ruff]
target-version = "py312"
line-length = 120               # デフォルト88は狭すぎるので少し広げる

[tool.ruff.lint]
select = [
    "E",    # pycodestyle エラー（基本的なスタイル違反）
    "F",    # pyflakes（未使用import、未定義変数など）
    "I",    # isort（import文の並び順）
    "UP",   # pyupgrade（古いPython記法の自動更新）
]

# --- mypy（型チェック） ---
[tool.mypy]
python_version = "3.12"
warn_return_any = true
warn_unused_configs = true
ignore_missing_imports = true   # strands-agents等に型スタブがないため

# --- pytest ---
[tool.pytest.ini_options]
testpaths = ["tests"]
markers = [
    "integration: LLM呼び出しを伴う統合テスト（CIではスキップ）",
]
asyncio_mode = "auto"
```

### なぜ ruff か

flake8 + isort + black + pyupgrade を1ツールに統合したもの。設定ファイルが1つで済み、実行も高速（Rust製）。新規プロジェクトではデファクトスタンダード。

### CDK側（TypeScript）

`packages/infra/package.json` に `typecheck` スクリプトを追加するだけで十分。ESLint/Prettier はCDKコードの規模が小さいので現時点では不要。

```json
"scripts": {
  "build": "tsc",
  "typecheck": "tsc --noEmit",
  "watch": "tsc -w",
  "cdk": "cdk"
}
```

---

## Step 2: テストの雛形を作る

### ディレクトリ構成

```
packages/agents/
  tests/
    conftest.py              # 共通フィクスチャ
    shared/
      test_config.py         # 設定値のテスト
      test_models.py         # Pydanticモデルのテスト
    collector/
      test_weather_tool.py   # 天気取得ツールのテスト
    analyst/
      test_save_to_s3.py     # S3保存ツールのテスト
```

### AIエージェント開発のテストピラミッド

AIエージェントのテストは通常のアプリとは異なり、**LLMの応答が非決定的**（毎回違う答えが返る）という特殊性がある。そのため以下の層に分けて考える。

```
        △  E2E（統合テスト）
       ／＼   エージェント全体の動作確認
      ／────＼  → LLM実呼び出し、コスト高、CIでは原則スキップ
     ／────────＼
    ／ ツールテスト ＼  個々のツール関数の入出力テスト
   ／──────────────＼  → LLM不要、モック可能、CI向き
  ／ ユニットテスト    ＼  設定・モデル・ユーティリティ
 ／──────────────────────＼ → 純粋関数、最速、最安定
```

### 各レイヤーの具体例

| レイヤー | テスト対象 | LLM必要？ | CI実行？ |
|---------|-----------|----------|---------|
| **ユニット** | `shared/config.py`, `shared/models.py` | No | Yes |
| **ツール** | `collector/tools/weather.py`, `analyst/tools/save_to_s3.py` | No | Yes |
| **統合** | `collector/agent.py` の応答品質 | Yes | No（ローカルのみ） |

**ポイント：**

- **CIではLLMを呼ばない** — コスト・速度・非決定性の問題があるため
- **ツール関数を厚くテストする** — エージェントの「手足」であり、ここが壊れるとエージェント全体が壊れる
- **統合テストはローカルで `pytest -m integration`** のようにマーカーで分離する

### なぜこの戦略が良いのか

通常のWebアプリなら「APIを叩いて期待するJSONが返るか」をテストできるが、AIエージェントは「天気を調べて」と言ったときの応答が毎回微妙に違う。そのため：

- **決定的な部分（ツール・設定）を徹底テスト** → 壊れたらすぐ分かる
- **非決定的な部分（LLM応答）はCIから外す** → CIが不安定にならない
- **本当にエージェントの品質を測りたいとき**は、別途「評価（Eval）パイプライン」を作る（上級編）

### テストのサンプルコード

```python
# tests/shared/test_models.py
"""Pydanticモデルの基本テスト。
ワークショップ Lab 1 で定義したデータモデルが正しくバリデーションされることを確認。
"""
from shared.models import WeatherData

def test_weather_data_valid():
    """正常なデータでモデルが生成できること。"""
    data = WeatherData(city="東京", temperature=25.0, humidity=60)
    assert data.city == "東京"

def test_weather_data_invalid_temperature():
    """不正な値でバリデーションエラーになること。"""
    import pytest
    with pytest.raises(ValueError):
        WeatherData(city="東京", temperature="暑い", humidity=60)
```

```python
# tests/collector/test_weather_tool.py
"""天気取得ツールのテスト。
ワークショップ Lab 2 で実装したカスタムツールが、
外部APIの応答を正しくパースできることを確認。
"""
from unittest.mock import patch, AsyncMock

@patch("collector.tools.weather.httpx.AsyncClient.get")
async def test_fetch_weather_returns_parsed_data(mock_get):
    """外部APIのレスポンスを正しくパースできること。"""
    mock_get.return_value = AsyncMock(
        json=lambda: {"temperature": 25.0, "city": "Tokyo"},
        status_code=200,
    )
    from collector.tools.weather import fetch_weather
    result = await fetch_weather("Tokyo")
    assert result["temperature"] == 25.0
```

---

## Step 3: GitHub Actions ワークフロー

### トリガー設計

| イベント | ブランチ | 用途 |
|---------|---------|------|
| `push` to `dev` | feature → dev マージ | 開発中の品質チェック |
| `push` to `main` | dev → main マージ | リリース前の最終チェック |

### パスフィルター（CI対象外）

```yaml
paths-ignore:
  - '**/*.md'
  - '.claude/**'
  - 'docs/**'
  - 'prompt.md'
```

### ワークフローファイル

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [dev, main]
    paths-ignore:
      - '**/*.md'
      - '.claude/**'
      - 'docs/**'
      - 'prompt.md'

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true    # 同じブランチの古いCIをキャンセル（コスト節約）

jobs:
  # ── Python ──
  python-check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/agents
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
        with:
          version: "latest"
      - run: uv sync --frozen --group dev

      - name: Format check (ruff format)
        run: uv run ruff format --check .

      - name: Lint (ruff check)
        run: uv run ruff check .

      - name: Type check (mypy)
        run: uv run mypy shared/src collector/src analyst/src

      - name: Test (pytest)
        run: uv run pytest -m "not integration" --tb=short

  # ── CDK (TypeScript) ──
  cdk-check:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/infra
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
          cache-dependency-path: packages/infra/package-lock.json
      - run: npm ci
      - name: Type check (tsc)
        run: npx tsc --noEmit
```

### 設計判断の補足

| 判断 | 理由 |
|------|------|
| ジョブは2つだけ（python / cdk） | 必要最低限。ジョブを分けすぎるとランナー起動のオーバーヘッドが増える |
| `concurrency` で古いCIキャンセル | push連打時に無駄なCIが溜まるのを防止 |
| `uv sync --frozen` | ロックファイルと一致しない依存はエラーにする（CI向き） |
| `--tb=short` | テスト失敗時のトレースバックを短くして読みやすく |
| `paths-ignore` で md/.claude 除外 | ドキュメント変更だけでCIが走るのは無駄 |

---

## 本番構成との違い

| 項目 | この学習用構成 | 本番構成 |
|------|--------------|---------|
| テスト | ユニット + ツールテストのみ | + Eval パイプライン（LLM応答品質の定量評価） |
| セキュリティ | なし | Trivy/Snyk で脆弱性スキャン |
| デプロイ | なし | main マージで CDK deploy を自動実行 |
| 環境分離 | なし | dev/staging/prod の multi-account 構成 |
| キャッシュ | uv/npm の標準キャッシュ | S3 や Artifactory でレイヤーキャッシュ |

---

## 作業チェックリスト（実施順）

```
□ 1. pyproject.toml に dev依存 + ruff/mypy/pytest 設定を追加
□ 2. uv sync --group dev で開発ツールをインストール
□ 3. uv run ruff format . で既存コードを一括フォーマット
□ 4. uv run ruff check --fix . でリント修正
□ 5. tests/ ディレクトリ + conftest.py + テスト1〜2個を作成
□ 6. uv run pytest でローカル実行確認
□ 7. packages/infra/package.json に typecheck スクリプト追加
□ 8. .github/workflows/ci.yml を作成
□ 9. dev ブランチを作成してpush → CIが動くことを確認
```

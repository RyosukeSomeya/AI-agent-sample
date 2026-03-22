# TASK-004 解説: 分析エージェント（Code Interpreter + S3保存）

## 1. このタスクで何を作ったか

**「データを受け取って、グラフを描いたり統計を出したりできる"分析担当"を作った。さらに分析結果をクラウドのストレージに保存する機能もつけた。」**

TASK-002〜003で作った収集エージェントは「データを取ってくる」係。今回の分析エージェントは「取ってきたデータを分析する」係。2人は別のエージェントで、それぞれ得意分野が違う。TASK-006で「指揮者（オーケストレータ）」が登場して、この2人を連携させる。

---

## 2. 作成・変更したファイル一覧

### (a) `packages/agents/analyst/pyproject.toml` — パッケージの設計図

| 項目 | 内容 |
|---|---|
| これは何か | 依存関係の宣言書。TSでいう **`package.json`**、Laravelでいう **`composer.json`** |
| なぜ必要か | Code Interpreter を使うために追加パッケージが必要 |
| 関連技術 | 素のPython（uv パッケージマネージャー） |

```toml
dependencies = [
    "strands-agents>=0.1",          # ← Strands Agents SDK（@tool, Agent）
    "strands-agents-tools>=0.1",    # ← ツール集（code_interpreter等）。TSでいう @strands/tools のようなもの
    "bedrock-agentcore>=1.4",       # ← AgentCore SDK（Code Interpreterのバックエンド）
    "shared",                       # ← TASK-001 で作った共通ライブラリ
]
```

**collector との違い:** collector は `httpx`（HTTP通信）が必要だったが、analyst は `strands-agents-tools` + `bedrock-agentcore`（Code Interpreter）が必要。使う道具が違えば、必要な材料も違う。

### (b) `packages/agents/analyst/src/analyst/tools/save_to_s3.py` — 自作ツール（S3保存）

| 項目 | 内容 |
|---|---|
| これは何か | 分析結果をAWSのS3（クラウドのファイル置き場）に保存する「道具」 |
| なぜ必要か | 分析結果を手元だけに持っていても、後で使えない。S3に保存すれば他のエージェントやダッシュボードからアクセスできる |
| 関連技術 | **Strands Agents SDK**（`@tool`）、**AWS**（S3, boto3） |

collector の `get_weather` と同じ `@tool` パターン。ただし今回は「外部APIからデータを取る」のではなく「AWSにデータを保存する」方向。

```python
from strands import tool        # ← Strands Agents SDK
from shared.s3 import put_object  # ← TASK-001 で作った共通ヘルパー

@tool
def save_to_s3(content: str, s3_key: str, content_type: str = "application/json") -> str:
    """分析結果をS3に保存する。"""
    uri = put_object(key=s3_key, body=content, content_type=content_type)
    return f"保存完了: {uri}"
```

**Laravelでいうと `Storage::disk('s3')->put($path, $content)` と同じ。** `shared.s3.put_object()` はTASK-001で作ったヘルパーで、中身は `boto3.client("s3").put_object(...)` を呼んでいるだけ。

```python
# shared/s3.py の中身（TASK-001 で作成済み）
import boto3   # ← TSなら import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
               #    Laravelなら use Illuminate\Support\Facades\Storage

s3 = boto3.client("s3")
s3.put_object(Bucket=bucket, Key=key, Body=body)  # ← Storage::disk('s3')->put($key, $body)
```

### (c) `packages/agents/analyst/src/analyst/agent.py` — 分析担当（エージェント本体）

| 項目 | 内容 |
|---|---|
| これは何か | 2つのツール（Code Interpreter + S3保存）を持つ分析エージェントの組み立て書 |
| なぜ必要か | 「分析して」と言われたらPythonコードを書いて実行し、「保存して」と言われたらS3に保存する |
| 関連技術 | **Strands Agents SDK**（`Agent`）、**AgentCore**（Code Interpreter） |

#### collector との構造比較

```
collector（TASK-003）              analyst（今回）
┌─────────────────────┐        ┌────────────────────────────┐
│ Agent(                │        │ Agent(                      │
│   tools=[             │        │   tools=[                   │
│     get_weather,      │ 自作   │     code_interpreter, ← SDK提供│
│     get_disaster_info │ 自作   │     save_to_s3        ← 自作  │
│   ]                   │        │   ]                         │
│ )                     │        │ )                           │
└─────────────────────┘        └────────────────────────────┘
```

**新しいポイント:** collector はツールが全部自作（`@tool`）だったが、analyst では **SDK提供の組み込みツール（Code Interpreter）と自作ツール（save_to_s3）を混ぜて使っている**。Agent はどちらも同じように扱う。

#### Code Interpreter のセットアップ

```python
from strands_tools.code_interpreter import AgentCoreCodeInterpreter

# ① Code Interpreter の管理者を作る（サンドボックス環境を管理する）
_code_interpreter_provider = AgentCoreCodeInterpreter()

# ② .code_interpreter 属性がツール関数（@tool 付き）
# Agent にはこれを渡す
tools=[_code_interpreter_provider.code_interpreter, save_to_s3]
```

**なぜ2ステップか？** `AgentCoreCodeInterpreter` はサンドボックス環境のライフサイクル（作成・破棄）を管理するクラス。その中の `.code_interpreter` が、実際にLLMが呼び出す「道具」。管理者（プロバイダー）と道具（ツール）を分離している設計。

### (d) `packages/agents/analyst/src/analyst/__main__.py` — 注文窓口（CLI対話）

| 項目 | 内容 |
|---|---|
| これは何か | `uv run python -m analyst` で起動する対話ループ。TASK-003の collector と全く同じパターン |
| なぜ必要か | 分析エージェントに直接話しかけてテストするため |
| 関連技術 | 素のPython |

collector と同じなので詳細は省略。唯一の違いは `create_collector_agent()` の代わりに `create_analyst_agent()` を使うこと。

### (e) `packages/agents/analyst/README.md` — 取扱説明書

学習ガイド。ツール一覧・動作確認手順・本番構成との差分を記載。

### (f) `packages/agents/pyproject.toml` — ワークスペースルート更新

```toml
[tool.uv.workspace]
members = [
    "shared",
    "collector",   # Step 1 (TASK-002)
    "analyst",     # Step 2 (TASK-004) ← 今回追加
]
```

TSでいうルートの `package.json` に `"workspaces": ["shared", "collector", "analyst"]` を追加したのと同じ。

---

## 3. ファイル間の関係図

```
packages/agents/analyst/
│
├── __main__.py ─────────── 注文窓口（CLI対話ループ）
│     │                     「uv run python -m analyst」で起動
│     │
│     └─→ agent.py ──────── 分析担当（エージェント定義）
│           │
│           ├─→ AgentCoreCodeInterpreter ──── 道具①: Pythonコード実行（SDK提供）
│           │     └─→ AgentCore サンドボックス（pandas / matplotlib が使える）
│           │
│           └─→ tools/save_to_s3.py ───────── 道具②: S3保存（自作）
│                 └─→ shared.s3.put_object() ← TASK-001 で作った共通ヘルパー
│                       └─→ boto3 → AWS S3
│
└── README.md ────────── 取扱説明書
```

**データの流れ:**

```
ユーザー: "この天気データの週間トレンドを分析して"
  → __main__.py: agent(user_input)
    → Bedrock: 「code_interpreter を使ってPythonコードを書け」
    → Code Interpreter: pandasでデータ集計、matplotlibでグラフ生成
    → Bedrock: 「分析結果を整理して回答を作れ」
  ← "要約: ... / 詳細: ... / グラフ: ..."

ユーザー: "この結果をS3に保存して"
  → __main__.py: agent(user_input)
    → Bedrock: 「save_to_s3 を使え」
    → save_to_s3: shared.s3.put_object() → AWS S3
  ← "保存完了: s3://weather-agent-dev/reports/..."
```

---

## 4. 今回登場した技術・用語の解説

### Code Interpreter（AgentCore）

- **それは何か:** LLMが「Pythonコードを書いて実行する」ことができるツール。人間のプログラマーのように、データを受け取ってpandasで集計し、matplotlibでグラフを描くことができる
- **仕組み:** LLMがPythonコードを**文字列として生成**し、AgentCoreの**サンドボックス環境**（隔離された実行環境）で実行する。結果（テキスト・画像）が返ってくる
- **なぜサンドボックスか:** 安全のため。LLMが生成したコードが暴走しても、本体のシステムには影響しない。ブラウザのiframeに似た考え方
- **TSでの対応:** 直接の対応はないが、イメージとしては「LLMがJavaScriptを書いて `eval()` する」に近い（ただし安全なサンドボックス内）

### S3（Simple Storage Service）

- **それは何か:** AWSのクラウドストレージ。ファイルをインターネット上に保存できる場所
- **TSでの対応:** `@aws-sdk/client-s3` の `PutObjectCommand`
- **Laravelでの対応:** `Storage::disk('s3')->put()`
- **なぜ使うか:** 分析結果を他のエージェントやダッシュボードからアクセスできるようにするため。ローカルファイルだと自分しか使えない

### boto3

- **それは何か:** Python の AWS SDK。S3やBedrockなどAWSのサービスをPythonから操作するためのライブラリ
- **TSでの対応:** `@aws-sdk/client-s3`, `@aws-sdk/client-bedrock` 等
- **Laravelでの対応:** AWS SDK for PHP（Laravelでは `Storage` ファサードが薄くラップしている）

### strands-agents-tools（パッケージ）

- **それは何か:** Strands Agents SDK のツール集。Code Interpreter のほか、ブラウザ操作、画像生成なども含まれる
- **注意点:** PyPIのパッケージ名は `strands-agents-tools` だが、Pythonでのインポート名は `strands_tools`（ハイフンがアンダースコアに変わる）。TSの `@strands/tools` と `import strandTools from '@strands/tools'` の関係に似ている

### 環境変数 `WEATHER_AGENT_BUCKET`

- **それは何か:** S3のバケット名を外部から設定するための環境変数
- **なぜ環境変数か:** 開発用バケットと本番用バケットを切り替えるため。コードに直書きすると環境ごとに書き換えが必要になる
- **TSでの対応:** `process.env.WEATHER_AGENT_BUCKET`
- **Laravelでの対応:** `.env` ファイルの `AWS_BUCKET` + `config('filesystems.disks.s3.bucket')`

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップとの対応

| 今回やったこと | ワークショップの Lab |
|---|---|
| Code Interpreter をツールとしてエージェントに渡す | **Lab 1** — Code Interpreter の利用 |
| 自作ツール `save_to_s3` と組み合わせる | **Lab 1** — 複数ツールの混在パターン |
| S3にデータを保存する | **Lab 1** — AWSサービス連携の基礎 |

### 本番構成との対応

| 今回のサンプル | 本番構成 |
|---|---|
| 気象データの分析 | S&P Global 財務データの分析 |
| pandas / matplotlib | 同じ（Code Interpreter 共通） |
| S3に1バケット保存 | S3に複数バケット（文書・レポート・ベクトルストア） |
| ローカルCLI | AgentCore Runtime（microVM） |

**本番との最大の違い:** 分析対象のデータが違うだけで、**Code Interpreter + S3保存というパイプラインのパターンは完全に同じ**。pandas/matplotlibの使い方もCode Interpreterのサンドボックス内で共通。

---

## 6. 次のタスクへのつながり

### TASK-005（横断分析・異常検知エージェント）

今回の分析エージェントは「1都市のデータを分析する」係。TASK-005では「複数都市のデータを横断的に比較する」エージェントと「異常を検知する」エージェントが登場する。

```
TASK-003          TASK-004（今回）      TASK-005（次）
┌──────────┐    ┌──────────────┐    ┌───────────────┐
│ 収集      │    │ 分析          │    │ 横断分析       │
│ エージェント│ →→ │ エージェント    │ →→ │ 異常検知       │
│ (天気/災害)│データ│ (統計/グラフ)  │分析 │ エージェント    │
└──────────┘    └──────────────┘結果 └───────────────┘
```

### TASK-006（オーケストレータ）

最終的に、これらのエージェントを**まとめて指揮する「オーケストレータ」**が作られる。「東京と大阪の天気を比較して」と言えば、収集→分析→横断分析が自動で連携する。

```
            オーケストレータ（TASK-006）
            ┌─────────────┐
            │  指揮者       │
            └──┬──┬──┬──┬─┘
               │  │  │  │
  ┌────────┐ ┌─┴──┐ ┌┴──┐ ┌┴───┐
  │収集     │ │分析 │ │横断│ │異常 │
  │TASK-003 │ │★今回│ │分析│ │検知 │
  └────────┘ └────┘ └───┘ └────┘
```

### 実装中に発見した知見

Code Interpreter のインポート方法が設計書の想定と異なっていた。正しい方法を `docs/knowledge/strands-code-interpreter-import.md` に記録済み：

```python
# ❌ 設計書の記載（実際には存在しないパス）
from strands.tools.agentcore import code_interpreter

# ✅ 実際の正しいインポート
from strands_tools.code_interpreter import AgentCoreCodeInterpreter
_provider = AgentCoreCodeInterpreter()
tools=[_provider.code_interpreter]  # .code_interpreter 属性がツール関数
```

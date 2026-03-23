# TASK-011 解説: Lambda関数（データ取得 + スコアリング）

## 1. このタスクで何を作ったか

**「毎朝自動で天気を調べて、ヤバい天気があれば報告する」仕組みの中身を作った。** 具体的には、決まった時間に天気データを集めてくるプログラム（ingest）と、集めたデータに異常がないかAIがチェックするプログラム（scorer）の2つ。

日常の例えでいうと、これまでは「人がお店に来て『天気を教えて』と聞く」対話型だったのを、「お店の方から毎朝自動で天気を確認し、異常があれば店長に報告する」自動巡回型に進化させたようなものです。

**今回の一番の学びポイント:** LLM（大規模言語モデル）には2つの使い方がある。
- **対話型（エージェント）** — 人と会話しながら考える（これまでの TASK-001〜006）
- **バッチ型（Lambda）** — 決まった処理を無人で自動実行する（今回の TASK-011）

この2つを使い分けるのが本番構成の基本パターン。

---

## 2. 作成・変更したファイル一覧

### 2.1 `packages/agents/lambdas/pyproject.toml` — Lambda パッケージの「名刺」（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | lambdas パッケージの依存関係と設定を定義するファイル |
| なぜ必要か | uv（パッケージマネージャー）がこのパッケージを認識するために必要 |
| 中身の要点 | shared と collector に依存、boto3 を使用 |
| 関連技術 | 素の Python（uv ワークスペース） |

TSでいう **`package.json`**、Laravelでいう **`composer.json`** と同じ。

```toml
[project]
name = "lambdas"
dependencies = [
    "shared",      # 共通ライブラリ（都市設定、S3ヘルパー）
    "collector",   # get_weather ツールを再利用するため
    "boto3>=1.34", # AWS SDK（EventBridge, Bedrock, S3）
    # ↑ TSなら "@aws-sdk/client-eventbridge" 等
    #   Laravelなら "aws/aws-sdk-php"
]
```

**ポイント:** `collector` に依存している理由は、ingest Lambda が collector エージェントの `get_weather` ツールのロジックを再利用するため。「すでに書いた天気データ取得ロジックをコピーせず、直接使い回す」設計。

### 2.2 `packages/agents/lambdas/src/lambdas/__init__.py` — パッケージ認識用（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | Python にこのフォルダがパッケージだと教えるファイル |
| なぜ必要か | これがないと `from lambdas.ingest import handler` が動かない |
| 中身の要点 | docstring（説明文）のみ |
| 関連技術 | 素の Python |

TSでいう **`index.ts`**。PHP には不要な概念（PHP は namespace 宣言で済む）。

### 2.3 `packages/agents/lambdas/src/lambdas/ingest.py` — 天気データ自動収集（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | 毎朝自動で天気データを集めて S3 に保存し「集めたよ」とイベントを発行する Lambda |
| なぜ必要か | エージェント（対話型）だけでは毎日の自動収集ができない |
| 中身の要点 | get_weather ツール再利用、S3 保存、EventBridge イベント発行 |
| 関連技術 | AWS Lambda / EventBridge / S3 / Strands Agents ツール再利用 |

Laravelでいう **`php artisan schedule:run`** で動く **Job クラス** に近い。TSでいうと **cron で実行される serverless function** です。

#### handler 関数 — Lambda の「入口」

```python
def handler(event: dict, context: object) -> dict:
    # ↑ Lambda のエントリポイント。TSの serverless handler と同じ
    #   Laravelでいう Job クラスの handle() メソッド
    cities = load_cities()  # cities.yaml から都市一覧を取得
    today = date.today().isoformat()  # "2026-03-22" のような文字列
```

**Lambda の handler とは？** AWS Lambda は「event（入力）を受け取り、処理して、結果を返す関数」。Express の `(req, res) => { ... }` や Laravel の Controller メソッドに近いが、**サーバーが不要**（AWS が自動で起動・終了する）のが特徴。

#### ツールの再利用 — `.fn()` がキモ

```python
from collector.tools.weather import get_weather

# エージェントが使う get_weather ツールを Lambda でも再利用
weather_json = get_weather.fn(city=city.name, days=7)
# ↑ .fn() で呼ぶのがポイント！
#   get_weather は @tool デコレータ付きの関数。
#   .fn() を付けると「デコレータを外して素の関数として呼ぶ」意味になる。
#   → エージェント経由でも Lambda 経由でも同じロジックを使える
```

**なぜ `.fn()` が必要か？** `@tool` デコレータは関数を「エージェント用ツール」として包んでいる。直接 `get_weather(city="東京")` と呼ぶとエージェントのツール呼び出しプロトコルが動いてしまう。`.fn()` で中身だけ取り出して「普通の Python 関数」として呼ぶ。TSでいうと、React のコンポーネント内のロジックを hooks として切り出して別の場所でも使うのに似ている。

#### EventBridge イベント発行 — 「仕事が終わったよ」の通知

```python
events_client = boto3.client("events")
# ↑ TSなら new EventBridgeClient({})
#   Laravelなら Event::dispatch() に近い

events_client.put_events(
    Entries=[{
        "Source": "weather-agent.ingest",       # 発行元（「誰が」）
        "DetailType": "WeatherDataFetched",     # イベント種別（「何が起きた」）
        "Detail": json.dumps({                  # 詳細データ（「具体的に何」）
            "cities": ["東京", "大阪", "福岡"],
            "date": "2026-03-22",
            "s3_keys": ["data/weather/東京/2026-03-22.json", ...],
        }),
    }]
)
```

**EventBridge イベントとは？** 「○○が起きました」というメッセージを AWS 全体にブロードキャストする仕組み。Laravelの **Event/Listener** パターンと同じ概念で、「データ取得完了」イベントを発行すると、それを待っている Step Functions（TASK-013 で構築）が自動起動する。

### 2.4 `packages/agents/lambdas/src/lambdas/scorer.py` — AI による異常気象チェック（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | S3 に保存された天気データを AI が読み、異常がないかスコアリングする Lambda |
| なぜ必要か | 「気温が急に10度下がった」のような異常を自動検知するため |
| 中身の要点 | S3 読み取り、Bedrock API 直接呼び出し、スコア判定、イベント発行 |
| 関連技術 | AWS Lambda / Bedrock API / EventBridge |

Laravelでいう **Queued Job** で、内部で **外部 AI サービスを呼ぶ**パターン。TSでいうと外部 API を叩く serverless function。

#### 「エージェント」vs「Lambda + Bedrock」の違い

これが今回の一番重要な学びポイント:

```
対話型（エージェント）:
  ユーザー → Agent(system_prompt, tools) → 自由に思考 → 応答
  「東京の天気について分析して」→ ツールを選び、分析し、言葉で回答する

バッチ型（Lambda + Bedrock）:
  タイマー → Lambda → bedrock.invoke_model(prompt) → 構造化JSON
  毎朝自動 → 気象データを渡す → スコアを数値で返す
```

エージェントは「自由に考えて対話する」のが得意。一方、「決まった基準でスコアを出す」だけの作業にエージェントは大げさ。Lambda + Bedrock API 直接呼び出しのほうがシンプルで速い。

#### Bedrock API 直接呼び出し — LLM を「API」として使う

```python
bedrock = boto3.client("bedrock-runtime")
# ↑ TSなら new BedrockRuntimeClient({})
#   Laravelなら new BedrockRuntimeClient(['region' => 'us-east-1'])

response = bedrock.invoke_model(
    modelId=MODEL_ID,  # "anthropic.claude-sonnet-4-20250514-v1:0"
    body=json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1024,
        "messages": [{
            "role": "user",
            "content": prompt,  # スコアリング指示 + 気象データ
        }],
    }),
)
# ↑ TSでいうと fetch("https://bedrock.../invoke", { body: ... })
#   Laravelでいうと Http::post('bedrock://...', [...])
```

**Strands SDK（Agent クラス）と何が違う？**
- **Agent:** 「system_prompt → ツール選択 → ツール実行 → 思考 → 応答」の対話ループを管理
- **invoke_model:** 1回だけプロンプトを送って1回だけ応答を受け取る。ツールなし、対話ループなし

agent はレストラン（注文→調理→サーブの流れがある）、invoke_model は自販機（ボタン押したら出てくる）。

#### LLM の出力パース — 「AIの答えがいつも完璧とは限らない」

```python
def _extract_json(text: str) -> dict | None:
    """LLM のレスポンスから JSON を抽出する"""
    # まず全体をパースしてみる
    try:
        return json.loads(text)       # ← うまくいけばここで終わり
    except json.JSONDecodeError:
        pass

    # { ... } の部分だけ抽出してパース
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pass

    return None
```

**なぜこんな面倒なことをする？** LLM は「はい、以下がスコアリング結果です：{...}」のように、JSON の前後に余計なテキストを付けることがある。「素直に JSON だけ返して」とプロンプトで指示しても 100% 守られるとは限らない。そのため、`{` と `}` に挟まれた部分だけ抽出してパースする安全策を入れている。

TSでいうと API レスポンスの `.data` を取り出す前に null チェックを入れるのに近い防御的プログラミング。

#### スコア判定 — 「クランプ」で範囲を保証

```python
score_result["anomaly_score"] = max(
    0.0, min(1.0, float(score_result.get("anomaly_score", 0)))
)
# ↑ Math.max(0, Math.min(1, score)) と同じ
#   TSでいう clamp(value, min, max) パターン
#   LLM が 1.5 や -0.3 を返しても 0.0〜1.0 に収める
```

### 2.5 `packages/agents/pyproject.toml` — ワークスペース設定（変更）

| 項目 | 内容 |
|---|---|
| これは何か | モノレポ全体の「目次」。どのパッケージが存在するか定義 |
| なぜ必要か | lambdas を追加しないと uv がパッケージとして認識しない |
| 中身の要点 | `members` と `sources` に lambdas を追加 |
| 関連技術 | 素の Python（uv ワークスペース） |

TSでいうルートの **`package.json`** の `"workspaces"` に新しいパッケージを追加するのと同じ。

```toml
[tool.uv.workspace]
members = [
    "shared",
    "collector",
    # ...
    "lambdas",     # ← Step 7 (TASK-011) で追加
]

[tool.uv.sources]
lambdas = { workspace = true }  # ← ワークスペース内の lambdas を使う
```

---

## 3. ファイル間の関係図

```
                              既存（TASK-001〜006）      新規（TASK-011）
                             ┌─────────────────┐      ┌──────────────────┐
                             │ collector/       │      │ lambdas/         │
                             │  tools/          │      │                  │
                             │   weather.py     │←─────│  ingest.py       │
                             │   (@tool)        │再利用│  (get_weather.fn)│
                             │   get_weather()  │      │                  │
                             └────────┬─────────┘      │  scorer.py       │
                                      │                │  (Bedrock API)   │
                             ┌────────┴─────────┐      └─────┬──────┬─────┘
                             │ shared/           │            │      │
                             │  config.py ───────┼────────────┘      │
                             │  (load_cities)    │  都市一覧         │
                             │  s3.py ───────────┼────────────┘──────┘
                             │  (put_object/     │  S3読み書き
                             │   get_object)     │
                             │  models.py        │
                             └───────────────────┘

データの流れ:
  EventBridge Scheduler（毎朝9:00）
       │
       ├──→ ingest Lambda
       │       │ get_weather.fn() で天気取得
       │       │ put_object() で S3 に保存
       │       │ put_events("WeatherDataFetched")
       │       ↓
       │    EventBridge ──→ Step Functions（TASK-013で構築）
       │
       └──→ scorer Lambda
               │ get_object() で S3 から読み込み
               │ bedrock.invoke_model() でスコアリング
               │ スコア > 0.7 なら put_events("WeatherAnomalyDetected")
               ↓
            EventBridge ──→ Step Functions（TASK-013で構築）
```

---

## 4. 今回登場した技術・用語の解説

### AWS Lambda（ラムダ）

**それは何か:** サーバーを用意せずに「関数」だけをクラウドで実行できるサービス。「handler 関数を1つ書くだけで、あとは AWS が起動・実行・終了を全部やってくれる」。

**なぜ使うか:** 毎朝1回天気を取得するだけなのに、24時間サーバーを動かすのは無駄。Lambda は実行した時間だけ課金される（月100万回無料枠あり）。

**日常の例え:** Uber Eats の配達員。注文（イベント）があったときだけ来て、配達（処理）が終わったら帰る。常時待機するバイトを雇う必要がない。

**TS/Laravel対応:** TSでいう **Vercel Serverless Functions** や **AWS Lambda + API Gateway**。Laravelでいう **Vapor**（Laravel のサーバーレスデプロイ）。

### EventBridge（イベントブリッジ）

**それは何か:** AWS サービス間で「メッセージ（イベント）」をやり取りする仲介サービス。「○○が起きました」を発信し、「○○が起きたら△△する」というルールを設定できる。

**なぜ使うか:** Lambda 間で直接通信すると密結合になる。EventBridge を挟むと「ingest は scorer の存在を知らなくてもいい」疎結合な設計になる。

**日常の例え:** 社内の掲示板。「新商品入荷しました」と貼り紙すると、それを見た各部署が自分の仕事を始める。貼り紙した人は誰が見るか知らなくていい。

**TS/Laravel対応:** Laravelでいう **Event + Listener** パターン。TSでいう **EventEmitter** や **RxJS の Subject**。

### put_events（イベント発行）

**それは何か:** EventBridge にカスタムイベントを送る API。

**構造:**
```python
{
    "Source": "weather-agent.ingest",    # 誰が発行した？（発行元）
    "DetailType": "WeatherDataFetched",  # 何が起きた？（イベント名）
    "Detail": json.dumps({...}),         # 詳細情報（JSON文字列）
}
```

Laravelでいうと `Event::dispatch(new WeatherDataFetched($data))`、TSでいうと `eventEmitter.emit('WeatherDataFetched', data)`。

### Bedrock InvokeModel API

**それは何か:** AWS Bedrock（LLMのマネージドサービス）に直接プロンプトを送って応答を受け取る API。

**Agent との違い:**

| 比較項目 | Agent（対話型） | InvokeModel（バッチ型） |
|---|---|---|
| 使う SDK | Strands Agents SDK | boto3 (AWS SDK) |
| ツール呼び出し | あり（@tool で定義） | なし |
| 対話ループ | あり（複数ターン） | なし（1回で完結） |
| 向いている用途 | 質問に答える、分析する | スコアリング、分類、要約 |
| Laravelでいうと | チャットボット | バッチ処理 Job |

**なぜ使い分ける？** エージェントは「考えて→ツール使って→また考えて...」のループがある分、処理時間が長い。スコアリングは「データを見てスコアを返すだけ」なので、InvokeModel で1回呼ぶほうが速くて安い。

### handler 関数（Lambda エントリポイント）

**それは何か:** Lambda が実行されたときに最初に呼ばれる関数。`handler(event, context)` の2引数を受け取る。

| 引数 | 何が入っている | TS/Laravel対応 |
|---|---|---|
| `event` | トリガーからの入力データ | Express の `req.body` / Laravel の `$request` |
| `context` | Lambda 実行環境の情報（残り時間、メモリ等） | Express の `req.app.locals` に近い |

### `.fn()` — デコレータの内側を呼ぶ

**それは何か:** Strands Agents の `@tool` デコレータが包んでいる「素の関数」を取り出すメソッド。

```python
@tool
def get_weather(city: str) -> str: ...

# エージェントから呼ぶ（ツールプロトコル経由）
agent("東京の天気を教えて")  # → Agent が get_weather を自動選択して呼ぶ

# Lambda から呼ぶ（素の関数として直接呼ぶ）
result = get_weather.fn(city="東京")  # → .fn() でデコレータをスキップ
```

TSでいうと React の `useCallback` で包んだ関数の中身を直接呼ぶようなもの。

### クランプ（clamp）

**それは何か:** 値を指定した範囲内に収める処理。`max(0, min(1, value))` で 0.0〜1.0 に制限する。

**なぜ使うか:** LLM が「スコア: 1.5」のような範囲外の値を返す可能性がある。防御的に範囲を保証する。

TSの `Math.max(0, Math.min(1, value))`、PHPの `max(0, min(1, $value))` と同じ。

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップ対応

| Lab | 関連内容 |
|---|---|
| **Lab 1** | ツール定義（get_weather）の再利用。Lab 1 で作ったツールを Lambda から呼ぶ |
| **Step 7** | EventBridge + Lambda によるイベント駆動パイプラインの構築 |

Step 7 の中心テーマは「エージェントの知識をバッチ処理でも活用する」こと。エージェントが対話で使うツール（get_weather）を Lambda からも再利用し、対話型とバッチ型を統合する設計パターンを学びます。

### 本番構成との対応

| 本番構成 | サンプル構成 | 状態 |
|---|---|---|
| MCP Server 経由のデータ取得 | Open-Meteo API（get_weather ツール経由） | 簡略版 |
| Fine-tuned スコアリングモデル | 汎用 Claude にプロンプトで指示 | 簡略版 |
| パラメータストアで閾値管理 | 定数 `ANOMALY_THRESHOLD = 0.7` | 簡略版 |
| DLQ（Dead Letter Queue）でエラー退避 | エラーログ出力のみ | 簡略版 |

### 本番との違い（簡略化した部分）

| 項目 | 本番 | サンプル | 理由 |
|---|---|---|---|
| データ取得元 | S&P Global MCP Server | Open-Meteo API | 無料 API で学習に集中 |
| スコアリングモデル | Fine-tuned 専用モデル | Claude（汎用）にプロンプト | モデル学習のコスト回避 |
| 閾値管理 | SSM Parameter Store | 定数 `0.7` | インフラの複雑さを避ける |
| エラー処理 | DLQ + CloudWatch アラーム | ログ出力 + continue | 学習範囲を限定 |
| Lambda レイヤー | 依存を Lambda Layer に分離 | パッケージ同梱 | デプロイの簡略化 |

---

## 6. 次のタスクへのつながり

```
TASK-011（今回）                    次のタスクたち
Lambda 2本の「中身」を作成
  │
  ├──→ TASK-012: CDK EventStack
  │     └─ 今回作った Lambda を AWS にデプロイし、
  │        EventBridge Scheduler（毎朝9:00）で自動起動する設定を CDK で構築する
  │        （Laravelでいう Task Scheduling の設定をインフラとして定義）
  │
  ├──→ TASK-013: CDK OrchestrationStack（Step Functions）
  │     └─ ingest が発行する WeatherDataFetched → 天気分析WF
  │        scorer が発行する WeatherAnomalyDetected → 異常気象監視WF
  │        これらの「イベント → ワークフロー」の連携を定義する
  │
  └──→ TASK-014: GatewayStack
        └─ 異常検知時の通知（Slack / メール）を設定する
           scorer → イベント → WF → 通知 の全体フローが完成
```

今回作った2つの Lambda は「中身（ロジック）」だけ。次の TASK-012 で「いつ・どう動かすか」のインフラ設定（EventBridge Scheduler, Lambda Function, IAM 権限）を CDK で定義すると、実際に AWS 上で自動実行されるようになります。

**対話型 vs バッチ型のまとめ:**

```
これまで（TASK-001〜009）:
  ユーザー → エージェント → ツール → 応答
  「聞かれたら答える」受動型

今回（TASK-011）+ 今後（TASK-012〜014）:
  タイマー → Lambda → S3 → EventBridge → Step Functions → 通知
  「自分から動く」能動型

両方を組み合わせるのが本番構成のベストプラクティス。
```

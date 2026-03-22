# TASK-003 解説: 災害情報取得ツール + エージェント統合

## 1. このタスクで何を作ったか

**「道具を2つ持った"料理人"を完成させて、お客さんの注文を受けられるようにした。」**

TASK-002で「天気を調べる道具」を作った。今回は「災害情報を調べる道具」をもう1つ作り、その2つの道具を"料理人"（AIエージェント）に渡した。さらに「注文を受ける窓口」（CLI対話）を作って、ユーザーが話しかけるとエージェントが自分で道具を選んで答えてくれるようになった。

---

## 2. 作成・変更したファイル一覧

### (a) `packages/agents/collector/src/collector/tools/disaster.py` — 2つ目の道具（災害情報取得）

| 項目 | 内容 |
|---|---|
| これは何か | AIエージェントに渡す「災害情報を調べる道具」。気象庁のAPIから警報・注意報を取得する |
| なぜ必要か | 天気だけでなく災害情報も扱えるようにすることで、収集エージェントとしての機能が完成する |
| 関連技術 | **Strands Agents SDK**（`@tool`）、**httpx**（HTTP通信）、**Pydantic**（データ変換） |

TASK-002の `weather.py` と**まったく同じパターン**で作られている。これが重要なポイント：ツールを増やすのに新しい仕組みは不要で、同じ `@tool` パターンを繰り返すだけ。

#### 処理の流れ

```
ユーザー: 「災害情報を教えて」
    ↓
Step A: 気象庁 API に問い合わせ
Step B: レスポンスから該当地域の警報を抽出
Step C: DisasterInfo モデルに変換して返す（or 「情報なし」メッセージ）
    ↓
AIエージェント: 受け取ったデータをもとにユーザーに回答
```

#### `@tool` デコレータ — weather.py と同じパターン

```python
@tool                                               # ← この1行で「AIが使える道具」になる
def get_disaster_info(region: str = "全国") -> str:  # ← 引数の型ヒントがツールのパラメータになる
    """指定地域の災害警報・注意報を取得する。"""         # ← この説明文がAIに渡される
```

`get_weather` との違いは引数だけ。`city` の代わりに `region`（地域名）を受け取る。**道具の作り方のパターンは完全に同じ。** TSでいうと、同じインターフェースを実装する別のクラスを作るイメージ。

#### API呼び出し部分

```python
import httpx   # ← TSなら fetch / axios
               #    Laravelなら Http::get()

with httpx.Client(timeout=5.0) as client:          # ← 5秒でタイムアウト
    response = client.get(JMA_WARNING_URL)          # ← 気象庁APIにGETリクエスト
    response.raise_for_status()                     # ← 4xx/5xxならエラーを投げる
    data = response.json()                          # ← JSONとしてパース
```

`weather.py` では `_fetch_with_retry()` でリトライ機能をつけていたが、災害情報APIではAPIエラー時に「情報なし」として扱う設計にした。仕様書の要件:「情報なし → "現在発表中の警報・注意報はありません" を返す」に対応。

#### エラーハンドリングの考え方

```python
try:
    # API呼び出し
except httpx.HTTPError:       # ← 通信エラーや4xx/5xxエラー
    return _no_alert_message(region)  # ← エラーでも「情報なし」として返す（クラッシュしない）
```

**なぜクラッシュさせないのか？** AIエージェントのツールがエラーで止まると、エージェント全体が止まってしまう。ツールは「呼ばれたら必ず文字列を返す」のがルール。Laravelでいうと、API連携のサービスクラスで例外をキャッチして `null` を返すのと同じ考え方。

### (b) `packages/agents/collector/src/collector/agent.py` — 料理人（エージェント本体）

| 項目 | 内容 |
|---|---|
| これは何か | 2つの道具を持った「AIエージェント」の組み立て書。「あなたは気象データ収集の専門家です」という人格と、使える道具のリストを定義する |
| なぜ必要か | 道具だけ作っても、それを使う「人」がいなければ動かない。このファイルが道具と人格を結びつける |
| 関連技術 | **Strands Agents SDK**（`Agent` クラス） |

Laravelでいうと、コントローラーに「どのサービスを使うか」をDIで注入するのに似ている。TSでいうと、`new Router(handler1, handler2)` のように複数のハンドラーを登録する感覚。

#### エージェントの3要素

```python
from strands import Agent   # ← Strands Agents SDK のメインクラス

# ① 人格定義（システムプロンプト）
SYSTEM_PROMPT = """\
あなたは気象データ収集の専門家です。
ユーザーの指示に基づいて、天気データや災害情報を取得し、
わかりやすく整理して報告します。

利用可能なツール:
- get_weather: 指定都市の天気予報・過去データを取得
- get_disaster_info: 災害警報・注意報を取得

回答のルール:
- データは必ずツールを使って取得すること（推測しない）
- 取得したデータは表形式で見やすく整理すること
"""

# ② エージェント生成
def create_collector_agent() -> Agent:
    return Agent(
        system_prompt=SYSTEM_PROMPT,        # ← ①の人格を設定
        tools=[get_weather, get_disaster_info],  # ← ③ 道具のリストを渡す
    )
```

**ポイント:**

- **`system_prompt`** = AIの「人格」。レストランでいうと「あなたはイタリアンのシェフです。使える食材はこれとこれ」と伝える指示書
- **`tools=[...]`** = 渡す道具のリスト。**リストに追加するだけ**で道具が増やせる。Laravelの `$this->middleware([...])` のように、配列で機能を追加する感覚
- Agent クラスが、ツールの `@tool` デコレータから **JSON Schema を自動生成**して Bedrock に渡す。手動でスキーマを書く必要はない

#### なぜシステムプロンプトにツール一覧を書くのか

```python
利用可能なツール:
- get_weather: 指定都市の天気予報・過去データを取得
- get_disaster_info: 災害警報・注意報を取得
```

技術的には書かなくても動く（`@tool` のスキーマで LLM は道具を認識できる）。しかし**明示的に書くことで、LLM のツール選択精度が上がる**。人間に仕事を頼むときも「あなたが使える道具はこれです」と最初に伝えた方が効率的なのと同じ。

### (c) `packages/agents/collector/src/collector/__main__.py` — 注文窓口（CLI対話）

| 項目 | 内容 |
|---|---|
| これは何か | ターミナルでエージェントと対話するための「受付窓口」。`uv run python -m collector` で起動する |
| なぜ必要か | エージェントと道具を作っても、ユーザーが話しかける場所がないと使えない |
| 関連技術 | **素のPython**（標準入出力） |

TSでいうと `package.json` の `"scripts": { "start": "..." }` で起動するエントリポイント。Laravelでいうと `php artisan` のコマンドクラス（`handle()` メソッド）に相当。

#### `__main__.py` とは何か

Pythonでは、フォルダに `__main__.py` があると `python -m フォルダ名` で実行できる。TSでいうと `bin/xxx.ts` にあたる。

```bash
uv run python -m collector
# ↑ TSなら: npx ts-node src/index.ts
#   Laravelなら: php artisan collector:run
```

#### 対話ループの仕組み

```python
def main() -> None:
    agent = create_collector_agent()    # ① エージェントを作る
    print("🌤 収集エージェント起動")

    while True:                         # ② 無限ループで対話を続ける
        user_input = input("あなた: ")  # ③ ユーザーの入力を待つ
        if user_input.lower() in ("exit", "quit"):
            break                       # ④ "exit" で終了

        response = agent(user_input)    # ⑤ ★ この1行が全部やってくれる
        print(f"エージェント: {response}")
```

**⑤が最も重要な行。** `agent(user_input)` を呼ぶだけで、裏側ではこんなことが起きている:

```
agent("東京の天気を教えて")
  ↓
1. Bedrock (Claude) に「ユーザーがこう言ってるけど、どうする？」と送信
  ↓
2. Bedrock が「get_weather(city="東京") を呼べ」と判断して返す
  ↓
3. Strands Agent が get_weather("東京") をローカルで実行
  ↓
4. Open-Meteo API から天気データを取得
  ↓
5. 結果を Bedrock に「このデータを使って答えて」と再送信
  ↓
6. Bedrock が表形式の回答を生成して返す
  ↓
"🌤 東京の週間天気予報..." というテキストが response に入る
```

**TSで例えると:**
```typescript
// これと同じような仕組み（あくまでイメージ）
const response = await agent.chat("東京の天気を教えて");
// 裏側で: LLM → ツール選択 → API呼び出し → 再推論 → 回答テキスト
```

### (d) `packages/agents/collector/README.md` — 取扱説明書

| 項目 | 内容 |
|---|---|
| これは何か | 収集エージェントの学習ガイド。起動方法・対話例・ファイル構成・本番との違いをまとめた説明書 |
| なぜ必要か | 次にこのコードを触る人（未来の自分含む）が迷わないため |
| 関連技術 | ドキュメント |

---

## 3. ファイル間の関係図

```
packages/agents/collector/
│
├── __main__.py ─────────── 注文窓口（CLI対話ループ）
│     │                     「uv run python -m collector」で起動
│     │
│     └─→ agent.py ──────── 料理人（エージェント定義）
│           │                system_prompt + tools のセット
│           │
│           ├─→ tools/weather.py ──── 道具①: 天気を調べる（TASK-002で作成）
│           │     ├─→ httpx で Open-Meteo API を呼ぶ
│           │     ├─→ shared.config.find_city() で都市名解決
│           │     └─→ shared.models.WeatherData でデータ構造化
│           │
│           └─→ tools/disaster.py ─── 道具②: 災害情報を調べる（★今回作成）
│                 ├─→ httpx で気象庁 API を呼ぶ
│                 └─→ shared.models.DisasterInfo でデータ構造化
│
└── README.md ────────── 取扱説明書

（shared/ は TASK-001 で作成済み）
```

**データの流れ（天気の場合）:**

```
ユーザー: "東京の天気を教えて"
  → __main__.py: agent(user_input)
    → Strands Agent → Bedrock: 「どの道具を使う？」
    ← Bedrock: 「get_weather(city="東京") を使え」
    → weather.py: Open-Meteo API → WeatherData → JSON
    → Strands Agent → Bedrock: 「このJSONで回答を作って」
    ← Bedrock: 「🌤 東京の週間天気予報...」
  ← __main__.py: print(response)
```

**データの流れ（災害情報の場合）:**

```
ユーザー: "災害情報を教えて"
  → __main__.py: agent(user_input)
    → Strands Agent → Bedrock: 「どの道具を使う？」
    ← Bedrock: 「get_disaster_info(region="全国") を使え」
    → disaster.py: 気象庁 API → DisasterInfo → JSON（or 「情報なし」）
    → Strands Agent → Bedrock: 「このデータで回答を作って」
    ← Bedrock: 「現在の災害情報は...」
  ← __main__.py: print(response)
```

**ポイント:** ユーザーの入力に応じて **Bedrock（LLM）が自動でどの道具を使うか選んでいる**。コード側に「天気の質問なら weather を呼ぶ」「災害なら disaster を呼ぶ」という if 文は一切ない。

---

## 4. 今回登場した技術・用語の解説

### `Agent` クラス（Strands Agents SDK）

- **それは何か:** ツールとシステムプロンプトをまとめて「AIエージェント」として動作させるクラス
- **何をしてくれるか:** `agent("質問")` を呼ぶだけで「推論 → ツール選択 → ツール実行 → 再推論 → 回答」を自動で回してくれる
- **TSでの対応:** 直接の対応はないが、Express.js の `app.use(middleware1, middleware2)` のようにハンドラーを登録する感覚に近い
- **Laravelでの対応:** コントローラーに複数のサービスをDI（依存性注入）するのに近い

### システムプロンプト

- **それは何か:** AIに「あなたはこういう役割です」と伝える最初の指示文
- **なぜ必要か:** 指示がないと AIは何でもやろうとする。「データは推測せずツールで取得しろ」「表形式で整理しろ」と明確にルールを伝えることで、安定した回答が得られる
- **比喩:** 新人アルバイトに渡す「業務マニュアル」のようなもの

### `__main__.py`（Pythonの特殊ファイル）

- **それは何か:** `python -m パッケージ名` で実行されるエントリポイント
- **TSでの対応:** `package.json` の `"bin"` や `"scripts"` で指定するエントリポイント
- **Laravelでの対応:** `php artisan` のコマンドクラス（`app/Console/Commands/` 配下）
- **なぜ `main.py` でなく `__main__.py` か:** Python の規約で、`__main__.py` という名前だけが `python -m` で自動実行される

### `_parse_warnings()` のアンダースコアプレフィックス

- **それは何か:** 関数名の先頭に `_` をつけると「このモジュールの内部用（外から呼ばないで）」という慣習
- **TSでの対応:** `private` キーワード
- **Laravelでの対応:** `private function` や `protected function`
- **Python の特徴:** あくまで**慣習**であり、技術的にはアクセスを制限しない。TSの `private` のように強制力はない

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップとの対応

| 今回やったこと | ワークショップの Lab |
|---|---|
| 2つ目のツール `get_disaster_info` を `@tool` で定義 | **Lab 1** — ツール定義パターン（応用） |
| `Agent(tools=[tool1, tool2])` で複数ツールを渡す | **Lab 1** — 複数ツールのエージェント |
| `system_prompt` でエージェントの役割を定義 | **Lab 1** — プロンプトエンジニアリング |
| `agent(入力)` でツール自動選択→実行→回答 | **Lab 1** — 推論ループの仕組み |
| `__main__.py` でCLI対話ループ | **Lab 1** — ローカルでのエージェント実行 |

### 本番構成との対応

| 今回のサンプル | 本番構成 |
|---|---|
| 気象庁 JSON API を直接呼ぶ | 気象庁 XML + リアルタイム通知 |
| ローカルでCLI対話 | AgentCore Runtime (microVM) + HTTPS API |
| `python -m collector` で起動 | `invoke_agent()` で呼び出し |
| **`agent.py` のコード** | **同じコードがそのまま動く** |

**最大のポイント:** ローカルで動かしているこの `agent.py` と `tools/` のコードは、**TASK-008で AgentCore Runtime にデプロイしてもそのまま動く**。変わるのは「どこで実行するか」と「どう呼び出すか」だけ。これが Lab 2 で学ぶ AgentCore Runtime の価値。

---

## 6. 次のタスクへのつながり

### TASK-004（分析エージェント）

今回作った収集エージェントが取得した天気データを、**分析エージェント**が受け取って統計分析・可視化を行う。

```
TASK-003（今回）               TASK-004（次）
┌──────────────────┐         ┌──────────────────────┐
│ 収集エージェント     │  データ  │ 分析エージェント        │
│  get_weather ─────│────→│  Code Interpreter     │
│  get_disaster_info │   JSON │  save_to_s3          │
│                    │         │  （統計分析→S3保存）    │
└──────────────────┘         └──────────────────────┘
```

### TASK-005（横断分析・異常検知エージェント）

収集エージェントの天気データを複数都市分まとめて比較分析したり、閾値を超えたらアラートを出すエージェントが作られる。

### TASK-006（オーケストレータ）

最終的に、収集・分析・横断分析・異常検知の4つのエージェントを**まとめて指揮する「オーケストレータ」**が作られる。今回の収集エージェントは、そのオーケストレータの「部下」の1人になる。

```
              オーケストレータ（TASK-006）
              ┌─────────────┐
              │  指揮者       │
              └──┬──┬──┬──┬─┘
                 │  │  │  │
    ┌────────┐ ┌─┴─┐ ┌┴──┐ ┌┴───┐
    │収集     │ │分析│ │横断│ │異常 │
    │★今回完成│ │    │ │分析│ │検知 │
    └────────┘ └───┘ └───┘ └────┘
```

つまり、今回は「チームの最初のメンバーが実戦投入された」段階。これから仲間（エージェント）が増えていき、最終的にチームとして連携する。

# TASK-002 解説: 天気データ取得ツール（get_weather）

## 1. このタスクで何を作ったか

**「都市名を言うと、その都市の天気予報データを取ってきてくれる"道具"」を作った。**

AIエージェントは人間のように「自分で天気を調べる」ことはできない。そこで、「天気を調べる道具（ツール）」を渡してあげると、必要なときに自分でその道具を使ってくれる。今回はその「道具」の1つ目を作った。

---

## 2. 作成・変更したファイル一覧

### (a) `packages/agents/collector/pyproject.toml` — パッケージの設計図

| 項目 | 内容 |
|---|---|
| これは何か | 「このパッケージにはこのライブラリが必要です」という依存関係の宣言書。TSでいう **`package.json`**、Laravelでいう **`composer.json`** |
| なぜ必要か | これがないと `uv sync` （TSの `npm install` に相当）したときに必要なライブラリがインストールされない |
| 関連技術 | 素のPython（uv パッケージマネージャー） |

```toml
dependencies = [
    "strands-agents>=0.1",  # ← Strands Agents SDK。@tool デコレータを使うために必要
    "httpx>=0.27",          # ← HTTP通信ライブラリ。TSの fetch/axios、Laravelの Http::get() に相当
    "shared",               # ← TASK-001 で作った共通ライブラリ
]
```

**ポイント:** `shared` はこのモノレポ内の別パッケージ。TSの npm workspaces で `"shared": "workspace:*"` と書くのと同じ仕組み。

### (b) `packages/agents/collector/src/collector/__init__.py` — パッケージの入口

| 項目 | 内容 |
|---|---|
| これは何か | 「このフォルダはPythonパッケージですよ」という目印。TSでいう **`index.ts`** |
| なぜ必要か | これがないと `from collector.tools.weather import ...` のようなインポートができない |
| 関連技術 | 素のPython |

Pythonでは `__init__.py` があるフォルダがパッケージとして認識される。TSでは `index.ts` がフォルダの代表ファイルになるのと似た仕組み。PHPではオートローダーが自動で解決するので、この概念はない。

### (c) `packages/agents/collector/src/collector/tools/__init__.py` — ツール群フォルダの入口

`(b)` と同じ役割。`tools/` フォルダもパッケージとして認識させるために必要。

### (d) `packages/agents/collector/src/collector/tools/weather.py` — 本体！天気データ取得ツール

| 項目 | 内容 |
|---|---|
| これは何か | AIエージェントに渡す「天気を調べる道具」。都市名を受け取り、Open-Meteo API から天気データを取得してJSON形式で返す |
| なぜ必要か | AIエージェントは自分でネットにアクセスできない。この道具を渡すことで「天気を調べて」と頼めるようになる |
| 関連技術 | **Strands Agents SDK**（`@tool`）、**httpx**（HTTP通信）、**Pydantic**（データ変換） |

このファイルが今回のメインなので、処理の流れを詳しく解説する。

#### 処理の流れ（3ステップ）

```
ユーザー: 「東京の天気を教えて」
    ↓
Step A: 都市名 → 緯度経度に変換
Step B: 緯度経度 → Open-Meteo API に問い合わせ
Step C: APIレスポンス → 整形されたJSON で返す
    ↓
AIエージェント: 受け取ったJSONをもとにユーザーに回答
```

#### Step A: 都市名の解決（2段階フォールバック）

```python
city_config = find_city(city)    # ← まず cities.yaml から探す（高速）
if city_config:
    lat, lon = city_config.latitude, city_config.longitude
else:
    coords = _geocode(city)      # ← なければ Geocoding API で探す（外部通信）
    if coords is None:
        return "エラー: 都市名「...」が見つかりませんでした。"
```

**なぜ2段階にするのか？**
東京・大阪・福岡はよく使うので、毎回APIに聞くのは無駄。ローカルの「電話帳」（cities.yaml）をまず見て、載っていない都市だけAPIに問い合わせる。Laravelでいうと `Cache::remember()` で先にキャッシュを見るのと同じ考え方。

#### Step B: Open-Meteo API 呼び出し（リトライ付き）

```python
response = _fetch_with_retry(OPEN_METEO_BASE, params)  # ← 失敗しても1回だけ自動リトライ
if response is None:
    return "エラー: 天気データの取得に失敗しました。"
```

**`httpx`** は Python の HTTP クライアントライブラリ。TSでいう **`fetch`** や **`axios`**、Laravelでいう **`Http::get()`** に相当する。

```python
# httpx での API 呼び出し（Pythonの書き方）
with httpx.Client(timeout=5.0) as client:       # ← TSなら const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    response = client.get(url, params=params)    #    Laravelなら Http::timeout(5)->get($url, $params)
    response.raise_for_status()                  #    ← ステータスコードが4xx/5xxならエラーを投げる
```

#### Step C: レスポンスを Pydantic モデルに変換

```python
weather_data = WeatherData(
    city=city,
    daily=[
        DailyWeather(date=d, temperature_max=tmax, ...)  # ← 1日分ずつモデルに詰める
        for d, tmax, ... in zip(daily["time"], daily["temperature_2m_max"], ...)
    ],
)
return weather_data.model_dump_json(indent=2)  # ← JSONに変換して返す
```

**Pydantic モデル**は、TSでいう **Zod スキーマ** に近い。今回の場面では主に **`model_dump_json()` でJSON文字列に簡単に変換できる便利さ** のために使っている（自分で `json.dumps()` を書かなくて済む）。Laravelでいうと **Eloquent の `$casts`** + `toJson()` に近い役割。

Pydanticには「違う形のデータが来たらエラーにする」バリデーション機能もあるが、今回は自分でAPIレスポンスを詰めているので、その恩恵はまだ薄い。**TASK-003以降で、別のエージェントがこのJSONを受け取るとき**に `WeatherData.model_validate_json(json_str)` でデータの形をチェックでき、そこで初めてバリデーションが活きてくる。

#### `@tool` デコレータ — これが Strands Agents 固有の仕組み

```python
@tool                                           # ← この1行で「AIエージェントが使える道具」になる
def get_weather(city: str, days: int = 7) -> str:
    """指定都市の天気データを取得する。"""        # ← この説明文がAIに渡される
```

**`@tool` が何をしているか:**

1. 関数の**引数の型ヒント**（`city: str`, `days: int`）を読み取り、AIモデル（Bedrock）に「このツールにはこんなパラメータがある」と伝えるスキーマを自動生成する
2. 関数の **docstring**（`"""指定都市の..."""`）をツールの説明文としてAIに渡す
3. AIが「天気を調べたい」と判断したら、この関数を自動で呼び出してくれる

TSやLaravelには直接対応するものがない、**Strands Agents SDK 固有の概念**。イメージとしては「関数に `@tool` というラベルを貼ると、AIが使えるメニューに載る」という感じ。

### (e) `packages/agents/pyproject.toml` — ワークスペースルートの更新

| 項目 | 内容 |
|---|---|
| これは何か | モノレポ全体の管理ファイル。TSでいうルートの `package.json` の `workspaces` 設定 |
| 変更内容 | `collector` をワークスペースのメンバーに追加した |
| なぜ必要か | これがないと `collector` パッケージが `uv sync` でインストールされない |

```toml
[tool.uv.workspace]
members = [
    "shared",
    "collector",   # ← 今回追加。TSなら "workspaces": ["shared", "collector"]
]

[tool.uv.sources]
shared = { workspace = true }
collector = { workspace = true }  # ← 「collectorはこのモノレポ内にあるよ」という宣言
```

---

## 3. ファイル間の関係図

```
packages/agents/
├── pyproject.toml ─────────── ワークスペース管理（TSのルート package.json）
│     └─ "collector はメンバーだよ"
│
├── shared/ ─────────────────── TASK-001 で作った共通ライブラリ
│   └── src/shared/
│       ├── config.py ←──────── find_city(): 都市名 → 緯度経度
│       ├── models.py ←──────── WeatherData, DailyWeather: データの型定義
│       └── cities.yaml ←───── 都市マスタ（東京・大阪・福岡）
│
└── collector/ ──────────────── 今回作ったパッケージ
    ├── pyproject.toml ──────── 依存関係（strands-agents, httpx, shared）
    └── src/collector/
        ├── __init__.py ─────── パッケージの入口
        └── tools/
            ├── __init__.py ─── ツール群の入口
            └── weather.py ──── ★ get_weather ツール本体
                  │
                  ├── shared.config.find_city() を呼ぶ
                  ├── shared.models.WeatherData に変換する
                  ├── httpx で Open-Meteo API を呼ぶ
                  └── httpx で Geocoding API を呼ぶ（フォールバック時）
```

**データの流れ:**

```
都市名（例: "東京"）
  → find_city() で cities.yaml を検索
  → 緯度経度を取得（35.6762, 139.6503）
  → Open-Meteo API に GET リクエスト
  → レスポンスを WeatherData モデルに変換
  → JSON文字列として返す
```

---

## 4. 今回登場した技術・用語の解説

### `@tool` デコレータ（Strands Agents SDK）

- **それは何か:** 普通のPython関数を「AIエージェントが使える道具」に変換する魔法の1行
- **なぜ使うか:** これをつけるだけで、AIが「いつ・どの引数で」この関数を呼ぶべきか自動判断してくれるようになる
- **仕組み:** 関数の型ヒントとdocstringを読み取り、Amazon Bedrock に渡すツールスキーマ（JSON Schema）を自動生成する

### `httpx`（サードパーティライブラリ）

- **それは何か:** Python の HTTP クライアントライブラリ
- **TSでの対応:** `fetch` API / `axios`
- **Laravelでの対応:** `Http::get()` （Laravel HTTP Client）
- **なぜ `requests` ではなく `httpx` か:** `httpx` は async/sync 両対応で、型ヒントも充実している現代的なライブラリ

### Pydantic モデル（`WeatherData`, `DailyWeather`）

- **それは何か:** データの「型」を定義するクラス。「天気データにはこのフィールドが必要」と宣言する
- **TSでの対応:** Zod スキーマ（バリデーション付き）/ TypeScript interface（型だけ）
- **Laravelでの対応:** Form Request のルール定義 + Eloquent の `$casts`
- **なぜ使うか:** 今回は主に `model_dump_json()` でJSON変換を簡単にするため。加えて、後続タスクで別のエージェントがこのデータを受け取る際に `model_validate_json()` で形のチェック（バリデーション）ができるようになる

### Open-Meteo API

- **それは何か:** 無料で使える天気予報API。APIキー不要
- **なぜこれを使うか:** 学習用サンプルなので、登録不要ですぐ使えるAPIが適している。本番では S&P Global MCP Server を使う

### Geocoding API

- **それは何か:** 「東京」→「緯度35.68, 経度139.65」のように、地名を座標に変換するAPI
- **なぜ必要か:** 天気APIは緯度経度で場所を指定する必要があるため

### `from __future__ import annotations`

- **それは何か:** Python の型ヒントの書き方を新しいスタイルにするおまじない
- **TSでの対応:** 不要（TSは最初からこの書き方）
- **なぜ必要か:** `tuple[float, float] | None` のような書き方が Python 3.9 以前でも使えるようになる

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップとの対応

| 今回やったこと | ワークショップの Lab |
|---|---|
| `@tool` で関数をツール化 | **Lab 1** — Strands Agents の基本（ツール定義） |
| 引数の型ヒント → ツールスキーマ自動生成 | **Lab 1** — ツールパラメータの定義方法 |
| 外部APIを呼ぶツールの実装 | **Lab 1** — ツールが外部サービスと連携するパターン |

### 本番構成との対応

| 今回のサンプル | 本番構成 |
|---|---|
| Open-Meteo API を `httpx` で直接呼ぶ | S&P Global MCP Server を AgentCore Gateway 経由で呼ぶ |
| `@tool` で関数を定義 | 同じ（`@tool` の仕組みは本番でも共通） |
| `cities.yaml` で都市情報を管理 | DB（DynamoDB等）で管理 |

**本番との最大の違い:** データの取得元が違うだけで、**「ツールを定義してエージェントに渡す」というパターンは完全に同じ**。Step 9 で MCP を導入すると、`weather.py` を MCP プロトコル版に差し替えるだけでエージェント側のコードは変更不要。これがツールを分離して設計するメリット。

---

## 6. 次のタスクへのつながり

### TASK-003（災害情報取得ツール + エージェント統合）で使われる

今回作った `get_weather` は「道具」だけで、まだエージェントに渡していない。TASK-003 では:

1. もう1つの道具 `get_disaster_info`（災害情報取得）を作る
2. **`agent.py`** で `Agent(tools=[get_weather, get_disaster_info])` のようにエージェントに道具を渡す
3. **`__main__.py`** でCLI対話ループを作り、`uv run python -m collector` で対話できるようにする

```
TASK-002（今回）        TASK-003（次回）
┌────────────────┐    ┌──────────────────────────┐
│ get_weather    │───→│ Agent(tools=[            │
│ （道具を作った） │    │   get_weather,    ← 今回の道具 │
│                │    │   get_disaster_info      │
│                │    │ ])                       │
│                │    │ + CLI対話ループ            │
└────────────────┘    └──────────────────────────┘
```

つまり、今回は「レストランのキッチンに包丁を1本用意した」段階。次回は「もう1本包丁を追加して、料理人（エージェント）に渡し、注文（CLI入力）を受けられるようにする」段階になる。

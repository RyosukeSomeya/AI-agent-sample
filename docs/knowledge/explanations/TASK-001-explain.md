# TASK-001 解説: shared基盤モジュール

## 1. このタスクで何を作ったか

**AIエージェントたちが共通で使う「道具箱」を作った。**

まだAIエージェント本体は作っていません。「これからエージェントを作るにあたって、全員が使うデータの形や便利関数を先に用意した」というのがこのタスクです。料理に例えると、**レシピ（エージェント）を作る前に、計量カップや保存容器（共通ライブラリ）を揃えた**段階です。

---

## 2. 作成・変更したファイル一覧

### ファイル①: `packages/agents/pyproject.toml`

| 項目 | 内容 |
|---|---|
| **これは何か** | プロジェクト全体の「目次」のようなファイル |
| **なぜ必要か** | 「このフォルダの中には shared, collector, analyst... というパッケージがありますよ」とPythonに教えるため |
| **関連技術** | **uv**（Pythonのパッケージ管理ツール）。Strands AgentsともAWSとも関係なし |

TypeScriptでいう **ルートの `package.json`** に `"workspaces": ["packages/*"]` と書くのと同じ役割。Laravelでいう **`composer.json`** に近いが、ワークスペース（モノレポ）機能はLaravelでは一般的でないので、TSの方がイメージしやすい。

```toml
[tool.uv.workspace]
members = [
    "shared",          # ← 今回作ったパッケージ
    # "collector",     # ← 次のタスクで追加する
]
```

**比喩:** マンションの「入居者一覧」のようなもの。今は shared さんだけ入居済み。collector さんは次のタスクで引っ越してくる。

---

### ファイル②: `packages/agents/shared/pyproject.toml`

| 項目 | 内容 |
|---|---|
| **これは何か** | shared パッケージの「自己紹介カード」 |
| **なぜ必要か** | 「shared というパッケージの名前はこれで、pydantic と pyyaml と boto3 が必要です」とPythonに教えるため |
| **関連技術** | **uv / pip**（Pythonのパッケージ管理）。素のPython |

TSでいう **各パッケージの `package.json`** の `dependencies` セクション。Laravelでいう **`composer.json`** の `require` セクション。`uv sync` は `npm install` や `composer install` と同じで、ここに書かれたライブラリを自動でインストールしてくれる。

```toml
dependencies = [
    "pydantic>=2.0",   # データの形を定義するライブラリ（TSでいう zod）
    "pyyaml>=6.0",     # YAMLファイルを読むライブラリ
    "boto3>=1.34",     # AWSを操作するライブラリ（TSでいう @aws-sdk/*）
]
```

---

### ファイル③: `packages/agents/shared/src/shared/__init__.py`

| 項目 | 内容 |
|---|---|
| **これは何か** | 「このフォルダはPythonパッケージですよ」という目印 |
| **なぜ必要か** | これがないと `from shared.config import ...` と書いてもPythonが認識してくれない |
| **関連技術** | **素のPython**の仕組み（パッケージシステム） |

TSでいう **`index.ts`** に近い。TSでは `import { something } from './shared'` と書くと自動で `shared/index.ts` を探しに行く。Pythonも同様に `from shared import ...` と書くと `shared/__init__.py` を探しに行く。ただしTSの `index.ts` は省略しても動く場合があるが、Pythonの `__init__.py` は**必須**（ないとエラーになる）。

PHPでは不要。PHPはnamespaceとautoloadで解決するので、このような目印ファイルは存在しない。

中身はドキュメント（docstring）だけ。でもこのファイルが存在すること自体に意味がある。

---

### ファイル④: `packages/agents/shared/src/shared/cities.yaml`

| 項目 | 内容 |
|---|---|
| **これは何か** | 天気を調べる対象の都市リスト（データファイル） |
| **なぜ必要か** | 天気APIを呼ぶには都市の緯度・経度が必要。それをここにまとめておく |
| **関連技術** | **YAML**（人間が読みやすいデータ形式）。プログラミング言語とは無関係 |

Laravelでいう **`.env`** や **`config/*.php`** の設定ファイルに近い考え方。「設定データはコードから分離する」という原則。TSなら **`config.json`** や **`.env`** に環境設定を書き出すのと同じ。

**なぜYAMLファイルなのか:** 本番構成ではRDS PostgreSQLに都市マスタテーブルを持ち、Laravelでいう `City::all()` のようにDBから取得する。しかし学習用サンプルではDB（RDS/DynamoDB）を使わない簡易設計にしたため、代わりにYAMLファイルで都市データを管理している。DBを省略してもエージェントの学習には影響しない部分なので、ここは割り切って簡略化した。

```yaml
cities:
  - name: 東京
    name_en: Tokyo
    latitude: 35.6762    # ← 天気APIに渡す緯度
    longitude: 139.6503  # ← 天気APIに渡す経度
    timezone: Asia/Tokyo
```

**なぜコードに直接書かないのか:** 都市を追加したいとき、Pythonコードを変更せずにYAMLファイルに1行追加するだけで済む。Laravelで `config/app.php` にハードコーディングせず `.env` に外出しするのと同じ発想。もし将来DBに切り替える場合も、`config.py` の `load_cities()` の中身をDB読み込みに変えるだけで、呼び出し側は一切変更不要。

---

### ファイル⑤: `packages/agents/shared/src/shared/config.py`

| 項目 | 内容 |
|---|---|
| **これは何か** | cities.yaml を読んでPythonオブジェクトに変換する関数 |
| **なぜ必要か** | YAMLファイルはただのテキスト。Pythonで使うには読み込んで変換する必要がある |
| **関連技術** | **素のPython** + **PyYAML**（YAMLを読むライブラリ） |

Laravelでいう **`config()` ヘルパー関数**。`config('app.name')` でconfig配下の設定を取得するのと同じように、`load_cities()` で都市設定を取得する。TSでいうと `import config from './config.json'` で設定を読み込むのに近い。

```python
@dataclass(frozen=True)   # ← TSの readonly interface に相当
class CityConfig:
    """都市1つ分のデータ。"""
    name: str          # "東京"
    latitude: float    # 35.6762
    longitude: float   # 139.6503
    ...
```

`@dataclass` はPythonの標準機能で、**TSの `interface` / `type`** や **Laravelの readonly class（DTO）** に相当する。データだけを持つ入れ物を短く定義できる。

`frozen=True` は **TSの `Readonly<T>`** に近い。「この箱に入れたデータは後から変更できません」という制約。

```python
def load_cities() -> list[CityConfig]:
    """YAMLを読んで、CityConfig のリストを返す。"""

def find_city(name: str) -> CityConfig | None:
    """"東京" と指定すると、東京のCityConfigを返す。"""
```

`-> list[CityConfig]` は**TSの `: CityConfig[]` 戻り値の型注釈**と同じ。`CityConfig | None` は **TSの `CityConfig | null`** と同じ。

---

### ファイル⑥: `packages/agents/shared/src/shared/models.py`

| 項目 | 内容 |
|---|---|
| **これは何か** | エージェント間で受け渡すデータの「形」の定義 |
| **なぜ必要か** | 「天気データにはcity, daily が必ず入っている」という約束を明文化。形が違うデータが来たら即エラーにできる |
| **関連技術** | **Pydantic**（データバリデーションライブラリ）。素のPythonライブラリであり、Strands Agentsとは無関係 |

TSでいう **`zod` スキーマ**。Laravelでいう **`FormRequest`（バリデーション）+ Eloquent の `$casts`（型変換）** を合わせたもの。

```python
class WeatherData(BaseModel):    # ← TSなら z.object({...}) で定義する感覚
    """天気データの形。"""
    city: str                    # 都市名（必須）  ← TSなら city: string
    fetched_at: str              # 取得日時（必須）
    daily: list[DailyWeather]    # 日ごとのデータ  ← TSなら daily: DailyWeather[]
```

TSの `zod` との比較:
```typescript
// TypeScript + zod の場合
const WeatherDataSchema = z.object({
  city: z.string(),
  fetched_at: z.string(),
  daily: z.array(DailyWeatherSchema),
});
type WeatherData = z.infer<typeof WeatherDataSchema>;
```

Laravelとの比較:
```php
// Laravel FormRequest の場合
public function rules(): array {
    return [
        'city' => 'required|string',
        'fetched_at' => 'required|string',
        'daily' => 'required|array',
    ];
}
```

Pydanticは zod のように**型定義とバリデーションが一体化**している。Laravelだと型定義（Model）とバリデーション（FormRequest）が別ファイルになるが、Pydanticは1クラスで両方をやる。

定義したデータモデル:

| モデル名 | 何のデータか | 誰が作って誰が使うか |
|---|---|---|
| `DailyWeather` | 1日分の天気（気温、降水量、風速等） | 収集エージェントが作る → 分析エージェントが使う |
| `WeatherData` | 都市の天気データ一式 | 収集エージェントが作る → 分析エージェントが使う |
| `DisasterAlert` | 1件の災害警報 | 収集エージェントが作る |
| `DisasterInfo` | 災害情報まとめ | 収集エージェントが作る |
| `AnalysisAlert` | 異常検知アラート | 異常検知エージェントが作る → SNS通知やS3保存に渡す |

---

### ファイル⑦: `packages/agents/shared/src/shared/s3.py`

| 項目 | 内容 |
|---|---|
| **これは何か** | AWS S3（クラウド上のファイル保存サービス）にファイルを保存/取得する関数 |
| **なぜ必要か** | 天気データや分析レポートをクラウドに保存するため |
| **関連技術** | **boto3**（AWSの公式Pythonライブラリ）。AWSのサービスを操作するためのもの |

TSでいう **`@aws-sdk/client-s3`** の `PutObjectCommand` / `GetObjectCommand`。Laravelでいう **`Storage::disk('s3')->put()`** / **`Storage::disk('s3')->get()`**。

```python
import boto3   # ← TSなら import { S3Client } from '@aws-sdk/client-s3'
               #    Laravelなら use Illuminate\Support\Facades\Storage

def put_object(key, body, content_type):
    """S3にファイルをアップロードする。"""
    # LaravelでいうStorage::disk('s3')->put($key, $body) と同じ

def get_object(key):
    """S3からファイルをダウンロードする。"""
    # LaravelでいうStorage::disk('s3')->get($key) と同じ
```

バケット名を環境変数から取得する設計も、Laravelの `config('filesystems.disks.s3.bucket')` が `.env` の `AWS_BUCKET` を参照するのと同じパターン。

**今はまだ動かない:** S3バケット（保存先フォルダ）はまだAWS上に作っていない。Step 4（TASK-007）でCDKを使って作成する。

---

## 3. ファイル間の関係図

```
他のパッケージ（collector, analyst 等）
    │
    │  from shared.config import load_cities    ← TSなら import { loadCities } from 'shared'
    │  from shared.models import WeatherData    ← TSなら import { WeatherData } from 'shared'
    │  from shared.s3 import put_object         ← Laravelなら Storage::disk('s3')
    ▼
┌─────────────────────────────────────────┐
│  shared パッケージ                        │
│  （TSでいう @myapp/shared ライブラリ）      │
│  （Laravelでいう app/Services 的な共通層）  │
│                                          │
│  config.py ──読む──→ cities.yaml          │
│      ↑                                   │
│      │ CityConfig を使う                  │
│      │                                   │
│  models.py （データの形を定義）            │
│      zod スキーマ / FormRequest に相当     │
│                                          │
│  s3.py ──使う──→ boto3 ──→ AWS S3        │
│      Storage::disk('s3') に相当           │
└─────────────────────────────────────────┘

pyproject.toml（= package.json = composer.json）
    └── shared/pyproject.toml
         └── 依存: pydantic(=zod), pyyaml, boto3(=@aws-sdk)
```

---

## 4. 今回登場した技術・用語

| 用語 | それは何か | TSでいうと | Laravelでいうと | なぜ使うか |
|---|---|---|---|---|
| **uv** | Pythonのパッケージ管理ツール（pip の高速版） | `npm` | `composer` | ライブラリのインストールやワークスペース管理を高速に行える |
| **uvワークスペース** | 複数のPythonパッケージを1リポジトリで管理する仕組み | `npm workspaces` | _(Laravelでは一般的でない)_ | collector, analyst 等を分けつつ、shared を共有するため |
| **pyproject.toml** | Pythonプロジェクトの設定ファイル | `package.json` | `composer.json` | パッケージ名・依存ライブラリ・ビルド方法を宣言する |
| **dataclass** | Pythonの標準機能。データを格納するクラスを簡単に作れる | `interface` / `type` | `readonly class` / DTO | CityConfig のような「データだけ持つクラス」を短く書ける |
| **Pydantic** | データの型チェック・変換を自動でやるライブラリ | `zod` スキーマ | `FormRequest` のバリデーション + Eloquent `$casts` | JSON↔Pythonの変換、データの形が正しいかの検証を自動化 |
| **PyYAML** | YAMLファイルを読み書きするライブラリ | `js-yaml` | `Yaml::parse()` (Symfony) | cities.yaml を Pythonの辞書に変換するため |
| **boto3** | AWSの公式Pythonライブラリ | `@aws-sdk/client-s3` 等 | `Storage::disk('s3')` | S3やBedrock等のAWSサービスをPythonから操作するため |
| **S3** | AWSのファイル保存サービス（クラウド版Googleドライブ） | 同じ | 同じ | 天気データやレポートをクラウドに永続保存するため |
| **YAML** | 人間が読みやすいデータ記述フォーマット | 同じ | 同じ（`.env` に近い用途） | JSONより読みやすい。設定ファイルによく使われる |
| **`__init__.py`** | 「このフォルダはパッケージです」という目印ファイル | `index.ts` | _(PHPでは不要)_ | これがないと `from shared.xxx import ...` できない |

---

## 5. ワークショップ・本番構成との対応

| 項目 | 本番構成 | 今回のサンプル |
|---|---|---|
| 都市（企業）マスタ | RDS PostgreSQL に格納 | cities.yaml ファイル |
| データモデル | DB テーブル定義 | Pydantic モデル |
| ファイル保存 | S3 × 3バケット（文書・レポート・ベクトル） | S3 × 1バケット（パスで分類） |

TASK-001 は特定のワークショップ Lab には対応しませんが、**Lab 1〜9 すべてのLabで使われる共通基盤**です。ワークショップでは各Labが独立した使い捨てコードでしたが、実際のプロジェクトでは「まず共通部分を作り、その上にエージェントを載せる」のが定石です。

---

## 6. 次のタスクへのつながり

```
TASK-001（今回）          TASK-002（次）             TASK-003（その次）
shared基盤               天気データ取得ツール         エージェント統合
─────────────           ──────────────────        ─────────────────
cities.yaml  ─────→     weather.py が               agent.py が
config.py    ─────→     find_city() で緯度経度取得   Agent() を組み立て
models.py    ─────→     WeatherData で結果を返す     CLI で対話開始
s3.py                   （s3.py はまだ使わない）      ← ここで初めて Strands Agents 登場！
```

**次の TASK-002 で初めて Strands Agents SDK が登場します。** `@tool` デコレータを使って「天気データを取得するツール」を定義し、今回作った `config.py`（都市の緯度経度）と `models.py`（データの形）を実際に使います。`@tool` はTS/Laravelには対応するものがない、Strands Agents 固有の機能です。

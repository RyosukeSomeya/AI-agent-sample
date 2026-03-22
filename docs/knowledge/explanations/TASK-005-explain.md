# TASK-005 解説: 横断分析・異常検知エージェント

## 1. このタスクで何を作ったか

**「複数の街の天気を見比べる"比較担当"と、危険な天気を見つけてアラートを出す"監視担当"の2人を作った。」**

TASK-003で作った収集エージェントは「データを取ってくる」係、TASK-004の分析エージェントは「1つの街のデータを分析する」係。今回作った横断分析エージェントは「複数の街を見比べる」係で、異常検知エージェントは「危ない状況を見つけて警報を出す」係。4人の専門家がそろった。TASK-006で「指揮者（オーケストレータ）」が登場して、この4人を連携させる。

**マルチエージェント設計のポイント:** 1人のスーパーエージェントに全部やらせるのではなく、**役割ごとに分ける**のが設計の基本。人間のチームと同じで、「収集担当」「分析担当」「比較担当」「監視担当」がそれぞれの得意分野で仕事をする。

---

## 2. 作成・変更したファイル一覧

### (a) `packages/agents/crosscut/pyproject.toml` — 横断分析パッケージの設計図

| 項目 | 内容 |
|---|---|
| これは何か | 依存関係の宣言書。TSでいう **`package.json`**、Laravelでいう **`composer.json`** |
| なぜ必要か | Code Interpreter と save_to_s3 を使うため、analyst と同じ依存が必要 |
| 関連技術 | 素のPython（uv パッケージマネージャー） |

```toml
dependencies = [
    "strands-agents>=0.1",          # ← Strands Agents SDK（Agent クラス）
    "strands-agents-tools>=0.1",    # ← ツール集（Code Interpreter）
    "bedrock-agentcore>=1.4",       # ← AgentCore SDK（Code Interpreterのバックエンド）
    "shared",                       # ← TASK-001 で作った共通ライブラリ
]
```

**analyst とほぼ同じ依存関係。** 使う「道具」が同じなので、必要な「材料」も同じ。TSでいうと2つのパッケージの `package.json` が同じ `dependencies` を持つのと同じ状況。

### (b) `packages/agents/crosscut/src/crosscut/agent.py` — 比較担当（エージェント本体）

| 項目 | 内容 |
|---|---|
| これは何か | 複数都市の気象データを横断比較する専門エージェント |
| なぜ必要か | 「東京と大阪を比較して」のような横断的な分析を行うため |
| 関連技術 | **Strands Agents SDK**（`Agent`）、**AgentCore**（Code Interpreter） |

```python
from strands import Agent
from strands_tools.code_interpreter import AgentCoreCodeInterpreter
from analyst.tools.save_to_s3 import save_to_s3  # ← analyst が作ったツールを再利用！

SYSTEM_PROMPT = """\
あなたは複数都市の気象データを横断的に比較分析する専門家です。
...
分析のルール:
- 最低2都市以上のデータを比較すること
- 都市間の差異を明確に示すこと
- 共通トレンドと個別傾向を分離して報告すること
"""
```

**ここが今回の最重要ポイント。** analyst と全く同じツール構成（Code Interpreter + save_to_s3）だが、**システムプロンプトだけが違う**。これが「エージェントの専門性はプロンプトで決まる」というマルチエージェント設計の核心。

TSでいうと、同じクラスから2つのインスタンスを作り、コンストラクタに渡す設定だけが違う、という感じ：

```typescript
// TypeScript で例えるなら…
const analyst = new Agent({ config: "1都市を深く分析して" });
const crosscut = new Agent({ config: "複数都市を比較して" });
// 同じ Agent クラスだが、設定（プロンプト）で専門性が変わる
```

**もう1つのポイント:** `from analyst.tools.save_to_s3 import save_to_s3` で、**analyst パッケージのツールをそのまま再利用**している。共通ツールを別パッケージから import できるのは、uv ワークスペース（TSでいう npm workspaces）のおかげ。

### (c) `packages/agents/alert/pyproject.toml` — 異常検知パッケージの設計図

| 項目 | 内容 |
|---|---|
| これは何か | 依存関係の宣言書 |
| なぜ必要か | 異常検知エージェントに必要なパッケージを宣言 |
| 関連技術 | 素のPython（uv パッケージマネージャー） |

```toml
dependencies = [
    "strands-agents>=0.1",    # ← Strands Agents SDK
    "shared",                 # ← 共通ライブラリ
    # strands-agents-tools は不要！ Code Interpreter を使わないから
]
```

**crosscut との違いに注目。** alert は Code Interpreter を使わない（グラフを描いたりしない）ので、`strands-agents-tools` と `bedrock-agentcore` が不要。必要なものだけを宣言する。Laravelでいえば、使わないパッケージを `composer.json` に入れないのと同じ。

### (d) `packages/agents/alert/src/alert/agent.py` — 監視担当（エージェント本体）

| 項目 | 内容 |
|---|---|
| これは何か | 気象異常を検知しアラートJSON を生成する監視エージェント |
| なぜ必要か | 危険な天気（急な気温変化、強風等）を自動検出してアラートにするため |
| 関連技術 | **Strands Agents SDK**（`Agent`）|

```python
SYSTEM_PROMPT = """\
あなたは気象異常を検知する監視エージェントです。

検知ルール:
- 24時間以内の気温変化が10°C以上 → 急激な気温変化アラート
- 風速が15m/s以上 → 強風アラート
- 降水量が50mm/h以上 → 大雨アラート
- 災害警報が発表中 → 災害アラート

アラートは重要度（critical / warning / info）を付与すること。
"""

def create_alert_agent() -> Agent:
    # save_to_s3 のみ — 判断はLLMの推論で行う設計
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[save_to_s3],
    )
```

**このエージェントの面白さは「ルールをコードに書かない」こと。** 従来のプログラミングなら：

```python
# 従来のやり方（ハードコード）
if temp_change > 10:
    alert("急激な気温変化")
if wind_speed > 15:
    alert("強風")
```

エージェント設計では、これらのルールを**プロンプト（自然言語）で定義**する。LLMが文脈を読んで柔軟に判断するので、「気温が9.8°C下がったけど、同時に暴風雨が来ているから総合的に dangerous」のような複合判断もできる。

**TSやLaravelとの対比:** TSでバリデーションルールを Zod のスキーマで定義するように、ここではルールをプロンプトで定義している。ただし Zod は厳密なルール判定だが、LLMは柔軟な判断ができる点が根本的に異なる。

#### アラート出力フォーマット（JSON）

```json
{
  "alert_id": "alert-20260321-001",
  "timestamp": "2026-03-21T09:00:00+09:00",
  "city": "東京",
  "type": "temperature_change",
  "severity": "warning",
  "message": "東京で24時間以内に12°Cの気温低下を検知しました",
  "data": { "previous_temp": 22, "current_temp": 10, "change": -12 }
}
```

このJSONフォーマットもプロンプトで定義している。LLMはこの「テンプレート」に従って構造化されたJSONを出力する。TSでいう型定義（interface）をプロンプトで表現しているイメージ。

### (e) `packages/agents/crosscut/src/crosscut/__main__.py` — 横断分析の注文窓口

| 項目 | 内容 |
|---|---|
| これは何か | `uv run python -m crosscut` で起動する対話ループ |
| なぜ必要か | 横断分析エージェントに直接話しかけてテストするため |
| 関連技術 | 素のPython |

collector / analyst と全く同じパターン。TSでいう `package.json` の `"scripts": { "start": "..." }` に相当する起動スクリプト。Laravelでいう `php artisan` コマンドクラスに近い。

### (f) `packages/agents/alert/src/alert/__main__.py` — 異常検知の注文窓口

crosscut と同じ対話ループパターン。`uv run python -m alert` で起動。

### (g) `packages/agents/crosscut/README.md` / `alert/README.md` — 取扱説明書

各エージェントの学習ガイド。役割・動作確認手順・本番構成との差分を記載。

### (h) `packages/agents/pyproject.toml` — ワークスペースルート更新

```toml
[tool.uv.workspace]
members = [
    "shared",
    "collector",   # Step 1 (TASK-002)
    "analyst",     # Step 2 (TASK-004)
    "crosscut",    # Step 3 (TASK-005) ← 今回追加
    "alert",       # Step 3 (TASK-005) ← 今回追加
]
```

TSでいうルートの `package.json` に `"workspaces": [..., "crosscut", "alert"]` を追加したのと同じ。これで `uv sync` 実行時に crosscut と alert もワークスペースの一部として認識される。

### (i) `docs/designs/weather-agent-design.md` — 設計書更新

設計書の §5（Step 3: マルチエージェント詳細設計）に §5.2 crosscut/agent.py と §5.3 alert/agent.py の詳細設計を追加。もともとオーケストレータ（§5.1）の設計しかなかったので、実装に合わせて設計書を補完した。

---

## 3. ファイル間の関係図

```
packages/agents/
│
├── crosscut/                          ★ 今回作成
│   ├── __main__.py ─────── 注文窓口（CLI対話ループ）
│   │     └─→ agent.py ──── 比較担当（エージェント定義）
│   │           ├─→ AgentCoreCodeInterpreter ── 道具①: Pythonコード実行（SDK提供）
│   │           └─→ analyst/tools/save_to_s3 ── 道具②: S3保存（analyst から借用）
│   └── README.md
│
├── alert/                             ★ 今回作成
│   ├── __main__.py ─────── 注文窓口（CLI対話ループ）
│   │     └─→ agent.py ──── 監視担当（エージェント定義）
│   │           └─→ analyst/tools/save_to_s3 ── 道具: S3保存（analyst から借用）
│   │           （※ 判断はLLMの推論のみ。Code Interpreter は使わない）
│   └── README.md
│
├── analyst/（TASK-004 で作成済み）
│   └── tools/save_to_s3.py ──── ↑ crosscut と alert の両方が使う共通ツール
│
├── collector/（TASK-003 で作成済み）
│
└── shared/（TASK-001 で作成済み）
      └── s3.py ──── save_to_s3 の裏側で AWS S3 と通信
```

**4つのエージェントの役割分担:**

```
           ユーザー: "東京と大阪の天気を比較して"
                        │
                        ▼
    ┌──────────────────────────────────────┐
    │      オーケストレータ（TASK-006で作る）    │
    │      「指揮者」- 誰に何を頼むか判断       │
    └──┬────────┬────────┬────────┬────────┘
       │        │        │        │
  ┌────▼───┐ ┌──▼────┐ ┌──▼────┐ ┌──▼────┐
  │ 収集    │ │ 分析   │ │★横断  │ │★監視  │
  │ TASK-003│ │TASK-004│ │ 分析  │ │ 検知  │
  │        │ │       │ │TASK-005│ │TASK-005│
  │ データを│ │ 1都市を│ │複数都市│ │危険を  │
  │ 取る   │ │ 分析   │ │を比較 │ │ 検出   │
  └────────┘ └───────┘ └───────┘ └───────┘
     ★=今回作成
```

---

## 4. 今回登場した技術・用語の解説

### マルチエージェント設計

- **それは何か:** 1つのAIに全部やらせるのではなく、専門性ごとにエージェントを分けて協調させる設計方法。人間のチームのようにそれぞれが得意な仕事をする
- **なぜそうするか:** 1つのエージェントに何でもやらせると、プロンプトが膨大になり精度が落ちる。「収集」「分析」「比較」「監視」のように分けたほうが、各エージェントの仕事がシンプルで精度が上がる
- **身近な例え:** 会社のチーム構成と同じ。営業部・マーケ部・開発部に分かれているのは、1人のスーパー社員に全部やらせるより効率的だから

### A2A（Agent-to-Agent）連携

- **それは何か:** エージェント同士が情報をやりとりする仕組み。Strands Agents では Agent インスタンスを別の Agent のツールとして渡すことで実現する
- **TSでの対応:** マイクロサービス間のAPI通信に近い。サービスAがサービスBを呼び出すのと同じ考え方
- **Laravelでの対応:** `Service` クラスが別の `Service` を呼び出す依存注入パターンに近い
- **今回の立ち位置:** 今回は個別のエージェントを作った段階。次の TASK-006 で実際に A2A 連携させる

### システムプロンプトによる専門性定義

- **それは何か:** エージェントの「性格」「専門分野」「行動ルール」を自然言語で定義するテキスト。いわばエージェントの「職務記述書（Job Description）」
- **なぜコードではなくプロンプトか:** ルールの追加・変更がコード変更なしでできる。再デプロイせずにエージェントの振る舞いを変えられる
- **身近な例え:** 新人にマニュアルを渡すのと同じ。「こういう場合はこうしてね」を文書で伝える

### 閾値ベースの異常検知

- **それは何か:** 「気温変化が10°C以上」のような数値の閾値（しきいち）を超えたら異常とみなす方法
- **従来の実装:** `if temperature_change > 10` のようにコードにハードコード
- **エージェント設計:** プロンプトに「10°C以上なら異常」と書く。LLMが柔軟に判断するので、複合条件や微妙なケースにも対応できる
- **TSでの対応:** Zod のバリデーションルールに似ているが、LLMはルール外の状況にも柔軟に対応できる点が根本的に異なる

### JSON 構造化出力

- **それは何か:** LLMの出力を決まった形式のJSONにすること。人間が読む自然文ではなく、プログラムが処理しやすい構造データにする
- **なぜ必要か:** アラートを後続のシステム（SNS通知、S3保存、ダッシュボード表示）に渡すとき、プログラムがパースできる形式でないと使えない
- **TSでの対応:** API のレスポンスを TypeScript の interface に合わせて返すのと同じ考え方

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップとの対応

| 今回やったこと | ワークショップの Lab |
|---|---|
| マルチエージェントの個別エージェント設計 | **ワークショップ外（発展）** — Lab 1〜9 の知識を応用 |
| Code Interpreter を横断分析に再利用 | **Lab 1** — Code Interpreter の利用パターン |
| 閾値ルールをプロンプトで定義 | **Lab 1 応用** — プロンプトエンジニアリングの発展 |

### 本番構成との対応（`docs/designs/architecture-comparison.md` 参照）

| 今回のサンプル | 本番構成 |
|---|---|
| 横断分析エージェント（天気データの都市間比較） | 横断分析エージェント（財務データの企業間比較） |
| 異常検知エージェント（気象異常の検知） | シグナル検知エージェント（財務異常シグナルの検知） |
| CLI対話でテスト | AgentCore Runtime（microVM）で稼働 |
| プロンプトで閾値ルールを定義 | 同じ + Bedrock Guardrails でガードレールも追加 |
| save_to_s3 でアラート保存 | SNS → Slack / メール通知 + S3 アーカイブ |

**本番との最大の違い:**

1. **起動方法:** 今はCLIで手動起動 → 本番は EventBridge イベントで自動起動（Step 7 で実装）
2. **通知方法:** 今はコンソール出力 + S3保存 → 本番は SNS 経由で Slack やメールに通知（Step 9 で実装）
3. **分析対象:** 天気データ → 財務データ（分析パターンは同じ）

---

## 6. 次のタスクへのつながり

### TASK-006（オーケストレータ — A2A連携）

今回作った4つのエージェント（収集・分析・横断分析・異常検知）は、まだ「バラバラの個人」。TASK-006で**「指揮者（オーケストレータ）」**を作り、4人を1つのチームにまとめる。

```python
# TASK-006 で作るオーケストレータの核心コード
from crosscut.agent import create_crosscut_agent  # ← 今回作った
from alert.agent import create_alert_agent        # ← 今回作った

orchestrator = Agent(
    system_prompt="あなたは指揮者です...",
    tools=[collector, analyst, crosscut, alert_agent],  # ← エージェントをツールとして渡す！
)
```

**「エージェントをツールとして渡す」** — これが Strands Agents の A2A 連携の仕組み。TASK-005 で作った `create_crosscut_agent()` と `create_alert_agent()` が、そのまま次のタスクで使われる。

### 全体の流れ

```
Step 1（完了）  Step 2（完了）  Step 3（★今回）    Step 3（次）
┌──────┐     ┌──────┐     ┌──────────┐     ┌───────────┐
│ 収集  │     │ 分析  │     │横断分析    │     │オーケスト   │
│      │ ──→ │      │ ──→ │異常検知    │ ──→ │レータ      │
│TASK-003│     │TASK-004│     │TASK-005   │     │TASK-006   │
│ 1人目 │     │ 2人目  │     │ 3人目+4人目│     │ 指揮者     │
└──────┘     └──────┘     └──────────┘     └───────────┘
  個人           個人          個人              チーム結成！
```

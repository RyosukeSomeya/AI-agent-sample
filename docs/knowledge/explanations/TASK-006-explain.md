# TASK-006 解説: オーケストレータ（A2A連携）

## 1. このタスクで何を作ったか

**「4人の専門家をまとめて指揮する"チームリーダー"を作った。ユーザーが1人に話しかけるだけで、裏では4人が連携して仕事を片付ける。」**

TASK-003〜005で「収集担当」「分析担当」「比較担当」「監視担当」の4人を作った。でも4人はバラバラに動くだけで、ユーザーが1人ずつ指示しないといけなかった。今回の**オーケストレータ**は、ユーザーの「東京と大阪の天気を比較して」という1つの指示を受け取り、「まず収集担当にデータを取らせて、次に分析担当に分析させて…」と自動で仕事を振り分ける。

**身近な例え:** レストランに例えると、今まではお客さんが厨房に入って「仕入れ担当さん、材料を準備して」「シェフ、料理して」と1人ずつ指示していた。オーケストレータは**フロアマネージャー**で、「ランチセットをお願いします」と言えば、裏で全スタッフに適切に指示を出してくれる。

---

## 2. 作成・変更したファイル一覧

### (a) `packages/agents/orchestrator/pyproject.toml` — パッケージの設計図

| 項目 | 内容 |
|---|---|
| これは何か | 依存関係の宣言書。TSでいう **`package.json`**、Laravelでいう **`composer.json`** |
| なぜ必要か | 4つの専門エージェントを import するために、それぞれへの依存を宣言する |
| 関連技術 | 素のPython（uv パッケージマネージャー） |

```toml
dependencies = [
    "strands-agents>=0.1",   # ← Strands Agents SDK（Agent クラス）
    "collector",              # ← 収集エージェント（TASK-003）
    "analyst",                # ← 分析エージェント（TASK-004）
    "crosscut",               # ← 横断分析エージェント（TASK-005）
    "alert",                  # ← 異常検知エージェント（TASK-005）
]
```

**今までとの違いに注目。** collector は `httpx`（HTTP通信ライブラリ）に依存、analyst は `strands-agents-tools`（Code Interpreter）に依存していた。オーケストレータは**他のエージェントパッケージそのもの**に依存している。TSでいうと、monorepo の中で `"dependencies": { "collector": "workspace:*" }` と書くのと同じ。

### (b) `packages/agents/orchestrator/src/orchestrator/agent.py` — チームリーダー（エージェント本体）

| 項目 | 内容 |
|---|---|
| これは何か | 4つの専門エージェントを統合するオーケストレータの組み立て書 |
| なぜ必要か | ユーザーが1回指示するだけで、複数エージェントが連携して動くようにするため |
| 関連技術 | **Strands Agents SDK**（`Agent`、A2A連携） |

#### 今回の最重要コード — A2A連携の核心

```python
from collector.agent import create_collector_agent    # ← 各パッケージから
from analyst.agent import create_analyst_agent        #    ファクトリ関数を import
from crosscut.agent import create_crosscut_agent
from alert.agent import create_alert_agent

def create_orchestrator() -> Agent:
    # ① 各専門エージェントの Agent インスタンスを作る
    collector = create_collector_agent()      # Agent オブジェクト
    analyst = create_analyst_agent()          # Agent オブジェクト
    crosscut = create_crosscut_agent()        # Agent オブジェクト
    alert_agent = create_alert_agent()        # Agent オブジェクト

    # ② Agent インスタンスをそのまま tools に渡す — これが A2A の全て！
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[collector, analyst, crosscut, alert_agent],
    )
```

**ここが今回の最大のポイント。** 今まで `tools` リストには「関数」を渡していた（`get_weather`, `save_to_s3` など）。今回は **Agent インスタンスそのもの**を渡している。Strands Agents は Agent を自動的にツールとして認識し、オーケストレータの LLM が「このエージェントに仕事を頼もう」と判断したら呼び出す。

**TSでの対比:**

```typescript
// TypeScript で例えるなら…（実際のコードではなくイメージ）

// 今まで: 関数をツールとして渡す
const collector = new Agent({
  tools: [getWeather, getDisasterInfo],  // ← 関数を渡す
});

// 今回: Agent インスタンスをツールとして渡す
const orchestrator = new Agent({
  tools: [collector, analyst, crosscut, alert],  // ← Agent を渡す！
});
```

**Laravelでの対比:**  Laravel でいうと、`Service` クラスが別の `Service` を依存注入（DI）で受け取るパターンに近い。`OrchestratorService` のコンストラクタに `CollectorService`, `AnalystService` を注入するようなもの。ただし DI は「どのメソッドを呼ぶか」をコードで書く必要があるが、A2A ではLLMが動的に判断する点が根本的に異なる。

#### システムプロンプト — チームリーダーへの「業務マニュアル」

```python
SYSTEM_PROMPT = """\
あなたは気象データ分析チームのリーダーです。
ユーザーの指示に応じて、適切な専門エージェントに仕事を振り分けます。

利用可能なエージェント:
- collector: 天気データ・災害情報を取得する
- analyst: データを分析しレポートを生成する
- crosscut: 複数都市のデータを横断比較する
- alert: 異常気象を検知しアラートを生成する

作業の進め方:
1. まず collector でデータを取得する
2. analyst で個別都市の分析を行う
3. 複数都市の場合は crosscut で横断分析する
4. 異常が検出された場合は alert でアラートを生成する
"""
```

プロンプトに**作業手順**を書いておくことで、LLM が「まずデータを取って、次に分析して…」と正しい順序で仕事を振る。ただしこの順序は「推奨」であり、LLM が状況に応じて判断を変えることもできる。これが「ハードコードされたワークフロー」との違い。

### (c) `packages/agents/orchestrator/src/orchestrator/__main__.py` — 注文窓口

| 項目 | 内容 |
|---|---|
| これは何か | `uv run python -m orchestrator` で起動する対話ループ |
| なぜ必要か | オーケストレータに話しかけてテストするため |
| 関連技術 | 素のPython |

collector / analyst / crosscut / alert と全く同じ対話ループパターン。TSでいう `package.json` の `"scripts": { "start": "..." }`、Laravelでいう `php artisan` コマンドに相当。

**ユーザーから見た違い:** 他のエージェントと同じ見た目だが、裏で4つのエージェントが連携して動く。「東京と大阪の天気を比較して」と1回言うだけで、データ取得→分析→横断比較が自動で行われる。

### (d) `packages/agents/orchestrator/README.md` — 取扱説明書

学習ガイド。A2A 連携フロー図・動作確認手順・本番構成との差分を記載。

### (e) `packages/agents/pyproject.toml` — ワークスペースルート更新

```toml
[tool.uv.workspace]
members = [
    "shared",
    "collector",       # Step 1 (TASK-002)
    "analyst",         # Step 2 (TASK-004)
    "crosscut",        # Step 3 (TASK-005)
    "alert",           # Step 3 (TASK-005)
    "orchestrator",    # Step 3 (TASK-006) ← 今回追加
]
```

TSでいうルートの `package.json` に `"workspaces": [..., "orchestrator"]` を追加。これで全6パッケージがワークスペースの一部になった。

---

## 3. ファイル間の関係図

```
packages/agents/orchestrator/                ★ 今回作成
│
├── __main__.py ─────── 注文窓口（CLI対話ループ）
│     │
│     └─→ agent.py ──── チームリーダー（オーケストレータ定義）
│           │
│           ├─→ collector（Agent）──── 道具①: データ取得チーム
│           │     ├─→ get_weather        （天気データ取得）
│           │     └─→ get_disaster_info  （災害情報取得）
│           │
│           ├─→ analyst（Agent）───── 道具②: 分析チーム
│           │     ├─→ code_interpreter   （Pythonコード実行）
│           │     └─→ save_to_s3         （S3保存）
│           │
│           ├─→ crosscut（Agent）──── 道具③: 比較チーム
│           │     ├─→ code_interpreter   （Pythonコード実行）
│           │     └─→ save_to_s3         （S3保存）
│           │
│           └─→ alert_agent（Agent）── 道具④: 監視チーム
│                 └─→ save_to_s3         （S3保存）
│
└── README.md
```

**データの流れ（実際の動き）:**

```
ユーザー: "東京と大阪の天気を比較分析して"
  │
  ▼
__main__.py: agent(user_input)
  │
  ▼
オーケストレータ LLM: 「まず collector でデータを取ろう」
  ├─→ collector に「東京の天気を取得して」 → 天気データ返却
  ├─→ collector に「大阪の天気を取得して」 → 天気データ返却
  │
  ├─→ 「次に analyst で個別分析」
  │    analyst に「東京のデータを分析して」 → 分析結果
  │    analyst に「大阪のデータを分析して」 → 分析結果
  │
  ├─→ 「複数都市なので crosscut で比較」
  │    crosscut に「東京と大阪を比較して」 → 横断分析レポート
  │
  └─→ 「異常があれば alert」
       alert に「異常がないかチェック」 → アラート or 問題なし
  │
  ▼
ユーザーに統合レポートを返す
```

**重要:** この流れは**コードでハードコードされていない**。オーケストレータのLLMが、システムプロンプトの「作業の進め方」を参考にしつつ、自分で判断している。「東京の天気だけ教えて」と言えば collector だけ使い、「異常がないかチェック」と言えば alert を呼ぶ。

---

## 4. 今回登場した技術・用語の解説

### A2A（Agent-to-Agent）連携

- **それは何か:** エージェント同士がお互いの能力を使い合う仕組み。Strands Agents では Agent インスタンスを別の Agent の tools に渡すことで実現する
- **なぜ必要か:** ユーザーが4人のエージェントに1人ずつ指示するのは面倒。チームリーダー（オーケストレータ）がまとめて管理してくれれば、ユーザーは1回指示するだけでいい
- **仕組み:** Agent を tools に渡すと、Strands Agents SDK が自動的に「このツールを呼ぶ = このエージェントに仕事を頼む」と解釈する。普通のツール関数と全く同じように扱える
- **TSでの対応:** マイクロサービスのAPI Gateway に近い。Gateway が複数のサービスへのリクエストをルーティングするように、オーケストレータが複数エージェントへのリクエストを振り分ける
- **Laravelでの対応:** `Controller` → `Service` → 別の `Service` の呼び出しチェーンに近い。ただしLaravelでは呼び出し順序がコードに書かれるが、A2Aではここが**LLMの判断**になる

### オーケストレータ

- **それは何か:** 複数のエージェントを統合し、全体の流れを制御する「指揮者」エージェント
- **名前の由来:** 音楽のオーケストラの指揮者（orchestrator）と同じ。バイオリン・チェロ・フルート（= 各エージェント）をまとめて1つの演奏にする
- **なぜ必要か:** 専門エージェントは自分の仕事しかできない。「どの順番で誰に頼むか」を判断する存在が必要

### ハイブリッドマルチエージェント方式

- **それは何か:** 本番構成で採用する二層構造の制御方式
  - **外側:** Step Functions（決定的制御）— 「必ずこの順番で実行する」「失敗したらリトライする」を確実に制御
  - **内側:** AgentCore A2A（LLM動的判断）— 「状況に応じて判断する」柔軟な振り分け
- **今回の位置づけ:** 今回作ったオーケストレータは**内側だけ**。外側の Step Functions は Step 8（TASK-013）で追加する
- **なぜ二層にするか:** LLMの判断は柔軟だが、たまに間違える。本番では「データ取得→分析→レポート生成」のような大枠の流れは Step Functions で確実に制御し、各ステップ内の細かい判断だけをLLMに任せる

### ファクトリ関数（`create_xxx_agent()`）

- **それは何か:** Agent インスタンスを「作って返す」関数。`create_collector_agent()` → `Agent(...)` を返す
- **なぜ直接 Agent() を書かないか:** 設定（システムプロンプト、ツール）をカプセル化するため。呼ぶ側は中身を知らなくていい
- **TSでの対応:** Factory パターン。`createApp()` や `createRouter()` のような関数
- **Laravelでの対応:** Service Provider の `register()` メソッドに近い

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップとの対応

| 今回やったこと | ワークショップの Lab |
|---|---|
| Agent を tools に渡す A2A パターン | **ワークショップ外（発展）** — Lab の知識を応用 |
| オーケストレータのシステムプロンプト設計 | **Lab 1 応用** — プロンプトで作業フローを定義 |

### 本番構成との対応（`docs/designs/architecture-comparison.md`、`sample-architecture.drawio` 参照）

| 今回のサンプル | 本番構成 |
|---|---|
| オーケストレータ Agent（LLM動的判断） | AgentCore A2A（内側の判断層） |
| なし | Step Functions（外側の制御層）← Step 8 で追加 |
| 同一プロセスで直接呼び出し | AgentCore Runtime（microVM 隔離、HTTPS 通信） |
| 逐次実行（LLMが1つずつ判断） | Map State で都市単位の並列実行（maxConcurrency=10） |

**drawio 構成図との対応:**

```
sample-architecture.drawio の中身:

┌──────────────────────────────────────────────┐
│ オーケストレーション層                           │
│  ┌──────────┐  ┌──────────┐                   │
│  │Step Func  │  │Step Func  │ ← Step 8 で追加  │
│  │天気分析WF  │  │異常気象WF │                   │
│  └──────────┘  └──────────┘                   │
│                                               │
│ AIエージェント層                                │
│  ┌───┐ ─A2A─ ┌───┐ ─A2A─ ┌────┐ ─ ┌────┐   │
│  │収集│       │分析│       │横断 │   │異常 │   │
│  │   │       │   │       │分析 │   │検知 │   │
│  └───┘       └───┘       └────┘   └────┘   │
│      ↑ 今回作ったオーケストレータは              │
│        この4つの「A2A接続」を制御する            │
└──────────────────────────────────────────────┘
```

drawio には**オーケストレータのアイコンは直接描かれていない**。本番構成では Step Functions が外側の指揮者役を担い、A2A の紫の破線が内側のエージェント間通信を表している。今回作ったオーケストレータは、この「A2A の紫の線」の部分を Python コードで実現したもの。

---

## 6. 次のタスクへのつながり

### TASK-007〜（CDK スタック群）

ここからは**インフラ側**の実装に入る。今まで作ったエージェント（ローカルで動く Python コード）を**AWS クラウドにデプロイ**するための CDK（Cloud Development Kit）スタックを作る。

```
Step 1〜3（完了）        Step 4〜（次から）
┌───────────────┐     ┌──────────────────────┐
│ エージェント群   │     │ AWSインフラ             │
│                │     │                       │
│ collector      │ ──→ │ CDK StorageStack (S3)  │
│ analyst        │ ──→ │ CDK RuntimeStack       │
│ crosscut       │     │   (AgentCore Runtime)  │
│ alert          │     │ CDK MemoryStack        │
│ orchestrator   │     │ CDK EventStack         │
│ ★全員揃った！   │     │ CDK OrchestrationStack │
└───────────────┘     │   (Step Functions)     │
                       └──────────────────────┘
```

### Step Functions（TASK-013）が加わるとどうなるか

今のオーケストレータは**LLMが全部判断**している。TASK-013 で Step Functions を追加すると：

```
今（TASK-006）:
  ユーザー → オーケストレータ LLM → collector → analyst → crosscut → alert
             ↑ 全てLLMが判断

Step 8 以降（TASK-013）:
  EventBridge → Step Functions → collector → analyst → crosscut → alert
                ↑ 大枠の流れは              ↑ 各ステップ内の判断は
                  Step Functions が確定制御     LLMが動的判断

  = ハイブリッドマルチエージェント方式の完成！
```

### ここまでの全体像

```
TASK-001  共通基盤（config / models / s3ヘルパー）      ✅
TASK-002  収集エージェント: 天気データ取得               ✅
TASK-003  収集エージェント: 災害情報 + 統合              ✅
TASK-004  分析エージェント: Code Interpreter + S3        ✅
TASK-005  横断分析 + 異常検知エージェント               ✅
TASK-006  オーケストレータ（A2A連携）                   ★ 今回完了！
───────── ↑ エージェント完成 ─── ↓ インフラ構築 ─────────
TASK-007  CDK StorageStack + RuntimeStack             ⬜ 次
TASK-008  AgentCore Runtime デプロイ                   ⬜
...
```

**エージェント側のコードは今回で一段落。** 次からは AWS にデプロイするためのインフラコード（TypeScript の CDK）に入る。

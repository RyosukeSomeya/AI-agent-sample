# TASK-009 解説: CDK MemoryStack + エージェント Memory 連携

## 1. このタスクで何を作ったか

**エージェントに「記憶力」を与えた。** 前回の会話で分析した結果を覚えておいて、「先週の分析と今週を比較して」と聞いたときに過去の記憶から答えられるようにした。さらに、記憶を「事実」「要約」「好み」の3種類に自動分類する仕組み（Memory Strategy）も定義した。

日常の例えでいうと、これまでのエージェントは「毎回初対面のカウンター店員」でした。今回の変更で「常連客の好みを覚えてくれる馴染みの店員」にアップグレードしたイメージです。しかも店員は3つのノートを持っています — 「お客さんが言った事実」「会話のまとめ」「好みの傾向」を自動的に書き分けてくれます。

---

## 2. 作成・変更したファイル一覧

### 2.1 `packages/agents/shared/src/shared/memory.py` — 記憶設定の「共通基盤」（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | Memory Strategy の定義と、Memory リソースの作成・SessionManager 生成を共通化するモジュール |
| なぜ必要か | analyst と crosscut が同じ Memory 設定を使うため。設定をバラバラに書くとズレが生じる |
| 中身の要点 | 3つの Memory Strategy 定義、検索パラメータ、ヘルパー関数 |
| 関連技術 | AgentCore Memory SDK（`bedrock_agentcore`）/ Python |

TSでいう **共通の設定ファイル**（`config/database.ts` のようなもの）。Laravelでいう `config/cache.php` に近い — キャッシュストアの設定を一元管理するのと同じです。

**ここが今回の一番の学びポイント: Memory Strategy（記憶戦略）**

Memory Strategy は「短期記憶を長期記憶に自動変換するルール」です。3つのノートを使い分ける仕組み:

```python
# 3つの Memory Strategy（= 3つのノート）
MEMORY_STRATEGIES = [
    {
        # ノート1: 事実ノート
        # 「東京の先週の平均気温は25度」のような事実を自動抽出して保存
        "semanticMemoryStrategy": {
            "name": "WeatherFactExtractor",
            "namespaces": ["/facts/{actorId}/"],
            # ↑ {actorId} はユーザーIDに自動置換される
            #   TSでいう テンプレートリテラル `/facts/${userId}/`
            #   Laravelでいう ルートパラメータ /facts/{user}/
        }
    },
    {
        # ノート2: 要約ノート
        # 「今日は東京の天気を分析して、グラフを3つ作った」のような会話の要約
        "summaryMemoryStrategy": {
            "name": "AnalysisSessionSummarizer",
            "namespaces": ["/summaries/{actorId}/{sessionId}/"],
        }
    },
    {
        # ノート3: 好みノート
        # 「このユーザーは棒グラフより折れ線グラフが好き」のような好みを自動学習
        "userPreferenceMemoryStrategy": {
            "name": "AnalysisPreferenceLearner",
            "namespaces": ["/preferences/{actorId}/"],
        }
    },
]
```

**検索設定（RetrievalConfig）** — 記憶を検索するときのルール:

```python
RETRIEVAL_CONFIG = {
    "/facts/{actorId}/": RetrievalConfig(
        top_k=10,             # 最大10件取得（事実は多めに）
        relevance_score=0.3,  # 関連度30%以上でヒット（幅広く）
    ),
    # ↑ TSでいう { limit: 10, threshold: 0.3 }
    #   Laravelでいう ->take(10)->where('score', '>=', 0.3)
    "/summaries/{actorId}/{sessionId}/": RetrievalConfig(
        top_k=5,
        relevance_score=0.5,  # 中程度
    ),
    "/preferences/{actorId}/": RetrievalConfig(
        top_k=5,
        relevance_score=0.7,  # 好みは確信度が高いものだけ
    ),
}
```

**ヘルパー関数:**

```python
def create_memory(region_name="us-east-1") -> str:
    """Memory リソースを作成して ID を返す"""
    client = MemoryClient(region_name=region_name)
    # ↑ TSなら new MemoryClient({ region: "us-east-1" })
    #   Laravelなら new MemoryClient(['region' => 'us-east-1'])
    memory = client.create_memory_and_wait(
        name=MEMORY_NAME,
        strategies=MEMORY_STRATEGIES,  # ← 3つのノートの設定を渡す
    )
    return memory["id"]

def create_session_manager(memory_id, session_id, actor_id) -> AgentCoreMemorySessionManager:
    """Agent に渡す SessionManager を生成する"""
    # SessionManager = 記憶の読み書きを仲介するオブジェクト
    # TSでいう middleware、Laravelでいう Service Provider に近い
```

### 2.2 `packages/infra/lib/memory-stack.ts` — 記憶機能の「許可証」（新規作成）

| 項目 | 内容 |
|---|---|
| これは何か | エージェントが Memory API を使えるようにするための IAM 権限定義 |
| なぜ必要か | 権限がないとエージェントが記憶の読み書きをしようとしてもAWSに拒否される |
| 中身の要点 | RuntimeStack のロールに Memory 関連の API アクセスを許可するポリシーを追加 |
| 関連技術 | AWS CDK（TypeScript） |

TSでいう **CDK のカスタムスタッククラス**（`extends cdk.Stack`）です。LaravelでいうとDBマイグレーションに近い位置づけ — 「このリソースを使いたいから権限をください」という宣言を書いています。

AgentCore Memory は **CDK でリソースを作る必要がありません**。S3バケット（StorageStack）は CDK で「バケットを作ってね」とAWSに指示しましたが、Memory は **Python コード側で `create_memory_and_wait()` を呼んで作成する**。CDK で必要なのは「使う許可」だけです。

```typescript
// 「記憶の読み書きを許可してね」とAWSに宣言する
props.runtimeRole.addToPrincipalPolicy(
  new iam.PolicyStatement({
    actions: [
      "bedrock:CreateAgentCoreMemory",     // 記憶を保存する
      "bedrock:RetrieveAgentCoreMemory",   // 記憶を検索する
      "bedrock:DeleteAgentCoreMemory",     // 記憶を削除する
      "bedrock:ListAgentCoreMemories",     // 記憶の一覧を取得する
      // ↑ Laravelでいう Storage::put / get / delete / files に対応
      //   TSでいう CRUD 操作の API 権限
    ],
    resources: ["*"],  // サンプルでは全リソースを許可（本番では制限する）
  })
);
```

**なぜ `runtimeRole` に追加するのか？** TASK-007 で作った RuntimeStack の IAM ロール（社員証）に「Memory も使えますよ」という権限を追記する形です。新しいロールを作るのではなく、既存のロールに機能を追加しています。Laravelでいうと、既存の Gate / Policy に新しいアビリティを追加するイメージです。

### 2.3 `packages/infra/bin/app.ts` — CDK アプリのエントリポイント（変更）

| 項目 | 内容 |
|---|---|
| これは何か | CDK アプリ全体の「起動スクリプト」。どのスタックを作るか決める |
| なぜ必要か | MemoryStack を追加しないと `cdk deploy` で認識されない |
| 中身の要点 | MemoryStack のインポートとインスタンス化を追加 |
| 関連技術 | AWS CDK（TypeScript） |

TSでいう `index.ts`（エントリポイント）、Laravelでいう `routes/web.php`（ルート定義）に近い役割。

```typescript
const memoryStack = new MemoryStack(app, "MemoryStack", {
  runtimeRole: runtimeStack.runtimeRole,
  // ↑ RuntimeStack のロール（社員証）を渡して「ここに権限を追加してね」と依頼
});
memoryStack.addDependency(runtimeStack);
// ↑ 「RuntimeStack が先にデプロイされてからMemoryStackをデプロイしてね」という順番指定
```

### 2.4 `packages/agents/analyst/src/analyst/agent.py` — 分析エージェント（変更）

| 項目 | 内容 |
|---|---|
| これは何か | 天気データを分析するエージェントの定義ファイル |
| なぜ必要か | Memory 連携を追加しないと「先週のデータと比較して」に答えられない |
| 中身の要点 | `session_manager` パラメータで Memory を有効化 |
| 関連技術 | Strands Agents SDK / AgentCore Memory（Python） |

```python
from shared.memory import create_session_manager
# ↑ 共通モジュールから SessionManager 生成関数をインポート

def create_analyst_agent(memory_id, session_id, actor_id) -> Agent:
    session_manager = create_session_manager(
        memory_id=memory_id,       # どの Memory リソースを使うか
        session_id=session_id,     # 今回の会話の ID
        actor_id=actor_id,         # ユーザーの ID
    )
    return Agent(
        system_prompt=SYSTEM_PROMPT,
        tools=[_code_interpreter_provider.code_interpreter, save_to_s3],
        session_manager=session_manager,  # ← これで STM + LTM が有効になる
        # ↑ TSでいう middleware を挟むイメージ
        #   Laravelでいう ->middleware(['memory']) に近い
    )
```

**以前の `memory=MemoryClient(...)` との違い:** SDK の正式な API は `session_manager` パラメータに `AgentCoreMemorySessionManager` を渡す方式。これにより STM（短期記憶）と LTM（Memory Strategy による長期記憶）の両方が有効になります。

### 2.5 `packages/agents/crosscut/src/crosscut/agent.py` — 横断分析エージェント（変更）

| 項目 | 内容 |
|---|---|
| これは何か | 複数都市の天気データを比較する横断分析エージェント |
| なぜ必要か | 過去の横断比較結果を記憶し、トレンドの変化を追跡するため |
| 中身の要点 | analyst と同じ memory_id で Memory を共有 |
| 関連技術 | Strands Agents SDK / AgentCore Memory（Python） |

analyst と全く同じパターン。**同じ `memory_id` を渡す** ことで、analyst が保存した事実情報を crosscut がセマンティック検索で横断参照できます。

### 2.6 `orchestrator/agent.py` + `__main__.py` — オーケストレータ（変更）

| 項目 | 内容 |
|---|---|
| これは何か | 4エージェントを統合するオーケストレータ |
| なぜ必要か | analyst/crosscut のファクトリ関数のシグネチャが変わったため対応が必要 |
| 中身の要点 | memory_id / session_id / actor_id を受け取り、analyst / crosscut に渡す |
| 関連技術 | Strands Agents SDK（Python） |

オーケストレータ自体は Memory を使いませんが、子エージェント（analyst / crosscut）に Memory の情報を「バトンリレー」します。collector / alert は記憶不要なので引数なしのまま。

```python
def create_orchestrator(memory_id, session_id, actor_id) -> Agent:
    collector = create_collector_agent()         # Memory なし
    analyst = create_analyst_agent(              # Memory あり
        memory_id=memory_id, session_id=session_id, actor_id=actor_id,
    )
    crosscut = create_crosscut_agent(            # Memory あり（同じ memory_id）
        memory_id=memory_id, session_id=session_id, actor_id=actor_id,
    )
    alert_agent = create_alert_agent()           # Memory なし
```

### 2.7 各 `__main__.py` — CLI エントリポイント（変更）

| 項目 | 内容 |
|---|---|
| これは何か | `uv run python -m analyst` 等で起動する対話ループ |
| なぜ必要か | 起動時に Memory リソースの作成とセッション情報の生成が必要になった |
| 中身の要点 | `create_memory()` で Memory 作成、UUID でセッション ID 生成 |
| 関連技術 | AgentCore Memory SDK / 素の Python |

```python
# 起動時に1回だけ Memory を作成
memory_id = create_memory()
session_id = f"analyst-session-{uuid.uuid4().hex[:8]}"
# ↑ TSでいう crypto.randomUUID()
#   Laravelでいう Str::uuid()
actor_id = "local-user"  # 本番ではログインユーザーの ID を使う

agent = create_analyst_agent(memory_id=memory_id, session_id=session_id, actor_id=actor_id)
```

---

## 3. ファイル間の関係図

```
packages/infra/（CDK — TypeScript）         packages/agents/（エージェント — Python）
┌──────────────────────┐
│ bin/app.ts           │                  ┌─────────────────────────┐
│ (エントリポイント)    │                  │ shared/memory.py        │
│                      │                  │ (Memory Strategy 定義)  │
│ StorageStack ──→ S3  │                  │ (共通設定)              │
│   ↓                  │                  └────────┬────────────────┘
│ RuntimeStack ──→ IAM │                           │  インポート
│   ↓                  │                    ┌──────┴───────┐
│ MemoryStack ──→ 権限 │                    ↓              ↓
│                      │             analyst/agent.py  crosscut/agent.py
└──────────────────────┘             (Memory有)        (Memory有)
                                       ↕ 同じ memory_id を共有 ↕
                                          ↑              ↑
                                          │   バトンリレー │
                                    ┌─────┴──────────────┴─────┐
                                    │ orchestrator/agent.py     │
                                    │ memory_id を受け取り      │
                                    │ analyst / crosscut に渡す │
                                    └──────────────────────────┘

__main__.py が起動時に:
  1. create_memory() で Memory リソースを作成 → memory_id 取得
  2. session_id / actor_id を生成
  3. orchestrator に渡す → orchestrator が analyst / crosscut に配る
```

---

## 4. 今回登場した技術・用語の解説

### AgentCore Memory（エージェントコア メモリ）

**それは何か:** エージェントに「記憶力」を与える AWS のサービス。会話の内容を保存し、後から「あのときの分析結果は？」とセマンティック検索（意味で探す検索）できる。

**なぜ使うか:** Memory がないエージェントは毎回の会話が「初対面」。Memory があれば過去の会話を検索して回答できる。

**日常の例え:** スマホの検索履歴。「前に調べたあのサイト何だっけ」と思ったとき、検索履歴から見つけられる。Memory はエージェント版の検索履歴。

### STM（短期記憶）と LTM（長期記憶）

**それは何か:** Memory には2種類ある。

| 種類 | 正式名称 | 保存場所 | 検索方法 | 日常の例え |
|---|---|---|---|---|
| **STM** | Short-Term Memory | 会話セッション内 | 直接参照 | メモ帳に書いた走り書き |
| **LTM** | Long-Term Memory | 永続ストレージ | セマンティック検索 | ノートにまとめた要約 |

**なぜ2種類あるか:** 会話中の「さっき言ったやつ」（STM）と、数日後の「先週の分析結果は？」（LTM）では、検索の仕方が違うから。

### Memory Strategy（メモリ戦略）

**それは何か:** STM → LTM への自動変換ルール。3種類ある:

| Strategy | 何をするか | 日常の例え |
|---|---|---|
| **semanticMemoryStrategy** | 会話から事実情報を抽出して保存 | 授業ノートにキーワードをメモ |
| **summaryMemoryStrategy** | セッション全体を要約して保存 | 1日の日記を書く |
| **userPreferenceMemoryStrategy** | ユーザーの好みを自動学習 | 「この人は辛いものが好き」と覚える |

**なぜ3つに分けるか:** 検索のしかたが違うから。「先週の気温は？」→ 事実ノート、「昨日何を分析した？」→ 要約ノート、「グラフは何がいい？」→ 好みノート。

### AgentCoreMemorySessionManager

**それは何か:** Agent に渡す「記憶の仲介人」オブジェクト。会話の保存・検索を自動管理する。

**なぜ使うか:** `Agent(session_manager=...)` と渡すだけで、SDKが自動的に:
1. 会話をSTMに保存
2. Memory Strategyに従ってLTMに変換
3. 新しい会話の開始時にLTMから関連情報を検索してコンテキストに注入

TSでいうと Express の middleware、Laravelでいうと Middleware（リクエスト前後に処理を挟む）に近い。

### RetrievalConfig（検索設定）

**それは何か:** 記憶を検索するときのパラメータ。

| パラメータ | 意味 | 設定値例 |
|---|---|---|
| `top_k` | 最大何件取得するか | 10件（事実）/ 5件（要約・好み） |
| `relevance_score` | 最低何%の関連度でヒットとみなすか | 0.3（30%）〜 0.7（70%） |

**なぜ namespace ごとに違う値にするか:** 事実は幅広く取得したい（低い閾値 0.3）、好みは確信度の高いものだけ欲しい（高い閾値 0.7）。

### セマンティック検索

**それは何か:** キーワードの完全一致ではなく、「意味」で検索する技術。「東京の気温が高かった日」と検索すると、「東京は最高気温35度を記録」という記憶がヒットする。

TSでいうと Algolia / Elasticsearch のファジー検索に近い。LaravelでいうとLaravel Scout の全文検索に近いが、さらに「意味の近さ」で検索できる点が進化している。

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップ対応

| Lab | 関連内容 |
|---|---|
| **Lab 3** | AgentCore Memory の STM/LTM、Memory Strategy の定義と利用 |

Lab 3 の中心テーマは「エージェントに記憶を持たせる」こと。今回の TASK-009 は、Lab 3 で学ぶ Memory の概念を CDK + Python で実装したものです。

### 本番構成との対応

| 本番構成 | サンプル構成 | 状態 |
|---|---|---|
| AgentCore Memory（環境ごとに namespace 分離） | 単一 Memory リソース | 簡略版 |
| Memory Strategy 3種類（カスタマイズあり） | Memory Strategy 3種類（デフォルト設定） | ほぼ再現 |
| Memory ID を環境変数 / Parameter Store で管理 | 起動時に毎回 `create_memory()` | 簡略版 |
| Memory API の IAM 権限（最小権限） | `resources: ["*"]`（全リソース許可） | 簡略版 |

### 本番との違い（簡略化した部分）

| 項目 | 本番 | サンプル | 理由 |
|---|---|---|---|
| Memory ID 管理 | 環境変数 / Parameter Store | 毎回新規作成 | インフラ管理の複雑さを避けるため |
| namespace | 環境別に分離 | テンプレート変数のみ | 環境が1つしかないため |
| IAM 権限 | 特定リソースに限定 | 全リソース `"*"` | 複雑さを避けるため |
| Memory 保持期間 | ビジネス要件に応じてカスタム | デフォルト | 学習用のため設定不要 |

---

## 6. 次のタスクへのつながり

```
TASK-009（今回）                    次のタスクたち
Memory（記憶力 + Strategy）を追加
  │
  ├──→ TASK-010: ObservabilityStack
  │     └─ CloudWatch で「記憶の使用量・検索レイテンシ」も監視できるようになる
  │       （Laravelでいう Telescope で Cache のヒット率を見るようなもの）
  │
  ├──→ TASK-013: OrchestrationStack（Step Functions）
  │     └─ Step Functions から呼ばれるエージェントも Memory を使える
  │       「昨日の自動分析結果」を記憶から引き出して比較分析
  │
  └──→ TASK-014: GatewayStack（Gateway + Guardrails）
        └─ Gateway 経由で外部からエージェントを呼ぶ際にも
           Memory が有効 — ユーザーごとのセッション記憶が可能
```

今回追加した Memory + Memory Strategy は、以降のすべてのタスクでエージェントの「賢さ」の土台になります。「データを取得して分析する」だけだった一回限りのエージェントが、「過去の分析を踏まえて比較・改善提案する」継続的なアシスタントに進化する第一歩です。

特に Memory Strategy の3つのノート（事実・要約・好み）は、ユーザーが使い込むほど賢くなるエージェントの基盤です。

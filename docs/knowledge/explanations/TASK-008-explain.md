# TASK-008 解説: AgentCore Runtime デプロイ

## 1. このタスクで何を作ったか

**ローカルPCで動かしていたエージェントを「AWSクラウドに送り出す手順書」と「ちゃんと届いたか確認するスクリプト」を作った。**

TASK-001〜006 で作ったエージェント（Python）はずっと自分のPC上で動いていました。TASK-007 でクラウド上に「部屋」（S3バケット）と「社員証」（IAMロール）を用意しました。今回は、その部屋にエージェントを「引っ越しさせる手順」と「引っ越し後の動作チェック」を作りました。

日常の例えでいうと、「引越し業者への依頼手順書」と「引越し後にガス・水道・電気が使えるか確認するチェックリスト」を作ったイメージです。

---

## 2. 作成・変更したファイル一覧

### 2.1 `packages/agents/deploy/README.md` — デプロイ手順書

| 項目       | 内容                                                     |
| ---------- | -------------------------------------------------------- |
| これは何か | エージェントをクラウドにデプロイするための手順書         |
| なぜ必要か | デプロイ手順を知らないとクラウドにエージェントを送れない |
| 関連技術   | AWS（AgentCore CLI、CloudFormation）                     |

LaravelプロジェクトでいうREADMEの「デプロイ手順」セクションに相当します。Laravelだと `php artisan serve` → `本番サーバーに rsync` → `php artisan migrate` のような流れがあるように、AgentCore にも決まったデプロイの流れがあります。

**手順の全体像:**

```
Step 1: IAMロールARNを確認
  └─ TASK-007 で作った「社員証」の番号を調べる

Step 2: agentcore deploy を実行
  └─ ローカルのコードをクラウドに送る（docker push に近い）

Step 3: エンドポイントURLを確認
  └─ クラウド上のエージェントの「住所」を受け取る

Step 4: 動作確認
  └─ verify_endpoint.py で「ちゃんと動くか」チェック
```

**ポイントとなるコマンド:**

```bash
# エージェントコードをクラウドにプッシュ
agentcore deploy \
  --role-arn <RuntimeRoleArn> \     # ← TASK-007で作ったIAMロール
  --agents collector,analyst,crosscut,alert,orchestrator
# ↑ TSでいう npm publish に似ているが、送り先はnpmレジストリではなくAWSクラウド
#   Laravelでいう Envoyer / Forge でのデプロイに近い
```

> **重要な学習ポイント:** `agentcore deploy` の最大の特徴は **コードの変更が不要** なこと。ローカルで `uv run python -m collector` と動かしていたコードが、一切の修正なしにクラウドで動きます。Laravelでも `php artisan serve`（ローカル）と本番サーバー（Nginx + PHP-FPM）で同じコードが動きますが、設定ファイルの変更が必要です。AgentCore ではそれすら不要です。

### 2.2 `packages/agents/deploy/verify_endpoint.py` — 動作確認スクリプト

| 項目       | 内容                                                               |
| ---------- | ------------------------------------------------------------------ |
| これは何か | クラウドにデプロイしたエージェントが正しく動くか確認するスクリプト |
| なぜ必要か | デプロイしただけでは動くかわからない。自動テストで確認する         |
| 関連技術   | AWS（AgentCore Client）/ 素の Python                               |

TSでいう `scripts/smoke-test.ts`（デプロイ後の疎通確認スクリプト）、Laravelでいう `php artisan tinker` で本番DBに繋がるか確認するのに似ています。

**スクリプトの流れ:**

```python
# 1. AgentCore クライアントを初期化
from agentcore import AgentCoreClient   # ← TSなら new AWS.AgentCoreClient()
                                         #    Laravelなら new AgentCoreClient()
client = AgentCoreClient(endpoint_url="https://xxxxx.agentcore.aws")

# 2. 各エージェントに「テスト質問」を投げる
response = client.invoke_agent(
    agent_name="collector",                       # どのエージェントを呼ぶか
    message="東京の今日の天気を教えて",             # ローカルと同じ質問
    session_id="verify-abc12345",                 # セッションID（後述）
)
# ↑ TSでいう fetch("https://api.example.com/agents/collector", { body: ... })
#   Laravelでいう Http::post("https://api.example.com/agents/collector", [...])
```

**3つのエージェントを順番にチェック:**

| #   | エージェント | テストメッセージ                     | 確認したいこと                       |
| --- | ------------ | ------------------------------------ | ------------------------------------ |
| 1   | collector    | 「東京の今日の天気を教えて」         | 天気API呼び出しが動くか              |
| 2   | analyst      | 「気温データの平均と傾向を分析して」 | Code Interpreter が動くか            |
| 3   | orchestrator | 「東京と大阪の天気を比較して」       | A2A連携（4エージェント統合）が動くか |

**argparse でコマンドライン引数を処理:**

```python
parser = argparse.ArgumentParser(...)
parser.add_argument("--endpoint", required=True, ...)
parser.add_argument("--session-id", default=None, ...)
# ↑ TSでいう commander / yargs でCLI引数をパース
#   Laravelでいう Artisan コマンドの signature 定義に近い
```

---

## 3. ファイル間の関係図

```
packages/agents/deploy/
├── README.md              ─── デプロイ手順書（人間が読む）
└── verify_endpoint.py     ─── 動作確認スクリプト（プログラムが実行する）

依存関係:

README.md
  │  「Step 4: verify_endpoint.py を実行してね」
  ▼
verify_endpoint.py
  │  AgentCoreClient を使って HTTPS リクエストを送る
  ▼
AgentCore Runtime（AWS クラウド上）
  ├── collector エージェント     ← TASK-002〜003 で作ったコード
  ├── analyst エージェント       ← TASK-004 で作ったコード
  ├── crosscut エージェント      ← TASK-005 で作ったコード
  ├── alert エージェント         ← TASK-005 で作ったコード
  └── orchestrator              ← TASK-006 で作ったコード
        │
        ▼
  IAM ロール（TASK-007 RuntimeStack で定義）
  ├── S3 読み書き ──→ S3バケット（TASK-007 StorageStack で定義）
  └── Bedrock 呼び出し ──→ Claude などの AI モデル
```

**全体の流れ:**

```
ローカルPC                      AWSクラウド
┌──────────┐   agentcore deploy   ┌───────────────────┐
│ Python   │  ───────────────→   │  AgentCore Runtime │
│ コード   │                      │  (microVM 内)      │
└──────────┘                      └───────────────────┘
                                         ↑
┌──────────────────┐   HTTPS        │
│ verify_endpoint  │  ──────────→   │
│ .py              │   invoke_agent()
└──────────────────┘
```

---

## 4. 今回登場した技術・用語の解説

### agentcore deploy

**それは何か:** ローカルのエージェントコードをAWSクラウド（AgentCore Runtime）に送るコマンド。

**なぜ使うか:** エージェントをクラウドで動かすため。TSでいう `npm publish` + `docker push` を合わせたようなコマンド。Laravelでいう Envoyer / Forge でのデプロイボタンに相当。

**特徴:** コードの変更が不要。ローカルで動くコードがそのままクラウドで動く。

### microVM（マイクロVM）

**それは何か:** 超軽量な仮想マシン。Dockerコンテナよりさらに隔離性が高い。

**なぜ使うか:** ユーザーAとユーザーBが同じエージェントを使っても、メモリやファイルが完全に分離される（情報漏洩を防ぐ）。TSでいう Web Worker が独立したメモリ空間を持つのに似ているが、OSレベルで隔離される点がより強力。

```
普通のサーバー:  ユーザーA ─┐
                           ├── 同じプロセス（メモリ共有の危険あり）
                ユーザーB ─┘

microVM:         ユーザーA ─→ VM-A（完全に独立した仮想マシン）
                ユーザーB ─→ VM-B（完全に独立した仮想マシン）
```

### session_id（セッションID）

**それは何か:** どの microVM を使うかを決める識別子。同じ session_id なら同じ VM で会話が続く。

**なぜ使うか:** 「さっきの天気の続きを分析して」のように会話を継続するため。Laravelでいう `session()->getId()` やブラウザの Cookie に保存されるセッション ID と同じ概念。

### invoke_agent()

**それは何か:** クラウド上のエージェントに HTTPS でメッセージを送る API。

**なぜ使うか:** ローカルでは `agent("東京の天気")` と直接呼べたが、クラウドでは HTTPS 経由で呼ぶ必要がある。TSでいう `fetch()` で REST API を叩くのと同じ。Laravelでいう `Http::post()` に相当。

### IAM Signature V4

**それは何か:** AWS の標準的な認証方式。リクエストに「自分が誰か」の署名をつける仕組み。

**なぜ使うか:** エンドポイントに誰でもアクセスできてしまうと危険。APIキーの代わりに AWS の認証情報で本人確認する。Laravelでいう `auth:sanctum` ミドルウェアで API を保護するのに似ている。

### argparse（標準ライブラリ）

**それは何か:** Python の「コマンドライン引数を解析する」標準ライブラリ。

**なぜ使うか:** `--endpoint https://xxx` のようにオプションを受け取るため。TSでいう `commander` / `yargs` パッケージ、Laravelでいう Artisan コマンドの `$signature` に相当。Python では標準ライブラリに含まれているため追加インストール不要。

---

## 5. ワークショップ・本番構成との対応

### AgentCore ワークショップ対応

| Lab       | 関連内容                                            |
| --------- | --------------------------------------------------- |
| **Lab 2** | AgentCore Runtime にデプロイしてHTTPS経由で呼び出す |

Lab 2 の中心テーマは「ローカルのコードをそのままクラウドにデプロイする」こと。今回の TASK-008 はまさにその手順を形にしたものです。

### 本番構成との対応（architecture-comparison.md より）

| 本番構成                        | サンプル構成            | 状態 |
| ------------------------------- | ----------------------- | ---- |
| AgentCore Runtime (microVM隔離) | デプロイ手順 + 動作確認 | 再現 |

### 本番との違い（簡略化した部分）

| 項目         | 本番                                      | サンプル                                       | 理由                              |
| ------------ | ----------------------------------------- | ---------------------------------------------- | --------------------------------- |
| 呼び出し元   | Step Functions → invoke_agent()           | verify_endpoint.py（手動）                     | Step Functions は TASK-013 で構築 |
| ネットワーク | VPC + PrivateLink（社内ネットワーク経由） | パブリックエンドポイント（インターネット経由） | ネットワーク構成の簡略化          |
| スケーリング | AutoScaling 設定済み                      | デフォルト設定                                 | 学習用のためトラフィックが少ない  |
| 監視         | CloudWatch ダッシュボード + アラーム      | なし（TASK-010 で追加）                        | 段階的に構築                      |

---

## 6. 次のタスクへのつながり

```
TASK-008（今回）                 次のタスクたち
デプロイ手順 + 動作確認
  │
  ├──→ TASK-009: MemoryStack
  │     └─ エージェントに「記憶力」を追加する
  │       （「さっき聞いた天気の続き」を覚えていられるようになる）
  │
  ├──→ TASK-010: ObservabilityStack
  │     └─ CloudWatch で「エージェントがちゃんと動いているか」を監視する
  │       （Laravelでいう Telescope / Horizon ダッシュボードのようなもの）
  │
  └──→ TASK-013: OrchestrationStack（Step Functions）
        └─ 今回の verify_endpoint.py は「手動確認」だったが、
           TASK-013 では Step Functions が「自動で」エージェントを呼び出す
           （Laravelでいう Job Queue / Scheduler に相当）
```

今回作った `invoke_agent()` の呼び出しパターンは、TASK-013 の Step Functions でも同じ形で使われます。手動テストで動作確認した呼び出し方を、そのまま自動化するイメージです。

agentcore configure -n collector_container -r ap-northeast-1 -ni

uv run python -c "import boto3, json; client = boto3.client('bedrock-agentcore', region_name='ap-northeast-1'); resp = client.invoke_agent_runtime agentRuntimeArn='arn:aws:bedrock-agentcore:ap-northeast-1:187363817007:runtime/collector_containe r-eHsW8ADWd6',runtimeSessionId='test-session-00000000000000000000001', payload=json.dumps({'input': {'prompt': 'hello'}}), qualifier='DEFAULT'); print(json.loads(resp['response'].read()))"

aws logs describe-log-groups --log-group-name-prefix "/aws/bedrock-agentcore/runtimes/collector_container" --region ap-northeast-1

aws logs tail /aws/bedrock-agentcore/runtimes/collector_container-eHsW8ADWd6-DEFAULT --since 10m --region ap-northeast-1

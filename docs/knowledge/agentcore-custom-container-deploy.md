# AgentCore Runtime カスタムコンテナデプロイのナレッジ

## 背景

agentcore CLI の自動ビルド（`agentcore deploy`）は uv ワークスペース（モノレポ）に対応していない。
カスタム Dockerfile + ECR プッシュ + boto3 で Runtime を作成する方法が必要。

## ハマりポイントと解決策

### 1. direct_code_deploy の30秒タイムアウト

**症状:** `Runtime initialization time exceeded. Please make sure that initialization completes in 30s`
**原因:** Strands SDK + 依存パッケージの読み込みが30秒を超える
**解決策:** コンテナデプロイに切り替える（依存が事前ビルドされるため起動が速い）

### 2. agentcore CLI がモノレポに非対応

**症状:** `Multiple top-level packages discovered in a flat-layout`
**原因:** agentcore がビルドコンテキストをワークスペースルートに展開し、ルートの pyproject.toml をインストールしようとする
**解決策:** カスタム Dockerfile で shared と collector を個別にインストール

### 3. IAMロールの信頼ポリシー

**症状:** `Role validation failed`
**原因:** サービスプリンシパルが `bedrock.amazonaws.com` ではない
**解決策:** `bedrock-agentcore.amazonaws.com` を使用する

### 4. IAMロールの description に日本語が使えない

**症状:** `Value at 'description' failed to satisfy constraint`
**解決策:** description は英語で記述する

### 5. artifact type の変更不可

**症状:** `Agent artifact type cannot be updated`
**原因:** direct_code_deploy → container に切り替えられない
**解決策:** 新しい名前で Runtime を作成する

### 6. CloudWatch ログが出ない

**症状:** ロググループが存在しない、ログが一切出力されない
**原因:** カスタムコンテナデプロイではログ配信（Vended Logs V2）を明示的に設定する必要がある
**解決策:** boto3 の `put_delivery_source` / `put_delivery_destination` / `create_delivery` でログ配信を設定する
**注意:** CDK（CloudFormation）では `bedrock-agentcore:AllowVendedLogDeliveryForResource` 権限の問題で設定できない場合がある

### 7. FastAPI エンドポイントの422エラー

**症状:** `Received error (422) from runtime`
**原因:** Pydantic モデルでリクエストを受けるとバリデーションエラー
**解決策:** `Request` を直接受け取り、生のJSONをパースする

## デプロイ手順（確定版）

```bash
cd packages/agents/collector

# 1. Docker ビルド（ARM64、ビルドコンテキストは packages/agents/）
docker buildx build --platform linux/arm64 -f Dockerfile -t <ecr-uri>:<tag> --load ..

# 2. ECR にプッシュ
aws ecr get-login-password --region ap-northeast-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-northeast-1.amazonaws.com
docker push <ecr-uri>:<tag>

# 3. Runtime 作成/更新（boto3: deploy_runtime.py）
uv run python deploy_runtime.py --region ap-northeast-1 --container-uri <ecr-uri>:<tag> --role-arn <role-arn> --agent-name <name>

# 4. ログ配信設定（boto3: setup_observability.py）※初回のみ
uv run python setup_observability.py

# 5. 動作確認
uv run python invoke_test.py
```

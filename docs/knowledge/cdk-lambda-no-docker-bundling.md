# CDK Lambda バンドリングで Docker が使えない場合の対処法

## 背景

devcontainer 環境では Docker-in-Docker が使えないため、CDK の `lambda.Code.fromAsset()` で `bundling` オプションを指定すると `spawnSync docker ENOENT` エラーが発生する。

## 解決策

バンドリングを使わず、事前ビルドしたディレクトリを直接参照する。

```typescript
// NG: Docker が必要
code: lambda.Code.fromAsset("../../packages/agents", {
  bundling: { image: lambda.Runtime.PYTHON_3_12.bundlingImage, ... },
})

// OK: 事前ビルドしたディレクトリを参照
code: lambda.Code.fromAsset("../../packages/agents/lambda-package")
```

## ビルド手順

デプロイ前に以下を実行してパッケージをビルドする:

```bash
cd packages/agents
pip install --target lambda-package ./shared ./collector ./lambdas
```

## 注意点

- `lambda-package/` は `.gitignore` に追加する（ビルド成果物のため）
- `logRetention` プロパティは非推奨。`logGroup` を使う

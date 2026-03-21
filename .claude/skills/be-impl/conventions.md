# バックエンド コーディング規約

## API設計

- RESTful API設計に従う
- エンドポイントは複数形名詞を使用する（例: `/api/documents`）
- HTTPメソッドを適切に使い分ける（GET/POST/PUT/DELETE）
- レスポンスは統一したJSON構造を返す

## レスポンス形式

```typescript
// 成功時
{ data: T }

// エラー時
{ error: { code: string; message: string } }
```

## エラーハンドリング

- API Routeではtry-catchで例外を捕捉する
- HTTPステータスコードを適切に返す（400, 401, 404, 500等）
- エラーメッセージはクライアントに安全な内容のみ返す
- サーバー側のスタックトレースはレスポンスに含めない

## データベースアクセス

- Prisma Clientを使用する
- クエリはService層に集約する（API Routeに直接書かない）
- トランザクションが必要な操作は `prisma.$transaction()` を使用する
- N+1問題を避けるため `include` / `select` を適切に使用する

## バリデーション

- リクエストボディは型ガードまたはバリデーションライブラリで検証する
- パスパラメータ・クエリパラメータも検証する
- バリデーションエラーは400 Bad Requestで返す

## セキュリティ

- 環境変数は `process.env` から取得し、ハードコードしない
- SQLインジェクション対策: Prismaのパラメータバインディングを使用する
- 認証が必要なエンドポイントにはミドルウェアで認証チェックを入れる

## ディレクトリ構成

```
src/
  app/api/       - Next.js API Routes
  lib/
    services/    - ビジネスロジック
    prisma.ts    - Prisma Client インスタンス
    validators/  - バリデーション関数
prisma/
  schema.prisma  - DBスキーマ定義
  migrations/    - マイグレーションファイル
```

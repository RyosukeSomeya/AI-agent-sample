# フロントエンド コーディング規約

## コンポーネント設計

- React関数コンポーネント + hooksを使用する
- コンポーネントファイルは1ファイル1コンポーネントとする
- propsの型定義はコンポーネントと同ファイルに記述する
- `export default` は使用せず、named exportを使用する

## 命名規則

- コンポーネント: PascalCase（例: `DocumentList.tsx`）
- hooks: camelCase + `use` prefix（例: `useDocuments.ts`）
- ユーティリティ: camelCase（例: `formatDate.ts`）
- 型定義: PascalCase + 用途に応じたsuffix（例: `DocumentListProps`）
- CSSモジュール: コンポーネントと同名（例: `DocumentList.module.css`）

## ディレクトリ構成

```
src/
  app/           - Next.js App Router ページ
  components/    - UIコンポーネント
    ui/          - 汎用UIコンポーネント（Button, Modal等）
    features/    - 機能固有コンポーネント
  hooks/         - カスタムhooks
  types/         - 共有型定義
```

## 状態管理

- サーバー状態: fetch + React Server Components を優先
- クライアント状態: useState / useReducer を使用
- グローバル状態: 必要最小限にとどめる

## スタイリング

- Tailwind CSS または CSS Modules を使用する
- インラインスタイルは使用しない
- レスポンシブ対応はモバイルファーストで記述する

## アクセシビリティ

- インタラクティブ要素には適切なaria属性を付与する
- 画像にはalt属性を必ず設定する
- キーボード操作に対応する

---
name: project-init
description: 新規プロジェクトの初期セットアップを行う。ヒアリングに応じてCLAUDE.mdと規約ファイルの雛形を生成し、ディレクトリ構成を整える。プロジェクト初期化、project-init、初期設定、新規プロジェクトセットアップなどのキーワードで使用する。
---

# プロジェクト初期セットアップスキル

ヒアリングを通じてプロジェクト情報を収集し、標準テンプレートから `CLAUDE.md` と規約ファイルの雛形を生成する。

> **既存プロジェクトの場合は `/analyze-codebase` を使用する。**

## 実行タイミング

- 新規プロジェクトの開発開始前（`CLAUDE.md` がまだない状態）
- 既存の `CLAUDE.md` がある場合は上書き確認をしてから進む

## ヒアリング手順

`AskUserQuestion` を使い、以下の順序で情報を収集する。一度に全部聞かず、関連する質問をグループ化して進める。

### グループ1: プロジェクト基本情報

- プロジェクト名
- プロジェクトの概要（何を作るか）
- モノレポか通常リポジトリか

モノレポの場合は追加ヒアリング：
- パッケージ構成（パッケージ名と役割の一覧）

### グループ2: 技術スタック

- フレームワーク（Next.js / React / Vue / Express / NestJS 等）
- 言語（TypeScript / JavaScript 等）
- DB・ORM（PostgreSQL + Prisma / MySQL / MongoDB 等、なければ「なし」）
- パッケージマネージャー（yarn / npm / pnpm / bun）
- その他の主要ライブラリ（任意）

`package.json` が既に存在する場合は読み込んで自動検出を試みる。

### グループ3: 開発スタイル

- 実装コマンドの使い方を選択する
  - **フルスタック・分業なし** → `/implement` を使用（`implement/conventions.md` を生成）
  - **FE/BE完全分業** → `/fe-impl` + `/be-impl` を使用（各 `conventions.md` を生成）

### グループ4: コミュニケーション

- AIへの指示・回答の言語（日本語 / 英語 / その他）

## 生成フロー

ヒアリング完了後、以下を順に実行する。

### 1. CLAUDE.md の生成

`.claude/skills/project-init/templates/CLAUDE.md.template` を読み込み、以下の処理を行う。

- ヒアリング結果を `{{...}}` プレースホルダーに埋め込む
- 通常リポジトリの場合は `<!-- [monorepo-only] -->` ～ `<!-- [/monorepo-only] -->` ブロックを削除する
- モノレポの場合は各パッケージの `CLAUDE.md` も生成する（`CLAUDE.package.template` を使用）

### 2. 規約ファイルの雛形生成

開発スタイルに応じて生成する。

| 開発スタイル | 生成するファイル |
|------------|----------------|
| フルスタック・分業なし | `.claude/skills/implement/conventions.md` |
| FE/BE完全分業 | `.claude/skills/fe-impl/conventions.md` + `.claude/skills/be-impl/conventions.md` |

既にファイルが存在する場合は上書き確認をする。

### 3. ディレクトリ構成の作成

以下を作成する（既存の場合はスキップ）。

```
docs/
  requirements/
  specs/
  designs/
  knowledge/
```

`docs/plans/` と `docs/tasks/` と `docs/analysis/` はローカル運用のため `.gitignore` に追記する（既に記載済みの場合はスキップ）。

### 4. 完了報告と次のステップ案内

生成・作成したファイルの一覧を報告し、次のステップを案内する。

```
✅ 初期セットアップ完了

生成したファイル:
- CLAUDE.md
- .claude/skills/implement/conventions.md  （または fe-impl/be-impl）
- docs/ ディレクトリ構成

次のステップ:
CLAUDE.md と規約ファイルの内容を確認・編集してから、
/requirements で要件定義を開始してください。
```

## 注意事項

- `CLAUDE.md` の内容はあくまで雛形。生成後にユーザーが内容を確認・編集することを前提とする
- 規約ファイルも雛形であり、プロジェクト固有のルールは生成後に追記する
- ヒアリングで得た情報が不明・未定の場合はプレースホルダーコメントを残す（例：`<!-- TODO: 確定後に記入 -->`）

## $ARGUMENTS

- `/project-init` - ヒアリングから開始する

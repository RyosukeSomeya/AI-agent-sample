# Claude Set

Claude Code を活用した開発ワークフロー環境の設定パッケージです。プロジェクトに導入することで、統一された AI 支援開発サイクルをすぐに使い始められます。

## 前提条件

### VS Code / Cursor での Dev Container 利用

Dev Container 機能を使うには拡張機能が必要です。

- **VS Code**: [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) 拡張機能をインストールする
- **Cursor**: Cursor の拡張機能マーケットプレイスから Dev Containers 拡張機能をインストールする

## セットアップ手順

### 1. claude-set をプロジェクトのルートに配置する

`claude-set/` ディレクトリをプロジェクトのルートディレクトリに配置します。

```
your-project/
├── claude-set/     ← ここに配置
├── src/
└── ...
```

### 2. set-up コマンドを実行する

プロジェクトのルートディレクトリで以下を実行します。

```bash
bash claude-set/set-up.sh
```

実行後、自動で以下が行われます。

- `.claude/` と `.devcontainer/` がプロジェクトルートに展開される
- `claude-set/` ディレクトリが削除される
- この README が `.claude/README.md` に移動する

```
your-project/
├── .claude/        ← 展開
├── .devcontainer/  ← 展開
├── src/
└── ...
```

## セットアップ後の使い方

### 開発サイクル

`.claude/development-guide/development-cycle.md` に開発サイクルの詳細な説明があります。
要件定義 → 仕様 → 設計 → タスク分割 → 実装 → レビュー → コミットまで、Claude Code スキルを活用したワークフローが定義されています。

### 通知の設定（macOS）

`.claude/notification-setup.md` を参照することで、Claude Code の応答完了時に macOS ネイティブ通知を受け取れるようになります。

### プロジェクトへの最適化

このパッケージは汎用的に作られています。導入後、プロジェクトの開発スタイルに合わせて以下のファイルをカスタマイズすることを推奨します。

| ファイル | 内容 |
| --- | --- |
| `CLAUDE.md` | プロジェクト全体の情報と指示（プロジェクトルートに作成） |
| `.claude/rules/*.md` | プロジェクト共通ルール（常時適用） |
| `.claude/skills/implement/conventions.md` | コーディング規約（フルスタック） |
| `.claude/skills/fe-impl/conventions.md` | FE コーディング規約 |
| `.claude/skills/be-impl/conventions.md` | BE コーディング規約 |

**新規プロジェクト**は `/project-init` スキルを、**既存プロジェクト**は `/analyze-codebase` スキルを使うと自動的にカスタマイズできます。

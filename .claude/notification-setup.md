# Claude Code 通知設定

devcontainer内でClaude Codeを使用する際、応答完了時にmacOSネイティブ通知を受け取る仕組み。

## 前提条件

- macOSに `terminal-notifier` がインストール済みであること

```bash
brew install terminal-notifier
```

## 使い方

1. **ホストMacのターミナル**でプロジェクトルートに移動し、通知サーバーを起動する

```bash
bash notify_server.sh
```

2. devcontainer内でClaude Codeを使用すると、応答完了時に自動で通知が届く

## 仕組み

- Claude Codeの応答完了時にフック（`.claude/settings.json` の `Stop`）が発火し、`.claude/notify` ファイルにメッセージを書き込む
  - `.claude/notify`は.gitignoreに追加されることを推奨します
- ホスト側の `notify_server.sh` がファイルの変更を1秒ごとに検知し、`terminal-notifier` でmacOS通知を送信する
- devcontainerではコンテナからホストへのネットワーク接続が制限されるため、共有ファイルシステム経由で通知を実現している

# ファイアウォール制約への対応ルール

devcontainer環境ではファイアウォールにより外部ドメインへのアクセスが制限されている（`docs/knowledge/devcontainer-firewall.md` 参照）。

## ルール

コマンド実行がネットワーク制限で失敗した場合：

1. **自力での解決を試みない**（リトライ・回避策の模索で時間を浪費しない）
2. **即座にユーザーに実行を依頼する**（実行すべきコマンドを提示する）
3. ユーザーの実行結果を受けて作業を継続する

## よくある該当コマンド

- `npx prisma migrate dev` / `npx prisma generate`（`binaries.prisma.sh` がブロック対象）
- 外部CDN・APIからのダウンロードを伴うコマンド
- パッケージのpostinstallスクリプトでバイナリをダウンロードするもの

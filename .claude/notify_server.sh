#!/usr/bin/env bash
# ファイル監視型の通知サーバー
# ワークスペース内の .claude/notify ファイルの変更を検知して macOS 通知を送る
#
# 使い方: ホストMacで実行
#   bash notify_server.sh
#
# 前提: terminal-notifier がインストール済み
#   brew install terminal-notifier

NOTIFY_FILE="$(cd "$(dirname "$0")" && pwd)/.claude/notify"

echo "通知サーバー起動: ${NOTIFY_FILE} を監視中..."

# 初期状態を記録
last_mod=""
if [[ -f "${NOTIFY_FILE}" ]]; then
  last_mod=$(stat -f "%m" "${NOTIFY_FILE}" 2>/dev/null || echo "")
fi

while true; do
  if [[ -f "${NOTIFY_FILE}" ]]; then
    current_mod=$(stat -f "%m" "${NOTIFY_FILE}" 2>/dev/null || echo "")
    if [[ "${current_mod}" != "${last_mod}" && -n "${current_mod}" ]]; then
      msg=$(cat "${NOTIFY_FILE}")
      if [[ -n "${msg}" ]]; then
        terminal-notifier \
          -title "ClaudeCode" \
          -message "${msg}" \
          -sound default
        echo "[$(date)] 通知送信: ${msg}"
      fi
      last_mod="${current_mod}"
    fi
  fi
  sleep 1
done

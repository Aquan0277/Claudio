#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$PROJECT_DIR/.run/ai-radio.pid"
LOG_FILE="$PROJECT_DIR/logs/ai-radio.log"
PORT="${PORT:-8080}"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "AI radio is running: pid=$PID"
  else
    echo "AI radio PID file is stale."
  fi
else
  echo "AI radio PID file not found."
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
else
  echo "Port $PORT is not listening."
fi

if command -v curl >/dev/null 2>&1; then
  echo
  echo "Settings:"
  curl -sS "http://localhost:$PORT/api/settings" || true
  echo
fi

if [[ -f "$LOG_FILE" ]]; then
  echo
  echo "Recent log:"
  tail -n 30 "$LOG_FILE" || true
fi

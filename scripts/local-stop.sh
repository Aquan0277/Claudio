#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$PROJECT_DIR/.run/ai-radio.pid"
PORT="${PORT:-8080}"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${PID:-}" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    for _ in {1..20}; do
      if ! kill -0 "$PID" 2>/dev/null; then
        break
      fi
      sleep 0.2
    done
    if kill -0 "$PID" 2>/dev/null; then
      kill -9 "$PID" 2>/dev/null || true
    fi
    echo "AI radio stopped: pid=$PID"
  else
    echo "PID file exists, but process is not running."
  fi
  rm -f "$PID_FILE"
  exit 0
fi

PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$PIDS" ]]; then
  echo "No PID file found, but port $PORT is in use:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN
  echo "Stop it manually if this is the AI radio process."
  exit 1
fi

echo "AI radio is not running."

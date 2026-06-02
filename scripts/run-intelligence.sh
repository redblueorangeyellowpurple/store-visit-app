#!/bin/bash
# Manually fire the SVA intelligence routine from any terminal.
#
# Usage (flags combine in any order):
#   ./scripts/run-intelligence.sh                          # yesterday SGT, broadcast on
#   ./scripts/run-intelligence.sh 2026-05-28               # specific date
#   ./scripts/run-intelligence.sh today                    # today SGT
#   ./scripts/run-intelligence.sh 2026-05-28 force         # regenerate even if a report exists
#   ./scripts/run-intelligence.sh 2026-05-28 nobroadcast   # backfill silently (no Telegram)

set -euo pipefail

ROUTINE_SPEC="/Users/wilsontan/Claude/tc-store-visit-app_v2/tc-sva-bot/scripts/intelligence-routine.md"

DATE_ARG=""; FORCE=""; NOBROADCAST=""
for a in "$@"; do
  case "$a" in
    force)       FORCE=1 ;;
    nobroadcast) NOBROADCAST=1 ;;
    today)       DATE_ARG=$(TZ=Asia/Singapore date +%Y-%m-%d) ;;
    yesterday)   DATE_ARG=$(TZ=Asia/Singapore date -v-1d +%Y-%m-%d) ;;
    *)           DATE_ARG="$a" ;;
  esac
done

PROMPT="Execute the routine at $ROUTINE_SPEC"
[[ -n "$DATE_ARG" ]]     && PROMPT="$PROMPT for date $DATE_ARG"
[[ -n "$FORCE" ]]        && PROMPT="$PROMPT. Use force (skip the idempotency check)"
[[ -n "$NOBROADCAST" ]]  && PROMPT="$PROMPT. Use nobroadcast (do not send any Telegram)"
PROMPT="$PROMPT."

echo "[run-intelligence] ${DATE_ARG:-yesterday}${FORCE:+ force}${NOBROADCAST:+ nobroadcast}"
claude --print --dangerously-skip-permissions "$PROMPT"

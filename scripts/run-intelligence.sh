#!/bin/bash
# Manually fire the SVA intelligence routine from any terminal.
#
# Usage:
#   ./scripts/run-intelligence.sh                    # today SGT
#   ./scripts/run-intelligence.sh 2026-05-26         # specific date
#   ./scripts/run-intelligence.sh 2026-05-26 force   # regenerate even if report exists
#   ./scripts/run-intelligence.sh today force        # today + force

set -euo pipefail

ROUTINE_SPEC="/Users/wilsontan/Claude/tc-store-visit-app_v2/tc-sva-bot/scripts/intelligence-routine.md"

DATE_ARG="${1:-today}"
FORCE_ARG="${2:-}"

if [[ "$DATE_ARG" == "today" ]]; then
  REPORT_DATE=$(TZ=Asia/Singapore date +%Y-%m-%d)
else
  REPORT_DATE="$DATE_ARG"
fi

PROMPT="Execute the routine at $ROUTINE_SPEC for date $REPORT_DATE."
if [[ "$FORCE_ARG" == "force" ]]; then
  PROMPT="$PROMPT Use force (skip the idempotency check)."
fi

echo "[run-intelligence] firing routine: $REPORT_DATE${FORCE_ARG:+ (force)}"
claude --print --dangerously-skip-permissions "$PROMPT"

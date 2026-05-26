/**
 * Daily intelligence cron entry-point.
 *
 * Usage:
 *   npm run intelligence                        # today's report (SGT)
 *   npm run intelligence -- --date=2026-05-18   # backfill / re-run
 *   npm run intelligence -- --dry-run           # no DB writes, no Telegram, just prints
 *   npm run intelligence -- --skip-telegram     # writes DB but does not broadcast
 *
 * Orchestration lives in src/ai/run-flow.ts so the in-bot cron and the
 * /runintelligence admin command share the exact same code path.
 */

import { runDailyIntelligenceFlow, sgtTodayISO, type RunFlowStatus } from '../src/ai/run-flow.js';

interface Flags {
  date: string;
  dryRun: boolean;
  skipTelegram: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    date: sgtTodayISO(),
    dryRun: false,
    skipTelegram: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--date=')) flags.date = arg.slice('--date='.length);
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--skip-telegram') flags.skipTelegram = true;
    else console.warn(`Unknown flag: ${arg}`);
  }
  return flags;
}

function exitCodeFor(status: RunFlowStatus): number {
  switch (status) {
    case 'ok':
    case 'no_visits':
      return 0;
    case 'lock_failed':
      return 1;
    case 'null_result':
      return 2;
    case 'validation_failed':
      return 3;
    case 'report_insert_failed':
      return 4;
  }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  const result = await runDailyIntelligenceFlow({
    date: flags.date,
    dryRun: flags.dryRun,
    skipTelegram: flags.skipTelegram,
  });

  if (result.status !== 'ok' && result.message) {
    console.error(result.message);
  }
  if (result.status === 'validation_failed' && result.briefPreview) {
    console.error('Brief preview:');
    console.error('─'.repeat(70));
    console.error(result.briefPreview);
  }

  console.log('─'.repeat(70));
  console.log(`Done. status=${result.status}`);
  process.exit(exitCodeFor(result.status));
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(99);
});

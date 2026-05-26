/**
 * In-bot scheduler for the daily intelligence run.
 *
 * Opt-in via env: only registers when INTELLIGENCE_CRON_ENABLED=true,
 * so dev shells never fire it.
 *
 * Default schedule: "0 23 * * *" UTC = 07:00 Asia/Singapore (UTC+8, no DST).
 * Override with INTELLIGENCE_CRON_SCHEDULE if you want a different time.
 */

import cron from 'node-cron';
import { runDailyIntelligenceFlow, sgtTodayISO } from '../ai/run-flow.js';

const DEFAULT_SCHEDULE = '0 23 * * *';

export function registerIntelligenceCron(): void {
  if (process.env.INTELLIGENCE_CRON_ENABLED !== 'true') {
    console.log('[cron] INTELLIGENCE_CRON_ENABLED!=true — daily-intelligence cron NOT scheduled');
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[cron] INTELLIGENCE_CRON_ENABLED=true but ANTHROPIC_API_KEY missing — runs will fail');
  }

  const schedule = process.env.INTELLIGENCE_CRON_SCHEDULE || DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[cron] invalid INTELLIGENCE_CRON_SCHEDULE="${schedule}" — not scheduling`);
    return;
  }

  cron.schedule(
    schedule,
    () => {
      void fire();
    },
    { timezone: 'UTC' },
  );
  console.log(`[cron] daily-intelligence scheduled "${schedule}" UTC (default ${DEFAULT_SCHEDULE} = 07:00 SGT)`);
}

async function fire(): Promise<void> {
  const date = sgtTodayISO();
  console.log(`[cron] daily-intelligence firing for ${date}`);
  try {
    const result = await runDailyIntelligenceFlow({ date });
    console.log(
      `[cron] daily-intelligence finished: status=${result.status} visits=${result.visits} notes_written=${result.notesWritten} bcast_sent=${result.bcastSent ?? 0}`,
    );
    if (result.message) console.log(`[cron] message: ${result.message}`);
  } catch (err) {
    console.error('[cron] daily-intelligence threw:', err);
  }
}

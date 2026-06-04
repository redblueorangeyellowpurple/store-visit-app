/**
 * In-bot scheduler for the daily per-CM recap.
 *
 * Two independent gates:
 *   1. RECAP_CRON_ENABLED=true (env)        — whether the job is scheduled at all
 *      (dev shells never fire it).
 *   2. settings.daily_recaps_enabled='true' — the runtime kill switch Wilson
 *      flips from the dashboard. Checked inside sendDailyRecaps().
 *
 * Default schedule: "0 0 * * *" UTC = 08:00 Asia/Singapore (UTC+8, no DST).
 * Override with RECAP_CRON_SCHEDULE.
 */

import cron from 'node-cron';
import { sgtYesterdayISO } from '../ai/run-flow.js';
import { sendDailyRecaps } from '../notifications/daily-recap.js';
import { getBotApi } from '../bot/photo-collection.js';

const DEFAULT_SCHEDULE = '0 0 * * *';

export function registerRecapCron(): void {
  if (process.env.RECAP_CRON_ENABLED !== 'true') {
    console.log('[cron] RECAP_CRON_ENABLED!=true — daily-recap cron NOT scheduled');
    return;
  }

  const schedule = process.env.RECAP_CRON_SCHEDULE || DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`[cron] invalid RECAP_CRON_SCHEDULE="${schedule}" — not scheduling`);
    return;
  }

  cron.schedule(
    schedule,
    () => {
      void fire();
    },
    { timezone: 'UTC' },
  );
  console.log(`[cron] daily-recap scheduled "${schedule}" UTC (default ${DEFAULT_SCHEDULE} = 08:00 SGT)`);
}

async function fire(): Promise<void> {
  const date = sgtYesterdayISO();
  const botApi = getBotApi();
  if (!botApi) {
    console.error('[cron] daily-recap: botApi not initialized — skipping');
    return;
  }
  console.log(`[cron] daily-recap firing for ${date}`);
  try {
    const result = await sendDailyRecaps(botApi, date);
    if ('disabled' in result) {
      console.log('[cron] daily-recap: master switch off — nothing sent');
    } else {
      console.log(
        `[cron] daily-recap finished: recipients=${result.recipients} sent=${result.sent} failed=${result.failed} skippedEmpty=${result.skippedEmpty}`,
      );
    }
  } catch (err) {
    console.error('[cron] daily-recap threw:', err);
  }
}

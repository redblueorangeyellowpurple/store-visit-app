/**
 * In-bot scheduler for the Monday weekly broadcast (see notifications/weekly.ts).
 * Separate from the daily morning pipeline so the two cadences are independently
 * gated and scheduled.
 *
 * Gate: WEEKLY_SEND_ENABLED=true (env) — off by default; dev shells never fire it.
 * Default schedule (UTC, SGT is UTC+8, no DST):
 *   send  "30 1 * * 1" = 09:30 SGT Monday — ping weekly recipients with the
 *         dashboard Week-view link, for the week that just ended.
 * Override with WEEKLY_SEND_SCHEDULE.
 *
 * No-op if the weekly routine hasn't written a report for the week yet
 * (sendWeeklySend skips with an admin note).
 */

import cron from 'node-cron';
import { lastCompletedWeekSGT } from '../ai/run-flow.js';
import { getBotApi } from '../bot/photo-collection.js';
import { sendWeeklySend } from '../notifications/weekly.js';

const DEFAULT_SEND = '30 1 * * 1';

export function registerWeeklyCron(): void {
  if (process.env.WEEKLY_SEND_ENABLED !== 'true') {
    console.log('[cron] WEEKLY_SEND_ENABLED!=true — weekly send NOT scheduled');
    return;
  }
  const expr = process.env.WEEKLY_SEND_SCHEDULE || DEFAULT_SEND;
  if (!cron.validate(expr)) {
    console.error(`[cron] invalid weekly-send schedule "${expr}" — not scheduling`);
    return;
  }
  cron.schedule(expr, () => void fire(), { timezone: 'UTC' });
  console.log(`[cron] weekly-send scheduled "${expr}" UTC`);
}

async function fire(): Promise<void> {
  const api = getBotApi();
  if (!api) {
    console.error('[cron] weekly-send: botApi not initialized — skipping');
    return;
  }
  const span = lastCompletedWeekSGT();
  console.log(`[cron] weekly-send firing for ${span.weekStart}..${span.weekEnd}`);
  try {
    await sendWeeklySend(api, span);
  } catch (err) {
    console.error('[cron] weekly-send threw:', err);
  }
}

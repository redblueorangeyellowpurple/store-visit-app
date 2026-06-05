/**
 * In-bot scheduler for the two-stage morning pipeline (see notifications/morning.ts).
 * Supersedes the old recap-cron: the 09:00 send now also handles the daily recaps.
 *
 * Gate: MORNING_CRON_ENABLED=true (env) — dev shells never fire it.
 * Default schedules (UTC, SGT is UTC+8, no DST):
 *   preview  "0 0 * * *" = 08:00 SGT  — DM Wilson the brief + recap list
 *   send     "0 1 * * *" = 09:00 SGT  — broadcast to team + send recaps
 * Override with MORNING_PREVIEW_SCHEDULE / MORNING_SEND_SCHEDULE.
 *
 * The 09:00 send still respects the daily_recaps_enabled master switch (inside
 * sendDailyRecaps), and broadcasts intelligence only if the 07:00 routine wrote
 * a report with a stored summary.
 */

import cron from 'node-cron';
import type { Api } from 'grammy';
import { sgtYesterdayISO } from '../ai/run-flow.js';
import { getBotApi } from '../bot/photo-collection.js';
import { sendMorningPreview, sendMorningSend } from '../notifications/morning.js';

const DEFAULT_PREVIEW = '0 0 * * *';
const DEFAULT_SEND = '0 1 * * *';

type Stage = (api: Api, date: string) => Promise<void>;

export function registerMorningCrons(): void {
  if (process.env.MORNING_CRON_ENABLED !== 'true') {
    console.log('[cron] MORNING_CRON_ENABLED!=true — morning preview/send NOT scheduled');
    return;
  }
  scheduleStage(process.env.MORNING_PREVIEW_SCHEDULE || DEFAULT_PREVIEW, 'preview', sendMorningPreview);
  scheduleStage(process.env.MORNING_SEND_SCHEDULE || DEFAULT_SEND, 'send', sendMorningSend);
}

function scheduleStage(expr: string, label: string, run: Stage): void {
  if (!cron.validate(expr)) {
    console.error(`[cron] invalid morning-${label} schedule "${expr}" — not scheduling`);
    return;
  }
  cron.schedule(expr, () => void fire(label, run), { timezone: 'UTC' });
  console.log(`[cron] morning-${label} scheduled "${expr}" UTC`);
}

async function fire(label: string, run: Stage): Promise<void> {
  const api = getBotApi();
  if (!api) {
    console.error(`[cron] morning-${label}: botApi not initialized — skipping`);
    return;
  }
  const date = sgtYesterdayISO();
  console.log(`[cron] morning-${label} firing for ${date}`);
  try {
    await run(api, date);
  } catch (err) {
    console.error(`[cron] morning-${label} threw:`, err);
  }
}

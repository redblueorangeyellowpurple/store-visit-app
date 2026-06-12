import { Api, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { getWeeklyRecipients } from '../db/queries/weekly.js';

// Monday weekly broadcast. Unlike the daily brief (a full HTML summary in the
// DM), the weekly report is a rich narrative whose source-chips only render in
// the dashboard — so the weekly send is a short ping + a deep-link to the Week
// view, sent to everyone with cms.is_weekly_recipient set. No group routing and
// no mini-app link (there's no weekly mini-app view yet).

export interface WeeklyBroadcastInput {
  weekStart: string; // Monday, ISO
  weekEnd: string;   // Sunday, ISO
}

export interface WeeklyBroadcastResult {
  sent: number;
  failed: { telegram_id: number; error: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "9–15 Jun" / "30 Jun–6 Jul" from two ISO dates.
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const [, sM, sD] = weekStart.split('-').map(Number);
  const [, eM, eD] = weekEnd.split('-').map(Number);
  const left = sM === eM ? `${sD}` : `${sD} ${MONTHS[sM - 1]}`;
  return `${left}–${eD} ${MONTHS[eM - 1]}`;
}

export function weeklyMessage(input: WeeklyBroadcastInput): string {
  const range = formatWeekRange(input.weekStart, input.weekEnd);
  return (
    `📅 <b>SVA Weekly Report — ${range}</b>\n` +
    `Last week's store-visit intelligence is ready: Good News, Signals, Alerts and Engagements across the team.\n\n` +
    `Open the dashboard to read the full week.`
  );
}

function weeklyKeyboard(): InlineKeyboard | undefined {
  const dashboardBase = config.dashboard.url;
  if (!dashboardBase) return undefined;
  const kb = new InlineKeyboard();
  kb.url('📊 Open Weekly Report', `${dashboardBase.replace(/\/+$/, '')}/?tab=weekly`);
  return kb;
}

export async function broadcastWeeklyReport(
  input: WeeklyBroadcastInput,
): Promise<WeeklyBroadcastResult> {
  const recipients = await getWeeklyRecipients();
  if (recipients.length === 0) {
    console.log('broadcastWeeklyReport: no weekly recipients');
    return { sent: 0, failed: [] };
  }

  const api = new Api(config.telegram.botToken);
  const text = weeklyMessage(input);
  const keyboard = weeklyKeyboard();

  let sent = 0;
  const failed: { telegram_id: number; error: string }[] = [];
  for (const r of recipients) {
    try {
      await api.sendMessage(r.telegram_id, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
      sent++;
    } catch (err) {
      failed.push({ telegram_id: r.telegram_id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { sent, failed };
}

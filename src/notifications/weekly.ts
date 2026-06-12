import { Api } from 'grammy';
import { config } from '../config.js';
import { getWeeklyRecipients, getWeeklyReportForWeek } from '../db/queries/weekly.js';
import { broadcastWeeklyReport, weeklyMessage, formatWeekRange } from '../bot/broadcast-weekly.js';

// Monday weekly send (see broadcast-weekly.ts). Fired Monday morning by the
// weekly cron, or manually via /weeklysend confirm. Only broadcasts if the
// weekly routine has already written a report for the week — otherwise it's a
// no-op (nothing to point the recipients at).

function adminChatId(): number | null {
  const raw = config.admin.chatId;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

export interface WeekSpan {
  weekStart: string;
  weekEnd: string;
}

// Preview to the invoker only — never touches recipients. Shows the exact
// message that would go out, the recipient count, and whether the report exists.
export async function sendWeeklyPreview(botApi: Api, span: WeekSpan, toChatId?: number): Promise<void> {
  const adminId = toChatId ?? adminChatId();
  if (!adminId) {
    console.warn('[weekly] ADMIN_TELEGRAM_ID not set — skipping preview DM');
    return;
  }
  const [recipients, report] = await Promise.all([
    getWeeklyRecipients(),
    getWeeklyReportForWeek(span.weekStart),
  ]);
  const range = formatWeekRange(span.weekStart, span.weekEnd);
  const reportNote = report
    ? `✅ Weekly report for ${range} exists (v${report.version}).`
    : `⚠️ <b>No weekly report for ${range} yet</b> — the weekly routine hasn't written it. Nothing would broadcast.`;
  const reachNote = `📣 Would send to <b>${recipients.length}</b> weekly recipient${recipients.length === 1 ? '' : 's'}.`;
  const preview = `🔍 <b>Weekly preview — ${range}</b>\n${reportNote}\n${reachNote}\n\n— message below —\n\n${weeklyMessage(span)}`;
  try {
    await botApi.sendMessage(adminId, preview, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    console.error('[weekly] preview DM failed:', err instanceof Error ? err.message : err);
  }
}

// The real send: broadcast to weekly recipients, then DM Wilson a summary.
export async function sendWeeklySend(botApi: Api, span: WeekSpan): Promise<void> {
  const adminId = adminChatId();
  const range = formatWeekRange(span.weekStart, span.weekEnd);

  const report = await getWeeklyReportForWeek(span.weekStart);
  let line: string;
  if (!report) {
    line = `📅 Weekly skipped — no report for ${range} (routine hasn't run)`;
  } else {
    const bcast = await broadcastWeeklyReport(span);
    line = `📅 Weekly sent ${bcast.sent}${bcast.failed.length ? ` · ${bcast.failed.length} failed` : ''}`;
  }

  console.log(`[weekly] send ${range}: ${line}`);
  if (adminId) {
    try {
      await botApi.sendMessage(adminId, `✅ <b>Weekly send — ${range}</b>\n${line}`, { parse_mode: 'HTML' });
    } catch (err) {
      console.error('[weekly] send-summary DM failed:', err instanceof Error ? err.message : err);
    }
  }
}

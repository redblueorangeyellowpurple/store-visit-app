import { Api } from 'grammy';
import { config } from '../config.js';
import { getReportForDate, getIntelligenceRecipients } from '../db/queries/intelligence.js';
import { listAlertGroups } from '../db/queries/alert-groups.js';
import { getIntelligencePauseState, getSetting } from '../db/queries/settings.js';
import { broadcastIntelligenceBrief } from '../bot/broadcast-intelligence.js';
import { previewRecapRecipients, sendDailyRecaps, RECAP_ENABLED_KEY } from './daily-recap.js';

// Two-stage morning pipeline. Intelligence is COMPUTED at 07:00 SGT by the
// headless Mac routine (scripts/intelligence-routine.md), which writes the
// report — with telegram_summary persisted in stats — but no longer broadcasts.
//
//   08:00 SGT  sendMorningPreview — DM Wilson ONLY: the brief about to go out +
//              the list of CMs who will receive a daily brief. A 1-hour window to
//              kill a bad send (disable the LaunchAgent / flip daily_recaps).
//   09:00 SGT  sendMorningSend    — broadcast the stored brief to the team + group
//              chats, then send the per-CM daily recaps, then DM Wilson a summary.

function adminChatId(): number | null {
  const raw = config.admin.chatId;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// The 7am routine stores the broadcast text in stats.telegram_summary (HTML,
// ≤900 chars). Reports written before that change won't have it.
function storedSummary(stats: Record<string, unknown>): string | null {
  const s = stats?.['telegram_summary'];
  return typeof s === 'string' && s.trim() ? s : null;
}

// How many people + group chats the 9am broadcast will reach (same delivery
// model as broadcastIntelligenceBrief — used only for the preview line).
async function intelligenceReach(): Promise<{ people: number; groups: number }> {
  const [recipients, groups] = await Promise.all([
    getIntelligenceRecipients(),
    listAlertGroups(),
  ]);
  const groupChats = new Set<number>();
  for (const g of groups) {
    if ((g.intelligence_mode === 'group' || g.intelligence_mode === 'both') && g.chat_id) {
      groupChats.add(g.chat_id);
    }
  }
  return { people: recipients.length, groups: groupChats.size };
}

// 08:00 — preview to Wilson only. Never touches the team. `toChatId` overrides
// the configured admin (used by the /morningpreview test command to reply to the
// invoker regardless of ADMIN_TELEGRAM_ID).
export async function sendMorningPreview(botApi: Api, date: string, toChatId?: number): Promise<void> {
  const adminId = toChatId ?? adminChatId();
  if (!adminId) {
    console.warn('[morning] ADMIN_TELEGRAM_ID not set — skipping preview DM');
    return;
  }

  const [report, recap, recapsOn, pause] = await Promise.all([
    getReportForDate(date),
    previewRecapRecipients(date),
    getSetting(RECAP_ENABLED_KEY).then((v) => v === 'true'),
    getIntelligencePauseState(),
  ]);
  const pausedNote = pause.paused
    ? `🛑 <b>Intelligence is PAUSED</b> — the brief will NOT broadcast at 9am unless you /resumeintelligence.\n\n`
    : '';

  // The master switch (daily_recaps_enabled) gates the 9am send but NOT the
  // preview computation — so flag its state, or the list lies (e.g. "5 CMs"
  // listed while the switch is off and 0 actually go out).
  const offNote = recapsOn ? '' : ' — ⚠️ recaps switch is OFF, so 0 will send unless you enable it';
  const recapBlock = recap.willReceive.length
    ? `📋 <b>Daily briefs at 9am → ${recap.willReceive.length} CM${recap.willReceive.length === 1 ? '' : 's'}${offNote}:</b>\n` +
      recap.willReceive.map((n) => `• ${htmlEscape(n)}`).join('\n')
    : `📋 <b>Daily briefs at 9am:</b> none — all recaps empty today.${recapsOn ? '' : ' (recaps switch also OFF.)'}`;

  const summary = report ? storedSummary(report.stats) : null;

  let head: string;
  if (!report) {
    head = `⚠️ <b>No intelligence report for ${date} yet</b> — the 7am routine may still be running or did not run. Nothing broadcasts at 9am unless it lands.`;
  } else if (!summary) {
    head = `🔍 <b>Intelligence ${date}</b> — report written, but no stored summary to preview (older report format).`;
  } else {
    const reach = await intelligenceReach();
    head =
      `🔍 <b>Intelligence preview — ${date}</b>\n` +
      `<i>Team gets this at 9am (${reach.people} ${reach.people === 1 ? 'person' : 'people'} + ${reach.groups} group${reach.groups === 1 ? '' : 's'}). Kill before then to stop it.</i>\n\n` +
      summary;
  }

  try {
    await botApi.sendMessage(adminId, `${pausedNote}${head}\n\n${recapBlock}`, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("can't parse entities")) {
      try {
        await botApi.sendMessage(adminId, `${pausedNote}${head}\n\n${recapBlock}`, {
          link_preview_options: { is_disabled: true },
        });
        return;
      } catch (retryErr) {
        console.error('[morning] preview DM retry (plain) failed:', retryErr instanceof Error ? retryErr.message : retryErr);
        return;
      }
    }
    console.error('[morning] preview DM failed:', msg);
  }
}

// 09:00 — the real send: team broadcast + per-CM recaps + a summary DM to Wilson.
export async function sendMorningSend(botApi: Api, date: string): Promise<void> {
  const adminId = adminChatId();
  const report = await getReportForDate(date);
  const summary = report ? storedSummary(report.stats) : null;

  // 1. Intelligence broadcast — only if the 7am routine produced a summary AND
  //    intelligence isn't paused. The pause (/stopintelligence) is the kill
  //    switch for the 8am→9am window: compute already happened at 7am, so this
  //    is the LAST gate before the team sees anything.
  let intelLine: string;
  const pause = await getIntelligencePauseState();
  if (pause.paused) {
    intelLine = `📢 Intelligence skipped — paused${pause.reason ? ` (${pause.reason})` : ''}. /resumeintelligence to re-enable.`;
  } else if (summary) {
    const bcast = await broadcastIntelligenceBrief({ telegramSummary: summary, reportDate: date });
    intelLine = `📢 Intelligence sent ${bcast.sent}${bcast.failed.length ? ` · ${bcast.failed.length} failed` : ''}`;
  } else {
    intelLine = report
      ? '📢 Intelligence skipped — report has no stored summary'
      : '📢 Intelligence skipped — no report for yesterday';
  }

  // 2. Per-CM daily recaps — honours the daily_recaps_enabled master switch.
  const recap = await sendDailyRecaps(botApi, date);
  const recapLine =
    'disabled' in recap
      ? '📋 Daily briefs skipped — master switch off'
      : `📋 Daily briefs sent ${recap.sent}${recap.skippedEmpty ? ` · ${recap.skippedEmpty} empty` : ''}${recap.failed ? ` · ${recap.failed} failed` : ''}`;

  console.log(`[morning] send ${date}: ${intelLine} | ${recapLine}`);
  if (adminId) {
    try {
      await botApi.sendMessage(adminId, `✅ <b>Morning send — ${date}</b>\n${intelLine}\n${recapLine}`, {
        parse_mode: 'HTML',
      });
    } catch (err) {
      console.error('[morning] send-summary DM failed:', err instanceof Error ? err.message : err);
    }
  }
}

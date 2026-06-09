import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { getIntelligenceRecipients } from '../db/queries/intelligence.js';
import { listAlertGroups } from '../db/queries/alert-groups.js';
import { notifyAdmins } from '../notifications/admin-notify.js';

// ─── Broadcast input ──────────────────────────────────────────────────────────

export interface IntelligenceBroadcastInput {
  /** Plain-text Telegram summary (one message, no markdown). */
  telegramSummary: string;
  /** Used to build the deep-link to the dashboard's intelligence page. */
  reportDate: string;
}

export interface BroadcastResult {
  sent: number;
  failed: { telegram_id: number; error: string }[];
}

/**
 * Delivery model:
 *   - Global people list (cms.is_intelligence_recipient=true) always receives the brief.
 *   - Each market with intelligence_mode in ('group','both') AND chat_id set
 *     additionally receives a copy. Chat IDs are deduped (overlap is OK).
 *   - Markets with mode=group/both but no chat_id trigger an admin DM warning.
 *
 * Format: ONE plain-text message per recipient, with an inline "View full
 * brief" button to the dashboard. No markdown chunking — telegram_summary is
 * pre-shaped by Claude to fit a single message.
 */
export async function broadcastIntelligenceBrief(
  input: IntelligenceBroadcastInput,
): Promise<BroadcastResult> {
  const [recipients, groups] = await Promise.all([
    getIntelligenceRecipients(),
    listAlertGroups(),
  ]);

  const groupChatIds = new Set<number>();
  const missingChatMarkets: string[] = [];
  for (const g of groups) {
    if (g.intelligence_mode === 'group' || g.intelligence_mode === 'both') {
      if (g.chat_id) {
        groupChatIds.add(g.chat_id);
      } else {
        missingChatMarkets.push(g.market);
      }
    }
  }

  if (recipients.length === 0 && groupChatIds.size === 0) {
    console.log('broadcastIntelligenceBrief: no recipients');
    return { sent: 0, failed: [] };
  }

  const bot = new Bot(config.telegram.botToken);

  // Inline buttons mirror what the 7am markdown routine used to attach: a
  // dashboard link (desktop web view) + an "Open in App" mini-app deep-link
  // (m/intel via startapp=intel). Each is added only if its base is configured.
  const dashboardBase = config.dashboard.url;
  const { botUsername } = config.broadcast;
  const miniappShort = config.miniapp.shortName;
  let keyboard: InlineKeyboard | undefined;
  if (dashboardBase || botUsername) {
    keyboard = new InlineKeyboard();
    if (dashboardBase) {
      keyboard.url('📊 Dashboard', `${dashboardBase.replace(/\/+$/, '')}/intelligence`);
    }
    if (botUsername) {
      keyboard.url('📱 Open in App', `https://t.me/${botUsername}/${miniappShort}?startapp=intel`);
    }
  }

  let sent = 0;
  const failed: { telegram_id: number; error: string }[] = [];

  const sendTo = async (chatId: number): Promise<void> => {
    try {
      await bot.api.sendMessage(chatId, input.telegramSummary, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(keyboard ? { reply_markup: keyboard } : {}),
      });
      sent++;
    } catch (err) {
      failed.push({
        telegram_id: chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  for (const recipient of recipients) {
    await sendTo(recipient.telegram_id);
  }
  for (const chatId of groupChatIds) {
    await sendTo(chatId);
  }

  if (missingChatMarkets.length > 0) {
    await notifyAdmins(
      bot.api,
      `⚠️ Intelligence brief: markets with mode=group/both but no chat_id set — ${missingChatMarkets.join(', ')}. Configure in Admin tab.`,
    );
  }

  return { sent, failed };
}

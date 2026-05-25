import { Api, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { getJoinRequestAdmins } from '../db/queries/alert-groups.js';

export function buildJoinRequestKeyboard(telegramId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('SG', `join:approve:${telegramId}:SG`)
    .text('MY', `join:approve:${telegramId}:MY`)
    .text('HK', `join:approve:${telegramId}:HK`)
    .text('TH', `join:approve:${telegramId}:TH`)
    .row()
    .text('✗ Reject', `join:reject:${telegramId}`);
}

interface BroadcastInput {
  telegramId: number;
  fullName: string;
  username?: string;
}

export async function broadcastJoinRequest(
  input: BroadcastInput,
  botApi: Api,
): Promise<void> {
  const handle = input.username ? `@${input.username}` : `(no username)`;
  const text =
    `📨 Join request\n\n` +
    `Name: ${input.fullName}\n` +
    `Telegram: ${handle}\n` +
    `ID: ${input.telegramId}\n\n` +
    `Pick a market to approve, or reject:`;
  const keyboard = buildJoinRequestKeyboard(input.telegramId);

  const admins = await getJoinRequestAdmins();

  if (admins.length === 0) {
    // Defensive fallback: nobody flagged yet → use legacy group chat
    if (!config.joinRequests.chatId) {
      console.warn('[join] no is_join_request_admin recipients AND no legacy chat — dropping request');
      return;
    }
    try {
      await botApi.sendMessage(config.joinRequests.chatId, text, { reply_markup: keyboard });
    } catch (err) {
      console.error('[join] legacy-group send failed:', err);
    }
    return;
  }

  for (const admin of admins) {
    try {
      await botApi.sendMessage(admin.telegram_id, text, { reply_markup: keyboard });
    } catch (err) {
      console.error(`[join] DM to ${admin.telegram_id} failed:`, err);
    }
  }
}

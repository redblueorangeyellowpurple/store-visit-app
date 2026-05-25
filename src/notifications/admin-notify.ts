import { Api } from 'grammy';
import { getJoinRequestAdmins } from '../db/queries/alert-groups.js';

/**
 * DM every CM flagged `is_join_request_admin=true` with a plaintext message.
 * Used for routing alerts that don't have a configured destination
 * (e.g. visit broadcast when the visit's market has no chat_id set).
 *
 * If no CM is flagged the message is dropped with a warning — callers should
 * never rely on this as the sole delivery path for critical alerts.
 */
export async function notifyAdmins(botApi: Api, text: string): Promise<void> {
  const admins = await getJoinRequestAdmins();
  if (admins.length === 0) {
    console.warn('[notifyAdmins] no is_join_request_admin recipients — message dropped:', text);
    return;
  }
  for (const admin of admins) {
    try {
      await botApi.sendMessage(admin.telegram_id, text);
    } catch (err) {
      console.error(`[notifyAdmins] send to ${admin.telegram_id} failed:`, err);
    }
  }
}

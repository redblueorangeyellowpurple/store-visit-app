import { BotContext, requireAdmin } from '../../middleware/auth.js';
import {
  getIntelligencePauseState,
  setIntelligencePaused,
} from '../../../db/queries/settings.js';

// Usage:
//   /stopintelligence                 → pause with no reason recorded
//   /stopintelligence <free text>     → pause with reason for audit

export async function handleStopIntelligence(ctx: BotContext): Promise<void> {
  if (!requireAdmin(ctx)) return;

  const fromId = ctx.from?.id;
  if (!fromId) {
    await ctx.reply('Could not identify caller.');
    return;
  }

  const text = ctx.message?.text ?? '';
  const reason = text.replace(/^\/\S+\s*/, '').trim() || undefined;

  const existing = await getIntelligencePauseState();
  if (existing.paused) {
    await ctx.reply(
      `🟡 Intelligence is *already paused*.\n` +
        (existing.reason ? `• Reason: ${existing.reason}\n` : '') +
        (existing.paused_by ? `• By: ${existing.paused_by}\n` : '') +
        (existing.paused_at ? `• At: ${existing.paused_at}\n` : '') +
        `\nUse \`/resumeintelligence\` to re-enable.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const ok = await setIntelligencePaused(true, fromId, reason);
  if (!ok) {
    await ctx.reply('❌ Failed to update kill switch. Check bot logs.');
    return;
  }

  await ctx.reply(
    `🛑 *Intelligence paused.*\n\n` +
      `• Daily cron will refuse to run.\n` +
      `• \`/runintelligence\` will refuse (even with \`force\`).\n` +
      `• Zero tokens will be spent on intelligence until resumed.\n` +
      (reason ? `\n*Reason:* ${reason}\n` : '') +
      `\nUse \`/resumeintelligence\` to re-enable.`,
    { parse_mode: 'Markdown' },
  );
}

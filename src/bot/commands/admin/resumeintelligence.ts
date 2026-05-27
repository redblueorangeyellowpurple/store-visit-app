import { BotContext, requireAdmin } from '../../middleware/auth.js';
import {
  getIntelligencePauseState,
  setIntelligencePaused,
} from '../../../db/queries/settings.js';

// Usage: /resumeintelligence → clears the pause flag (no args)

export async function handleResumeIntelligence(ctx: BotContext): Promise<void> {
  if (!requireAdmin(ctx)) return;

  const fromId = ctx.from?.id;
  if (!fromId) {
    await ctx.reply('Could not identify caller.');
    return;
  }

  const existing = await getIntelligencePauseState();
  if (!existing.paused) {
    await ctx.reply(
      `🟢 Intelligence is *already running* (not paused). No change.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const ok = await setIntelligencePaused(false, fromId);
  if (!ok) {
    await ctx.reply('❌ Failed to update kill switch. Check bot logs.');
    return;
  }

  await ctx.reply(
    `🟢 *Intelligence resumed.*\n\n` +
      `• Daily cron will run on schedule.\n` +
      `• \`/runintelligence\` is unblocked.\n` +
      (existing.reason ? `\n_Pause reason cleared:_ ${existing.reason}` : ''),
    { parse_mode: 'Markdown' },
  );
}

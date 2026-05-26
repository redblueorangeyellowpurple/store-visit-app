import { NextFunction } from 'grammy';
import { BotContext } from './auth.js';

// The bot keeps a presence in groups (per-market alert routing posts visit
// locks, photo galleries, etc. via bot.api), but should never run CM-facing
// flows there. If a CM types /visit or taps "🏪 Log Visit" in a group, point
// them to DM and drop the update before it hits auth/conversations.
const REPLY_TRIGGERS = new Set(['🏪 Log Visit', '🔗 Links']);

export async function groupGuardMiddleware(
  ctx: BotContext,
  next: NextFunction,
): Promise<void> {
  const chat = ctx.chat;
  if (!chat || chat.type === 'private') return next();

  if (!ctx.message) return; // drop non-message updates in groups too

  const text = ctx.message.text ?? ctx.message.caption ?? '';
  const isCommand = text.trim().startsWith('/');
  const isQuickAccessButton = REPLY_TRIGGERS.has(text.trim());

  if (isCommand || isQuickAccessButton) {
    await ctx.reply('👋 DM me to log visits — group commands are disabled.', {
      reply_parameters: { message_id: ctx.message.message_id },
    }).catch(() => {});
  }
}

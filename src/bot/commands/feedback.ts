import { BotContext, requireAuth } from '../middleware/auth.js';

// /feedback — any registered CM can send feedback or report a bug. Gates on
// auth (so we have a submitter identity), then enters the capture conversation.
export async function handleFeedback(ctx: BotContext): Promise<void> {
  const user = requireAuth(ctx);
  if (!user) return;
  await ctx.conversation.enter('feedbackFlow');
}

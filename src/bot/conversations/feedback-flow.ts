import { Conversation } from '@grammyjs/conversations';
import { BotContext } from '../middleware/auth.js';
import { config } from '../../config.js';
import { logFeedback } from '../../db/queries/feedback.js';
import { getCMRecord } from '../../db/queries/cms.js';

type FeedbackConversation = Conversation<BotContext, BotContext>;

const MAX_LEN = 1000;

// Single-step capture: ask for the feedback, wait for a text reply, log it to
// the product-feedback dashboard, then DM Wilson a heads-up. Mirrors the
// join-request flow — ctx.reply / ctx.api are replay-safe, DB writes go through
// conversation.external().
export async function feedbackFlow(
  conversation: FeedbackConversation,
  ctx: BotContext,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  await ctx.reply(
    "What's on your mind? 💬\n\n" +
    "Send a bug, an idea, or anything about the app — a sentence is enough. " +
    "Wilson sees it in the dashboard.\n\n_/cancel to stop._",
    { parse_mode: 'Markdown' },
  );

  let body = '';
  while (!body) {
    const msg = await conversation.wait();

    if (msg.message?.text === '/cancel') {
      await ctx.reply("No worries — nothing sent 👍");
      return;
    }

    const txt = msg.message?.text?.trim();
    if (!txt) {
      await ctx.reply('Please send your feedback as a text message. /cancel to stop.');
      continue;
    }
    if (txt.length > MAX_LEN) {
      await ctx.reply(`That's a bit long — keep it under ${MAX_LEN} characters. Try again, or /cancel.`);
      continue;
    }
    body = txt;
  }

  const cm = await conversation.external(() => getCMRecord(telegramId));
  const submitterName = cm?.nickname || cm?.full_name || ctx.from?.first_name || 'A CM';

  const ok = await conversation.external(() =>
    logFeedback({ body, submitterName, submitterTgId: telegramId }),
  );

  if (!ok) {
    await ctx.reply("Hmm — couldn't save that just now. Give it another try in a moment 🙏");
    return;
  }

  await ctx.reply("✅ Logged — thanks! Wilson will see it in the dashboard.");

  // Best-effort heads-up DM to Wilson. Never blocks or fails the submission.
  const notifyId = config.feedback.notifyTgId;
  if (notifyId && notifyId !== String(telegramId)) {
    const preview = body.length > 300 ? `${body.slice(0, 300)}…` : body;
    await ctx.api.sendMessage(
      notifyId,
      `📝 New feedback — Store Visit App\nFrom: ${submitterName}\n\n${preview}`,
    ).catch(() => {});
  }
}

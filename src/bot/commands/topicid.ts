import { BotContext } from '../middleware/auth.js';

// Setup helper: run inside a forum topic to get the chat_id + thread_id to paste
// into the dashboard Admin tab (Alert groups). Registered BEFORE the group guard
// so it works in group chats. Read-only — just echoes IDs.
export async function handleTopicId(ctx: BotContext): Promise<void> {
  const chatId = ctx.chat?.id;
  const threadId = ctx.message?.message_thread_id;

  if (chatId == null) {
    await ctx.reply('Run this inside the group/topic you want to route alerts to.');
    return;
  }

  const threadLine =
    threadId != null
      ? `🧵 Topic thread ID: \`${threadId}\``
      : `🧵 Topic thread ID: _none_ — you're in the group's General topic (leave the thread field blank).`;

  await ctx.reply(
    `📍 *Routing IDs for this chat*\n\n` +
      `💬 Chat ID: \`${chatId}\`\n` +
      `${threadLine}\n\n` +
      `_Paste these into the dashboard → Admin → Alert groups for the matching market._`,
    { parse_mode: 'Markdown', message_thread_id: threadId },
  );
}

import { Bot } from 'grammy';
import { BotContext } from './middleware/auth.js';
import { getAllCMs } from '../db/queries/cms.js';

// Registers the bot's slash commands with Telegram so they appear in the "/"
// autocomplete menu. Without this the menu is empty/stale — which is why
// /testrecap (and friends) never showed up. Run once at startup.
//
// Telegram resolves the command list by the MOST SPECIFIC scope, so we layer:
//   • all_private_chats → the baseline CM set everyone sees
//   • per-chat (admins / managers) → baseline + their extra commands, visible
//     only in their own chat.

type Command = { command: string; description: string };

const USER_COMMANDS: Command[] = [
  { command: 'visit', description: 'Log a new store visit' },
  { command: 'myvisits', description: 'Your last 5 visits' },
  { command: 'mystores', description: 'Your assigned store portfolio' },
  { command: 'storevisits', description: 'Browse visits for a specific store' },
  { command: 'links', description: 'Store objective + asset links' },
  { command: 'nickname', description: 'Set your display name' },
  { command: 'myprofile', description: 'View your profile' },
  { command: 'feedback', description: 'Send feedback or report a bug' },
  { command: 'cancel', description: 'Pause the current visit' },
  { command: 'help', description: 'Show all commands' },
];

const MANAGER_EXTRA: Command[] = [
  { command: 'dashboard', description: 'Open the team dashboard' },
];

const ADMIN_EXTRA: Command[] = [
  { command: 'dashboard', description: 'Open the team dashboard' },
  { command: 'testrecap', description: "Preview a CM's daily recap (DM to you)" },
  { command: 'morningpreview', description: 'Preview the morning brief + recipients' },
  { command: 'morningsend', description: 'Fire the 9am team send now' },
  { command: 'weeklypreview', description: 'Preview the Monday weekly ping (DMs you)' },
  { command: 'weeklysend', description: 'Fire the weekly recipient ping now' },
  { command: 'runintelligence', description: "Generate today's daily brief" },
  { command: 'stopintelligence', description: 'Pause all intelligence (kill switch)' },
  { command: 'resumeintelligence', description: 'Resume intelligence after a pause' },
  { command: 'grantaccess', description: 'Add a CM' },
  { command: 'revokeaccess', description: 'Remove a CM' },
  { command: 'listaccess', description: 'List all active CMs' },
  { command: 'topicid', description: 'Get a group topic chat + thread IDs' },
];

export async function registerBotCommands(bot: Bot<BotContext>): Promise<void> {
  try {
    await bot.api.setMyCommands(USER_COMMANDS, { scope: { type: 'all_private_chats' } });

    const cms = await getAllCMs();
    let scoped = 0;
    for (const cm of cms) {
      const extra =
        cm.role === 'admin'
          ? ADMIN_EXTRA
          : cm.role === 'am' || cm.role === 'cmic'
            ? MANAGER_EXTRA
            : null;
      if (!extra) continue;
      await bot.api.setMyCommands([...USER_COMMANDS, ...extra], {
        scope: { type: 'chat', chat_id: cm.telegram_id },
      });
      scoped++;
    }
    console.log(`[startup] bot commands registered (baseline + ${scoped} manager/admin chats)`);
  } catch (err) {
    console.error('[startup] setMyCommands failed:', err instanceof Error ? err.message : err);
  }
}

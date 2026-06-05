import { BotContext, isManager } from '../middleware/auth.js';

export async function handleHelp(ctx: BotContext): Promise<void> {
  const role = ctx.user?.role;
  const isAdmin = role === 'admin';
  const manager = isManager(ctx.user);

  const managerBlock = manager
    ? `\n👥 *Manager commands*\n` +
      `/dashboard — open the team dashboard\n` +
      `_(assign stores to CMs in the dashboard → Channel Managers tab)_\n`
    : '';

  const adminBlock = isAdmin
    ? `\n🛠 *Admin commands*\n` +
      `/grantaccess — add a CM\n` +
      `/revokeaccess — remove a CM\n` +
      `/listaccess — list all active CMs\n` +
      `/runintelligence — generate today's daily brief (or for a past date)\n` +
      `/stopintelligence — 🛑 kill switch: pause all intelligence (cron + manual). Add a reason after the command.\n` +
      `/resumeintelligence — re-enable intelligence after a pause\n` +
      `/morningpreview — preview the morning brief + daily-brief recipient list (DMs only you)\n` +
      `/morningsend — 📢 manually fire the 9am team send now (needs \`confirm\`)\n` +
      `_(per-market alert groups are configured in the dashboard Admin tab)_\n`
    : '';

  await ctx.reply(
    `📱 *Commands*\n\n` +
    `🏪 /visit — log a new store visit\n` +
    `🕒 /myvisits — your last 5 visits\n` +
    `🔗 /links — store objective + asset verification links\n` +
    `✏️ /nickname — set your display name\n` +
    `🚫 /cancel — pause the visit (draft saved for 7 days)\n` +
    managerBlock +
    adminBlock + `\n` +
    `📝 *How /visit works*\n\n` +
    `Pick the store, then answer 4 quick prompts:\n` +
    `🎉 Good News · 👥 People & Training\n` +
    `🔍 Competitor Insights · 📦 Display & Stock\n\n` +
    `Each prompt has a *Skip* button if there's nothing to flag.\n` +
    `Tap *← Back* to redo the previous question (clears its photos too).\n` +
    `Send photos any time — they tag to whichever prompt is active.\n` +
    `Close out with one-line or mini-app follow-ups.\n\n` +
    `💡 _Names, numbers, and specifics make your notes 10× more useful._`,
    { parse_mode: 'Markdown' },
  );
}

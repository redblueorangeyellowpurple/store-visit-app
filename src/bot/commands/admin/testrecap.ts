import { BotContext, requireAdmin } from '../../middleware/auth.js';
import { sendTestRecap } from '../../../notifications/daily-recap.js';
import { sgtYesterdayISO } from '../../../ai/run-flow.js';
import { getAllCMs } from '../../../db/queries/cms.js';

// /testrecap [YYYY-MM-DD] [cm name or telegram id]
// DMs the admin a sample daily recap. Built from the target CM's visits for the
// date (defaults: yesterday + the caller), but always sent only to the caller —
// so an AM can preview a real field CM's recap. Bypasses the master switch +
// recipient flag; it's purely a preview.
export async function handleTestRecap(ctx: BotContext): Promise<void> {
  const cm = requireAdmin(ctx);
  if (!cm) return;
  const callerId = ctx.from?.id;
  if (!callerId) return;

  // First token may be a date ('yesterday' or YYYY-MM-DD); whatever remains is an
  // optional CM name/id to preview.
  const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
  let date = sgtYesterdayISO();
  let rest = args;
  if (args[0]) {
    const a0 = args[0].toLowerCase();
    if (a0 === 'yesterday') {
      rest = args.slice(1);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(a0)) {
      date = a0;
      rest = args.slice(1);
    }
  }
  const query = rest.join(' ').trim();

  // Resolve whose data to build from. Default = the caller's own visits.
  let targetId = callerId;
  let targetName = cm.nickname || cm.full_name;
  if (query) {
    const all = await getAllCMs();
    const q = query.toLowerCase();
    const matches = /^\d+$/.test(query)
      ? all.filter((c) => String(c.telegram_id) === query)
      : all.filter(
          (c) => (c.nickname ?? '').toLowerCase().includes(q) || c.full_name.toLowerCase().includes(q),
        );

    if (matches.length === 0) {
      await ctx.reply(`No active CM matches "${query}". Try part of their name or their telegram id.`);
      return;
    }
    if (matches.length > 1) {
      const list = matches
        .slice(0, 10)
        .map((c) => `• ${c.full_name}${c.nickname ? ` (${c.nickname})` : ''} — ${c.telegram_id}`)
        .join('\n');
      await ctx.reply(`Multiple CMs match "${query}":\n${list}\n\nNarrow it down or pass the telegram id.`);
      return;
    }
    targetId = matches[0].telegram_id;
    targetName = matches[0].nickname || matches[0].full_name;
  }

  const res = await sendTestRecap(ctx.api, callerId, targetName, date, targetId);
  if (!res.ok) {
    await ctx.reply("⚠️ Couldn't send the test recap — check the bot logs.");
    return;
  }
  if (res.empty) {
    await ctx.reply(
      `_Sent — but ${targetName} had no activity on ${date}, so it’s a near-empty sample. Try a CM + date with logged visits._`,
      { parse_mode: 'Markdown' },
    );
  }
}

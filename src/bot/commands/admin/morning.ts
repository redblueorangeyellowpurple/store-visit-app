import { BotContext, requireAdmin } from '../../middleware/auth.js';
import { sgtYesterdayISO } from '../../../ai/run-flow.js';
import { sendMorningPreview, sendMorningSend } from '../../../notifications/morning.js';

// Manual triggers for the morning pipeline (normally fired by cron at 08:00 /
// 09:00 SGT — see notifications/morning.ts). Admin-only.

// First positional arg as a date, else yesterday SGT. Non-date args (e.g.
// "confirm") fall through to the default.
function dateArg(ctx: BotContext): string {
  const a = ctx.message?.text?.split(/\s+/)[1]?.toLowerCase();
  return a && /^\d{4}-\d{2}-\d{2}$/.test(a) ? a : sgtYesterdayISO();
}

// /morningpreview [date] — run the 08:00 preview now. DMs only the invoker, so
// it's safe to run anytime; the team never sees anything.
export async function handleMorningPreview(ctx: BotContext): Promise<void> {
  if (!requireAdmin(ctx)) return;
  const date = dateArg(ctx);
  await ctx.reply(`Running morning preview for ${date}…`);
  await sendMorningPreview(ctx.api, date, ctx.from?.id);
}

// /morningsend [date] confirm — fire the REAL 09:00 send now: broadcasts the
// brief to the whole team + group chats and sends the per-CM daily recaps.
// Requires the literal word "confirm" so it can't go out by accident.
export async function handleMorningSend(ctx: BotContext): Promise<void> {
  if (!requireAdmin(ctx)) return;
  const args = ctx.message?.text?.split(/\s+/).slice(1).map((a) => a.toLowerCase()) ?? [];
  if (!args.includes('confirm')) {
    await ctx.reply(
      '⚠️ This broadcasts the brief to the whole team and sends daily recaps *now*.\n' +
        'Re-run as `/morningsend confirm` (optionally with a date) to proceed.',
      { parse_mode: 'Markdown' },
    );
    return;
  }
  const date = dateArg(ctx);
  await ctx.reply(`Firing the real morning send for ${date}…`);
  await sendMorningSend(ctx.api, date);
}

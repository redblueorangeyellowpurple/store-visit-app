import { BotContext, requireAdmin } from '../../middleware/auth.js';
import { lastCompletedWeekSGT } from '../../../ai/run-flow.js';
import { sendWeeklyPreview, sendWeeklySend, type WeekSpan } from '../../../notifications/weekly.js';

// Manual triggers for the Monday weekly broadcast (normally fired by the weekly
// cron — see notifications/weekly.ts). Admin-only.

// A "YYYY-MM-DD" first arg picks that week (snapped to its Monday); otherwise
// the last completed Mon–Sun week.
function weekArg(ctx: BotContext): WeekSpan {
  const a = ctx.message?.text?.split(/\s+/)[1];
  if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) {
    const d = new Date(`${a}T00:00:00Z`);
    const sinceMonday = (d.getUTCDay() + 6) % 7;
    const monday = new Date(d.getTime() - sinceMonday * 86_400_000);
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    return { weekStart: monday.toISOString().slice(0, 10), weekEnd: sunday.toISOString().slice(0, 10) };
  }
  return lastCompletedWeekSGT();
}

// /weeklypreview [date] — preview the weekly ping. DMs only the invoker.
export async function handleWeeklyPreview(ctx: BotContext): Promise<void> {
  if (!requireAdmin(ctx)) return;
  const span = weekArg(ctx);
  await ctx.reply(`Running weekly preview for ${span.weekStart}..${span.weekEnd}…`);
  await sendWeeklyPreview(ctx.api, span, ctx.from?.id);
}

// /weeklysend [date] confirm — broadcast the weekly ping to all weekly
// recipients *now*. Requires the literal word "confirm".
export async function handleWeeklySend(ctx: BotContext): Promise<void> {
  if (!requireAdmin(ctx)) return;
  const args = ctx.message?.text?.split(/\s+/).slice(1).map((a) => a.toLowerCase()) ?? [];
  if (!args.includes('confirm')) {
    await ctx.reply(
      '⚠️ This pings every weekly recipient with the weekly-report link *now*.\n' +
        'Re-run as `/weeklysend confirm` (optionally with a Monday date) to proceed.',
      { parse_mode: 'Markdown' },
    );
    return;
  }
  const span = weekArg(ctx);
  await ctx.reply(`Firing the weekly send for ${span.weekStart}..${span.weekEnd}…`);
  await sendWeeklySend(ctx.api, span);
}

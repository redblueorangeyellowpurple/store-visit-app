import { BotContext, requireAdmin } from '../../middleware/auth.js';
import { runDailyIntelligenceFlow, sgtTodayISO } from '../../../ai/run-flow.js';
import { config } from '../../../config.js';

// Usage:
//   /runintelligence                         → today (SGT)
//   /runintelligence 2026-05-18              → specific date
//   /runintelligence 2026-05-18 dry          → preview (no writes, no broadcast)
//   /runintelligence 2026-05-18 nobroadcast  → write to DB but skip Telegram
//   /runintelligence today nobroadcast       → today + skip Telegram

export async function handleRunIntelligence(ctx: BotContext): Promise<void> {
  if (!requireAdmin(ctx)) return;

  const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
  const dateArg = args[0]?.toLowerCase();
  const modeArg = args[1]?.toLowerCase();

  const reportDate =
    !dateArg || dateArg === 'today'
      ? sgtTodayISO()
      : /^\d{4}-\d{2}-\d{2}$/.test(dateArg)
      ? dateArg
      : null;

  if (!reportDate) {
    await ctx.reply(
      'Usage: `/runintelligence [YYYY-MM-DD] [dry|nobroadcast]`\n\n' +
        'Examples:\n' +
        '• `/runintelligence` — today\n' +
        '• `/runintelligence 2026-05-18`\n' +
        '• `/runintelligence today dry` — preview only\n' +
        '• `/runintelligence 2026-05-18 nobroadcast`',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const dryRun = modeArg === 'dry';
  const skipTelegram = modeArg === 'nobroadcast' || dryRun;

  if (!config.anthropic.apiKey) {
    await ctx.reply(
      `⚠️ \`ANTHROPIC_API_KEY\` not set on the bot service. Add it in Railway and redeploy, then try again.\n\n` +
        `For demo-only data, use \`npm run intelligence:seed\` on your laptop instead.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  await ctx.reply(
    `🧠 Running intelligence for *${reportDate}*${dryRun ? ' (dry-run)' : ''}${
      skipTelegram && !dryRun ? ' (no broadcast)' : ''
    }…`,
    { parse_mode: 'Markdown' },
  );

  try {
    const result = await runDailyIntelligenceFlow({
      date: reportDate,
      dryRun,
      skipTelegram,
    });

    if (result.status === 'no_visits') {
      await ctx.reply(`No locked & unanalyzed visits found for ${reportDate}. Nothing to run.`);
      return;
    }
    if (result.status === 'lock_failed') {
      await ctx.reply('⚠️ Another intelligence run is in progress. Try again in a minute.');
      return;
    }
    if (result.status === 'null_result') {
      await ctx.reply('❌ Claude run returned null. Check bot logs for details.');
      return;
    }
    if (result.status === 'validation_failed') {
      await ctx.reply(
        `❌ Validation failed: ${result.message ?? 'unknown'}\n\nNothing written. Re-run with \`dry\` to preview.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }
    if (result.status === 'report_insert_failed') {
      await ctx.reply('❌ Report insert failed. Memory notes are in DB but no report row exists.');
      return;
    }

    if (dryRun) {
      const preview = (result.briefPreview ?? '').slice(0, 1500);
      await ctx.reply(
        `*Dry-run preview* — ${result.visits} visits, ${result.notesWritten} note updates queued.\n\n` +
          '```\n' +
          preview +
          ((result.briefPreview?.length ?? 0) > 1500 ? '\n…(truncated)' : '') +
          '\n```\n\n_No DB writes, no broadcast._',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    await ctx.reply(
      `✅ *Brief generated for ${reportDate}* (v${result.report?.version})\n\n` +
        `• Visits analyzed: *${result.visits}*\n` +
        `• Notes written: *${result.notesWritten}*\n` +
        `• Edges: *${result.edgesUpserted}*\n` +
        `• Tokens: ${result.promptTokens} in / ${result.completionTokens} out\n` +
        (skipTelegram
          ? '• Broadcast: _skipped_\n'
          : `• Broadcast: *${result.bcastSent ?? 0} sent*${(result.bcastFailed ?? 0) > 0 ? `, ${result.bcastFailed} failed` : ''}\n`) +
        `\nView on dashboard: */intelligence*`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ Run failed: \`${msg}\`\n\nCheck bot logs for the full stack.`, {
      parse_mode: 'Markdown',
    });
  }
}

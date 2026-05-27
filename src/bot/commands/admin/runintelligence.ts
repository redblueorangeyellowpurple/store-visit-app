import { BotContext, requireAdmin } from '../../middleware/auth.js';
import { runDailyIntelligenceFlow, sgtTodayISO, type RunFlowResult } from '../../../ai/run-flow.js';
import { config } from '../../../config.js';

function fmtNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** One-line cost+token summary for the admin reply. */
function formatCost(r: RunFlowResult): string {
  const inTok = r.promptTokens ?? 0;
  const outTok = r.completionTokens ?? 0;
  const cachedRead = r.cacheReadTokens ?? 0;
  const cost = r.costUsd ?? 0;
  return `• Tokens: in ${fmtNum(inTok)} (cached ${fmtNum(cachedRead)}) · out ${fmtNum(outTok)}\n` +
    `• 💰 Cost: *~$${cost.toFixed(4)}*`;
}

// Usage:
//   /runintelligence                         → today (SGT)
//   /runintelligence 2026-05-18              → specific date
//   /runintelligence 2026-05-18 dry          → preview (no writes, no broadcast)
//   /runintelligence 2026-05-18 nobroadcast  → write to DB but skip Telegram
//   /runintelligence today nobroadcast       → today + skip Telegram
//   /runintelligence 2026-05-18 force        → regenerate even if report exists
//   /runintelligence 2026-05-18 dry force    → preview AND ignore existing (dry already ignores)

export async function handleRunIntelligence(ctx: BotContext): Promise<void> {
  if (!requireAdmin(ctx)) return;

  const args = ctx.message?.text?.split(/\s+/).slice(1) ?? [];
  const dateArg = args[0]?.toLowerCase();
  // Remaining args (positions 1..N) act as flags — order-independent.
  const flags = new Set(args.slice(1).map((a) => a.toLowerCase()));

  const reportDate =
    !dateArg || dateArg === 'today'
      ? sgtTodayISO()
      : /^\d{4}-\d{2}-\d{2}$/.test(dateArg)
      ? dateArg
      : null;

  if (!reportDate) {
    await ctx.reply(
      'Usage: `/runintelligence [YYYY-MM-DD] [dry] [nobroadcast] [force]`\n\n' +
        'Examples:\n' +
        '• `/runintelligence` — today\n' +
        '• `/runintelligence 2026-05-18`\n' +
        '• `/runintelligence today dry` — preview only (no Claude write, still costs tokens)\n' +
        '• `/runintelligence 2026-05-18 nobroadcast`\n' +
        '• `/runintelligence 2026-05-18 force` — regenerate even if report exists',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const dryRun = flags.has('dry');
  const skipTelegram = flags.has('nobroadcast') || dryRun;
  const force = flags.has('force');

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
      force,
    });

    if (result.status === 'no_visits') {
      await ctx.reply(`No locked & unanalyzed visits found for ${reportDate}. Nothing to run.`);
      return;
    }
    if (result.status === 'report_exists') {
      await ctx.reply(
        `🛑 Report *v${result.report?.version}* already exists for *${reportDate}*. ` +
          `Each run costs ~$0.18, so re-runs are blocked by default.\n\n` +
          `Append \`force\` to regenerate: \`/runintelligence ${reportDate} force\``,
        { parse_mode: 'Markdown' },
      );
      return;
    }
    if (result.status === 'lock_failed') {
      await ctx.reply('⚠️ Another intelligence run is in progress. Try again in a minute.');
      return;
    }
    if (result.status === 'null_result') {
      const reason = result.message ?? 'unknown reason';
      const costNote = result.costUsd
        ? `\n\n💰 *Partial cost incurred:* ~$${result.costUsd.toFixed(4)} (Claude was billed before the failure).`
        : '\n\n💰 *No cost incurred* (request rejected before token use).';
      await ctx.reply(
        `❌ *Claude run failed*\n\n${reason}${costNote}\n\n` +
          `⚠️ Don't keep retrying — every attempt that reaches Claude can cost tokens. Wait or fix the root cause first.`,
        { parse_mode: 'Markdown' },
      );
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

    const costLine = formatCost(result);

    if (dryRun) {
      // For dry-run, show what the Telegram broadcast would look like — that's
      // the format Wilson is iterating on. The full dashboard brief is in
      // briefPreview but skipped here to keep the reply scannable.
      const tgPreview = (result.telegramPreview ?? '').slice(0, 1500);
      await ctx.reply(
        `*Dry-run preview* — ${result.visits} visits, ${result.notesWritten} note updates queued.\n\n` +
          `*Telegram message (what recipients would see):*\n\`\`\`\n` +
          tgPreview +
          `\n\`\`\`\n\n` +
          costLine +
          '\n_No DB writes, no broadcast. Full dashboard brief is in the bot logs._',
        { parse_mode: 'Markdown' },
      );
      return;
    }

    await ctx.reply(
      `✅ *Brief generated for ${reportDate}* (v${result.report?.version})\n\n` +
        `• Visits analyzed: *${result.visits}*\n` +
        `• Notes written: *${result.notesWritten}*\n` +
        `• Edges: *${result.edgesUpserted}*\n` +
        costLine + '\n' +
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

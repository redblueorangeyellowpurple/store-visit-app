/**
 * Daily intelligence orchestration — shared by:
 *   - scripts/daily-intelligence.ts (CLI)
 *   - src/cron/intelligence-cron.ts (Railway cron)
 *   - src/bot/commands/admin/runintelligence.ts (Telegram admin)
 *
 * Returns a status enum + diagnostic fields. Callers translate to exit codes
 * (CLI), log lines (cron), or chat replies (admin command).
 */

import {
  getVisitsForReportDate,
  getAllCurrentMemoryNotes,
  insertMemoryNoteVersion,
  upsertMemoryEdges,
  insertIntelligenceReport,
  getReportForDate,
  markVisitsAnalyzed,
  acquireIntelligenceLock,
  releaseIntelligenceLock,
} from '../db/queries/intelligence.js';
import { getIntelligencePauseState } from '../db/queries/settings.js';
import {
  runDailyIntelligence,
  validateRunResult,
} from './daily-intelligence.js';
import { broadcastIntelligenceBrief } from '../bot/broadcast-intelligence.js';

export type RunFlowStatus =
  | 'ok'
  | 'no_visits'
  | 'lock_failed'
  | 'null_result'
  | 'validation_failed'
  | 'report_insert_failed'
  | 'report_exists'
  | 'paused';

export interface RunFlowResult {
  status: RunFlowStatus;
  message?: string;
  dryRun: boolean;
  visits: number;
  notesIn: number;
  notesWritten: number;
  edgesUpserted: number;
  promptTokens?: number;
  completionTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  costUsd?: number;
  report?: { id: string; version: number };
  bcastSent?: number;
  bcastFailed?: number;
  briefPreview?: string;
  telegramPreview?: string;
}

export interface RunFlowOpts {
  date: string;
  dryRun?: boolean;
  skipTelegram?: boolean;
  /** Regenerate even if a report already exists for this date. Default false. */
  force?: boolean;
  log?: (line: string) => void;
}

export async function runDailyIntelligenceFlow(opts: RunFlowOpts): Promise<RunFlowResult> {
  const log = opts.log ?? ((l) => console.log(l));
  const dryRun = !!opts.dryRun;
  const skipTelegram = !!opts.skipTelegram;
  const force = !!opts.force;

  log('─'.repeat(70));
  log(`SVA Daily Intelligence — report_date=${opts.date}  dry_run=${dryRun}  skip_telegram=${skipTelegram}  force=${force}`);
  log('─'.repeat(70));

  // Kill switch: refuse before any Claude call (and before any DB writes) if
  // /stopintelligence has been called. Force does NOT override — the operator
  // must explicitly /resumeintelligence to undo the pause.
  const pauseState = await getIntelligencePauseState();
  if (pauseState.paused) {
    const reasonSuffix = pauseState.reason ? ` Reason: ${pauseState.reason}` : '';
    const bySuffix = pauseState.paused_by ? ` (paused by ${pauseState.paused_by})` : '';
    log(`Intelligence is PAUSED${bySuffix}.${reasonSuffix} Refusing run.`);
    return {
      status: 'paused',
      message: `Intelligence is paused${bySuffix}.${reasonSuffix} Use /resumeintelligence to re-enable.`,
      dryRun,
      visits: 0,
      notesIn: 0,
      notesWritten: 0,
      edgesUpserted: 0,
    };
  }

  // Cost guard: refuse to spend Claude tokens for a date that already has a
  // committed report unless the caller passed force=true. Dry-runs bypass this
  // because they're explicitly previews, not duplicates.
  if (!dryRun && !force) {
    const existing = await getReportForDate(opts.date);
    if (existing) {
      return {
        status: 'report_exists',
        message: `Report v${existing.version} already exists for ${opts.date}. Append \`force\` to regenerate.`,
        dryRun: false,
        visits: 0,
        notesIn: 0,
        notesWritten: 0,
        edgesUpserted: 0,
        report: { id: existing.id, version: existing.version },
      };
    }
  }

  const lockAcquired = await acquireIntelligenceLock();
  if (!lockAcquired) {
    return {
      status: 'lock_failed',
      message: 'Could not acquire advisory lock — another run in progress?',
      dryRun,
      visits: 0,
      notesIn: 0,
      notesWritten: 0,
      edgesUpserted: 0,
    };
  }

  try {
    const visits = await getVisitsForReportDate(opts.date);
    log(`Visits: ${visits.length} locked & unanalyzed for ${opts.date}`);
    if (visits.length === 0) {
      return {
        status: 'no_visits',
        message: 'No visits — nothing to report.',
        dryRun,
        visits: 0,
        notesIn: 0,
        notesWritten: 0,
        edgesUpserted: 0,
      };
    }

    const notes = await getAllCurrentMemoryNotes();
    log(`Memory: ${notes.length} current notes`);

    log('Calling Claude…');
    const outcome = await runDailyIntelligence({
      reportDate: opts.date,
      visits,
      notes,
    });
    if (!outcome.ok) {
      log(`Claude run failed: ${outcome.reason}${outcome.partial_cost_usd ? ` (partial cost ~$${outcome.partial_cost_usd.toFixed(4)})` : ''}`);
      return {
        status: 'null_result',
        message: outcome.reason,
        dryRun,
        visits: visits.length,
        notesIn: notes.length,
        notesWritten: 0,
        edgesUpserted: 0,
        costUsd: outcome.partial_cost_usd,
      };
    }
    const result = outcome.result;
    log(
      `Claude returned: model=${result.model}  in=${result.prompt_tokens}  out=${result.completion_tokens}  cached_read=${result.cache_read_tokens}  cached_write=${result.cache_creation_tokens}  cost≈$${result.cost_usd.toFixed(4)}`,
    );

    const validation = validateRunResult(result, { previousNotes: notes, visits });
    if (validation.warnings.length > 0) {
      log('Validation warnings:');
      for (const w of validation.warnings) log(`  - ${w}`);
    }
    if (!validation.ok) {
      return {
        status: 'validation_failed',
        message: `Validation failed: ${validation.reason}`,
        dryRun,
        visits: visits.length,
        notesIn: notes.length,
        notesWritten: 0,
        edgesUpserted: 0,
        promptTokens: result.prompt_tokens,
        completionTokens: result.completion_tokens,
        cacheReadTokens: result.cache_read_tokens,
        cacheCreationTokens: result.cache_creation_tokens,
        costUsd: result.cost_usd,
        briefPreview: result.brief_markdown.slice(0, 1000),
        telegramPreview: result.telegram_summary,
      };
    }

    if (dryRun) {
      log('─'.repeat(70));
      log('DRY RUN — Telegram summary:');
      log('─'.repeat(70));
      log(result.telegram_summary);
      log('─'.repeat(70));
      log('DRY RUN — full brief (dashboard):');
      log('─'.repeat(70));
      log(result.brief_markdown);
      log('─'.repeat(70));
      log(`Notes to update/create: ${result.note_updates.length}`);
      log(`Edges to upsert: ${result.edges.length}`);
      log(`Themes promoted: ${result.stats.themes_promoted}  New notes: ${result.stats.new_notes}`);
      return {
        status: 'ok',
        dryRun: true,
        visits: visits.length,
        notesIn: notes.length,
        notesWritten: 0,
        edgesUpserted: 0,
        promptTokens: result.prompt_tokens,
        completionTokens: result.completion_tokens,
        cacheReadTokens: result.cache_read_tokens,
        cacheCreationTokens: result.cache_creation_tokens,
        costUsd: result.cost_usd,
        briefPreview: result.brief_markdown,
        telegramPreview: result.telegram_summary,
      };
    }

    let notesWritten = 0;
    for (const note of result.note_updates) {
      const v = await insertMemoryNoteVersion(note);
      if (v !== null) notesWritten++;
    }
    log(`Notes written: ${notesWritten}/${result.note_updates.length}`);

    const edgesOk = await upsertMemoryEdges(result.edges);
    log(`Edges upserted: ${result.edges.length} (ok=${edgesOk})`);

    const report = await insertIntelligenceReport(opts.date, {
      brief_markdown: result.brief_markdown,
      stats: result.stats as unknown as Record<string, unknown>,
      visit_ids: visits.map((v) => v.id),
      model: result.model,
      prompt_tokens: result.prompt_tokens,
      completion_tokens: result.completion_tokens,
    });
    if (!report) {
      return {
        status: 'report_insert_failed',
        message: 'Report insert failed.',
        dryRun: false,
        visits: visits.length,
        notesIn: notes.length,
        notesWritten,
        edgesUpserted: edgesOk ? result.edges.length : 0,
        promptTokens: result.prompt_tokens,
        completionTokens: result.completion_tokens,
        cacheReadTokens: result.cache_read_tokens,
        cacheCreationTokens: result.cache_creation_tokens,
        costUsd: result.cost_usd,
      };
    }
    log(`Report inserted: id=${report.id} version=${report.version}`);

    const marked = await markVisitsAnalyzed(visits.map((v) => v.id));
    log(`Marked ${visits.length} visits analyzed (ok=${marked})`);

    let bcastSent = 0;
    let bcastFailed = 0;
    if (skipTelegram) {
      log('skipTelegram=true — not broadcasting.');
    } else {
      log('Broadcasting to intelligence recipients…');
      const bcast = await broadcastIntelligenceBrief({
        telegramSummary: result.telegram_summary,
        reportDate: opts.date,
      });
      bcastSent = bcast.sent;
      bcastFailed = bcast.failed.length;
      log(`Broadcast: sent=${bcast.sent} failed=${bcast.failed.length}`);
      for (const f of bcast.failed) log(`  failed to ${f.telegram_id}: ${f.error}`);
    }

    return {
      status: 'ok',
      dryRun: false,
      visits: visits.length,
      notesIn: notes.length,
      notesWritten,
      edgesUpserted: edgesOk ? result.edges.length : 0,
      promptTokens: result.prompt_tokens,
      completionTokens: result.completion_tokens,
      cacheReadTokens: result.cache_read_tokens,
      cacheCreationTokens: result.cache_creation_tokens,
      costUsd: result.cost_usd,
      report: { id: report.id, version: report.version },
      bcastSent,
      bcastFailed,
    };
  } finally {
    await releaseIntelligenceLock();
  }
}

export function sgtTodayISO(): string {
  const sgt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return sgt.toISOString().slice(0, 10);
}

export function sgtYesterdayISO(): string {
  const sgt = new Date(Date.now() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return sgt.toISOString().slice(0, 10);
}

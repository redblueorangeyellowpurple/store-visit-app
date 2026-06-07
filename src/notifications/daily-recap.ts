import { Api, InlineKeyboard } from 'grammy';
import { config } from '../config.js';
import { getSetting } from '../db/queries/settings.js';
import { getRecapRecipients, getCMDailyRecap, type RecapData } from '../db/queries/recap.js';

// Daily per-CM recap: a no-AI summary of the CM's previous day, DM'd each
// morning. Master on/off lives in sva.settings ('daily_recaps_enabled'); the
// recipient set is the is_recap_recipient flag. Both default off, so this is
// inert until switched on in the dashboard.

export const RECAP_ENABLED_KEY = 'daily_recaps_enabled';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Telegram legacy Markdown parses _ * ` [ in body text. Store names + follow-up
// titles are user input — escape so a stray asterisk can't 400 the send.
function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, '\\$1');
}

// 'YYYY-MM-DD' → 'Tue, 3 Jun' (timezone-independent — pure calendar date).
function prettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]}, ${d} ${MON[m - 1]}`;
}

function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function dueLabel(due: string | null, todayISO: string): string {
  if (!due) return '';
  if (due < todayISO) return ' · ⚠️ overdue';
  if (due === todayISO) return ' · due today';
  return ` · due ${prettyDate(due)}`;
}

// When a follow-up was logged, for the 48h KPI. A breach (>48h still open) gets
// the ⏰ marker; otherwise just a quiet "logged Nd ago".
function ageLabel(daysAgo: number, breach: boolean): string {
  if (breach) return ` · ⏰ ${daysAgo}d open`;
  if (daysAgo <= 0) return ' · logged today';
  return ` · logged ${daysAgo}d ago`;
}

const FU_LIMIT = 5; // show at most this many follow-ups inline, then "+N more"

// True when there's genuinely nothing worth sending — no visits, no missed
// plans, no open follow-ups. We skip these so a quiet day isn't a nag.
export function isRecapEmpty(d: RecapData): boolean {
  return (
    d.visitedStores.length === 0 &&
    d.plannedMissed.length === 0 &&
    d.followUpOpenTotal === 0 &&
    d.pendingFeedback.length === 0
  );
}

const FB_LIMIT = 5; // show at most this many feedback visits inline, then "+N more"

function feedbackBits(f: RecapData['pendingFeedback'][number]): string {
  return [
    f.fixes > 0 ? `${f.fixes} fix${f.fixes !== 1 ? 'es' : ''}` : null,
    f.comments > 0 ? `${f.comments} comment${f.comments !== 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');
}

// Inline "open the viewer" buttons for each pending-feedback visit. We use
// buttons (not a Markdown text link) because the mini-app deep-link URL carries
// underscores (startapp=visit_…) that legacy Markdown can mis-parse — the same
// reason every other mini-app link in this codebase is a kb.url button.
export function buildRecapKeyboard(d: RecapData): InlineKeyboard | undefined {
  if (d.pendingFeedback.length === 0 || !config.broadcast.botUsername) return undefined;
  const kb = new InlineKeyboard();
  for (const f of d.pendingFeedback.slice(0, FB_LIMIT)) {
    const url = `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}?startapp=visit_${f.visitId}`;
    kb.url(`⬚ ${f.store}`, url).row();
  }
  return kb;
}

export function buildRecapMessage(name: string, date: string, d: RecapData): string {
  const todayISO = addDaysISO(date, 1);
  const lines: string[] = [];

  lines.push(`☀️ *Morning, ${escapeMd(name)}!* Your yesterday — ${prettyDate(date)}`);

  // Stores visited
  lines.push('');
  if (d.visitedStores.length > 0) {
    lines.push(`🏬 *Stores visited: ${d.visitedStores.length}*`);
    for (const s of d.visitedStores) lines.push(`• ${escapeMd(s)}`);
  } else {
    lines.push('🏬 *No store visits logged yesterday.*');
  }

  // Engagements
  if (d.engagementCount > 0) {
    const ppl = `${d.engagementCount} ${d.engagementCount === 1 ? 'person' : 'people'}`;
    const trained = d.trainedCount > 0 ? ` (${d.trainedCount} trained)` : '';
    lines.push('');
    lines.push(`👥 *Engagements: ${ppl}*${trained}`);
  }

  // Planned vs done — only when there was a plan or a walk-in to report.
  if (d.plannedExecuted.length || d.plannedMissed.length || d.walkIns.length) {
    lines.push('');
    lines.push('📋 *Planned vs done*');
    for (const s of d.plannedExecuted) lines.push(`✓ ${escapeMd(s)}`);
    for (const s of d.walkIns) lines.push(`＋ ${escapeMd(s)} _(walk-in)_`);
    for (const s of d.plannedMissed) lines.push(`✗ ${escapeMd(s)} _(planned, missed)_`);
  }

  // Open follow-ups — with logged-age + the 48h KPI flag (⏰) so anything left
  // open past the window is impossible to miss.
  if (d.followUpOpenTotal > 0) {
    lines.push('');
    const kpi = d.followUpKpiBreaches > 0 ? ` · ⏰ ${d.followUpKpiBreaches} past 48h` : '';
    lines.push(`📌 *Open follow-ups: ${d.followUpOpenTotal}*${kpi}`);
    for (const f of d.openFollowUps.slice(0, FU_LIMIT)) {
      lines.push(`• ${escapeMd(f.title)} · ${escapeMd(f.store)}${dueLabel(f.due, todayISO)}${ageLabel(f.openedDaysAgo, f.kpiBreach)}`);
    }
    if (d.followUpOpenTotal > FU_LIMIT) lines.push(`_+${d.followUpOpenTotal - FU_LIMIT} more_`);
  }

  // AM feedback to review — boxed fixes + comments left on your visits. The
  // tap-through buttons are attached via buildRecapKeyboard at send time.
  if (d.pendingFeedback.length > 0) {
    lines.push('');
    lines.push(`⬚ *Feedback to review: ${d.pendingFeedback.length}*`);
    for (const f of d.pendingFeedback.slice(0, FB_LIMIT)) {
      lines.push(`• ${escapeMd(f.store)} — ${feedbackBits(f)}`);
      for (const s of f.commentSnippets) lines.push(`   💬 _${escapeMd(s)}_`);
    }
    if (d.pendingFeedback.length > FB_LIMIT) lines.push(`_+${d.pendingFeedback.length - FB_LIMIT} more_`);
    lines.push('_Tap a store below to see what to fix._');
  }

  lines.push('');
  lines.push('Have a great one 💪');
  return lines.join('\n');
}

export interface RecapSendResult {
  recipients: number;
  sent: number;
  failed: number;
  skippedEmpty: number;
}

// Send the recap to every opted-in CM for the given SGT date. Honours the master
// switch unless force=true. Empty days are skipped (not sent).
export async function sendDailyRecaps(
  botApi: Api,
  date: string,
  opts: { force?: boolean } = {},
): Promise<RecapSendResult | { disabled: true }> {
  if (!opts.force) {
    const enabled = (await getSetting(RECAP_ENABLED_KEY)) === 'true';
    if (!enabled) {
      console.log('[recap] daily_recaps_enabled != true — skipping send');
      return { disabled: true };
    }
  }

  const recipients = await getRecapRecipients();
  let sent = 0;
  let failed = 0;
  let skippedEmpty = 0;

  for (const r of recipients) {
    const data = await getCMDailyRecap(r.telegram_id, date);
    if (!data) {
      failed++;
      continue;
    }
    if (isRecapEmpty(data)) {
      skippedEmpty++;
      continue;
    }
    const name = r.nickname || r.full_name;
    try {
      await botApi.sendMessage(r.telegram_id, buildRecapMessage(name, date, data), {
        parse_mode: 'Markdown',
        reply_markup: buildRecapKeyboard(data),
      });
      sent++;
    } catch (err) {
      failed++;
      console.error(`[recap] send to ${r.telegram_id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`[recap] ${date}: recipients=${recipients.length} sent=${sent} failed=${failed} skippedEmpty=${skippedEmpty}`);
  return { recipients: recipients.length, sent, failed, skippedEmpty };
}

export interface RecapPreview {
  willReceive: string[]; // CM display names whose recap is non-empty (will be sent)
  recipients: number;    // total opted-in recipients considered
  skippedEmpty: number;  // recipients whose day was empty (skipped)
}

// Dry-run the recap send for the morning preview: which opted-in CMs WILL get a
// daily brief at 09:00. Mirrors sendDailyRecaps' recipient + empty-skip logic
// exactly (same queries, same isRecapEmpty) so the 08:00 preview matches the
// 09:00 send. Ignores the master switch — a preview should show what's queued
// even while the switch is being decided.
export async function previewRecapRecipients(date: string): Promise<RecapPreview> {
  const recipients = await getRecapRecipients();
  const willReceive: string[] = [];
  let skippedEmpty = 0;
  for (const r of recipients) {
    const data = await getCMDailyRecap(r.telegram_id, date);
    if (!data || isRecapEmpty(data)) {
      skippedEmpty++;
      continue;
    }
    willReceive.push(r.nickname || r.full_name);
  }
  return { willReceive, recipients: recipients.length, skippedEmpty };
}

// Build + DM a single recap, bypassing the master switch and recipient flag.
// Used by /testrecap and the dashboard "Send test" button. The recap is BUILT
// from dataForTelegramId's visits (defaults to the recipient) but always SENT to
// sendToTelegramId — so an AM can preview a real field CM's recap without that
// CM's data ever being assembled into someone who isn't them.
export async function sendTestRecap(
  botApi: Api,
  sendToTelegramId: number,
  name: string,
  date: string,
  dataForTelegramId: number = sendToTelegramId,
): Promise<{ ok: boolean; empty: boolean }> {
  const data = await getCMDailyRecap(dataForTelegramId, date);
  if (!data) return { ok: false, empty: false };
  const empty = isRecapEmpty(data);
  const msg = '🧪 *Test recap* — only you can see this.\n\n' + buildRecapMessage(name, date, data);
  try {
    await botApi.sendMessage(sendToTelegramId, msg, {
      parse_mode: 'Markdown',
      reply_markup: buildRecapKeyboard(data),
    });
    return { ok: true, empty };
  } catch (err) {
    console.error('[recap] test send failed:', err instanceof Error ? err.message : err);
    return { ok: false, empty };
  }
}

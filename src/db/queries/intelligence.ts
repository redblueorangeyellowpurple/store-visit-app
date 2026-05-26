import { supabase } from '../client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MemoryNote {
  id: string;
  slug: string;
  scope: 'store' | 'person' | 'theme' | 'channel';
  scope_ref: string;
  title: string;
  summary: string;
  body_markdown: string;
  related_slugs: string[];
  version: number;
  last_touched_at: string;
  edited_by_human: boolean;
  created_at: string;
  tier?: 'short' | 'long';
}

export interface MemoryNoteWrite {
  slug: string;
  scope: 'store' | 'person' | 'theme' | 'channel';
  scope_ref: string;
  title: string;
  summary: string;
  body_markdown: string;
  related_slugs: string[];
}

export interface MemoryEdgeWrite {
  from_slug: string;
  to_slug: string;
  edge_type: 'store_theme' | 'person_store' | 'person_theme' | 'theme_theme';
}

export interface IntelligenceReport {
  id: string;
  report_date: string;
  version: number;
  brief_markdown: string;
  stats: Record<string, unknown>;
  visit_ids: string[];
  model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  edited_by_human: boolean;
  created_at: string;
}

export interface VisitForReport {
  id: string;
  store_id: string;
  store_name: string;
  cm_telegram_id: number;
  cm_full_name: string;
  visit_date: string;
  locked_at: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  training: string | null;
}

// ─── Visit selection ──────────────────────────────────────────────────────────

/**
 * Visits that should be folded into the report for `reportDate`:
 *   - locked (is_locked = true)
 *   - not yet analyzed (analyzed_at IS NULL)
 *   - locked on this date (DATE(locked_at) = reportDate)
 *
 * Late submissions naturally land in the brief for the date they were locked.
 */
export async function getVisitsForReportDate(
  reportDate: string,
): Promise<VisitForReport[]> {
  const { data, error } = await supabase
    .from('visits')
    .select(`
      id, store_id, cm_telegram_id, visit_date, locked_at,
      good_news, competitors, display_stock, follow_up, buzz_plan, training,
      stores ( name ),
      cms!visits_cm_telegram_id_fkey ( full_name )
    `)
    .eq('is_locked', true)
    .is('analyzed_at', null)
    .gte('locked_at', `${reportDate}T00:00:00+08:00`)
    .lt('locked_at', `${reportDate}T23:59:59.999+08:00`)
    .order('locked_at', { ascending: true });

  if (error) {
    console.error('getVisitsForReportDate error:', error);
    throw new Error(`visit query failed: ${error.message} [${error.code ?? '?'}]`);
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    store_id: row.store_id,
    store_name: row.stores?.name ?? 'Unknown',
    cm_telegram_id: row.cm_telegram_id,
    cm_full_name: row.cms?.full_name ?? 'Unknown CM',
    visit_date: row.visit_date,
    locked_at: row.locked_at,
    good_news: row.good_news,
    competitors: row.competitors,
    display_stock: row.display_stock,
    follow_up: row.follow_up,
    buzz_plan: row.buzz_plan,
    training: row.training,
  }));
}

export async function markVisitsAnalyzed(visitIds: string[]): Promise<boolean> {
  if (visitIds.length === 0) return true;
  const { error } = await supabase
    .from('visits')
    .update({ analyzed_at: new Date().toISOString() })
    .in('id', visitIds);
  if (error) {
    console.error('markVisitsAnalyzed error:', error);
    return false;
  }
  return true;
}

// ─── Memory notes ─────────────────────────────────────────────────────────────

export async function getAllCurrentMemoryNotes(): Promise<MemoryNote[]> {
  const { data, error } = await supabase
    .from('v_memory_notes_current')
    .select('*');
  if (error) {
    console.error('getAllCurrentMemoryNotes error:', error);
    throw new Error(`memory note query failed: ${error.message} [${error.code ?? '?'}]`);
  }
  return (data as MemoryNote[]) ?? [];
}

export async function getMemoryNotesBySlugs(
  slugs: string[],
): Promise<MemoryNote[]> {
  if (slugs.length === 0) return [];
  const { data, error } = await supabase
    .from('v_memory_notes_current')
    .select('*')
    .in('slug', slugs);
  if (error) {
    console.error('getMemoryNotesBySlugs error:', error);
    return [];
  }
  return (data as MemoryNote[]) ?? [];
}

/**
 * Inserts the next version of a memory note for the given slug.
 * If the slug doesn't exist yet, starts at version 1.
 * Returns the new version number, or null on error.
 */
export async function insertMemoryNoteVersion(
  note: MemoryNoteWrite,
  options: { edited_by_human?: boolean } = {},
): Promise<number | null> {
  const { data: existing, error: vErr } = await supabase
    .from('memory_notes')
    .select('version')
    .eq('slug', note.slug)
    .order('version', { ascending: false })
    .limit(1);

  if (vErr) {
    console.error('insertMemoryNoteVersion lookup error:', vErr);
    return null;
  }

  const nextVersion = (existing?.[0]?.version ?? 0) + 1;

  const { error } = await supabase.from('memory_notes').insert({
    slug: note.slug,
    scope: note.scope,
    scope_ref: note.scope_ref,
    title: note.title,
    summary: note.summary,
    body_markdown: note.body_markdown,
    related_slugs: note.related_slugs,
    version: nextVersion,
    last_touched_at: new Date().toISOString(),
    edited_by_human: options.edited_by_human ?? false,
  });

  if (error) {
    console.error('insertMemoryNoteVersion error:', error);
    return null;
  }
  return nextVersion;
}

export async function upsertMemoryEdges(
  edges: MemoryEdgeWrite[],
): Promise<boolean> {
  if (edges.length === 0) return true;
  const { error } = await supabase
    .from('memory_edges')
    .upsert(edges, { onConflict: 'from_slug,to_slug,edge_type', ignoreDuplicates: true });
  if (error) {
    console.error('upsertMemoryEdges error:', error);
    return false;
  }
  return true;
}

// ─── Reports ──────────────────────────────────────────────────────────────────

export async function insertIntelligenceReport(
  reportDate: string,
  data: {
    brief_markdown: string;
    stats: Record<string, unknown>;
    visit_ids: string[];
    model: string | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
  },
): Promise<IntelligenceReport | null> {
  const { data: existing, error: vErr } = await supabase
    .from('intelligence_reports')
    .select('version')
    .eq('report_date', reportDate)
    .order('version', { ascending: false })
    .limit(1);

  if (vErr) {
    console.error('insertIntelligenceReport lookup error:', vErr);
    return null;
  }

  const nextVersion = (existing?.[0]?.version ?? 0) + 1;

  const { data: inserted, error } = await supabase
    .from('intelligence_reports')
    .insert({
      report_date: reportDate,
      version: nextVersion,
      brief_markdown: data.brief_markdown,
      stats: data.stats,
      visit_ids: data.visit_ids,
      model: data.model,
      prompt_tokens: data.prompt_tokens,
      completion_tokens: data.completion_tokens,
    })
    .select()
    .single();

  if (error) {
    console.error('insertIntelligenceReport error:', error);
    return null;
  }
  return inserted as IntelligenceReport;
}

export async function getReportForDate(
  reportDate: string,
): Promise<IntelligenceReport | null> {
  const { data, error } = await supabase
    .from('v_intelligence_reports_current')
    .select('*')
    .eq('report_date', reportDate)
    .maybeSingle();
  if (error) {
    console.error('getReportForDate error:', error);
    return null;
  }
  return data as IntelligenceReport | null;
}

// ─── Recipients ───────────────────────────────────────────────────────────────

export interface IntelligenceRecipient {
  telegram_id: number;
  full_name: string;
}

export async function getIntelligenceRecipients(): Promise<IntelligenceRecipient[]> {
  const { data, error } = await supabase
    .from('cms')
    .select('telegram_id, full_name')
    .eq('is_intelligence_recipient', true)
    .eq('is_active', true);
  if (error) {
    console.error('getIntelligenceRecipients error:', error);
    return [];
  }
  return (data as IntelligenceRecipient[]) ?? [];
}

// ─── Advisory lock (placeholder — v1 cron is single-threaded on Railway) ─────
// pg_try_advisory_lock is a Postgres built-in, but invoking it from Supabase
// requires a wrapper SQL function. Skipping for v1 — add when dashboard edit
// UI lands, where concurrent writes could actually collide.

export async function acquireIntelligenceLock(): Promise<boolean> {
  return true;
}

export async function releaseIntelligenceLock(): Promise<void> {
  // no-op
}

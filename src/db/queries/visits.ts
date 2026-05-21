import { supabase } from '../client.js';
import { ParsedSections } from '../../utils/parse-template.js';

export interface Visit {
  id: string;
  store_id: string;
  cm_telegram_id: number;
  visit_date: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  training: string | null;
  people_training: string | null;
  grade: 1 | 2 | 3 | null;
  grade_comments: string | null;
  is_locked: boolean;
  locked_at: string | null;
  submitted_at: string | null;
  edited_at: string | null;
  created_at: string;
}

// Maps the v2 prompt key to the visits column the conversation persists into.
// Kept here (not in the conversation file) so other code paths — resume,
// visit-details — can use the same mapping.
export const V2_PROMPT_COLUMN = {
  good_news:       'good_news',
  people_training: 'people_training',
  competitor:      'competitors',
  display_stock:   'display_stock',
} as const;

export type V2PromptKey = keyof typeof V2_PROMPT_COLUMN;

export async function createVisit(data: {
  store_id: string;
  cm_telegram_id: number;
  grade?: 1 | 2 | 3 | null;
  grade_comments?: string | null;
}): Promise<Visit | null> {
  const { data: row, error } = await supabase
    .from('visits')
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error('createVisit error:', error);
    return null;
  }
  return row as Visit;
}

export async function setVisitGrade(
  visitId: string,
  grade: 1 | 2 | 3,
  comments: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('visits')
    .update({ grade, grade_comments: comments })
    .eq('id', visitId);

  if (error) {
    console.error('setVisitGrade error:', error);
    return false;
  }
  return true;
}

export async function updateVisitGrade(
  visitId: string,
  grade: 1 | 2 | 3,
): Promise<boolean> {
  const { error } = await supabase
    .from('visits')
    .update({ grade, edited_at: new Date().toISOString() })
    .eq('id', visitId);

  if (error) {
    console.error('updateVisitGrade error:', error);
    return false;
  }
  return true;
}

export async function updateVisitGradeComments(
  visitId: string,
  comments: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('visits')
    .update({ grade_comments: comments, edited_at: new Date().toISOString() })
    .eq('id', visitId);

  if (error) {
    console.error('updateVisitGradeComments error:', error);
    return false;
  }
  return true;
}

export async function attachVisitSections(
  visitId: string,
  sections: ParsedSections,
): Promise<boolean> {
  const { error } = await supabase
    .from('visits')
    .update({
      good_news: sections.goodNews,
      competitors: sections.competitors,
      display_stock: sections.displayStock,
      follow_up: sections.followUp,
      buzz_plan: sections.buzzPlan,
    })
    .eq('id', visitId);

  if (error) {
    console.error('attachVisitSections error:', error);
    return false;
  }
  return true;
}

export async function lockVisit(visitId: string): Promise<boolean> {
  const { error } = await supabase
    .from('visits')
    .update({
      is_locked: true,
      locked_at: new Date().toISOString(),
      submitted_at: new Date().toISOString(),
    })
    .eq('id', visitId);

  if (error) {
    console.error('lockVisit error:', error);
    return false;
  }
  return true;
}

export async function getRecentVisitsByCM(
  telegramId: number,
  limit = 5,
): Promise<(Visit & { stores: { name: string } })[]> {
  const { data, error } = await supabase
    .from('visits')
    .select('*, stores(name), visit_cms!inner(cm_telegram_id)')
    .eq('visit_cms.cm_telegram_id', telegramId)
    .eq('is_locked', true)
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as any;
}

export async function getVisitsByCMAndStore(
  telegramId: number,
  storeId: string,
  limit = 20,
): Promise<Visit[]> {
  const { data, error } = await supabase
    .from('visits')
    .select('*, visit_cms!inner(cm_telegram_id)')
    .eq('visit_cms.cm_telegram_id', telegramId)
    .eq('store_id', storeId)
    .eq('is_locked', true)
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data as Visit[];
}

export async function getLastVisitDatePerStore(
  telegramId: number,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('visits')
    .select('store_id, visit_date, created_at, visit_cms!inner(cm_telegram_id)')
    .eq('visit_cms.cm_telegram_id', telegramId)
    .eq('is_locked', true)
    .order('visit_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (error || !data) return {};

  const result: Record<string, string> = {};
  for (const row of data) {
    if (!result[row.store_id]) result[row.store_id] = row.visit_date;
  }
  return result;
}

export async function getStoreContextForCM(
  telegramId: number,
  storeId: string,
): Promise<{ lastVisitId: string | null; lastVisitDate: string | null; last30dCount: number }> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [lastRes, countRes] = await Promise.all([
    supabase
      .from('visits')
      .select('id, visit_date, visit_cms!inner(cm_telegram_id)')
      .eq('visit_cms.cm_telegram_id', telegramId)
      .eq('store_id', storeId)
      .eq('is_locked', true)
      .order('visit_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('visits')
      .select('id, visit_cms!inner(cm_telegram_id)', { count: 'exact', head: true })
      .eq('visit_cms.cm_telegram_id', telegramId)
      .eq('store_id', storeId)
      .eq('is_locked', true)
      .gte('visit_date', since),
  ]);

  return {
    lastVisitId: (lastRes.data as any)?.id ?? null,
    lastVisitDate: (lastRes.data as any)?.visit_date ?? null,
    last30dCount: countRes.count ?? 0,
  };
}

export async function getFullVisit(
  visitId: string,
): Promise<(Visit & { store_name: string }) | null> {
  const { data, error } = await supabase
    .from('visits')
    .select('*, stores(name)')
    .eq('id', visitId)
    .single();

  if (error || !data) return null;
  const v = data as any;
  return { ...v, store_name: v.stores?.name ?? 'Unknown store' } as Visit & {
    store_name: string;
  };
}

export async function getVisitInfo(
  visitId: string,
): Promise<{ cm_telegram_id: number; store_name: string } | null> {
  const { data, error } = await supabase
    .from('visits')
    .select('cm_telegram_id, stores(name)')
    .eq('id', visitId)
    .single();

  if (error || !data) return null;
  return {
    cm_telegram_id: data.cm_telegram_id,
    store_name: (data.stores as any)?.name ?? 'Unknown store',
  };
}

export async function updateVisitSections(
  visitId: string,
  sections: ParsedSections,
): Promise<boolean> {
  const { error } = await supabase
    .from('visits')
    .update({
      good_news: sections.goodNews,
      competitors: sections.competitors,
      display_stock: sections.displayStock,
      follow_up: sections.followUp,
      buzz_plan: sections.buzzPlan,
      edited_at: new Date().toISOString(),
    })
    .eq('id', visitId);

  if (error) {
    console.error('updateVisitSections error:', error);
    return false;
  }
  return true;
}

// Returns the most recent unlocked visit by this CM within the resume window.
// Used by /visit to offer Resume / Start-fresh when a draft is open.
// Window matches the stale-draft TTL (purgeStaleDrafts) so any draft visible
// here is also one we haven't auto-deleted yet.
export async function getDraftVisit(
  cmTelegramId: number,
  windowHours = 7 * 24,
): Promise<(Visit & { store_name: string }) | null> {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('visits')
    .select('*, stores(name)')
    .eq('cm_telegram_id', cmTelegramId)
    .eq('is_locked', false)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const v = data as any;
  return { ...v, store_name: v.stores?.name ?? 'Unknown store' };
}

// Save-as-you-go: write one prompt's freetext (or null for Skip) to its
// column. Called by the v2 flow after each prompt reply.
export async function persistVisitSection(
  visitId: string,
  key: V2PromptKey,
  value: string | null,
): Promise<boolean> {
  const column = V2_PROMPT_COLUMN[key];
  const { error } = await supabase
    .from('visits')
    .update({ [column]: value })
    .eq('id', visitId);
  if (error) {
    console.error('persistVisitSection error:', error);
    return false;
  }
  return true;
}

// Used by the v2 follow-up close-out fallback path: typed freetext is also
// mirrored to the legacy follow_up column for back-compat with old renderers.
export async function setVisitFollowUpText(
  visitId: string,
  text: string | null,
): Promise<boolean> {
  const { error } = await supabase
    .from('visits')
    .update({ follow_up: text })
    .eq('id', visitId);
  if (error) {
    console.error('setVisitFollowUpText error:', error);
    return false;
  }
  return true;
}

// Sweeps this CM's unlocked drafts older than the TTL. Called at the top of
// /visit so abandoned drafts disappear silently — no notification, no value
// was ever locked, so it's effectively scratch work. Runs storage cleanup
// best-effort; a row-only delete still leaves no functional draft behind.
export async function purgeStaleDrafts(
  cmTelegramId: number,
  days = 7,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: stale } = await supabase
    .from('visits')
    .select('id')
    .eq('cm_telegram_id', cmTelegramId)
    .eq('is_locked', false)
    .lt('created_at', cutoff);

  const ids = (stale ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return 0;

  let purged = 0;
  for (const id of ids) {
    const ok = await deleteVisit(id);
    if (ok) purged++;
  }
  return purged;
}

export async function deleteVisit(visitId: string): Promise<boolean> {
  // DB-first: drop the row (cascades to visit_photos/visit_cms/visit_staff/
  // insights/visit_follow_ups), then try storage cleanup. If storage fails
  // we still report success — the user sees the visit gone, and stray bytes
  // can be swept by a future janitor. Order matters: if storage runs first
  // and DB fails, we'd be left with rows pointing at gone files.
  const { data: photos } = await supabase
    .from('visit_photos')
    .select('storage_path')
    .eq('visit_id', visitId);

  const { error: delErr } = await supabase.from('visits').delete().eq('id', visitId);
  if (delErr) {
    console.error('deleteVisit DB error:', delErr);
    return false;
  }

  const paths = (photos ?? [])
    .map((p: { storage_path: string | null }) => p.storage_path)
    .filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    const { error: storErr } = await supabase.storage.from('sva-photos').remove(paths);
    if (storErr) console.error('deleteVisit storage cleanup error:', storErr);
  }
  return true;
}

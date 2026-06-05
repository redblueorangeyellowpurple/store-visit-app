import { supabase } from '../client.js';

// Data layer for the daily per-CM recap. All reads are scoped to one CM and one
// SGT date. Pure DB assembly — formatting lives in notifications/daily-recap.ts.

export interface RecapRecipient {
  telegram_id: number;
  full_name: string;
  nickname: string | null;
}

export interface RecapData {
  visitedStores: string[];   // store labels for visits LOCKED on the date
  engagementCount: number;   // people logged across those visits
  trainedCount: number;      // of those, how many had a training
  plannedExecuted: string[]; // planned for the date AND visited
  plannedMissed: string[];   // planned for the date but NOT visited
  walkIns: string[];         // visited but not in the plan
  openFollowUps: { title: string; store: string; due: string | null; overdue: boolean }[];
  followUpOpenTotal: number;
  // Locked visits with AM review feedback the CM hasn't marked seen yet (any
  // recent date, not just yesterday) — a standing nudge until acknowledged.
  pendingFeedback: { store: string; visitId: string; fixes: number; comments: number }[];
}

// Calendar-date math on 'YYYY-MM-DD' (timezone-independent).
function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// How far back to look for unacknowledged feedback. Older than this is stale.
const FEEDBACK_WINDOW_DAYS = 30;

// CMs who have opted in to the daily recap (dashboard Admin tab).
export async function getRecapRecipients(): Promise<RecapRecipient[]> {
  const { data, error } = await supabase
    .from('cms')
    .select('telegram_id, full_name, nickname')
    .eq('is_recap_recipient', true)
    .eq('is_active', true);
  if (error) {
    console.error('[recap] getRecapRecipients failed:', error);
    return [];
  }
  return (data as RecapRecipient[]) ?? [];
}

function storeLabel(s: { name: string | null; chain: string | null } | null | undefined): string {
  const name = s?.name ?? 'a store';
  return s?.chain ? `${name} @ ${s.chain}` : name;
}

// Assemble one CM's recap for a given SGT date (YYYY-MM-DD). Returns null only on
// a hard query error; an empty day returns a RecapData with empty arrays so the
// caller can decide whether it's worth sending.
export async function getCMDailyRecap(
  telegramId: number,
  date: string,
): Promise<RecapData | null> {
  const start = `${date}T00:00:00+08:00`;
  const end = `${date}T23:59:59.999+08:00`;

  // 1. Visits locked on the date + 2. plans for the date + 4. open follow-ups +
  // 5. recent visits with unacknowledged AM feedback.
  const feedbackCutoff = `${addDaysISO(date, -FEEDBACK_WINDOW_DAYS)}T00:00:00+08:00`;
  const [visitsRes, plansRes, fuRes, unackedRes] = await Promise.all([
    supabase
      .from('visits')
      .select('id, store_id')
      .eq('cm_telegram_id', telegramId)
      .eq('is_locked', true)
      .gte('locked_at', start)
      .lte('locked_at', end),
    supabase
      .from('visit_plans')
      .select('store_id')
      .eq('cm_telegram_id', telegramId)
      .eq('planned_date', date),
    supabase
      .from('visit_follow_ups')
      .select('title, due_date, store_id')
      .eq('cm_telegram_id', telegramId)
      .eq('status', 'open')
      .order('due_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('visits')
      .select('id, store_id')
      .eq('cm_telegram_id', telegramId)
      .eq('is_locked', true)
      .is('review_ack_at', null)
      .gte('locked_at', feedbackCutoff),
  ]);

  if (visitsRes.error) {
    console.error('[recap] visits query failed:', visitsRes.error);
    return null;
  }

  const visits = (visitsRes.data ?? []) as { id: string; store_id: string }[];
  const plans = (plansRes.data ?? []) as { store_id: string }[];
  const fus = (fuRes.data ?? []) as { title: string; due_date: string | null; store_id: string }[];
  const unackedVisits = (unackedRes.data ?? []) as { id: string; store_id: string }[];

  // 3. Resolve store names once for every store id we touch.
  const storeIds = Array.from(
    new Set([...visits, ...plans, ...fus, ...unackedVisits].map((r) => r.store_id).filter(Boolean)),
  );
  const storeMap = new Map<string, { name: string | null; chain: string | null }>();
  if (storeIds.length > 0) {
    const { data: storeRows } = await supabase
      .from('stores')
      .select('id, name, chain')
      .in('id', storeIds);
    for (const s of (storeRows ?? []) as { id: string; name: string | null; chain: string | null }[]) {
      storeMap.set(s.id, { name: s.name, chain: s.chain });
    }
  }

  // 5. Engagements across the day's visits.
  let engagementCount = 0;
  let trainedCount = 0;
  const visitIds = visits.map((v) => v.id);
  if (visitIds.length > 0) {
    const { data: staffRows } = await supabase
      .from('visit_staff')
      .select('was_trained')
      .in('visit_id', visitIds);
    const rows = (staffRows ?? []) as { was_trained: boolean | null }[];
    engagementCount = rows.length;
    trainedCount = rows.filter((r) => r.was_trained).length;
  }

  const label = (id: string) => storeLabel(storeMap.get(id));

  // Pending AM feedback: for the recent unacked visits, count boxed fixes +
  // comments per visit (via their photos). Only visits that actually carry
  // feedback make the list.
  const pendingFeedback: RecapData['pendingFeedback'] = [];
  if (unackedVisits.length > 0) {
    const uvIds = unackedVisits.map((v) => v.id);
    const { data: photoRows } = await supabase
      .from('visit_photos')
      .select('id, visit_id')
      .in('visit_id', uvIds);
    const photos = (photoRows ?? []) as { id: string; visit_id: string }[];
    if (photos.length > 0) {
      const photoIds = photos.map((p) => p.id);
      const photoToVisit = new Map(photos.map((p) => [p.id, p.visit_id]));
      const [annRes, cmtRes] = await Promise.all([
        supabase.from('photo_annotations').select('photo_id').in('photo_id', photoIds),
        supabase.from('photo_comments').select('photo_id').in('photo_id', photoIds),
      ]);
      const fixByVisit = new Map<string, number>();
      const cmtByVisit = new Map<string, number>();
      for (const r of (annRes.data ?? []) as { photo_id: string }[]) {
        const vid = photoToVisit.get(r.photo_id);
        if (vid) fixByVisit.set(vid, (fixByVisit.get(vid) ?? 0) + 1);
      }
      for (const r of (cmtRes.data ?? []) as { photo_id: string }[]) {
        const vid = photoToVisit.get(r.photo_id);
        if (vid) cmtByVisit.set(vid, (cmtByVisit.get(vid) ?? 0) + 1);
      }
      for (const v of unackedVisits) {
        const fixes = fixByVisit.get(v.id) ?? 0;
        const comments = cmtByVisit.get(v.id) ?? 0;
        if (fixes + comments > 0) {
          pendingFeedback.push({ store: label(v.store_id), visitId: v.id, fixes, comments });
        }
      }
    }
  }

  // Planned-vs-executed: compare the set of stores visited against the planned set.
  const visitedStoreIds = new Set(visits.map((v) => v.store_id));
  const plannedStoreIds = new Set(plans.map((p) => p.store_id));

  const visitedStores = [...visitedStoreIds].map(label);
  const plannedExecuted = [...plannedStoreIds].filter((id) => visitedStoreIds.has(id)).map(label);
  const plannedMissed = [...plannedStoreIds].filter((id) => !visitedStoreIds.has(id)).map(label);
  const walkIns = [...visitedStoreIds].filter((id) => !plannedStoreIds.has(id)).map(label);

  // Open follow-ups, with overdue flagged against the recap date.
  const openFollowUps = fus.map((f) => ({
    title: f.title,
    store: label(f.store_id),
    due: f.due_date,
    overdue: !!f.due_date && f.due_date < date,
  }));

  return {
    visitedStores,
    engagementCount,
    trainedCount,
    plannedExecuted,
    plannedMissed,
    walkIns,
    openFollowUps,
    followUpOpenTotal: fus.length,
    pendingFeedback,
  };
}

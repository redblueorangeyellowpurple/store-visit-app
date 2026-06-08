import { supabase } from "./supabase";

// ─── Helpers (exported from queries.ts pattern, mirrored here) ────────────────
// NOTE: mondayOf/buildWeeks/isoDate are also defined locally in queries.ts.
// We re-export them from there so callers can import from one place.

export function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

export function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

export function buildWeeks(fromISO: string, toISO: string): { start: string; end: string }[] {
  const start = mondayOf(new Date(fromISO + "T00:00:00"));
  const to = new Date(toISO + "T00:00:00");
  const weeks: { start: string; end: string }[] = [];
  const cursor = new Date(start);
  const MAX_WEEKS = 60;
  let safety = 0;
  while (cursor <= to && safety < MAX_WEEKS) {
    const wStart = new Date(cursor);
    const wEnd = new Date(cursor); wEnd.setDate(cursor.getDate() + 6);
    weeks.push({ start: isoDate(wStart), end: isoDate(wEnd) });
    cursor.setDate(cursor.getDate() + 7);
    safety += 1;
  }
  return weeks;
}

function weekLabel(weekStart: string, weekEnd: string): string {
  const s = new Date(weekStart + "T00:00:00");
  const e = new Date(weekEnd + "T00:00:00");
  const mons = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const sDay = days[s.getDay()];
  const eDay = days[e.getDay()];
  const sMonStr = mons[s.getMonth()];
  const eMonStr = mons[e.getMonth()];
  if (s.getMonth() === e.getMonth()) {
    return `${sDay} ${s.getDate()} – ${eDay} ${e.getDate()} ${eMonStr} ${e.getFullYear()}`;
  }
  return `${sDay} ${s.getDate()} ${sMonStr} – ${eDay} ${e.getDate()} ${eMonStr} ${e.getFullYear()}`;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  label: string;
  stats: {
    planned: number;
    executed: number;
    wowPct: number | null;
    engagements: number;
    productTrainings: number;
    activeCMs: number;
    totalCMs: number;
    storesCovered: number;
    totalStores: number;
  };
  byDay: { dow: string; date: string; count: number }[];
  perCM: { cm: string; market: string; visited: number; engagements: number }[];
  coverageByTier: {
    tier: string;
    visited: number;
    total: number;
    pct: number;
    markets: {
      market: string;
      visited: number;
      total: number;
      chains: { chain: string; visited: number; total: number }[];
    }[];
  }[];
  displayByTier: {
    tier: string;
    storesVisited: number;
    markets: {
      market: string;
      storesVisited: number;
      chains: {
        chain: string;
        stores: {
          store: string;
          storeId: string;
          photos: number;
          displayNote: string | null;
          followUps: { title: string; ageDays: number }[];
        }[];
      }[];
    }[];
  }[];
}

// ─── listWeeks ─────────────────────────────────────────────────────────────────

export async function listWeeks(): Promise<{ start: string; end: string; label: string }[]> {
  // Get min/max visit_date of locked visits
  const { data: bounds } = await supabase
    .from("visits")
    .select("visit_date")
    .eq("is_locked", true)
    .order("visit_date", { ascending: true })
    .limit(1);
  const { data: boundsMax } = await supabase
    .from("visits")
    .select("visit_date")
    .eq("is_locked", true)
    .order("visit_date", { ascending: false })
    .limit(1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const minDate: string | null = (bounds as any)?.[0]?.visit_date ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maxDate: string | null = (boundsMax as any)?.[0]?.visit_date ?? null;
  if (!minDate || !maxDate) return [];

  const allWeeks = buildWeeks(minDate, maxDate);

  // Get all locked visit dates to filter weeks that have at least one
  const { data: visitDates } = await supabase
    .from("visits")
    .select("visit_date")
    .eq("is_locked", true);

  const visitedMondays = new Set<string>();
  for (const v of (visitDates ?? []) as { visit_date: string }[]) {
    visitedMondays.add(isoDate(mondayOf(new Date(v.visit_date + "T00:00:00"))));
  }

  // Completed weeks only — a weekly report covers finished Mon–Sun weeks, so the
  // current in-progress week is excluded (it would otherwise be the default and
  // show a near-empty partial week).
  const todayISO = isoDate(new Date());
  const filtered = allWeeks
    .filter((w) => visitedMondays.has(w.start) && w.end < todayISO)
    .reverse(); // newest first

  return filtered.map((w) => ({
    start: w.start,
    end: w.end,
    label: weekLabel(w.start, w.end),
  }));
}

// ─── getWeeklyReport ──────────────────────────────────────────────────────────

export async function getWeeklyReport(weekStartISO?: string): Promise<WeeklyReport> {
  // Resolve week
  let weekStart: string;
  let weekEnd: string;

  if (weekStartISO) {
    weekStart = weekStartISO;
    const e = new Date(weekStartISO + "T00:00:00");
    e.setDate(e.getDate() + 6);
    weekEnd = isoDate(e);
  } else {
    const weeks = await listWeeks();
    if (weeks.length === 0) {
      // return empty report
      const today = new Date();
      const mon = mondayOf(today);
      weekStart = isoDate(mon);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      weekEnd = isoDate(sun);
    } else {
      weekStart = weeks[0].start;
      weekEnd = weeks[0].end;
    }
  }

  const label = weekLabel(weekStart, weekEnd);

  // Prior week window
  const priorStart = new Date(weekStart + "T00:00:00");
  priorStart.setDate(priorStart.getDate() - 7);
  const priorEnd = new Date(weekEnd + "T00:00:00");
  priorEnd.setDate(priorEnd.getDate() - 7);
  const priorStartISO = isoDate(priorStart);
  const priorEndISO = isoDate(priorEnd);

  // ── Parallel fetches ──────────────────────────────────────────────────────
  const [
    visitsRes,
    priorVisitsRes,
    plansRes,
    cmsRes,
    storesRes,
  ] = await Promise.all([
    // All locked visits in the week, with store + CM info
    supabase
      .from("visits")
      .select("id, visit_date, cm_telegram_id, store_id, display_stock, stores(name, chain, market, tier), cms!cm_telegram_id(full_name, market)")
      .eq("is_locked", true)
      .gte("visit_date", weekStart)
      .lte("visit_date", weekEnd),
    // Prior week visit count only
    supabase
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("is_locked", true)
      .gte("visit_date", priorStartISO)
      .lte("visit_date", priorEndISO),
    // Plans
    supabase
      .from("visit_plans")
      .select("id", { count: "exact", head: true })
      .gte("planned_date", weekStart)
      .lte("planned_date", weekEnd),
    // Active CMs (cm + cmic roles)
    supabase
      .from("cms")
      .select("telegram_id, full_name, market, role, is_active")
      .eq("is_active", true)
      .in("role", ["cm", "cmic"]),
    // All active stores (for totals)
    supabase
      .from("stores")
      .select("id, name, chain, market, tier")
      .eq("is_active", true),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visits = ((visitsRes.data ?? []) as any[]);
  const visitIds = visits.map((v) => v.id as string);
  const priorExecuted = priorVisitsRes.count ?? 0;
  const planned = plansRes.count ?? 0;
  const executed = visits.length;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allActiveCMs = ((cmsRes.data ?? []) as any[]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allActiveStores = ((storesRes.data ?? []) as any[]);

  // ── visit_staff for engagements ───────────────────────────────────────────
  let staffRows: { id: string; visit_id: string; update_text: string | null; training_response: string | null; was_trained: boolean | null; cm_telegram_id?: number }[] = [];
  if (visitIds.length > 0) {
    const { data: vsData } = await supabase
      .from("visit_staff")
      .select("id, visit_id, update_text, training_response, was_trained")
      .in("visit_id", visitIds);
    // Attach cm_telegram_id via the visits map
    const visitCmMap = new Map<string, number>();
    for (const v of visits) visitCmMap.set(v.id as string, v.cm_telegram_id as number);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    staffRows = ((vsData ?? []) as any[]).map((r) => ({
      ...r,
      cm_telegram_id: visitCmMap.get(r.visit_id as string),
    }));
  }

  // Filter for "is engagement": update_text non-empty OR training_response non-empty OR was_trained
  function isEngagement(r: { update_text: string | null; training_response: string | null; was_trained: boolean | null }): boolean {
    return !!(r.update_text?.trim()) || !!(r.training_response?.trim()) || !!(r.was_trained);
  }

  // engagement_trainings count
  let productTrainings = 0;
  if (visitIds.length > 0) {
    const engagingStaffIds = staffRows.filter(isEngagement).map((r) => r.id);
    if (engagingStaffIds.length > 0) {
      const { count } = await supabase
        .from("engagement_trainings")
        .select("id", { count: "exact", head: true })
        .in("visit_staff_id", engagingStaffIds);
      productTrainings = count ?? 0;
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const wowPct = priorExecuted > 0
    ? Math.round((executed - priorExecuted) / priorExecuted * 100)
    : null;

  const distinctCMIds = new Set(visits.map((v) => v.cm_telegram_id as number));
  const activeCMs = distinctCMIds.size;
  const totalCMs = allActiveCMs.length;

  const distinctStoreIds = new Set(visits.map((v) => v.store_id as string));
  const storesCovered = distinctStoreIds.size;
  // totalStores = active stores with a tier (skip untiered for store count, but the spec says count all active stores)
  const totalStores = allActiveStores.length;

  const engagements = staffRows.filter(isEngagement).length;

  // ── byDay ─────────────────────────────────────────────────────────────────
  const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayCounts = new Map<string, number>();
  for (const v of visits) {
    const d = v.visit_date as string;
    dayCounts.set(d, (dayCounts.get(d) ?? 0) + 1);
  }
  const byDay: WeeklyReport["byDay"] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + "T00:00:00");
    d.setDate(d.getDate() + i);
    const iso = isoDate(d);
    byDay.push({ dow: DOW_LABELS[i], date: iso, count: dayCounts.get(iso) ?? 0 });
  }

  // ── perCM ─────────────────────────────────────────────────────────────────
  // Build map of cm_telegram_id -> { cm, market, visitIds, engagements }
  const cmMap = new Map<number, { cm: string; market: string; visitIds: Set<string> }>();
  for (const v of visits) {
    const cmId = v.cm_telegram_id as number;
    if (!cmMap.has(cmId)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cms = v.cms as any;
      cmMap.set(cmId, {
        cm: cms?.full_name ?? "Unknown",
        market: cms?.market ?? "—",
        visitIds: new Set(),
      });
    }
    cmMap.get(cmId)!.visitIds.add(v.id as string);
  }

  const engByVisit = new Map<string, number>();
  for (const s of staffRows) {
    if (isEngagement(s)) {
      engByVisit.set(s.visit_id as string, (engByVisit.get(s.visit_id as string) ?? 0) + 1);
    }
  }

  const perCM: WeeklyReport["perCM"] = Array.from(cmMap.entries()).map(([, v]) => {
    let engCount = 0;
    for (const vid of v.visitIds) engCount += engByVisit.get(vid) ?? 0;
    return { cm: v.cm, market: v.market, visited: v.visitIds.size, engagements: engCount };
  }).sort((a, b) => b.visited - a.visited || a.cm.localeCompare(b.cm));

  // ── coverageByTier ─────────────────────────────────────────────────────────
  const TIER_ORDER = ["T1", "T2", "T3", "T4"];

  // Build active-store lookup by tier → market → chain
  type StoreInfo = { id: string; name: string; chain: string; market: string; tier: string | null };
  const tieredStores = (allActiveStores as StoreInfo[]).filter((s) => s.tier !== null && s.tier !== "");

  // Group all tiered active stores by tier → market → chain → { total }
  const tierMarketChain = new Map<string, Map<string, Map<string, { total: number }>>>();

  for (const s of tieredStores) {
    const tier = s.tier!;
    if (!tierMarketChain.has(tier)) tierMarketChain.set(tier, new Map());
    const mkt = tierMarketChain.get(tier)!;
    if (!mkt.has(s.market)) mkt.set(s.market, new Map());
    const ch = mkt.get(s.market)!;
    if (!ch.has(s.chain)) ch.set(s.chain, { total: 0 });
    ch.get(s.chain)!.total += 1;
  }

  // Count distinct store_ids visited per tier/market/chain
  const visitedPerChain = new Map<string, Set<string>>(); // key: "tier|market|chain" → Set<store_id>
  for (const v of visits) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = v.stores as any;
    if (!store || !store.tier) continue;
    const key = `${store.tier as string}|${store.market as string}|${store.chain as string}`;
    if (!visitedPerChain.has(key)) visitedPerChain.set(key, new Set());
    visitedPerChain.get(key)!.add(v.store_id as string);
  }

  // Also track visited per tier|market for market-level rollup
  const visitedPerMarket = new Map<string, Set<string>>(); // "tier|market" → Set<store_id>
  const visitedPerTier = new Map<string, Set<string>>();    // "tier" → Set<store_id>
  for (const v of visits) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = v.stores as any;
    if (!store || !store.tier) continue;
    const mkKey = `${store.tier as string}|${store.market as string}`;
    if (!visitedPerMarket.has(mkKey)) visitedPerMarket.set(mkKey, new Set());
    visitedPerMarket.get(mkKey)!.add(v.store_id as string);
    if (!visitedPerTier.has(store.tier as string)) visitedPerTier.set(store.tier as string, new Set());
    visitedPerTier.get(store.tier as string)!.add(v.store_id as string);
  }

  // Also need total per tier|market|chain from active stores
  // Already built in tierMarketChain above but needs visited counts corrected
  // Rebuild with the visited sets
  const coverageByTier: WeeklyReport["coverageByTier"] = TIER_ORDER
    .filter((tier) => tierMarketChain.has(tier))
    .map((tier) => {
      const mktMap = tierMarketChain.get(tier)!;
      const tierVisited = visitedPerTier.get(tier)?.size ?? 0;
      const tierTotal = Array.from(mktMap.values()).reduce((acc, cMap) =>
        acc + Array.from(cMap.values()).reduce((a, c) => a + c.total, 0), 0);

      const markets = Array.from(mktMap.entries()).map(([market, chainMap]) => {
        const mkKey = `${tier}|${market}`;
        const mktVisited = visitedPerMarket.get(mkKey)?.size ?? 0;
        const mktTotal = Array.from(chainMap.values()).reduce((a, c) => a + c.total, 0);

        const chains = Array.from(chainMap.entries()).map(([chain, info]) => {
          const cKey = `${tier}|${market}|${chain}`;
          const chainVisited = visitedPerChain.get(cKey)?.size ?? 0;
          return { chain, visited: chainVisited, total: info.total };
        }).sort((a, b) => b.visited - a.visited || a.chain.localeCompare(b.chain));

        return { market, visited: mktVisited, total: mktTotal, chains };
      }).sort((a, b) => b.visited - a.visited || a.market.localeCompare(b.market));

      return {
        tier,
        visited: tierVisited,
        total: tierTotal,
        pct: tierTotal > 0 ? Math.round(tierVisited / tierTotal * 100) : 0,
        markets,
      };
    });

  // ── displayByTier ─────────────────────────────────────────────────────────
  // Only visited stores this week, grouped tier→market→chain
  // Need: photos count, displayNote, open follow-ups

  // Collect distinct stores visited with their store info
  type VisitedStore = { storeId: string; name: string; chain: string; market: string; tier: string; displayNotes: string[] };
  const visitedStoreMap = new Map<string, VisitedStore>();
  for (const v of visits) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = v.stores as any;
    if (!store || !store.tier) continue; // skip untiered
    const sid = v.store_id as string;
    if (!visitedStoreMap.has(sid)) {
      visitedStoreMap.set(sid, {
        storeId: sid,
        name: store.name as string,
        chain: store.chain as string,
        market: store.market as string,
        tier: store.tier as string,
        displayNotes: [],
      });
    }
    const ds = v.display_stock as string | null;
    if (ds?.trim()) visitedStoreMap.get(sid)!.displayNotes.push(ds.trim());
  }

  // Photos per store (from visits this week)
  const photosPerStore = new Map<string, number>();
  if (visitIds.length > 0) {
    const { data: photoRows } = await supabase
      .from("visit_photos")
      .select("id, visit_id")
      .in("visit_id", visitIds);
    const visitToStore = new Map<string, string>();
    for (const v of visits) visitToStore.set(v.id as string, v.store_id as string);
    for (const p of (photoRows ?? []) as { id: string; visit_id: string }[]) {
      const sid = visitToStore.get(p.visit_id);
      if (sid) photosPerStore.set(sid, (photosPerStore.get(sid) ?? 0) + 1);
    }
  }

  // Open follow-ups per store (all open, not week-limited)
  const followUpsPerStore = new Map<string, { title: string; ageDays: number }[]>();
  if (visitedStoreMap.size > 0) {
    const storeIds = Array.from(visitedStoreMap.keys());
    const { data: fuRows } = await supabase
      .from("visit_follow_ups")
      .select("id, store_id, title, status, created_at")
      .in("store_id", storeIds)
      .eq("status", "open");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const fu of (fuRows ?? []) as { id: string; store_id: string; title: string; status: string; created_at: string }[]) {
      const created = new Date(fu.created_at);
      created.setHours(0, 0, 0, 0);
      const ageDays = Math.floor((today.getTime() - created.getTime()) / 86400000);
      const list = followUpsPerStore.get(fu.store_id) ?? [];
      list.push({ title: fu.title, ageDays });
      followUpsPerStore.set(fu.store_id, list);
    }
  }

  // Build displayByTier
  // Group: tier → market → chain → stores[]
  type DspTierMap = Map<string, Map<string, Map<string, VisitedStore[]>>>;
  const dspTierMap: DspTierMap = new Map();
  for (const [, vs] of visitedStoreMap) {
    if (!dspTierMap.has(vs.tier)) dspTierMap.set(vs.tier, new Map());
    const mktMap = dspTierMap.get(vs.tier)!;
    if (!mktMap.has(vs.market)) mktMap.set(vs.market, new Map());
    const chMap = mktMap.get(vs.market)!;
    if (!chMap.has(vs.chain)) chMap.set(vs.chain, []);
    chMap.get(vs.chain)!.push(vs);
  }

  const displayByTier: WeeklyReport["displayByTier"] = TIER_ORDER
    .filter((tier) => dspTierMap.has(tier))
    .map((tier) => {
      const mktMap = dspTierMap.get(tier)!;
      let tierTotal = 0;

      const markets = Array.from(mktMap.entries()).map(([market, chMap]) => {
        let mktTotal = 0;

        const chains = Array.from(chMap.entries()).map(([chain, stores]) => {
          const storeRows = stores.map((vs) => {
            const displayNotes = vs.displayNotes;
            let displayNote: string | null = null;
            if (displayNotes.length > 0) {
              const combined = [...new Set(displayNotes)].join(" · ");
              displayNote = combined.length > 160 ? combined.slice(0, 157) + "…" : combined;
            }
            return {
              store: vs.name,
              storeId: vs.storeId,
              photos: photosPerStore.get(vs.storeId) ?? 0,
              displayNote,
              followUps: followUpsPerStore.get(vs.storeId) ?? [],
            };
          }).sort((a, b) => a.store.localeCompare(b.store));
          mktTotal += storeRows.length;
          return { chain, stores: storeRows };
        }).sort((a, b) => a.chain.localeCompare(b.chain));

        tierTotal += mktTotal;
        return { market, storesVisited: mktTotal, chains };
      }).sort((a, b) => b.storesVisited - a.storesVisited || a.market.localeCompare(b.market));

      return { tier, storesVisited: tierTotal, markets };
    });

  return {
    weekStart,
    weekEnd,
    label,
    stats: {
      planned,
      executed,
      wowPct,
      engagements,
      productTrainings,
      activeCMs,
      totalCMs,
      storesCovered,
      totalStores,
    },
    byDay,
    perCM,
    coverageByTier,
    displayByTier,
  };
}

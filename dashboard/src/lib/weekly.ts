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

export interface WeeklyEngagementSummary {
  peopleEngaged: number;
  newPeople: number;       // first-ever appearance in visit_staff by staff_id (or case-insensitive name within store)
  returningPeople: number;
  alliesEngaged: number;
}

// One person-training entry inside a product's drawer list.
export interface TrainedPersonDetail {
  person: string;
  store: string;
  date: string;            // visit_date ISO
  response: string | null; // per-product response if present, else the person's training_response
}

// One row of the "trainings by product" table, with its drawer list precomputed.
export interface TrainingProductSummary {
  product: string;
  trainings: number;       // training entries this week
  people: number;          // distinct people trained on it
  persons: TrainedPersonDetail[];
}

// One engagement row inside a CM's drawer list.
export interface CMEngagementDetail {
  person: string;
  store: string;
  products: string | null; // products trained, comma-joined; null if none
  response: string | null;
  date: string;            // visit_date ISO
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  label: string;
  narrativeMarkdown: string | null; // AI Signals/Alerts/Engagements; null until generated
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
  engagementSummary: WeeklyEngagementSummary;
  trainingProducts: TrainingProductSummary[];
  byDay: { dow: string; date: string; count: number }[];
  // Per-store × per-day visit counts (Mon..Sun) for the Execution Summary "Stores" heatmap.
  storeDayMatrix: { storeId: string; store: string; chain: string; market: string; tier: string | null; counts: number[]; total: number }[];
  perCM: { cm: string; market: string; visited: number; engagements: number; engagementDetails: CMEngagementDetail[] }[];
  // Flat list of every store visited this week (Store Updates cards).
  storesVisited: {
    storeId: string;
    store: string;
    chain: string;
    market: string;
    tier: string | null;
    photos: number;
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
      .select("id, visit_date, cm_telegram_id, store_id, stores(name, chain, market, tier), cms!cm_telegram_id(full_name, market)")
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
  let staffRows: {
    id: string;
    visit_id: string;
    update_text: string | null;
    training_response: string | null;
    was_trained: boolean | null;
    products_trained_on: string | null;
    person_name: string | null;
    staff_id: string | null;
    // joined from staff table
    staff: { id: string; name: string; is_ally: boolean; store_id: string } | null;
    cm_telegram_id?: number;
  }[] = [];
  if (visitIds.length > 0) {
    const { data: vsData } = await supabase
      .from("visit_staff")
      .select("id, visit_id, update_text, training_response, was_trained, products_trained_on, person_name, staff_id, staff(id, name, is_ally, store_id)")
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

  // engagement_trainings count + product names + per-product responses
  let productTrainings = 0;
  let trainingProductRows: { visit_staff_id: string; product_name: string; response: string | null }[] = [];
  if (visitIds.length > 0) {
    const engagingStaffIds = staffRows.filter(isEngagement).map((r) => r.id);
    if (engagingStaffIds.length > 0) {
      const { data: etData, count } = await supabase
        .from("engagement_trainings")
        .select("visit_staff_id, product_name, response", { count: "exact" })
        .in("visit_staff_id", engagingStaffIds);
      productTrainings = count ?? 0;
      trainingProductRows = (etData ?? []) as { visit_staff_id: string; product_name: string; response: string | null }[];
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

  // ── Engagement Summary ────────────────────────────────────────────────────
  // People engaged = staff rows that qualify as engagement
  const engagingRows = staffRows.filter(isEngagement);

  // New vs returning: a person is "new" if this is their first-ever appearance in
  // visit_staff. Keyed by staff_id when set; otherwise by case-insensitive person_name
  // within the same store (need to look up store per visit).
  const visitStoreMap = new Map<string, string>(); // visit_id → store_id
  for (const v of visits) visitStoreMap.set(v.id as string, v.store_id as string);

  // Collect the unique keys for people who appeared this week
  type PersonKey = string; // "staff:<staff_id>" or "name:<store_id>:<lower_name>"
  function personKey(r: typeof engagingRows[number]): PersonKey {
    if (r.staff_id) return `staff:${r.staff_id}`;
    const sid = visitStoreMap.get(r.visit_id) ?? "";
    const name = (r.person_name ?? "unknown").toLowerCase();
    return `name:${sid}:${name}`;
  }

  const weekPeopleKeys = new Set<PersonKey>();
  for (const r of engagingRows) weekPeopleKeys.add(personKey(r));

  // Look up prior appearances for these keys (before this week's start)
  const staffIdKeys = [...weekPeopleKeys].filter((k) => k.startsWith("staff:")).map((k) => k.slice(6));
  const nameKeys = [...weekPeopleKeys].filter((k) => k.startsWith("name:"));

  const priorPersonKeys = new Set<PersonKey>();

  if (staffIdKeys.length > 0) {
    const { data: priorByStaff } = await supabase
      .from("visit_staff")
      .select("staff_id, visit_id, visits!inner(visit_date)")
      .in("staff_id", staffIdKeys)
      .lt("visits.visit_date", weekStart);
    for (const r of (priorByStaff ?? []) as { staff_id: string }[]) {
      priorPersonKeys.add(`staff:${r.staff_id}`);
    }
  }

  if (nameKeys.length > 0) {
    // For name-keyed people: fetch all prior name-keyed rows and filter client-side
    // (Supabase can't do OR on LOWER; prior rows are few, so a broad fetch is fine)
    const wantedNames = new Set(nameKeys.map((k) => k.split(":")[2])); // the lowercased names
    const { data: priorByName } = await supabase
      .from("visit_staff")
      .select("person_name, visit_id, visits!inner(visit_date, store_id)")
      .not("person_name", "is", null)
      .lt("visits.visit_date", weekStart);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (priorByName ?? []) as any[]) {
      const name = ((r.person_name ?? "") as string).toLowerCase();
      if (!wantedNames.has(name)) continue;
      // Supabase returns joined table as array even for !inner joins
      const visitsJoin = Array.isArray(r.visits) ? r.visits[0] : r.visits;
      const sid = (visitsJoin?.store_id ?? "") as string;
      priorPersonKeys.add(`name:${sid}:${name}`);
    }
  }

  const newPeople = [...weekPeopleKeys].filter((k) => !priorPersonKeys.has(k)).length;
  const returningPeople = weekPeopleKeys.size - newPeople;

  // Allies engaged (distinct staff with is_ally = true who appeared in an engagement)
  const alliesEngaged = new Set(
    engagingRows.filter((r) => r.staff?.is_ally === true && r.staff_id).map((r) => r.staff_id as string),
  ).size;

  const engagementSummary: WeeklyEngagementSummary = {
    peopleEngaged: weekPeopleKeys.size,
    newPeople,
    returningPeople,
    alliesEngaged,
  };

  // ── trainingProducts + per-CM engagement detail ───────────────────────────
  // Per-product breakdown: one entry per training delivered this week, with the
  // drawer person-list precomputed. Where a trained person has no
  // engagement_trainings rows, fall back to parsing the legacy CSV
  // (products_trained_on), with training_response as the response.
  const visitInfo = new Map<string, { store: string; date: string }>(); // visit_id → store name + date
  for (const v of visits) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = v.stores as any;
    visitInfo.set(v.id as string, { store: (store?.name as string) ?? "—", date: v.visit_date as string });
  }

  const etByStaff = new Map<string, { product: string; response: string | null }[]>();
  for (const t of trainingProductRows) {
    if (!t.product_name?.trim()) continue;
    const list = etByStaff.get(t.visit_staff_id) ?? [];
    list.push({ product: t.product_name.trim(), response: t.response?.trim() || null });
    etByStaff.set(t.visit_staff_id, list);
  }

  const productAgg = new Map<string, { trainings: number; people: Set<string>; persons: TrainedPersonDetail[] }>();
  const detailsByCm = new Map<number, CMEngagementDetail[]>();
  for (const r of engagingRows) {
    const ets = etByStaff.get(r.id) ?? [];
    // Per-training entries: child rows first; legacy CSV fallback for trained rows.
    let entries: { product: string; response: string | null }[] = ets;
    if (entries.length === 0 && (r.was_trained || r.products_trained_on?.trim())) {
      entries = (r.products_trained_on ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((product) => ({ product, response: r.training_response?.trim() || null }));
    }
    const info = visitInfo.get(r.visit_id);
    const person = r.person_name ?? r.staff?.name ?? "Unknown";
    const key = personKey(r);
    for (const e of entries) {
      const agg = productAgg.get(e.product) ?? { trainings: 0, people: new Set<string>(), persons: [] };
      agg.trainings += 1;
      agg.people.add(key);
      agg.persons.push({
        person,
        store: info?.store ?? "—",
        date: info?.date ?? "",
        response: e.response ?? r.training_response?.trim() ?? null,
      });
      productAgg.set(e.product, agg);
    }
    // Per-CM engagement detail (every engagement, trained or not)
    const cmId = r.cm_telegram_id;
    if (cmId !== undefined) {
      const list = detailsByCm.get(cmId) ?? [];
      list.push({
        person,
        store: info?.store ?? "—",
        products: entries.length > 0 ? entries.map((e) => e.product).join(", ") : null,
        response: r.update_text?.trim() || r.training_response?.trim() || null,
        date: info?.date ?? "",
      });
      detailsByCm.set(cmId, list);
    }
  }
  for (const list of detailsByCm.values()) list.sort((a, b) => b.date.localeCompare(a.date) || a.person.localeCompare(b.person));

  const trainingProducts: TrainingProductSummary[] = Array.from(productAgg.entries())
    .map(([product, agg]) => ({
      product,
      trainings: agg.trainings,
      people: agg.people.size,
      persons: agg.persons.sort((a, b) => b.date.localeCompare(a.date) || a.person.localeCompare(b.person)),
    }))
    .sort((a, b) => b.trainings - a.trainings || a.product.localeCompare(b.product));

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

  // ── storeDayMatrix ────────────────────────────────────────────────────────
  const dayIdx = new Map<string, number>();
  byDay.forEach((d, i) => dayIdx.set(d.date, i));
  const matrixMap = new Map<string, WeeklyReport["storeDayMatrix"][number]>();
  for (const v of visits) {
    const idx = dayIdx.get(v.visit_date as string);
    if (idx === undefined) continue;
    const sid = v.store_id as string;
    let row = matrixMap.get(sid);
    if (!row) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = v.stores as any;
      row = {
        storeId: sid,
        store: (store?.name as string) ?? "Unknown",
        chain: (store?.chain as string) ?? "",
        market: (store?.market as string) ?? "",
        tier: (store?.tier as string | null) ?? null,
        counts: [0, 0, 0, 0, 0, 0, 0],
        total: 0,
      };
      matrixMap.set(sid, row);
    }
    row.counts[idx] += 1;
    row.total += 1;
  }
  const storeDayMatrix = Array.from(matrixMap.values())
    .sort((a, b) => b.total - a.total || a.store.localeCompare(b.store));

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

  const perCM: WeeklyReport["perCM"] = Array.from(cmMap.entries()).map(([cmId, v]) => {
    let engCount = 0;
    for (const vid of v.visitIds) engCount += engByVisit.get(vid) ?? 0;
    return { cm: v.cm, market: v.market, visited: v.visitIds.size, engagements: engCount, engagementDetails: detailsByCm.get(cmId) ?? [] };
  }).sort((a, b) => b.visited - a.visited || a.cm.localeCompare(b.cm));

  // ── storesVisited ─────────────────────────────────────────────────────────
  // Flat list of every store visited this week, with its photo count.

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

  const storesVisitedMap = new Map<string, WeeklyReport["storesVisited"][number]>();
  for (const v of visits) {
    const sid = v.store_id as string;
    if (storesVisitedMap.has(sid)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = v.stores as any;
    storesVisitedMap.set(sid, {
      storeId: sid,
      store: (store?.name as string) ?? "Unknown",
      chain: (store?.chain as string) ?? "",
      market: (store?.market as string) ?? "",
      tier: (store?.tier as string | null) ?? null,
      photos: photosPerStore.get(sid) ?? 0,
    });
  }
  const storesVisited = Array.from(storesVisitedMap.values()).sort((a, b) => a.store.localeCompare(b.store));

  // ── Stored AI narrative (latest version for this week), if generated ────────
  const { data: narrRow } = await supabase
    .from("v_weekly_reports_current")
    .select("brief_markdown")
    .eq("week_start", weekStart)
    .maybeSingle();
  const narrativeMarkdown = (narrRow as { brief_markdown: string } | null)?.brief_markdown ?? null;

  return {
    weekStart,
    weekEnd,
    label,
    narrativeMarkdown,
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
    engagementSummary,
    trainingProducts,
    byDay,
    storeDayMatrix,
    perCM,
    storesVisited,
  };
}

import { supabase } from "./supabase";

export interface TrainedStaffItem {
  name: string;
  products: string | null;
}

export interface FollowUpItem {
  id: string;
  title: string;
  status: string;
  due_date: string | null;
}

export interface VisitRow {
  id: string;
  visit_date: string;
  cm_telegram_id: number;
  cm_name: string;
  store_id: string;
  store_name: string;
  store_chain: string;
  store_market: string;
  store_tier: "T1" | "T2" | "T3" | "T4" | null;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  training: string | null;
  photo_count: number;
  photo_urls: string[];
  sections_filled: number;
  edited_at: string | null;
  training_count: number;
  follow_up_count: number;
  trained_staff: TrainedStaffItem[];
  follow_up_items: FollowUpItem[];
}

export interface StaffRow {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  is_ally: boolean;
  ally_since: string | null;
  store_id: string;
  store_name: string;
  store_chain: string;
  store_tier: "T1" | "T2" | "T3" | "T4" | null;
  store_market?: "SG" | "MY" | "TH" | "HK";
  tagged_visits?: number;
  times_trained?: number;
  last_trained_at?: string | null;
  last_trained_products?: string | null;
}

export interface CMOption { telegram_id: number; name: string; market: string | null }
export interface StoreOption { id: string; name: string; chain: string; tier: string | null; market?: 'SG' | 'MY' | 'TH' | 'HK' }

export interface TeamStats {
  visits_this_month: number;
  visits_all_time: number;
  active_cms_this_month: number;
  total_cms: number;
  total_stores: number;
}

const SECTION_KEYS = ["good_news", "competitors", "display_stock", "follow_up", "buzz_plan", "training"] as const;

function countSections(row: Record<string, unknown>): number {
  return SECTION_KEYS.filter((k) => row[k]).length;
}

export async function getTeamStats(): Promise<TeamStats> {
  const monthStart = new Date();
  monthStart.setDate(1);
  const since = monthStart.toISOString().slice(0, 10);

  const [allTime, thisMonth, cms, stores] = await Promise.all([
    supabase.from("visits").select("id", { count: "exact", head: true }).eq("is_locked", true),
    supabase.from("visits").select("cm_telegram_id").eq("is_locked", true).gte("visit_date", since),
    supabase.from("cms").select("telegram_id", { count: "exact", head: true }),
    supabase.from("stores").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  const activeCmIds = new Set((thisMonth.data ?? []).map((r: { cm_telegram_id: number }) => r.cm_telegram_id));

  return {
    visits_all_time: allTime.count ?? 0,
    visits_this_month: thisMonth.data?.length ?? 0,
    active_cms_this_month: activeCmIds.size,
    total_cms: cms.count ?? 0,
    total_stores: stores.count ?? 0,
  };
}

export interface StoreStatus {
  id: string;
  name: string;
  chain: string;
  market: 'SG' | 'TH' | 'MY' | 'HK';
  tier: 'T1' | 'T2' | 'T3' | 'T4' | null;
  last_visit_date: string | null;
}

export async function getStoreStatus(): Promise<StoreStatus[]> {
  const { data: stores } = await supabase
    .from('stores')
    .select('id, name, chain, market, tier')
    .eq('is_active', true)
    .order('market')
    .order('chain')
    .order('name');

  if (!stores || stores.length === 0) return [];

  const storeIds = stores.map((s) => s.id);

  const { data: visits } = await supabase
    .from('visits')
    .select('store_id, visit_date')
    .in('store_id', storeIds)
    .eq('is_locked', true)
    .order('visit_date', { ascending: false });

  const lastVisit = new Map<string, string>();
  for (const v of visits ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = v as any;
    if (!lastVisit.has(row.store_id)) lastVisit.set(row.store_id, row.visit_date);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return stores.map((s: any) => ({
    id: s.id,
    name: s.name,
    chain: s.chain,
    market: s.market,
    tier: s.tier,
    last_visit_date: lastVisit.get(s.id) ?? null,
  }));
}

export async function getVisitsFeed(opts: {
  cm?: number;
  cms?: number[];  // multi-select CM filter
  store?: string;
  from?: string;
  to?: string;
  offset?: number;
  limit?: number;
  market?: string;
  chain?: string;
}): Promise<{ visits: VisitRow[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  // Resolve store-id filter from market / chain / store opts
  let filteredStoreIds: string[] | null = null;
  if (opts.market || opts.chain) {
    let sq = supabase.from("stores").select("id").eq("is_active", true);
    if (opts.market) sq = sq.eq("market", opts.market);
    if (opts.chain) sq = sq.eq("chain", opts.chain);
    const { data: mStores } = await sq;
    const ids = (mStores ?? []).map((s: { id: string }) => s.id);
    if (ids.length === 0) return { visits: [], total: 0 };
    filteredStoreIds = ids;
  }

  let q = supabase
    .from("visits")
    .select("*, stores(name, chain, tier, market), cms!cm_telegram_id(full_name)", { count: "exact" })
    .eq("is_locked", true)
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts.cm) q = q.eq("cm_telegram_id", opts.cm);
  else if (opts.cms?.length) q = q.in("cm_telegram_id", opts.cms);
  if (opts.store) q = q.eq("store_id", opts.store);
  if (opts.from) q = q.gte("visit_date", opts.from);
  if (opts.to) q = q.lte("visit_date", opts.to);
  if (filteredStoreIds) q = q.in("store_id", filteredStoreIds);

  const { data, count } = await q;

  const visits: VisitRow[] = (data ?? []).map((v) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = v as any;
    return {
      id: row.id,
      visit_date: row.visit_date,
      cm_telegram_id: row.cm_telegram_id,
      cm_name: row.cms?.full_name ?? "Unknown",
      store_id: row.store_id,
      store_name: row.stores?.name ?? "Unknown",
      store_chain: row.stores?.chain ?? "",
      store_market: row.stores?.market ?? "",
      store_tier: row.stores?.tier ?? null,
      good_news: row.good_news,
      competitors: row.competitors,
      display_stock: row.display_stock,
      follow_up: row.follow_up,
      buzz_plan: row.buzz_plan,
      training: row.training,
      photo_count: 0,
      photo_urls: [],
      sections_filled: countSections(row),
      edited_at: row.edited_at,
      training_count: 0,
      follow_up_count: 0,
      trained_staff: [],
      follow_up_items: [],
    };
  });

  if (visits.length > 0) {
    const ids = visits.map((v) => v.id);

    // Photos
    const { data: photos } = await supabase
      .from("visit_photos")
      .select("visit_id, storage_path")
      .in("visit_id", ids)
      .order("created_at");
    const pathsByVisit = new Map<string, string[]>();
    for (const p of photos ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = p as any;
      const paths = pathsByVisit.get(row.visit_id) ?? [];
      paths.push(row.storage_path as string);
      pathsByVisit.set(row.visit_id, paths);
    }
    const allPaths = [...pathsByVisit.values()].flat();
    const signed = await signPhotoUrls(allPaths);
    const signedMap = new Map<string, string>();
    allPaths.forEach((p, i) => { if (signed[i]) signedMap.set(p, signed[i]); });
    for (const v of visits) {
      const paths = pathsByVisit.get(v.id) ?? [];
      v.photo_count = paths.length;
      v.photo_urls = paths.map((p) => signedMap.get(p) ?? "").filter(Boolean);
    }

    // Trained staff (rich — name + products)
    const { data: staffRows, error: staffErr } = await supabase
      .from("visit_staff")
      .select("visit_id, was_trained, products_trained_on, staff(name)")
      .in("visit_id", ids)
      .eq("was_trained", true);
    if (!staffErr && staffRows) {
      type StaffLink = { visit_id: string; products_trained_on: string | null; staff: { name: string } | null };
      const byVisit = new Map<string, TrainedStaffItem[]>();
      for (const r of staffRows as unknown as StaffLink[]) {
        const list = byVisit.get(r.visit_id) ?? [];
        list.push({ name: r.staff?.name ?? "Unknown", products: r.products_trained_on });
        byVisit.set(r.visit_id, list);
      }
      for (const v of visits) {
        const items = byVisit.get(v.id) ?? [];
        v.trained_staff = items;
        v.training_count = items.length;
      }
    }

    // Follow-up items (rich — title + status + due_date)
    const { data: fuRows, error: fuErr } = await supabase
      .from("visit_follow_ups")
      .select("id, visit_id, title, status, due_date")
      .in("visit_id", ids)
      .order("created_at", { ascending: true });
    if (!fuErr && fuRows) {
      type FuRow = { id: string; visit_id: string; title: string; status: string; due_date: string | null };
      const byVisit = new Map<string, FollowUpItem[]>();
      for (const r of fuRows as unknown as FuRow[]) {
        const list = byVisit.get(r.visit_id) ?? [];
        list.push({ id: r.id, title: r.title, status: r.status, due_date: r.due_date });
        byVisit.set(r.visit_id, list);
      }
      for (const v of visits) {
        const items = byVisit.get(v.id) ?? [];
        v.follow_up_items = items;
        v.follow_up_count = items.length;
      }
    }
  }

  return { visits, total: count ?? 0 };
}

export async function getCMsList(): Promise<CMOption[]> {
  const { data } = await supabase.from("cms").select("telegram_id, full_name, market").order("full_name");
  return (data ?? []).map((r: { telegram_id: number; full_name: string; market: string | null }) => ({ telegram_id: r.telegram_id, name: r.full_name, market: r.market }));
}

export async function getStoresList(): Promise<StoreOption[]> {
  const { data } = await supabase
    .from("stores")
    .select("id, name, chain, tier, market")
    .eq("is_active", true)
    .order("name");
  return (data ?? []) as StoreOption[];
}

export async function getAllStaff(): Promise<StaffRow[]> {
  const { data } = await supabase
    .from("staff")
    .select("*, stores(name, chain, tier, market)")
    .order("store_id")
    .order("name");

  const staffRows: StaffRow[] = (data ?? []).map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = s as any;
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      phone: row.phone,
      is_ally: row.is_ally,
      ally_since: row.ally_since,
      store_id: row.store_id,
      store_name: row.stores?.name ?? "Unknown",
      store_chain: row.stores?.chain ?? "",
      store_tier: row.stores?.tier ?? null,
      store_market: row.stores?.market ?? "SG",
      tagged_visits: 0,
      times_trained: 0,
      last_trained_at: null,
      last_trained_products: null,
    };
  });

  // Pull training data from visit_staff. Tolerate the migration not being applied yet.
  if (staffRows.length > 0) {
    const ids = staffRows.map((s) => s.id);
    const { data: vsRaw, error: vsErr } = await supabase
      .from("visit_staff")
      .select("staff_id, was_trained, products_trained_on, visits(visit_date, is_locked)")
      .in("staff_id", ids);
    if (!vsErr && vsRaw) {
      type Vs = {
        staff_id: string;
        was_trained?: boolean | null;
        products_trained_on?: string | null;
        visits?: { visit_date?: string; is_locked?: boolean } | null;
      };
      const byStaff = new Map<string, {
        tagged: number;
        trained: number;
        last_trained_at: string | null;
        last_trained_products: string | null;
      }>();
      for (const linkRaw of vsRaw) {
        const link = linkRaw as unknown as Vs;
        const v = link.visits;
        if (v && v.is_locked === false) continue;
        const acc = byStaff.get(link.staff_id) ?? { tagged: 0, trained: 0, last_trained_at: null, last_trained_products: null };
        acc.tagged += 1;
        if (link.was_trained) {
          acc.trained += 1;
          const vDate = v?.visit_date ?? null;
          if (vDate && (acc.last_trained_at === null || vDate > acc.last_trained_at)) {
            acc.last_trained_at = vDate;
            acc.last_trained_products = link.products_trained_on ?? null;
          }
        }
        byStaff.set(link.staff_id, acc);
      }
      for (const s of staffRows) {
        const agg = byStaff.get(s.id);
        s.tagged_visits = agg?.tagged ?? 0;
        s.times_trained = agg?.trained ?? 0;
        s.last_trained_at = agg?.last_trained_at ?? null;
        s.last_trained_products = agg?.last_trained_products ?? null;
      }
    }
  }

  return staffRows;
}

// ── Store Staff (single store) ────────────────────────────────────────────────

export async function getStoreStaff(storeId: string): Promise<StaffRow[]> {
  const { data } = await supabase
    .from('staff')
    .select('*, stores(name, chain, tier, market)')
    .eq('store_id', storeId)
    .order('name');

  const staffRows: StaffRow[] = (data ?? []).map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = s as any;
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      phone: row.phone,
      is_ally: row.is_ally,
      ally_since: row.ally_since,
      store_id: row.store_id,
      store_name: row.stores?.name ?? 'Unknown',
      store_chain: row.stores?.chain ?? '',
      store_tier: row.stores?.tier ?? null,
      store_market: row.stores?.market ?? 'SG',
      tagged_visits: 0,
      times_trained: 0,
      last_trained_at: null,
      last_trained_products: null,
    };
  });

  if (staffRows.length > 0) {
    const ids = staffRows.map((s) => s.id);
    const { data: vsRaw, error: vsErr } = await supabase
      .from('visit_staff')
      .select('staff_id, was_trained, products_trained_on, visits(visit_date, is_locked)')
      .in('staff_id', ids);
    if (!vsErr && vsRaw) {
      type Vs = {
        staff_id: string;
        was_trained?: boolean | null;
        products_trained_on?: string | null;
        visits?: { visit_date?: string; is_locked?: boolean } | null;
      };
      const byStaff = new Map<string, {
        tagged: number;
        trained: number;
        last_trained_at: string | null;
        last_trained_products: string | null;
      }>();
      for (const linkRaw of vsRaw) {
        const link = linkRaw as unknown as Vs;
        const v = link.visits;
        if (v && v.is_locked === false) continue;
        const acc = byStaff.get(link.staff_id) ?? { tagged: 0, trained: 0, last_trained_at: null, last_trained_products: null };
        acc.tagged += 1;
        if (link.was_trained) {
          acc.trained += 1;
          const vDate = v?.visit_date ?? null;
          if (vDate && (acc.last_trained_at === null || vDate > acc.last_trained_at)) {
            acc.last_trained_at = vDate;
            acc.last_trained_products = link.products_trained_on ?? null;
          }
        }
        byStaff.set(link.staff_id, acc);
      }
      for (const s of staffRows) {
        const agg = byStaff.get(s.id);
        s.tagged_visits = agg?.tagged ?? 0;
        s.times_trained = agg?.trained ?? 0;
        s.last_trained_at = agg?.last_trained_at ?? null;
        s.last_trained_products = agg?.last_trained_products ?? null;
      }
    }
  }

  return staffRows;
}

// ── Staff Detail ──────────────────────────────────────────────────────────────

export interface StaffTrainingEntry {
  visit_id: string;
  visit_date: string;
  products: string | null;
}

export interface StaffTaggedVisit {
  visit_id: string;
  visit_date: string;
  was_trained: boolean;
  store_name: string;
}

export interface StaffDetailInfo {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  is_ally: boolean;
  store_id: string;
  store_name: string;
  tagged_visits: number;
  times_trained: number;
  last_trained_at: string | null;
  training_history: StaffTrainingEntry[];
  tagged_visit_history: StaffTaggedVisit[];
}

export async function getStaffDetail(staffId: string): Promise<StaffDetailInfo | null> {
  const { data: staffData } = await supabase
    .from('staff')
    .select('*, stores(name)')
    .eq('id', staffId)
    .single();

  if (!staffData) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = staffData as any;

  const { data: vsRaw } = await supabase
    .from('visit_staff')
    .select('visit_id, was_trained, products_trained_on, visits(visit_date, is_locked, stores(name))')
    .eq('staff_id', staffId)
    .order('visit_id', { ascending: false });

  type VsDetail = {
    visit_id: string;
    was_trained?: boolean | null;
    products_trained_on?: string | null;
    visits?: { visit_date?: string; is_locked?: boolean; stores?: { name?: string } | null } | null;
  };

  let tagged_visits = 0;
  let times_trained = 0;
  let last_trained_at: string | null = null;
  const training_history: StaffTrainingEntry[] = [];
  const tagged_visit_history: StaffTaggedVisit[] = [];

  for (const linkRaw of vsRaw ?? []) {
    const link = linkRaw as unknown as VsDetail;
    const v = link.visits;
    if (v && v.is_locked === false) continue;
    tagged_visits += 1;
    tagged_visit_history.push({
      visit_id: link.visit_id,
      visit_date: v?.visit_date ?? '',
      was_trained: link.was_trained ?? false,
      store_name: v?.stores?.name ?? s.stores?.name ?? 'Unknown',
    });
    if (link.was_trained) {
      times_trained += 1;
      const vDate = v?.visit_date ?? null;
      if (vDate && (last_trained_at === null || vDate > last_trained_at)) last_trained_at = vDate;
      training_history.push({
        visit_id: link.visit_id,
        visit_date: v?.visit_date ?? '',
        products: link.products_trained_on ?? null,
      });
    }
  }

  // Sort newest first
  tagged_visit_history.sort((a, b) => b.visit_date.localeCompare(a.visit_date));
  training_history.sort((a, b) => b.visit_date.localeCompare(a.visit_date));

  return {
    id: s.id,
    name: s.name,
    role: s.role ?? null,
    phone: s.phone ?? null,
    is_ally: s.is_ally ?? false,
    store_id: s.store_id,
    store_name: s.stores?.name ?? 'Unknown',
    tagged_visits,
    times_trained,
    last_trained_at,
    training_history,
    tagged_visit_history,
  };
}

export interface StoreInfo {
  id: string;
  name: string;
  chain: string;
  market: string;
  tier: 'T1' | 'T2' | 'T3' | 'T4' | null;
}

export interface StoreVisitSummary {
  id: string;
  visit_date: string;
  cm_telegram_id: number;
  cm_name: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  training: string | null;
  people_training: string | null;
  photo_count: number;
  thumb_urls: string[];
  photo_urls: string[];
}

export interface StoreMemoryNote {
  slug: string;
  scope: "store" | "person" | "theme" | "channel";
  title: string;
  summary: string;
  version: number;
  last_touched_at: string;
}

export async function signPhotoUrls(paths: string[], ttlSec = 300): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await supabase.storage.from('sva-photos').createSignedUrls(paths, ttlSec);
  if (error || !data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((d) => d.signedUrl as string).filter(Boolean);
}

export async function getVisitPhotos(visitId: string): Promise<string[]> {
  const { data } = await supabase
    .from('visit_photos')
    .select('storage_path')
    .eq('visit_id', visitId)
    .order('created_at');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paths = (data ?? []).map((p: any) => p.storage_path as string).filter(Boolean);
  return signPhotoUrls(paths);
}

export async function getStoreDashboard(storeId: string): Promise<{ store: StoreInfo | null; visits: StoreVisitSummary[]; memory_notes: StoreMemoryNote[]; staff: StaffRow[] }> {
  const [storeRes, visitsRes, notesRes, staff] = await Promise.all([
    supabase.from('stores').select('id, name, chain, market, tier').eq('id', storeId).single(),
    supabase
      .from('visits')
      .select('id, visit_date, cm_telegram_id, good_news, competitors, display_stock, follow_up, buzz_plan, training, people_training, cms!cm_telegram_id(full_name, nickname)')
      .eq('store_id', storeId)
      .eq('is_locked', true)
      .order('visit_date', { ascending: false }),
    supabase
      .from('v_memory_notes_current')
      .select('slug, scope, title, summary, version, last_touched_at')
      .eq('scope', 'store')
      .eq('scope_ref', storeId)
      .order('last_touched_at', { ascending: false }),
    getStoreStaff(storeId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = (storeRes.data as any) as StoreInfo | null ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitRows = (visitsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memory_notes = (notesRes.data ?? []) as StoreMemoryNote[];

  if (visitRows.length === 0) return { store, visits: [], memory_notes, staff };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = visitRows.map((v: any) => v.id);
  const { data: photoRows } = await supabase
    .from('visit_photos')
    .select('visit_id, storage_path')
    .in('visit_id', ids)
    .order('created_at');

  const allPathsByVisit = new Map<string, string[]>();
  const thumbPathsByVisit = new Map<string, string[]>();
  const countByVisit = new Map<string, number>();

  for (const p of photoRows ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = p as any;
    const vid = row.visit_id as string;
    const path = row.storage_path as string;
    countByVisit.set(vid, (countByVisit.get(vid) ?? 0) + 1);
    const all = allPathsByVisit.get(vid) ?? [];
    all.push(path);
    allPathsByVisit.set(vid, all);
    const thumbs = thumbPathsByVisit.get(vid) ?? [];
    if (thumbs.length < 3) { thumbs.push(path); thumbPathsByVisit.set(vid, thumbs); }
  }

  const allPaths = [...allPathsByVisit.values()].flat();
  const signedUrls = await signPhotoUrls(allPaths);
  const signedMap = new Map<string, string>();
  allPaths.forEach((p, i) => { if (signedUrls[i]) signedMap.set(p, signedUrls[i]); });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visits: StoreVisitSummary[] = visitRows.map((v: any) => ({
    id: v.id,
    visit_date: v.visit_date,
    cm_telegram_id: v.cm_telegram_id as number,
    cm_name: v.cms?.nickname ?? v.cms?.full_name ?? 'Unknown',
    good_news: v.good_news ?? null,
    competitors: v.competitors ?? null,
    display_stock: v.display_stock ?? null,
    follow_up: v.follow_up ?? null,
    buzz_plan: v.buzz_plan ?? null,
    training: v.training ?? null,
    people_training: v.people_training ?? null,
    photo_count: countByVisit.get(v.id) ?? 0,
    thumb_urls: (thumbPathsByVisit.get(v.id) ?? []).map((p) => signedMap.get(p) ?? '').filter(Boolean),
    photo_urls: (allPathsByVisit.get(v.id) ?? []).map((p) => signedMap.get(p) ?? '').filter(Boolean),
  }));

  return { store, visits, memory_notes, staff };
}

// ── CM Detail (for visits page right panel) ──────────────────────────────────

export interface CMDetailInfo {
  telegram_id: number;
  full_name: string;
  market: string;
  am_name: string | null;
  assigned_stores: Array<{ id: string; name: string; chain: string; tier: 'T1'|'T2'|'T3'|'T4'|null; market: string }>;
}

export async function getCMDetail(telegramId: number): Promise<{ cm: CMDetailInfo | null; visits: VisitRow[] }> {
  const { data: cmData } = await supabase
    .from('cms')
    .select('telegram_id, full_name, market, am_telegram_id')
    .eq('telegram_id', telegramId)
    .single();

  if (!cmData) return { cm: null, visits: [] };

  // Resolve AM name
  let amName: string | null = null;
  if ((cmData as any).am_telegram_id) {
    const { data: amRow } = await supabase
      .from('cms').select('full_name').eq('telegram_id', (cmData as any).am_telegram_id).single();
    amName = (amRow as any)?.full_name ?? null;
  }

  // Assigned stores
  const { data: assignData } = await supabase
    .from('cm_store_assignments')
    .select('stores(id, name, chain, tier, market)')
    .eq('cm_telegram_id', telegramId)
    .eq('is_active', true);

  const TIER_ORDER: Record<string, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stores = ((assignData ?? []) as any[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((a: any) => a.stores)
    .filter(Boolean)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => {
      const ta = a.tier ? (TIER_ORDER[a.tier] ?? 99) : 99;
      const tb = b.tier ? (TIER_ORDER[b.tier] ?? 99) : 99;
      return ta !== tb ? ta - tb : a.name.localeCompare(b.name);
    });

  const { visits } = await getVisitsFeed({ cm: telegramId, limit: 15 });

  return {
    cm: {
      telegram_id: (cmData as any).telegram_id,
      full_name: (cmData as any).full_name,
      market: (cmData as any).market,
      am_name: amName,
      assigned_stores: stores,
    },
    visits,
  };
}

export interface DashboardCM {
  telegram_id: number;
  full_name: string;
  role: 'cm' | 'cmic' | 'am' | 'admin';
  is_active: boolean;
}

export async function getCMByTelegramId(telegramId: number): Promise<DashboardCM | null> {
  const { data } = await supabase
    .from('cms')
    .select('telegram_id, full_name, role, is_active')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  return (data as DashboardCM | null) ?? null;
}

// ─── Channel Managers + store assignments ─────────────────────────────────────

export interface CMRow {
  telegram_id: number;
  full_name: string;
  nickname: string | null;
  role: 'cm' | 'cmic' | 'am' | 'admin';
  market: 'SG' | 'MY' | 'TH' | 'HK';
  am_telegram_id: number | null;
  am_name: string | null;
  assigned_stores: { id: string; name: string; chain: string; tier: 'T1' | 'T2' | 'T3' | 'T4' | null; market: 'SG' | 'MY' | 'TH' | 'HK' }[];
}

export async function getCMsWithAssignments(): Promise<CMRow[]> {
  const { data: cmsRaw } = await supabase
    .from('cms')
    .select('telegram_id, full_name, nickname, role, market, am_telegram_id, is_active')
    .eq('is_active', true)
    .order('full_name');
  const cms = (cmsRaw ?? []) as {
    telegram_id: number;
    full_name: string;
    nickname: string | null;
    role: 'cm' | 'cmic' | 'am' | 'admin';
    market: 'SG' | 'MY' | 'TH' | 'HK';
    am_telegram_id: number | null;
    is_active: boolean;
  }[];

  const cmsById = new Map(cms.map((c) => [c.telegram_id, c]));

  const { data: assignRaw } = await supabase
    .from('cm_store_assignments')
    .select('cm_telegram_id, store_id, stores(id, name, chain, tier, market)')
    .eq('is_active', true);

  type AssignRow = {
    cm_telegram_id: number;
    store_id: string;
    stores: { id: string; name: string; chain: string; tier: 'T1' | 'T2' | 'T3' | 'T4' | null; market: 'SG' | 'MY' | 'TH' | 'HK' } | null;
  };

  const byCm = new Map<number, CMRow['assigned_stores']>();
  for (const row of (assignRaw ?? []) as unknown as AssignRow[]) {
    if (!row.stores) continue;
    const list = byCm.get(row.cm_telegram_id) ?? [];
    list.push(row.stores);
    byCm.set(row.cm_telegram_id, list);
  }

  return cms.map((c) => {
    const am = c.am_telegram_id ? cmsById.get(c.am_telegram_id) : null;
    const stores = (byCm.get(c.telegram_id) ?? []).sort((a, b) => {
      const c0 = a.chain.localeCompare(b.chain);
      return c0 !== 0 ? c0 : a.name.localeCompare(b.name);
    });
    return {
      telegram_id: c.telegram_id,
      full_name: c.full_name,
      nickname: c.nickname,
      role: c.role,
      market: c.market,
      am_telegram_id: c.am_telegram_id,
      am_name: am?.full_name ?? null,
      assigned_stores: stores,
    };
  });
}

export async function assignStore(cmTelegramId: number, storeId: string): Promise<boolean> {
  const { error } = await supabase
    .from('cm_store_assignments')
    .upsert(
      { cm_telegram_id: cmTelegramId, store_id: storeId, is_active: true },
      { onConflict: 'cm_telegram_id,store_id' },
    );
  if (error) console.error('assignStore error:', error);
  return !error;
}

export async function unassignStore(cmTelegramId: number, storeId: string): Promise<boolean> {
  const { error } = await supabase
    .from('cm_store_assignments')
    .delete()
    .eq('cm_telegram_id', cmTelegramId)
    .eq('store_id', storeId);
  if (error) console.error('unassignStore error:', error);
  return !error;
}

export async function setAllyStatus(staffId: string, isAlly: boolean): Promise<boolean> {
  const { error } = await supabase
    .from("staff")
    .update({ is_ally: isAlly, ally_since: isAlly ? new Date().toISOString() : null })
    .eq("id", staffId);
  return !error;
}

export interface PayrollGrid {
  weeks: { start: string; end: string }[]; // ISO Monday → Sunday, oldest → newest
  rows: {
    telegram_id: number;
    full_name: string;
    nickname: string | null;
    market: 'SG' | 'MY' | 'TH' | 'HK';
    am_name: string | null;
    counts: number[]; // length = weeks.length
    range_total: number;
  }[];
  co_credit_active: boolean;
  range: { from: string; to: string };
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function mondayOf(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d;
}

function buildWeeks(fromISO: string, toISO: string): { start: string; end: string }[] {
  const start = mondayOf(new Date(fromISO + 'T00:00:00'));
  const to = new Date(toISO + 'T00:00:00');
  const weeks: { start: string; end: string }[] = [];
  const cursor = new Date(start);
  // Safety cap so a typo can't produce millions of weeks
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

export async function getPayrollGrid(fromISO: string, toISO: string): Promise<PayrollGrid> {
  const weeks = buildWeeks(fromISO, toISO);
  if (weeks.length === 0) {
    return { weeks: [], rows: [], co_credit_active: false, range: { from: fromISO, to: toISO } };
  }
  const windowStartISO = weeks[0].start;
  const windowEndISO = weeks[weeks.length - 1].end;

  // CMs: only those whose role earns payroll attribution (cm + cmic). AMs/admins excluded from rows.
  const { data: cmsRaw } = await supabase
    .from('cms')
    .select('telegram_id, full_name, role, market, am_telegram_id, is_active')
    .eq('is_active', true);
  const allCms = (cmsRaw ?? []) as unknown as {
    telegram_id: number;
    full_name: string;
    role: 'cm' | 'cmic' | 'am' | 'admin';
    market: 'SG' | 'MY' | 'TH' | 'HK';
    am_telegram_id: number | null;
    is_active: boolean;
  }[];
  const cmsById = new Map(allCms.map((c) => [c.telegram_id, c]));
  const payrollCms = allCms.filter((c) => c.role === 'cm' || c.role === 'cmic');
  if (payrollCms.length === 0) {
    return { weeks, rows: [], co_credit_active: false, range: { from: windowStartISO, to: windowEndISO } };
  }

  // Visits in window
  const { data: visitsRaw } = await supabase
    .from('visits')
    .select('id, visit_date, cm_telegram_id')
    .eq('is_locked', true)
    .gte('visit_date', windowStartISO)
    .lte('visit_date', windowEndISO);
  const visits = (visitsRaw ?? []) as { id: string; visit_date: string; cm_telegram_id: number }[];

  // Co-CM tagging via visit_cms — fall back gracefully if migration not applied
  let coCreditActive = false;
  let coCreditByVisit: Map<string, Set<number>> | null = null;
  if (visits.length > 0) {
    const { data: vcRaw, error: vcErr } = await supabase
      .from('visit_cms')
      .select('visit_id, cm_telegram_id')
      .in('visit_id', visits.map((v) => v.id));
    if (!vcErr && vcRaw && vcRaw.length > 0) {
      coCreditActive = true;
      coCreditByVisit = new Map();
      for (const link of vcRaw as { visit_id: string; cm_telegram_id: number }[]) {
        const set = coCreditByVisit.get(link.visit_id) ?? new Set<number>();
        set.add(link.cm_telegram_id);
        coCreditByVisit.set(link.visit_id, set);
      }
    }
  }

  // Build week index keyed by Monday ISO
  const weekIdx = new Map(weeks.map((w, i) => [w.start, i]));
  const cellCounts = new Map<number, number[]>();
  for (const c of payrollCms) cellCounts.set(c.telegram_id, new Array(weeks.length).fill(0));

  for (const v of visits) {
    const mon = mondayOf(new Date(v.visit_date + 'T00:00:00'));
    const idx = weekIdx.get(isoDate(mon));
    if (idx === undefined) continue;
    const credited = coCreditByVisit?.get(v.id) ?? new Set<number>([v.cm_telegram_id]);
    for (const cmId of credited) {
      const row = cellCounts.get(cmId);
      if (!row) continue; // skip non-payroll CMs (AM/admin) even if tagged
      row[idx] += 1;
    }
  }

  const rows = payrollCms.map((c) => {
    const counts = cellCounts.get(c.telegram_id) ?? new Array(weeks.length).fill(0);
    const am = c.am_telegram_id ? cmsById.get(c.am_telegram_id) : null;
    return {
      telegram_id: c.telegram_id,
      full_name: c.full_name,
      nickname: null,
      market: c.market,
      am_name: am?.full_name ?? null,
      counts,
      range_total: counts.reduce((a, b) => a + b, 0),
    };
  }).sort((a, b) => {
    const amCmp = (a.am_name ?? 'ZZZ').localeCompare(b.am_name ?? 'ZZZ');
    if (amCmp !== 0) return amCmp;
    return a.full_name.localeCompare(b.full_name);
  });

  return { weeks, rows, co_credit_active: coCreditActive, range: { from: windowStartISO, to: windowEndISO } };
}

// ─── Admin tab: people management ────────────────────────────────────────────

export type AdminRole = 'cm' | 'cmic' | 'am' | 'admin';
export type AdminMarket = 'SG' | 'MY' | 'TH' | 'HK';

export interface ActivePersonRow {
  telegram_id: number;
  full_name: string;
  nickname: string | null;
  role: AdminRole;
  market: AdminMarket;
  am_telegram_id: number | null;
  am_name: string | null;
  is_active: boolean;
  is_intelligence_recipient: boolean;
  is_join_request_admin: boolean;
}

export interface PendingPersonRow {
  telegram_id: number;
  full_name: string;
  pending_request_at: string;
}

export async function getActivePeople(): Promise<ActivePersonRow[]> {
  const { data, error } = await supabase
    .from('cms')
    .select('telegram_id, full_name, nickname, role, market, am_telegram_id, is_active, is_intelligence_recipient, is_join_request_admin')
    .eq('is_active', true)
    .order('full_name');
  if (error || !data) {
    console.error('getActivePeople error:', error);
    return [];
  }
  const rows = data as Omit<ActivePersonRow, 'am_name'>[];
  const byId = new Map(rows.map((r) => [r.telegram_id, r.full_name]));
  return rows.map((r) => ({
    ...r,
    am_name: r.am_telegram_id ? byId.get(r.am_telegram_id) ?? null : null,
  }));
}

export async function getPendingPeople(): Promise<PendingPersonRow[]> {
  const { data, error } = await supabase
    .from('cms')
    .select('telegram_id, full_name, pending_request_at')
    .eq('is_active', false)
    .not('pending_request_at', 'is', null)
    .order('pending_request_at', { ascending: false });
  if (error || !data) {
    console.error('getPendingPeople error:', error);
    return [];
  }
  return data as PendingPersonRow[];
}

export interface CreatePersonInput {
  telegram_id: number;
  full_name: string;
  role: AdminRole;
  market: AdminMarket;
}

export async function createPerson(input: CreatePersonInput): Promise<boolean> {
  const { error } = await supabase
    .from('cms')
    .upsert(
      {
        telegram_id: input.telegram_id,
        full_name: input.full_name,
        role: input.role,
        market: input.market,
        is_active: true,
        pending_request_at: null,
      },
      { onConflict: 'telegram_id' },
    );
  if (error) console.error('createPerson error:', error);
  return !error;
}

export interface UpdatePersonPatch {
  role?: AdminRole;
  market?: AdminMarket;
  am_telegram_id?: number | null;
  is_active?: boolean;
  is_intelligence_recipient?: boolean;
  is_join_request_admin?: boolean;
}

export async function updatePerson(
  telegramId: number,
  patch: UpdatePersonPatch,
): Promise<boolean> {
  const { error } = await supabase.from('cms').update(patch).eq('telegram_id', telegramId);
  if (error) console.error('updatePerson error:', error);
  return !error;
}

export async function approvePendingPerson(
  telegramId: number,
  market: AdminMarket,
  role: AdminRole = 'cm',
): Promise<boolean> {
  const { error } = await supabase
    .from('cms')
    .update({ is_active: true, market, role, pending_request_at: null })
    .eq('telegram_id', telegramId);
  if (error) console.error('approvePendingPerson error:', error);
  return !error;
}

export async function rejectPendingPerson(telegramId: number): Promise<boolean> {
  const { error } = await supabase
    .from('cms')
    .delete()
    .eq('telegram_id', telegramId)
    .eq('is_active', false)
    .not('pending_request_at', 'is', null);
  if (error) console.error('rejectPendingPerson error:', error);
  return !error;
}

// ─── Admin tab: alert groups ─────────────────────────────────────────────────

export type IntelligenceMode = 'people' | 'group' | 'both';

export interface AlertGroupRow {
  market: AdminMarket;
  chat_id: number | null;
  intelligence_mode: IntelligenceMode;
  updated_at: string;
}

export async function listAlertGroups(): Promise<AlertGroupRow[]> {
  const { data, error } = await supabase
    .from('alert_groups')
    .select('market, chat_id, intelligence_mode, updated_at')
    .order('market');
  if (error || !data) {
    console.error('listAlertGroups error:', error);
    return [];
  }
  return data as AlertGroupRow[];
}

export interface AlertGroupPatch {
  chat_id?: number | null;
  intelligence_mode?: IntelligenceMode;
}

export async function setAlertGroup(
  market: AdminMarket,
  patch: AlertGroupPatch,
  updatedByTelegramId: number,
): Promise<boolean> {
  const row = {
    ...patch,
    updated_at: new Date().toISOString(),
    updated_by_telegram_id: updatedByTelegramId,
  };
  const { error } = await supabase.from('alert_groups').update(row).eq('market', market);
  if (error) console.error('setAlertGroup error:', error);
  return !error;
}

// ─── Admin tab: stores CRUD ──────────────────────────────────────────────────

export type StoreTier = 'T1' | 'T2' | 'T3' | 'T4';

export interface AdminStoreRow {
  id: string;
  name: string;
  chain: string;
  market: AdminMarket;
  tier: StoreTier | null;
  address: string | null;
  is_active: boolean;
}

export async function getAllStores(): Promise<AdminStoreRow[]> {
  const { data, error } = await supabase
    .from('stores')
    .select('id, name, chain, market, tier, address, is_active')
    .order('market')
    .order('chain')
    .order('name');
  if (error || !data) {
    console.error('getAllStores error:', error);
    return [];
  }
  return data as AdminStoreRow[];
}

export interface CreateStoreInput {
  name: string;
  chain: string;
  market: AdminMarket;
  tier?: StoreTier | null;
  address?: string | null;
}

export async function createStore(input: CreateStoreInput): Promise<AdminStoreRow | null> {
  const { data, error } = await supabase
    .from('stores')
    .insert({
      name: input.name,
      chain: input.chain,
      market: input.market,
      tier: input.tier ?? null,
      address: input.address ?? null,
      is_active: true,
    })
    .select()
    .single();
  if (error) {
    console.error('createStore error:', error);
    return null;
  }
  return data as AdminStoreRow;
}

export interface UpdateStorePatch {
  name?: string;
  chain?: string;
  market?: AdminMarket;
  tier?: StoreTier | null;
  address?: string | null;
  is_active?: boolean;
}

export async function updateStore(id: string, patch: UpdateStorePatch): Promise<boolean> {
  const { error } = await supabase.from('stores').update(patch).eq('id', id);
  if (error) console.error('updateStore error:', error);
  return !error;
}

import { supabase } from "./supabase";

export interface EngagedPersonItem {
  id: string;                 // staff id ("" for free-typed people with no staff row)
  name: string;
  update_text: string | null; // the free-text note logged about this person
  was_trained: boolean;       // true if a product/training was recorded for them
  products: string | null;    // CSV of products they were trained on (if any)
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
  photos: PhotoItem[];
  sections_filled: number;
  edited_at: string | null;
  engagement_count: number;
  follow_up_count: number;
  engaged_people: EngagedPersonItem[];
  follow_up_items: FollowUpItem[];
  // When the CM marked this visit's review feedback as seen (migration 023). null = unseen.
  review_ack_at: string | null;
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
      photos: [],
      sections_filled: countSections(row),
      edited_at: row.edited_at,
      engagement_count: 0,
      follow_up_count: 0,
      engaged_people: [],
      follow_up_items: [],
      review_ack_at: row.review_ack_at ?? null,
    };
  });

  if (visits.length > 0) {
    const ids = visits.map((v) => v.id);

    // Photos — full PhotoItem (id + section + grade + comments + annotations) so the
    // feed lightbox can navigate + comment, same shape the store reviewer uses.
    const { data: photoRows } = await supabase
      .from("visit_photos")
      .select("id, visit_id, storage_path, section_key, review_grade")
      .in("visit_id", ids)
      .order("created_at");
    type PhotoMeta = { id: string; path: string; section_key: string | null; grade: number | null };
    const metaByVisit = new Map<string, PhotoMeta[]>();
    for (const p of photoRows ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = p as any;
      const list = metaByVisit.get(row.visit_id) ?? [];
      list.push({ id: row.id, path: row.storage_path as string, section_key: row.section_key ?? null, grade: row.review_grade ?? null });
      metaByVisit.set(row.visit_id, list);
    }

    const allMeta = [...metaByVisit.values()].flat();
    const allPaths = allMeta.map((m) => m.path);
    // 1h TTL so a long review session doesn't 403 mid-way.
    const signed = await signPhotoUrls(allPaths, 3600);
    const signedMap = new Map<string, string>();
    allPaths.forEach((p, i) => { if (signed[i]) signedMap.set(p, signed[i]); });

    const photoIds = allMeta.map((m) => m.id);
    const commentsByPhoto = new Map<string, PhotoComment[]>();
    const annotationsByPhoto = new Map<string, PhotoAnnotation[]>();
    if (photoIds.length > 0) {
      const [cRes, aRes] = await Promise.all([
        supabase.from("photo_comments")
          .select("id, photo_id, body, author_name, created_at")
          .in("photo_id", photoIds).order("created_at"),
        supabase.from("photo_annotations")
          .select("id, photo_id, x, y, w, h, note, author_name, created_at")
          .in("photo_id", photoIds).order("created_at"),
      ]);
      for (const r of (cRes.data ?? []) as Array<PhotoComment & { photo_id: string }>) {
        const list = commentsByPhoto.get(r.photo_id) ?? [];
        list.push({ id: r.id, body: r.body, author_name: r.author_name, created_at: r.created_at });
        commentsByPhoto.set(r.photo_id, list);
      }
      for (const r of (aRes.data ?? []) as Array<PhotoAnnotation & { photo_id: string }>) {
        const list = annotationsByPhoto.get(r.photo_id) ?? [];
        list.push({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, note: r.note, author_name: r.author_name, created_at: r.created_at });
        annotationsByPhoto.set(r.photo_id, list);
      }
    }

    for (const v of visits) {
      const meta = metaByVisit.get(v.id) ?? [];
      const photos: PhotoItem[] = meta
        .map((m) => ({
          id: m.id,
          url: signedMap.get(m.path) ?? "",
          section_key: m.section_key,
          grade: m.grade,
          comments: commentsByPhoto.get(m.id) ?? [],
          annotations: annotationsByPhoto.get(m.id) ?? [],
        }))
        .filter((p) => p.url);
      v.photo_count = photos.length;
      v.photo_urls = photos.map((p) => p.url);
      v.photos = photos;
    }

    // Engaged people (ALL people logged on the visit — not only those trained).
    // Mirrors the bot's getVisitEngagements: every visit_staff row, enriched
    // with the per-person update + trainings (from engagement_trainings, with a
    // CSV fallback for legacy rows). "Trained" becomes a per-person badge, not
    // a filter — an engagement with no training is still shown.
    const { data: staffRows, error: staffErr } = await supabase
      .from("visit_staff")
      .select("id, visit_id, person_name, update_text, was_trained, products_trained_on, staff(id, name)")
      .in("visit_id", ids);
    if (!staffErr && staffRows) {
      type StaffLink = {
        id: string;
        visit_id: string;
        person_name: string | null;
        update_text: string | null;
        was_trained: boolean | null;
        products_trained_on: string | null;
        staff: { id: string; name: string } | null;
      };
      const rows = staffRows as unknown as StaffLink[];

      // Per-person trainings from the child table (newer engagement model).
      const vsIds = rows.map((r) => r.id);
      const trainingsByPerson = new Map<string, string[]>();
      if (vsIds.length > 0) {
        const { data: etRows } = await supabase
          .from("engagement_trainings")
          .select("visit_staff_id, product_name")
          .in("visit_staff_id", vsIds);
        for (const t of (etRows ?? []) as { visit_staff_id: string; product_name: string }[]) {
          const arr = trainingsByPerson.get(t.visit_staff_id) ?? [];
          arr.push(t.product_name);
          trainingsByPerson.set(t.visit_staff_id, arr);
        }
      }

      const byVisit = new Map<string, EngagedPersonItem[]>();
      for (const r of rows) {
        const trainings = trainingsByPerson.get(r.id) ?? [];
        const products = trainings.length > 0 ? trainings.join(", ") : (r.products_trained_on ?? null);
        const wasTrained = Boolean(r.was_trained) || trainings.length > 0 || Boolean(r.products_trained_on);
        const list = byVisit.get(r.visit_id) ?? [];
        list.push({
          id: r.staff?.id ?? "",
          name: r.person_name ?? r.staff?.name ?? "Unknown",
          update_text: r.update_text ?? null,
          was_trained: wasTrained,
          products,
        });
        byVisit.set(r.visit_id, list);
      }
      for (const v of visits) {
        const items = (byVisit.get(v.id) ?? []).sort((a, b) => a.name.localeCompare(b.name));
        v.engaged_people = items;
        v.engagement_count = items.length;
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
  store_id: string;
  store_name: string;
}

export interface StaffTaggedVisit {
  visit_id: string;
  visit_date: string;
  was_trained: boolean;
  store_id: string;
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
    .select('visit_id, was_trained, products_trained_on, visits(visit_date, is_locked, store_id, stores(id, name))')
    .eq('staff_id', staffId)
    .order('visit_id', { ascending: false });

  type VsDetail = {
    visit_id: string;
    was_trained?: boolean | null;
    products_trained_on?: string | null;
    visits?: { visit_date?: string; is_locked?: boolean; store_id?: string; stores?: { id?: string; name?: string } | null } | null;
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
    const storeId = v?.stores?.id ?? v?.store_id ?? s.store_id;
    const storeName = v?.stores?.name ?? s.stores?.name ?? 'Unknown';
    tagged_visits += 1;
    tagged_visit_history.push({
      visit_id: link.visit_id,
      visit_date: v?.visit_date ?? '',
      was_trained: link.was_trained ?? false,
      store_id: storeId,
      store_name: storeName,
    });
    if (link.was_trained) {
      times_trained += 1;
      const vDate = v?.visit_date ?? null;
      if (vDate && (last_trained_at === null || vDate > last_trained_at)) last_trained_at = vDate;
      training_history.push({
        visit_id: link.visit_id,
        visit_date: v?.visit_date ?? '',
        products: link.products_trained_on ?? null,
        store_id: storeId,
        store_name: storeName,
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

export interface PhotoComment {
  id: string;
  body: string;
  author_name: string | null;
  created_at: string;
}

export interface PhotoAnnotation {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  note: string;
  author_name: string | null;
  created_at: string;
}

export interface PhotoItem {
  id: string;
  url: string;
  section_key: string | null;
  grade: number | null;
  comments: PhotoComment[];
  annotations: PhotoAnnotation[];
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
  photos: PhotoItem[];
}

export interface StoreMemoryNote {
  slug: string;
  scope: "store" | "person" | "theme" | "channel";
  title: string;
  summary: string;
  version: number;
  last_touched_at: string;
}

export interface StoreOpenTask {
  id: string;
  title: string;
  status: "open" | "done";
  due_date: string | null;
  visit_id: string;
  visit_date: string | null;
  cm_name: string | null;
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

export async function getStoreDashboard(storeId: string): Promise<{ store: StoreInfo | null; visits: StoreVisitSummary[]; memory_notes: StoreMemoryNote[]; staff: StaffRow[]; open_tasks: StoreOpenTask[] }> {
  const [storeRes, visitsRes, notesRes, staff, tasksRes] = await Promise.all([
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
    supabase
      .from('visit_follow_ups')
      .select('id, title, status, due_date, visit_id, visits!visit_id(visit_date, cm_telegram_id, cms!cm_telegram_id(full_name, nickname))')
      .eq('store_id', storeId)
      .order('due_date', { ascending: true, nullsFirst: false }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = (storeRes.data as any) as StoreInfo | null ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitRows = (visitsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memory_notes = (notesRes.data ?? []) as StoreMemoryNote[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const open_tasks: StoreOpenTask[] = (tasksRes.data ?? []).map((t: any) => ({
    id: t.id,
    title: t.title,
    status: t.status === "done" ? "done" : "open",
    due_date: t.due_date ?? null,
    visit_id: t.visit_id,
    visit_date: t.visits?.visit_date ?? null,
    cm_name: t.visits?.cms?.nickname ?? t.visits?.cms?.full_name ?? null,
  }));

  if (visitRows.length === 0) return { store, visits: [], memory_notes, staff, open_tasks };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = visitRows.map((v: any) => v.id);
  const { data: photoRows } = await supabase
    .from('visit_photos')
    .select('id, visit_id, storage_path, section_key, review_grade')
    .in('visit_id', ids)
    .order('created_at');

  type PhotoMeta = { id: string; path: string; section_key: string | null; grade: number | null };
  const metaByVisit = new Map<string, PhotoMeta[]>();

  for (const p of photoRows ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = p as any;
    const vid = row.visit_id as string;
    const list = metaByVisit.get(vid) ?? [];
    list.push({ id: row.id as string, path: row.storage_path as string, section_key: row.section_key ?? null, grade: row.review_grade ?? null });
    metaByVisit.set(vid, list);
  }

  // Sign all paths once. 1h TTL so a long review/grading session doesn't 403 mid-way.
  const allMeta = [...metaByVisit.values()].flat();
  const allPaths = allMeta.map((m) => m.path);
  const signedUrls = await signPhotoUrls(allPaths, 3600);
  const signedMap = new Map<string, string>();
  allPaths.forEach((p, i) => { if (signedUrls[i]) signedMap.set(p, signedUrls[i]); });

  // Review data (comments + box annotations) for every photo in one round-trip each.
  const photoIds = allMeta.map((m) => m.id);
  const commentsByPhoto = new Map<string, PhotoComment[]>();
  const annotationsByPhoto = new Map<string, PhotoAnnotation[]>();
  if (photoIds.length > 0) {
    const [cRes, aRes] = await Promise.all([
      supabase.from('photo_comments')
        .select('id, photo_id, body, author_name, created_at')
        .in('photo_id', photoIds).order('created_at'),
      supabase.from('photo_annotations')
        .select('id, photo_id, x, y, w, h, note, author_name, created_at')
        .in('photo_id', photoIds).order('created_at'),
    ]);
    for (const r of (cRes.data ?? []) as Array<PhotoComment & { photo_id: string }>) {
      const list = commentsByPhoto.get(r.photo_id) ?? [];
      list.push({ id: r.id, body: r.body, author_name: r.author_name, created_at: r.created_at });
      commentsByPhoto.set(r.photo_id, list);
    }
    for (const r of (aRes.data ?? []) as Array<PhotoAnnotation & { photo_id: string }>) {
      const list = annotationsByPhoto.get(r.photo_id) ?? [];
      list.push({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, note: r.note, author_name: r.author_name, created_at: r.created_at });
      annotationsByPhoto.set(r.photo_id, list);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visits: StoreVisitSummary[] = visitRows.map((v: any) => {
    const meta = metaByVisit.get(v.id) ?? [];
    const photos: PhotoItem[] = meta
      .map((m) => ({
        id: m.id,
        url: signedMap.get(m.path) ?? '',
        section_key: m.section_key,
        grade: m.grade,
        comments: commentsByPhoto.get(m.id) ?? [],
        annotations: annotationsByPhoto.get(m.id) ?? [],
      }))
      .filter((p) => p.url);
    return {
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
      photo_count: meta.length,
      thumb_urls: photos.slice(0, 3).map((p) => p.url),
      photo_urls: photos.map((p) => p.url),
      photos,
    };
  });

  return { store, visits, memory_notes, staff, open_tasks };
}

// ── CM Detail (for visits page right panel) ──────────────────────────────────

export interface CMDetailInfo {
  telegram_id: number;
  full_name: string;
  market: string;
  am_name: string | null;
  assigned_stores: Array<{ id: string; name: string; chain: string; tier: 'T1'|'T2'|'T3'|'T4'|null; market: string }>;
}

export async function getCMDetail(telegramId: number): Promise<{ cm: CMDetailInfo | null; visits: VisitRow[]; memory_notes: StoreMemoryNote[] }> {
  const { data: cmData } = await supabase
    .from('cms')
    .select('telegram_id, full_name, market, am_telegram_id')
    .eq('telegram_id', telegramId)
    .single();

  if (!cmData) return { cm: null, visits: [], memory_notes: [] };

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

  const [{ visits }, notesRes] = await Promise.all([
    getVisitsFeed({ cm: telegramId, limit: 15 }),
    supabase
      .from('v_memory_notes_current')
      .select('slug, scope, title, summary, version, last_touched_at')
      .eq('scope', 'person')
      .eq('scope_ref', String(telegramId))
      .order('last_touched_at', { ascending: false }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const memory_notes = (notesRes.data ?? []) as StoreMemoryNote[];

  return {
    cm: {
      telegram_id: (cmData as any).telegram_id,
      full_name: (cmData as any).full_name,
      market: (cmData as any).market,
      am_name: amName,
      assigned_stores: stores,
    },
    visits,
    memory_notes,
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

// ─── Statistics: store coverage heatmap ──────────────────────────────────────

export interface CoverageStore {
  id: string;
  name: string;
  chain: string;
  market: 'SG' | 'MY' | 'TH' | 'HK';
  tier: 'T1' | 'T2' | 'T3' | 'T4' | null;
  weeks: boolean[];            // visited in each of the last 6 weeks, oldest → newest
  last_visit_date: string | null;
}

export interface CoverageGrid {
  weeks: string[];             // ISO Monday starts, oldest → newest (length 6)
  stores: CoverageStore[];
  total: number;
  ever_visited: number;
  asof: string;                // ISO today
}

// Last 6 weeks of coverage for every active store. Filled-week flags come from
// locked visits inside the window; last_visit_date is the all-time most recent
// locked visit (so a store visited long ago shows empty cells but isn't "never").
export async function getCoverageGrid(): Promise<CoverageGrid> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = isoDate(today);
  const thisMon = mondayOf(today);
  const windowStart = new Date(thisMon);
  windowStart.setDate(thisMon.getDate() - 35); // 6 Mondays incl. the current week
  const weeks = buildWeeks(isoDate(windowStart), todayISO);

  const { data: storesRaw } = await supabase
    .from('stores')
    .select('id, name, chain, market, tier')
    .eq('is_active', true)
    .order('chain')
    .order('name');
  const stores = (storesRaw ?? []) as {
    id: string; name: string; chain: string | null;
    market: 'SG' | 'MY' | 'TH' | 'HK'; tier: 'T1' | 'T2' | 'T3' | 'T4' | null;
  }[];

  const { data: visitsRaw } = await supabase
    .from('visits')
    .select('store_id, visit_date')
    .eq('is_locked', true)
    .order('visit_date', { ascending: false });
  const visits = (visitsRaw ?? []) as { store_id: string; visit_date: string }[];

  const weekIdx = new Map(weeks.map((w, i) => [w.start, i]));
  const lastByStore = new Map<string, string>();
  const flagsByStore = new Map<string, boolean[]>();
  for (const v of visits) {
    if (!lastByStore.has(v.store_id)) lastByStore.set(v.store_id, v.visit_date);
    const mon = isoDate(mondayOf(new Date(v.visit_date + 'T00:00:00')));
    const idx = weekIdx.get(mon);
    if (idx !== undefined) {
      const arr = flagsByStore.get(v.store_id) ?? new Array(weeks.length).fill(false);
      arr[idx] = true;
      flagsByStore.set(v.store_id, arr);
    }
  }

  const covStores: CoverageStore[] = stores.map((s) => ({
    id: s.id,
    name: s.name,
    chain: s.chain ?? '—',
    market: s.market,
    tier: s.tier,
    weeks: flagsByStore.get(s.id) ?? new Array(weeks.length).fill(false),
    last_visit_date: lastByStore.get(s.id) ?? null,
  }));

  return {
    weeks: weeks.map((w) => w.start),
    stores: covStores,
    total: covStores.length,
    ever_visited: covStores.filter((s) => s.last_visit_date !== null).length,
    asof: todayISO,
  };
}

// ─── Statistics: planned-vs-executed per CM ───────────────────────────────────

export interface ExecutionRow {
  telegram_id: number;
  full_name: string;
  market: 'SG' | 'MY' | 'TH' | 'HK';
  planned: number;            // plans with planned_date in window
  fulfilled: number;          // of those, how many have been consumed
  executed: number;           // locked visits logged in window
}

export interface ExecutionGrid {
  rows: ExecutionRow[];
  total_planned: number;
  total_executed: number;
  range: { from: string; to: string };
}

// Planned-vs-executed for the week. visit_plans is empty during the pilot, so
// total_planned is 0 and the view renders its empty state; the table lights up
// automatically once CMs start logging Friday plans.
export async function getExecutionGrid(fromISO: string, toISO: string): Promise<ExecutionGrid> {
  const { data: cmsRaw } = await supabase
    .from('cms')
    .select('telegram_id, full_name, role, market, is_active')
    .eq('is_active', true);
  const payrollCms = ((cmsRaw ?? []) as {
    telegram_id: number; full_name: string; role: string;
    market: 'SG' | 'MY' | 'TH' | 'HK'; is_active: boolean;
  }[]).filter((c) => c.role === 'cm' || c.role === 'cmic');

  const { data: plansRaw } = await supabase
    .from('visit_plans')
    .select('cm_telegram_id, consumed_at')
    .gte('planned_date', fromISO)
    .lte('planned_date', toISO);
  const plans = (plansRaw ?? []) as { cm_telegram_id: number; consumed_at: string | null }[];

  const { data: visRaw } = await supabase
    .from('visits')
    .select('cm_telegram_id')
    .eq('is_locked', true)
    .gte('visit_date', fromISO)
    .lte('visit_date', toISO);
  const vis = (visRaw ?? []) as { cm_telegram_id: number }[];

  const plannedBy = new Map<number, number>();
  const fulfilledBy = new Map<number, number>();
  for (const p of plans) {
    plannedBy.set(p.cm_telegram_id, (plannedBy.get(p.cm_telegram_id) ?? 0) + 1);
    if (p.consumed_at) fulfilledBy.set(p.cm_telegram_id, (fulfilledBy.get(p.cm_telegram_id) ?? 0) + 1);
  }
  const execBy = new Map<number, number>();
  for (const v of vis) execBy.set(v.cm_telegram_id, (execBy.get(v.cm_telegram_id) ?? 0) + 1);

  const rows: ExecutionRow[] = payrollCms
    .map((c) => ({
      telegram_id: c.telegram_id,
      full_name: c.full_name,
      market: c.market,
      planned: plannedBy.get(c.telegram_id) ?? 0,
      fulfilled: fulfilledBy.get(c.telegram_id) ?? 0,
      executed: execBy.get(c.telegram_id) ?? 0,
    }))
    .sort((a, b) => a.market.localeCompare(b.market) || a.full_name.localeCompare(b.full_name));

  return {
    rows,
    total_planned: plans.length,
    total_executed: vis.length,
    range: { from: fromISO, to: toISO },
  };
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
  is_recap_recipient: boolean;
}

export interface PendingPersonRow {
  telegram_id: number;
  full_name: string;
  pending_request_at: string;
}

export async function getActivePeople(): Promise<ActivePersonRow[]> {
  const { data, error } = await supabase
    .from('cms')
    .select('telegram_id, full_name, nickname, role, market, am_telegram_id, is_active, is_intelligence_recipient, is_join_request_admin, is_recap_recipient')
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
  is_recap_recipient?: boolean;
}

export async function updatePerson(
  telegramId: number,
  patch: UpdatePersonPatch,
): Promise<boolean> {
  const { error } = await supabase.from('cms').update(patch).eq('telegram_id', telegramId);
  if (error) console.error('updatePerson error:', error);
  return !error;
}

// ─── Daily-recap master switch (sva.settings key/value) ───────────────────────

const RECAP_ENABLED_KEY = 'daily_recaps_enabled';

export async function getRecapsEnabled(): Promise<boolean> {
  const { data } = await supabase
    .from('settings')
    .select('value')
    .eq('key', RECAP_ENABLED_KEY)
    .maybeSingle();
  return data?.value === 'true';
}

export async function setRecapsEnabled(enabled: boolean, byTelegramId: number): Promise<boolean> {
  const { error } = await supabase.from('settings').upsert(
    {
      key: RECAP_ENABLED_KEY,
      value: enabled ? 'true' : 'false',
      updated_at: new Date().toISOString(),
      updated_by_telegram_id: byTelegramId,
    },
    { onConflict: 'key' },
  );
  if (error) console.error('setRecapsEnabled error:', error);
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

// ─── Products master (catalogue) ──────────────────────────────────────────────

export interface AdminProductRow {
  id: string;
  brand: string;
  name: string;
  is_active: boolean;
}

export async function getAllProducts(): Promise<AdminProductRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, brand, name, is_active')
    .order('brand')
    .order('name');
  if (error || !data) {
    console.error('getAllProducts error:', error);
    return [];
  }
  return data as AdminProductRow[];
}

export interface CreateProductInput {
  brand: string;
  name: string;
}

export async function createProduct(input: CreateProductInput): Promise<AdminProductRow | null> {
  const { data, error } = await supabase
    .from('products')
    .insert({ brand: input.brand, name: input.name, is_active: true })
    .select('id, brand, name, is_active')
    .single();
  if (error) {
    console.error('createProduct error:', error);
    return null;
  }
  return data as AdminProductRow;
}

export interface UpdateProductPatch {
  brand?: string;
  name?: string;
  is_active?: boolean;
}

export async function updateProduct(id: string, patch: UpdateProductPatch): Promise<boolean> {
  const { error } = await supabase.from('products').update(patch).eq('id', id);
  if (error) console.error('updateProduct error:', error);
  return !error;
}

// ─── Display Review: photo comments, box annotations, grade ───────────────────

interface Author { telegram_id: number; name: string }

export async function addPhotoComment(photoId: string, body: string, author: Author): Promise<PhotoComment | null> {
  const { data, error } = await supabase
    .from('photo_comments')
    .insert({ photo_id: photoId, body, author_telegram_id: author.telegram_id, author_name: author.name })
    .select('id, body, author_name, created_at')
    .single();
  if (error) { console.error('addPhotoComment error:', error); return null; }
  return data as PhotoComment;
}

export async function deletePhotoComment(commentId: string): Promise<boolean> {
  const { error } = await supabase.from('photo_comments').delete().eq('id', commentId);
  if (error) console.error('deletePhotoComment error:', error);
  return !error;
}

export interface AnnotationInput { x: number; y: number; w: number; h: number; note: string }

export async function addPhotoAnnotation(photoId: string, a: AnnotationInput, author: Author): Promise<PhotoAnnotation | null> {
  const { data, error } = await supabase
    .from('photo_annotations')
    .insert({ photo_id: photoId, x: a.x, y: a.y, w: a.w, h: a.h, note: a.note, author_telegram_id: author.telegram_id, author_name: author.name })
    .select('id, x, y, w, h, note, author_name, created_at')
    .single();
  if (error) { console.error('addPhotoAnnotation error:', error); return null; }
  return data as PhotoAnnotation;
}

export interface AnnotationPatch { note?: string; x?: number; y?: number; w?: number; h?: number }

export async function updatePhotoAnnotation(annotationId: string, patch: AnnotationPatch): Promise<boolean> {
  const { error } = await supabase.from('photo_annotations').update(patch).eq('id', annotationId);
  if (error) console.error('updatePhotoAnnotation error:', error);
  return !error;
}

export async function deletePhotoAnnotation(annotationId: string): Promise<boolean> {
  const { error } = await supabase.from('photo_annotations').delete().eq('id', annotationId);
  if (error) console.error('deletePhotoAnnotation error:', error);
  return !error;
}

export async function setPhotoGrade(photoId: string, grade: number | null): Promise<boolean> {
  const { error } = await supabase.from('visit_photos').update({ review_grade: grade }).eq('id', photoId);
  if (error) console.error('setPhotoGrade error:', error);
  return !error;
}

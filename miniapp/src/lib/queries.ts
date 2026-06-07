import { supabase } from "./supabase";

export interface Store {
  id: string;
  name: string;
  chain: string;
  market: "SG" | "TH" | "MY" | "HK";
  tier: "T1" | "T2" | "T3" | "T4" | null;
  address: string | null;
}

export interface PortfolioStore extends Store {
  last_visit_date: string | null;
  last_visit_id: string | null;
  visits_30d: number;
}

export interface VisitSummary {
  id: string;
  visit_date: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  cm_name?: string | null;   // populated when allCMs=true
  photo_count: number;
  thumb_urls: string[];      // first 3, for list view
  photo_urls?: string[];     // all photos, for gallery view
  grade: 1 | 2 | 3 | null;
  grade_comments: string | null;
}

export interface AllMarketStore extends Store {
  last_visit_date: string | null;
  last_visit_cm: string | null;
  is_assigned?: boolean;
  last_visit_by_you?: string | null;
  last_visit_by_team?: { date: string; cm_name: string } | null;
}

export interface SearchResult {
  id: string;
  visit_date: string;
  store_id: string;
  store_name: string;
  store_chain: string;
  store_tier: Store["tier"];
  cm_name: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
}

export interface VisitTrainedStaff {
  staff_id: string;
  name: string;
  products: string | null;
  response: string | null;
}

// New engagement model (mig 021). A person engaged on a visit — known store
// staff or a free-typed name — plus a free-text update and zero or more
// per-product trainings each with their own response.
export interface VisitEngagementTraining {
  product_id: string | null;
  product_name: string;
  response: string | null;
}

export interface VisitEngagedPerson {
  id: string;
  staff_id: string | null;
  name: string;
  update_text: string | null;
  trainings: VisitEngagementTraining[];
}

export interface VisitFollowUpRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: 'open' | 'done' | 'cancelled';
  closed_at: string | null;
  created_at: string;
  assigned_to_telegram_id: number | null;
  assigned_to_name: string | null;
}

// Review feedback left by an AM/admin in the dashboard lightbox. Read-only on
// the CM side — the miniapp surfaces it so the CM actually sees the comments and
// boxed fixes (sva.photo_comments + sva.photo_annotations, migration 018).
export interface PhotoComment {
  id: string;
  body: string;
  author_name: string | null;
  created_at: string;
}

export interface PhotoAnnotation {
  id: string;
  x: number; // % of image width (0–100), top-left corner
  y: number; // % of image height
  w: number; // % of image width
  h: number; // % of image height
  note: string;
  author_name: string | null;
  created_at: string;
}

export interface VisitPhotoRow {
  id: string;
  storage_path: string;
  section_key:
    | 'good_news'
    | 'people_training'
    | 'competitor'
    | 'display_stock'
    | 'follow_up'
    | null;
  comments: PhotoComment[];
  annotations: PhotoAnnotation[];
}

export type PhotoSectionKey = NonNullable<VisitPhotoRow['section_key']>;

export interface FullVisit extends VisitSummary {
  store_id: string;
  store_name: string;
  cm_telegram_id: number;
  is_locked: boolean;
  submitted_at: string | null;
  edited_at: string | null;
  people_training: string | null;
  // Photos with section_key so the visit page can render grouped + ungrouped.
  // photo_paths kept for back-compat with /api/m/visit/[id] PATCH editor.
  photos: VisitPhotoRow[];
  photo_paths: string[];
  follow_ups: VisitFollowUpRow[];
  grade: 1 | 2 | 3 | null;
  grade_comments: string | null;
  cms: { telegram_id: number; name: string; role: 'lead' | 'co' }[];
  trained_staff: VisitTrainedStaff[];
  engaged_people: VisitEngagedPerson[];
  viewer_is_lead: boolean;
  // When the CM marked the AM review feedback as seen (migration 023). null = unseen.
  review_ack_at: string | null;
}

export async function getPortfolioForCM(
  telegramId: number,
): Promise<PortfolioStore[]> {
  const { data: assignRows, error: assignErr } = await supabase
    .from("cm_store_assignments")
    .select("store_id, stores(*)")
    .eq("cm_telegram_id", telegramId)
    .eq("is_active", true);

  if (assignErr || !assignRows) return [];

  const stores: Store[] = assignRows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((row: any) => row.stores as Store)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((s: any) => s && s.is_active !== false);

  if (stores.length === 0) return [];

  const storeIds = stores.map((s) => s.id);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data: visitRows } = await supabase
    .from("visits")
    .select("id, store_id, visit_date, created_at, visit_cms!inner(cm_telegram_id)")
    .eq("visit_cms.cm_telegram_id", telegramId)
    .eq("is_locked", true)
    .in("store_id", storeIds)
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  const lastVisitByStore = new Map<string, { id: string; date: string }>();
  const count30dByStore = new Map<string, number>();

  for (const v of visitRows ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = v as any;
    if (!lastVisitByStore.has(row.store_id)) {
      lastVisitByStore.set(row.store_id, { id: row.id, date: row.visit_date });
    }
    if (row.visit_date >= since) {
      count30dByStore.set(
        row.store_id,
        (count30dByStore.get(row.store_id) ?? 0) + 1,
      );
    }
  }

  return stores
    .map((s) => ({
      ...s,
      last_visit_date: lastVisitByStore.get(s.id)?.date ?? null,
      last_visit_id: lastVisitByStore.get(s.id)?.id ?? null,
      visits_30d: count30dByStore.get(s.id) ?? 0,
    }))
    .sort((a, b) => {
      // sort: visited stores first by recency, then unvisited alphabetically
      if (a.last_visit_date && b.last_visit_date) {
        return b.last_visit_date.localeCompare(a.last_visit_date);
      }
      if (a.last_visit_date) return -1;
      if (b.last_visit_date) return 1;
      return a.name.localeCompare(b.name);
    });
}

export interface StoreStats {
  visits: number;       // visits in the current view (your visits, or all CMs)
  engagements: number;  // people engaged across those visits
  trained: number;      // of those, how many were trained
  products: number;     // product-training rows across those visits
}

// A canonical store-staff member with their engagement rollup over the visits
// currently in view. Free-typed (not-yet-promoted) people are excluded — only
// linked staff (have a staff_id) appear, so each row can deep-link to detail.
export interface StoreStaffRosterEntry {
  id: string;
  name: string;
  role: string | null;
  is_ally: boolean;
  engagements: number;
  trained: number;
  products: number;
}

export async function getStoreTimelineForCM(
  telegramId: number,
  storeId: string,
  options?: { allCMs?: boolean },
): Promise<{ store: Store | null; visits: VisitSummary[]; stats: StoreStats; staff: StoreStaffRosterEntry[] }> {
  const emptyStats: StoreStats = { visits: 0, engagements: 0, trained: 0, products: 0 };
  const [storeRes, visitsRes] = await Promise.all([
    supabase.from("stores").select("*").eq("id", storeId).single(),
    options?.allCMs
      ? supabase
          .from("visits")
          .select("id, visit_date, good_news, competitors, display_stock, follow_up, buzz_plan, grade, grade_comments, cm_telegram_id, cms!cm_telegram_id(full_name, nickname)")
          .eq("store_id", storeId)
          .eq("is_locked", true)
          .order("visit_date", { ascending: false })
          .order("created_at", { ascending: false })
      : supabase
          .from("visits")
          .select("id, visit_date, good_news, competitors, display_stock, follow_up, buzz_plan, grade, grade_comments, visit_cms!inner(cm_telegram_id)")
          .eq("visit_cms.cm_telegram_id", telegramId)
          .eq("store_id", storeId)
          .eq("is_locked", true)
          .order("visit_date", { ascending: false })
          .order("created_at", { ascending: false }),
  ]);

  const store = (storeRes.data as Store | null) ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitRows = (visitsRes.data ?? []) as any[];

  if (visitRows.length === 0) return { store, visits: [], stats: emptyStats, staff: [] };

  const ids = visitRows.map((v: any) => v.id); // eslint-disable-line @typescript-eslint/no-explicit-any

  // Engagement / training / product rollup for the visits in view.
  const stats: StoreStats = { visits: visitRows.length, engagements: 0, trained: 0, products: 0 };
  const { data: staffRows } = await supabase
    .from("visit_staff")
    .select("id, staff_id, was_trained")
    .in("visit_id", ids);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffArr = (staffRows ?? []) as any[];
  stats.engagements = staffArr.length;
  stats.trained = staffArr.filter((r) => r.was_trained).length;

  // Per-staff roster aggregation, keyed by canonical staff_id. visit_staff.id →
  // staff_id lets us attribute product-training rows back to each person.
  const vsToStaff = new Map<string, string>();   // visit_staff.id → staff_id
  const rosterAgg = new Map<string, { engagements: number; trained: number; products: number }>();
  for (const r of staffArr) {
    if (!r.staff_id) continue;
    vsToStaff.set(r.id as string, r.staff_id as string);
    const agg = rosterAgg.get(r.staff_id) ?? { engagements: 0, trained: 0, products: 0 };
    agg.engagements += 1;
    if (r.was_trained) agg.trained += 1;
    rosterAgg.set(r.staff_id, agg);
  }

  if (staffArr.length > 0) {
    const { data: trainingRows } = await supabase
      .from("engagement_trainings")
      .select("visit_staff_id")
      .in("visit_staff_id", staffArr.map((r) => r.id as string));
    const trArr = (trainingRows ?? []) as { visit_staff_id: string }[];
    stats.products = trArr.length;
    for (const t of trArr) {
      const sid = vsToStaff.get(t.visit_staff_id);
      if (sid) rosterAgg.get(sid)!.products += 1;
    }
  }

  // Hydrate roster with canonical staff names/roles, sorted by engagement count.
  let staffRoster: StoreStaffRosterEntry[] = [];
  if (rosterAgg.size > 0) {
    const { data: staffDetails } = await supabase
      .from("staff")
      .select("id, name, role, is_ally")
      .in("id", [...rosterAgg.keys()]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    staffRoster = ((staffDetails ?? []) as any[])
      .map((s) => {
        const agg = rosterAgg.get(s.id as string)!;
        return {
          id: s.id as string,
          name: s.name as string,
          role: (s.role as string | null) ?? null,
          is_ally: Boolean(s.is_ally),
          engagements: agg.engagements,
          trained: agg.trained,
          products: agg.products,
        };
      })
      .sort((a, b) => b.engagements - a.engagements || a.name.localeCompare(b.name));
  }

  const { data: photoRows } = await supabase
    .from("visit_photos")
    .select("visit_id, storage_path")
    .in("visit_id", ids)
    .order("created_at");

  const countByVisit = new Map<string, number>();
  const allPathsByVisit = new Map<string, string[]>();
  const thumbPathsByVisit = new Map<string, string[]>();

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

  // Sign all photo paths in one batch
  const allPaths = [...allPathsByVisit.values()].flat();
  const signedUrls = await signPhotoUrls(allPaths);
  const signedMap = new Map<string, string>();
  allPaths.forEach((p, i) => { if (signedUrls[i]) signedMap.set(p, signedUrls[i]); });

  const visits: VisitSummary[] = visitRows.map((v: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: v.id,
    visit_date: v.visit_date,
    good_news: v.good_news ?? null,
    competitors: v.competitors ?? null,
    display_stock: v.display_stock ?? null,
    follow_up: v.follow_up ?? null,
    buzz_plan: v.buzz_plan ?? null,
    cm_name: options?.allCMs ? (v.cms?.nickname ?? v.cms?.full_name ?? null) : undefined,
    photo_count: countByVisit.get(v.id) ?? 0,
    thumb_urls: (thumbPathsByVisit.get(v.id) ?? []).map((p) => signedMap.get(p) ?? "").filter(Boolean),
    photo_urls: (allPathsByVisit.get(v.id) ?? []).map((p) => signedMap.get(p) ?? "").filter(Boolean),
    grade: v.grade ?? null,
    grade_comments: v.grade_comments ?? null,
  }));

  return { store, visits, stats, staff: staffRoster };
}

export async function getAllStoresInMarket(
  market: string | null,
  currentCmTelegramId?: number,
): Promise<AllMarketStore[]> {
  let storeQ = supabase
    .from("stores")
    .select("*")
    .eq("is_active", true)
    .order("name");
  if (market !== null) storeQ = storeQ.eq("market", market);
  const { data: storeRows } = await storeQ;

  if (!storeRows || storeRows.length === 0) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeIds = storeRows.map((s: any) => s.id) as string[];

  const visitsP = supabase
    .from("visits")
    .select("id, store_id, visit_date, created_at, cm_telegram_id, cms!cm_telegram_id(full_name, nickname)")
    .in("store_id", storeIds)
    .eq("is_locked", true)
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  const myVisitsP = currentCmTelegramId !== undefined
    ? supabase
        .from("visits")
        .select("id, store_id, visit_date, visit_cms!inner(cm_telegram_id)")
        .eq("visit_cms.cm_telegram_id", currentCmTelegramId)
        .in("store_id", storeIds)
        .eq("is_locked", true)
        .order("visit_date", { ascending: false })
        .order("created_at", { ascending: false })
    : Promise.resolve({ data: [] as unknown[] });

  const assignmentsP = currentCmTelegramId !== undefined
    ? supabase
        .from("cm_store_assignments")
        .select("store_id")
        .eq("cm_telegram_id", currentCmTelegramId)
        .eq("is_active", true)
    : Promise.resolve({ data: [] as unknown[] });

  const [visitsRes, myVisitsRes, assignRes] = await Promise.all([visitsP, myVisitsP, assignmentsP]);

  // Visit IDs the current CM participated in (lead OR co-CM) — so we can
  // exclude them from "last team visit" even when someone else was lead.
  const myVisitIds = new Set<string>();
  const myLastByStore = new Map<string, string>();
  for (const v of myVisitsRes.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = v as any;
    if (row.id) myVisitIds.add(row.id as string);
    if (!myLastByStore.has(row.store_id)) myLastByStore.set(row.store_id, row.visit_date);
  }

  // Overall last visit (any CM)
  const lastVisitByStore = new Map<string, { date: string; cm_name: string }>();
  // Last visit where I had no involvement at all (neither lead nor co-CM)
  const lastTeamByStore = new Map<string, { date: string; cm_name: string }>();
  for (const v of visitsRes.data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = v as any;
    const cmName = row.cms?.nickname ?? row.cms?.full_name ?? "Unknown";
    if (!lastVisitByStore.has(row.store_id)) {
      lastVisitByStore.set(row.store_id, { date: row.visit_date, cm_name: cmName });
    }
    if (currentCmTelegramId !== undefined && !myVisitIds.has(row.id) && !lastTeamByStore.has(row.store_id)) {
      lastTeamByStore.set(row.store_id, { date: row.visit_date, cm_name: cmName });
    }
  }

  const assignedSet = new Set(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((assignRes.data ?? []) as any[]).map((a) => a.store_id as string),
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return storeRows.map((s: any) => ({
    ...(s as Store),
    last_visit_date: lastVisitByStore.get(s.id)?.date ?? null,
    last_visit_cm: lastVisitByStore.get(s.id)?.cm_name ?? null,
    is_assigned: assignedSet.has(s.id),
    last_visit_by_you: myLastByStore.get(s.id) ?? null,
    last_visit_by_team: lastTeamByStore.get(s.id) ?? null,
  })).sort((a, b) => {
    if (a.last_visit_date && b.last_visit_date) return b.last_visit_date.localeCompare(a.last_visit_date);
    if (a.last_visit_date) return -1;
    if (b.last_visit_date) return 1;
    return a.name.localeCompare(b.name);
  });
}

export type VisitSectionKey =
  | "good_news"
  | "competitors"
  | "display_stock"
  | "follow_up"
  | "buzz_plan";

export interface VisitFilterOptions {
  q?: string;                          // text search (>=2 chars to apply)
  sections?: VisitSectionKey[];        // require non-null on each (AND)
  fromDate?: string;                   // YYYY-MM-DD inclusive
  toDate?: string;                     // YYYY-MM-DD inclusive
  storeId?: string;                    // uuid
  cmTelegramId?: number;               // bigint
  limit?: number;
}

const ALL_SECTIONS: VisitSectionKey[] = [
  "good_news", "competitors", "display_stock", "follow_up", "buzz_plan",
];

export async function searchVisitsInMarket(
  market: string,
  options: VisitFilterOptions = {},
): Promise<SearchResult[]> {
  const { data: storeRows } = await supabase
    .from("stores")
    .select("id, name, chain, tier")
    .eq("market", market)
    .eq("is_active", true);

  if (!storeRows || storeRows.length === 0) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeMap = new Map(storeRows.map((s: any) => [s.id, s]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allStoreIds = storeRows.map((s: any) => s.id) as string[];

  // Narrow store set if explicit store filter is given AND it belongs to this market
  const storeIds = options.storeId && allStoreIds.includes(options.storeId)
    ? [options.storeId]
    : allStoreIds;

  const validSections = (options.sections ?? []).filter((s) => ALL_SECTIONS.includes(s));
  const query = (options.q ?? "").trim();
  const useTextSearch = query.length >= 2;

  const baseSelect = "id, visit_date, store_id, good_news, competitors, display_stock, follow_up, buzz_plan, cms!cm_telegram_id(full_name, nickname)";
  const filterByCM = options.cmTelegramId !== undefined;

  let q = supabase
    .from("visits")
    .select(filterByCM ? `${baseSelect}, visit_cms!inner(cm_telegram_id)` : baseSelect)
    .in("store_id", storeIds)
    .eq("is_locked", true);

  if (filterByCM) q = q.eq("visit_cms.cm_telegram_id", options.cmTelegramId!);
  if (options.fromDate) q = q.gte("visit_date", options.fromDate);
  if (options.toDate) q = q.lte("visit_date", options.toDate);
  for (const s of validSections) q = q.not(s, "is", null);

  if (useTextSearch) {
    // If section filters narrow text search to those columns; else search across all
    const cols = validSections.length > 0 ? validSections : ALL_SECTIONS;
    q = q.or(cols.map((c) => `${c}.ilike.%${query}%`).join(","));
  }

  q = q
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 50);

  const { data: visitRows } = await q;

  return (visitRows ?? []).map((v: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const store = storeMap.get(v.store_id) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    return {
      id: v.id,
      visit_date: v.visit_date,
      store_id: v.store_id,
      store_name: store?.name ?? "Unknown",
      store_chain: store?.chain ?? "",
      store_tier: store?.tier ?? null,
      cm_name: v.cms?.nickname ?? v.cms?.full_name ?? "Unknown",
      good_news: v.good_news ?? null,
      competitors: v.competitors ?? null,
      display_stock: v.display_stock ?? null,
      follow_up: v.follow_up ?? null,
      buzz_plan: v.buzz_plan ?? null,
      };
  });
}

export interface FilterOptionsPayload {
  stores: { id: string; name: string; chain: string }[];
  cms: { telegram_id: number; name: string }[];
  canFilterCM: boolean;
}

export async function getFilterOptionsForMarket(
  market: string,
  viewerRole: "cm" | "cmic" | "am" | "admin",
  viewerTelegramId: number,
): Promise<FilterOptionsPayload> {
  const canFilterCM = viewerRole !== "cm";

  const storesPromise = supabase
    .from("stores")
    .select("id, name, chain")
    .eq("market", market)
    .eq("is_active", true)
    .order("name");

  const cmsPromise = canFilterCM
    ? supabase
        .from("cms")
        .select("telegram_id, full_name, nickname")
        .eq("market", market)
        .eq("is_active", true)
        .order("full_name")
    : Promise.resolve({ data: [], error: null });

  const [storesRes, cmsRes] = await Promise.all([storesPromise, cmsPromise]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stores = ((storesRes.data ?? []) as any[]).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    chain: s.chain as string,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cms = ((cmsRes.data ?? []) as any[])
    .filter((c) => c.telegram_id !== viewerTelegramId || canFilterCM)
    .map((c) => ({
      telegram_id: c.telegram_id as number,
      name: (c.nickname as string | null) ?? (c.full_name as string),
    }));

  return { stores, cms, canFilterCM };
}

export interface CMOption {
  telegram_id: number;
  name: string;
}

export async function listCMsInMarket(market: string): Promise<CMOption[]> {
  const { data, error } = await supabase
    .from("cms")
    .select("telegram_id, full_name, nickname")
    .eq("market", market)
    .eq("is_active", true)
    .order("full_name");
  if (error || !data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((c) => ({
    telegram_id: c.telegram_id as number,
    name: (c.nickname as string | null) ?? (c.full_name as string),
  }));
}

export async function updateCMNickname(telegramId: number, nickname: string): Promise<boolean> {
  const { error } = await supabase
    .from("cms")
    .update({ nickname })
    .eq("telegram_id", telegramId);
  return !error;
}

export async function getFullVisitForCM(
  telegramId: number,
  visitId: string,
  viewerRole: "cm" | "cmic" | "am" | "admin" = "cm",
): Promise<FullVisit | null> {
  const { data, error } = await supabase
    .from("visits")
    .select("*, stores(name)")
    .eq("id", visitId)
    .single();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (error || !data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = data as any;

  const { data: vcRows } = await supabase
    .from("visit_cms")
    .select("cm_telegram_id, role, cms(full_name, nickname)")
    .eq("visit_id", visitId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cms = ((vcRows ?? []) as any[])
    .map((r) => ({
      telegram_id: r.cm_telegram_id as number,
      role: r.role as 'lead' | 'co',
      name: (r.cms?.nickname as string | null) ?? (r.cms?.full_name as string | null) ?? "Unknown",
    }))
    .sort((a, b) => (a.role === 'lead' ? -1 : b.role === 'lead' ? 1 : 0));

  const isInVisit = cms.some((c) => c.telegram_id === telegramId);
  const isElevated = viewerRole !== "cm";
  if (!isInVisit && !isElevated) return null;

  const { data: photos } = await supabase
    .from("visit_photos")
    .select("id, storage_path, section_key")
    .eq("visit_id", visitId)
    .order("created_at");

  // Pull AM review feedback (comments + boxed fixes) for these photos so the CM
  // viewer can render it read-only. One batched query each, keyed by photo_id.
  const photoIds = ((photos ?? []) as { id: string }[]).map((p) => p.id);
  const commentsByPhoto = new Map<string, PhotoComment[]>();
  const annotationsByPhoto = new Map<string, PhotoAnnotation[]>();
  if (photoIds.length > 0) {
    const [{ data: cRows }, { data: aRows }] = await Promise.all([
      supabase
        .from("photo_comments")
        .select("id, photo_id, body, author_name, created_at")
        .in("photo_id", photoIds)
        .order("created_at", { ascending: true }),
      supabase
        .from("photo_annotations")
        .select("id, photo_id, x, y, w, h, note, author_name, created_at")
        .in("photo_id", photoIds)
        .order("created_at", { ascending: true }),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (cRows ?? []) as any[]) {
      const arr = commentsByPhoto.get(r.photo_id) ?? [];
      arr.push({ id: r.id, body: r.body, author_name: r.author_name ?? null, created_at: r.created_at });
      commentsByPhoto.set(r.photo_id, arr);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (aRows ?? []) as any[]) {
      const arr = annotationsByPhoto.get(r.photo_id) ?? [];
      arr.push({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, note: r.note, author_name: r.author_name ?? null, created_at: r.created_at });
      annotationsByPhoto.set(r.photo_id, arr);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photoRows: VisitPhotoRow[] = ((photos ?? []) as any[])
    .map((p) => ({
      id: p.id as string,
      storage_path: p.storage_path as string,
      section_key: (p.section_key as VisitPhotoRow["section_key"]) ?? null,
      comments: commentsByPhoto.get(p.id as string) ?? [],
      annotations: annotationsByPhoto.get(p.id as string) ?? [],
    }))
    .filter((p) => Boolean(p.storage_path));

  const photoPaths = photoRows.map((p) => p.storage_path);

  const { data: followUpRows } = await supabase
    .from("visit_follow_ups")
    .select("id, title, notes, due_date, status, closed_at, created_at, assigned_to_telegram_id, cms:assigned_to_telegram_id(full_name, nickname)")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const followUps: VisitFollowUpRow[] = ((followUpRows ?? []) as any[]).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    notes: (r.notes as string | null) ?? null,
    due_date: (r.due_date as string | null) ?? null,
    status: r.status as 'open' | 'done' | 'cancelled',
    closed_at: (r.closed_at as string | null) ?? null,
    created_at: r.created_at as string,
    assigned_to_telegram_id: (r.assigned_to_telegram_id as number | null) ?? null,
    assigned_to_name: r.cms?.nickname ?? r.cms?.full_name ?? null,
  }));

  const viewerIsLead = cms.find((c) => c.role === 'lead')?.telegram_id === telegramId;

  // All people engaged on this visit (new model). No was_trained filter — a
  // person may just have been spoken to. Old back-compat columns are still read
  // so bot-written rows (which only set products_trained_on/training_response)
  // render correctly even before they carry engagement_trainings child rows.
  const { data: vsRows } = await supabase
    .from("visit_staff")
    .select("id, staff_id, person_name, update_text, products_trained_on, training_response, was_trained, staff(name)")
    .eq("visit_id", visitId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vsList = (vsRows ?? []) as any[];
  const vsIds = vsList.map((r) => r.id as string);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let etRows: any[] = [];
  if (vsIds.length > 0) {
    const { data } = await supabase
      .from("engagement_trainings")
      .select("visit_staff_id, product_id, product_name, response")
      .in("visit_staff_id", vsIds);
    etRows = data ?? [];
  }
  const trainingsByPerson = new Map<string, VisitEngagementTraining[]>();
  for (const t of etRows) {
    const arr = trainingsByPerson.get(t.visit_staff_id as string) ?? [];
    arr.push({
      product_id: (t.product_id as string | null) ?? null,
      product_name: t.product_name as string,
      response: (t.response as string | null) ?? null,
    });
    trainingsByPerson.set(t.visit_staff_id as string, arr);
  }

  const engagedPeople: VisitEngagedPerson[] = vsList
    .map((r) => {
      const name = (r.person_name as string | null) ?? (r.staff?.name as string | null) ?? "Unknown";
      // Child rows win; otherwise synthesize from the old CSV so legacy/bot rows
      // still show their products (no per-product response available there).
      let trainings = trainingsByPerson.get(r.id as string) ?? [];
      if (trainings.length === 0) {
        trainings = parseProductsCsvServer(r.products_trained_on as string | null).map((p) => ({
          product_id: null,
          product_name: p,
          response: null,
        }));
      }
      return {
        id: r.id as string,
        staff_id: (r.staff_id as string | null) ?? null,
        name,
        update_text: (r.update_text as string | null) ?? (r.training_response as string | null) ?? null,
        trainings,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Derived back-compat shape for any reader still on trained_staff.
  const trainedStaff: VisitTrainedStaff[] = vsList
    .filter((r) => r.was_trained)
    .map((r) => ({
      staff_id: (r.staff_id as string | null) ?? "",
      name: (r.person_name as string | null) ?? (r.staff?.name as string | null) ?? "Unknown",
      products: (r.products_trained_on as string | null) ?? null,
      response: (r.training_response as string | null) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: v.id,
    visit_date: v.visit_date,
    good_news: v.good_news,
    competitors: v.competitors,
    display_stock: v.display_stock,
    follow_up: v.follow_up,
    buzz_plan: v.buzz_plan,
    people_training: v.people_training ?? null,
    store_id: v.store_id,
    store_name: v.stores?.name ?? "Unknown store",
    cm_telegram_id: v.cm_telegram_id,
    is_locked: v.is_locked,
    submitted_at: v.submitted_at,
    edited_at: v.edited_at,
    photo_count: photoRows.length,
    thumb_urls: [],
    photos: photoRows,
    photo_paths: photoPaths,
    follow_ups: followUps,
    grade: v.grade ?? null,
    grade_comments: v.grade_comments ?? null,
    cms,
    trained_staff: trainedStaff,
    engaged_people: engagedPeople,
    viewer_is_lead: viewerIsLead,
    review_ack_at: (v.review_ack_at as string | null) ?? null,
  };
}

// Records that the CM has seen the AM review feedback on a visit. Returns the
// ack timestamp on success (ISO string), or null on failure. Auth is enforced
// by the caller (route) via getFullVisitForCM before this runs.
export async function acknowledgeVisitReview(
  visitId: string,
  telegramId: number,
): Promise<string | null> {
  const at = new Date().toISOString();
  const { error } = await supabase
    .from("visits")
    .update({ review_ack_at: at, review_ack_by: telegramId })
    .eq("id", visitId);
  return error ? null : at;
}

// Server-side CSV split (mirrors the editor's parseProductsCsv). Used to
// synthesize trainings for legacy/bot rows that only have the old CSV column.
function parseProductsCsvServer(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ─── Visit follow-ups (mini-app side) ──────────────────────────────────────

export async function createFollowUpsForVisit(
  visitId: string,
  cmTelegramId: number,
  items: Array<{
    title: string;
    notes?: string | null;
    due_date?: string | null;
    assigned_to_telegram_id?: number | null;
  }>,
): Promise<VisitFollowUpRow[]> {
  // Look up store_id from the visit so the API caller doesn't have to pass it.
  const { data: visit } = await supabase
    .from("visits")
    .select("store_id")
    .eq("id", visitId)
    .single();
  if (!visit) return [];

  const rows = items
    .filter((i) => i.title.trim())
    .map((i) => ({
      visit_id: visitId,
      store_id: (visit as { store_id: string }).store_id,
      cm_telegram_id: cmTelegramId,
      // Default assignee = creator. Pre-migration this column doesn't exist
      // yet; the DB will ignore unknown columns? No — it'll error. Wrap below.
      assigned_to_telegram_id: i.assigned_to_telegram_id ?? cmTelegramId,
      title: i.title.trim(),
      notes: i.notes && i.notes.trim() ? i.notes.trim() : null,
      due_date: i.due_date && i.due_date.trim() ? i.due_date : null,
    }));
  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from("visit_follow_ups")
    .insert(rows)
    .select("id, title, notes, due_date, status, closed_at, created_at, assigned_to_telegram_id, cms:assigned_to_telegram_id(full_name, nickname)");
  if (error || !data) {
    console.error("createFollowUpsForVisit error:", error);
    return [];
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes ?? null,
    due_date: r.due_date ?? null,
    status: r.status,
    closed_at: r.closed_at ?? null,
    created_at: r.created_at,
    assigned_to_telegram_id: r.assigned_to_telegram_id ?? null,
    assigned_to_name: r.cms?.nickname ?? r.cms?.full_name ?? null,
  }));
}

export async function listFollowUpsForVisitMA(
  visitId: string,
): Promise<VisitFollowUpRow[]> {
  const { data } = await supabase
    .from("visit_follow_ups")
    .select("id, title, notes, due_date, status, closed_at, created_at, assigned_to_telegram_id, cms:assigned_to_telegram_id(full_name, nickname)")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    title: r.title,
    notes: r.notes ?? null,
    due_date: r.due_date ?? null,
    status: r.status,
    closed_at: r.closed_at ?? null,
    created_at: r.created_at,
    assigned_to_telegram_id: r.assigned_to_telegram_id ?? null,
    assigned_to_name: r.cms?.nickname ?? r.cms?.full_name ?? null,
  }));
}

// CM-scoped list of all OPEN follow-ups across every visit, oldest first, with
// the 48h-KPI age computed server-side. Powers the Stats-tab follow-up list so a
// CM sees everything still outstanding (and what's breaching the <48h KPI) in one
// place, each tappable through to its visit.
export interface OpenFollowUp {
  id: string;
  visit_id: string;
  title: string;
  store_name: string;
  due_date: string | null;
  created_at: string;
  openedDaysAgo: number;
  kpiBreach: boolean;
  overdue: boolean;
}

export async function getOpenFollowUpsForCM(telegramId: number): Promise<OpenFollowUp[]> {
  const { data } = await supabase
    .from("visit_follow_ups")
    .select("id, visit_id, title, due_date, created_at, store_id")
    .eq("cm_telegram_id", telegramId)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const storeIds = Array.from(new Set(rows.map((r) => r.store_id).filter(Boolean)));
  const storeName = new Map<string, string>();
  if (storeIds.length > 0) {
    const { data: stores } = await supabase.from("stores").select("id, name").in("id", storeIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const s of (stores ?? []) as any[]) storeName.set(s.id, s.name);
  }

  const now = Date.now();
  const todayISO = new Date().toISOString().slice(0, 10);
  return rows.map((r) => {
    const ageHours = Math.max(0, (now - new Date(r.created_at).getTime()) / 3_600_000);
    return {
      id: r.id as string,
      visit_id: r.visit_id as string,
      title: r.title as string,
      store_name: storeName.get(r.store_id) ?? "—",
      due_date: (r.due_date as string | null) ?? null,
      created_at: r.created_at as string,
      openedDaysAgo: Math.floor(ageHours / 24),
      kpiBreach: ageHours > 48,
      overdue: !!r.due_date && (r.due_date as string) < todayISO,
    };
  });
}

export async function markFollowUpDoneMA(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("visit_follow_ups")
    .update({ status: "done", closed_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}

// Recent AM/admin review comments left on THIS CM's own visit photos, newest
// first. Powers the Visits-tab "Recent comments" feed so a CM sees feedback on
// their photos without opening each visit. "Recent" = a rolling window (no
// per-user read-state exists yet), bounded + capped.
export interface RecentPhotoComment {
  id: string;
  visit_id: string;
  visit_date: string;
  store_name: string;
  body: string;
  author_name: string | null;
  created_at: string;
  thumb_url: string | null;
}

export async function getRecentPhotoCommentsForCM(
  telegramId: number,
  sinceDays = 21,
  limit = 25,
): Promise<RecentPhotoComment[]> {
  const sinceISO = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("photo_comments")
    .select(
      "id, body, author_name, created_at, " +
        "visit_photos!inner(storage_path, visits!inner(id, visit_date, cm_telegram_id, stores(name)))",
    )
    .eq("visit_photos.visits.cm_telegram_id", telegramId)
    .gte("created_at", sinceISO)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("getRecentPhotoCommentsForCM error:", error);
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // Sign one thumbnail per comment in a single batch.
  const paths = rows.map((r) => r.visit_photos?.storage_path as string).filter(Boolean);
  const signed = await signPhotoUrls(paths);
  const signedByPath = new Map<string, string>();
  paths.forEach((p, i) => { if (signed[i]) signedByPath.set(p, signed[i]); });

  return rows.map((r) => {
    const photo = r.visit_photos;
    const visit = photo?.visits;
    const path = photo?.storage_path as string | undefined;
    return {
      id: r.id as string,
      visit_id: (visit?.id as string) ?? "",
      visit_date: (visit?.visit_date as string) ?? "",
      store_name: (visit?.stores?.name as string) ?? "—",
      body: r.body as string,
      author_name: (r.author_name as string | null) ?? null,
      created_at: r.created_at as string,
      thumb_url: path ? (signedByPath.get(path) ?? null) : null,
    };
  });
}

export async function updateFollowUpFieldsMA(
  visitId: string,
  followUpId: string,
  fields: {
    title?: string;
    notes?: string | null;
    due_date?: string | null;
    status?: 'open' | 'done' | 'cancelled';
    assigned_to_telegram_id?: number | null;
  },
): Promise<VisitFollowUpRow | null> {
  const patch: Record<string, unknown> = {};
  if (typeof fields.title === "string") patch.title = fields.title.trim();
  if (fields.notes !== undefined) patch.notes = fields.notes && fields.notes.trim() ? fields.notes.trim() : null;
  if (fields.due_date !== undefined) patch.due_date = fields.due_date && fields.due_date.trim() ? fields.due_date : null;
  if (fields.assigned_to_telegram_id !== undefined) patch.assigned_to_telegram_id = fields.assigned_to_telegram_id;
  if (fields.status) {
    patch.status = fields.status;
    patch.closed_at = fields.status === "done" ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) return null;

  const { data, error } = await supabase
    .from("visit_follow_ups")
    .update(patch)
    .eq("id", followUpId)
    .eq("visit_id", visitId)
    .select("id, title, notes, due_date, status, closed_at, created_at, assigned_to_telegram_id, cms:assigned_to_telegram_id(full_name, nickname)")
    .single();
  if (error || !data) {
    console.error("updateFollowUpFieldsMA error:", error);
    return null;
  }
  const r = data as Record<string, unknown> & { cms?: { full_name?: string; nickname?: string } };
  return {
    id: r.id as string,
    title: r.title as string,
    notes: (r.notes as string) ?? null,
    due_date: (r.due_date as string) ?? null,
    status: r.status as 'open' | 'done' | 'cancelled',
    closed_at: (r.closed_at as string) ?? null,
    created_at: r.created_at as string,
    assigned_to_telegram_id: (r.assigned_to_telegram_id as number | null) ?? null,
    assigned_to_name: r.cms?.nickname ?? r.cms?.full_name ?? null,
  };
}

export async function deleteFollowUpMA(visitId: string, followUpId: string): Promise<boolean> {
  const { error } = await supabase
    .from("visit_follow_ups")
    .delete()
    .eq("id", followUpId)
    .eq("visit_id", visitId);
  if (error) {
    console.error("deleteFollowUpMA error:", error);
    return false;
  }
  return true;
}

// ── Mini-app finalize (Save & Done) ────────────────────────────────────────
// These helpers back the `/api/m/visit/[id]/finalize` endpoint, which is
// what the follow-up page calls when the CM taps "Save & Done". They mirror
// what the bot's followUp loop does on the ✓ Done callback: lock the visit,
// gather counts for the summary message, find the manager broadcast chat.

export async function lockVisitMA(visitId: string): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("visits")
    .update({ is_locked: true, locked_at: nowIso, submitted_at: nowIso })
    .eq("id", visitId)
    .eq("is_locked", false); // idempotent — only locks if still open
  if (error) {
    console.error("lockVisitMA error:", error);
    return false;
  }
  return true;
}

export async function countVisitPhotosMA(visitId: string): Promise<number> {
  const { count } = await supabase
    .from("visit_photos")
    .select("id", { count: "exact", head: true })
    .eq("visit_id", visitId);
  return count ?? 0;
}

export async function countTrainedStaffMA(visitId: string): Promise<number> {
  const { count } = await supabase
    .from("visit_staff")
    .select("staff_id", { count: "exact", head: true })
    .eq("visit_id", visitId)
    .eq("was_trained", true);
  return count ?? 0;
}

export interface FinalizeVisitContext {
  store_name: string;
  store_chain: string | null;
  market: "SG" | "MY" | "HK" | "TH" | null;
  cm_telegram_id: number;
  cms: { telegram_id: number; role: "lead" | "co"; name: string }[];
}

export async function getFinalizeContext(
  visitId: string,
): Promise<FinalizeVisitContext | null> {
  const { data, error } = await supabase
    .from("visits")
    .select("cm_telegram_id, stores(name, chain, market)")
    .eq("id", visitId)
    .single();
  if (error || !data) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = data as any;

  const { data: vcRows } = await supabase
    .from("visit_cms")
    .select("cm_telegram_id, role, cms(full_name, nickname)")
    .eq("visit_id", visitId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cms = ((vcRows ?? []) as any[])
    .map((r) => ({
      telegram_id: r.cm_telegram_id as number,
      role: r.role as "lead" | "co",
      name:
        (r.cms?.nickname as string | null) ??
        (r.cms?.full_name as string | null) ??
        "Unknown",
    }))
    .sort((a, b) => (a.role === "lead" ? -1 : b.role === "lead" ? 1 : 0));

  return {
    store_name: v.stores?.name ?? "Unknown store",
    store_chain: v.stores?.chain ?? null,
    market: (v.stores?.market as "SG" | "MY" | "HK" | "TH" | null) ?? null,
    cm_telegram_id: v.cm_telegram_id,
    cms,
  };
}

// Per-market alert routing. Mirrors src/db/queries/alert-groups.ts:getAlertGroup.
export async function getAlertGroupChatIdMA(
  market: "SG" | "MY" | "HK" | "TH",
): Promise<number | null> {
  const { data } = await supabase
    .from("alert_groups")
    .select("chat_id")
    .eq("market", market)
    .maybeSingle();
  return ((data as { chat_id: number | null } | null)?.chat_id) ?? null;
}

// Admins flagged for DM fallback when a market has no alert chat.
// Mirrors src/db/queries/alert-groups.ts:getJoinRequestAdmins.
export async function getJoinRequestAdminIdsMA(): Promise<number[]> {
  const { data } = await supabase
    .from("cms")
    .select("telegram_id")
    .eq("is_join_request_admin", true)
    .eq("is_active", true);
  return ((data ?? []) as { telegram_id: number }[]).map((r) => r.telegram_id);
}

// Hard delete. DB-first → storage-second so storage hiccups don't leave
// orphan rows. Mirrors src/db/queries/visits.ts:deleteVisit.
export async function deleteVisitMA(visitId: string): Promise<boolean> {
  const { data: photos } = await supabase
    .from("visit_photos")
    .select("storage_path")
    .eq("visit_id", visitId);

  const { error: delErr } = await supabase.from("visits").delete().eq("id", visitId);
  if (delErr) {
    console.error("deleteVisitMA DB error:", delErr);
    return false;
  }

  const paths = ((photos ?? []) as { storage_path: string | null }[])
    .map((p) => p.storage_path)
    .filter((p): p is string => Boolean(p));
  if (paths.length > 0) {
    const { error: storErr } = await supabase.storage.from("sva-photos").remove(paths);
    if (storErr) console.error("deleteVisitMA storage cleanup error:", storErr);
  }
  return true;
}

export async function updateVisitStaffProducts(
  visitId: string,
  updates: Array<{ staff_id: string; products: string | null }>,
): Promise<boolean> {
  for (const u of updates) {
    const { error } = await supabase
      .from("visit_staff")
      .update({ products_trained_on: u.products && u.products.trim() ? u.products.trim() : null })
      .eq("visit_id", visitId)
      .eq("staff_id", u.staff_id);
    if (error) {
      console.error("updateVisitStaffProducts error:", error);
      return false;
    }
  }
  return true;
}

export interface StoreStaff {
  id: string;
  name: string;
}

export async function getStoreStaffForVisit(visitId: string): Promise<StoreStaff[] | null> {
  const { data: visit, error: vErr } = await supabase
    .from("visits")
    .select("store_id")
    .eq("id", visitId)
    .single();
  if (vErr || !visit) return null;

  const { data, error } = await supabase
    .from("staff")
    .select("id, name")
    .eq("store_id", visit.store_id)
    .order("name", { ascending: true });
  if (error) {
    console.error("getStoreStaffForVisit error:", error);
    return null;
  }
  return (data ?? []).map((s) => ({ id: s.id as string, name: s.name as string }));
}

export interface StaffDetail {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  is_ally: boolean;
  age: number | null;
  bio: string | null;
  store_id: string;
  store_name: string;
  stats: { engagements: number; trained: number; products: number; lastEngagedAt: string | null };
  trainingHistory: Array<{ visit_id: string; visit_date: string; products: string[] }>;
}

// Full per-staff profile + lifetime engagement rollup across all locked visits
// at their store. Powers the m/staff/[id] detail screen.
export async function getStaffDetailForCM(staffId: string): Promise<StaffDetail | null> {
  const { data: staff, error } = await supabase
    .from("staff")
    .select("id, name, role, phone, is_ally, age, bio, store_id, stores(name)")
    .eq("id", staffId)
    .single();
  if (error || !staff) return null;

  // Every locked engagement for this person, newest first (date sort in JS to
  // avoid referenced-table ordering quirks).
  const { data: vsRows } = await supabase
    .from("visit_staff")
    .select("id, was_trained, visits!inner(id, visit_date, is_locked)")
    .eq("staff_id", staffId)
    .eq("visits.is_locked", true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vs = ((vsRows ?? []) as any[]).sort((a, b) =>
    String(b.visits?.visit_date ?? "").localeCompare(String(a.visits?.visit_date ?? "")),
  );

  const stats = {
    engagements: vs.length,
    trained: vs.filter((r) => r.was_trained).length,
    products: 0,
    lastEngagedAt: vs.length > 0 ? (vs[0].visits?.visit_date ?? null) : null,
  };

  // Per-product training history grouped by visit (only visits with trainings).
  const trainingHistory: StaffDetail["trainingHistory"] = [];
  if (vs.length > 0) {
    const vsIds = vs.map((r) => r.id as string);
    const { data: trRows } = await supabase
      .from("engagement_trainings")
      .select("visit_staff_id, product_name")
      .in("visit_staff_id", vsIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tr = (trRows ?? []) as any[];
    stats.products = tr.length;
    const byVs = new Map<string, string[]>();
    for (const t of tr) {
      const arr = byVs.get(t.visit_staff_id as string) ?? [];
      arr.push(t.product_name as string);
      byVs.set(t.visit_staff_id as string, arr);
    }
    for (const r of vs) {
      const products = byVs.get(r.id as string) ?? [];
      if (products.length === 0) continue;
      trainingHistory.push({
        visit_id: r.visits?.id as string,
        visit_date: r.visits?.visit_date as string,
        products,
      });
    }
  }

  return {
    id: staff.id as string,
    name: staff.name as string,
    role: (staff.role as string | null) ?? null,
    phone: (staff.phone as string | null) ?? null,
    is_ally: Boolean(staff.is_ally),
    age: (staff.age as number | null) ?? null,
    bio: (staff.bio as string | null) ?? null,
    store_id: staff.store_id as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store_name: ((staff.stores as any)?.name as string) ?? "Store",
    stats,
    trainingHistory,
  };
}

// Update editable profile fields on a staff member (age + bio). Used by the
// m/staff/[id] edit form. age/bio columns added in mig 026.
export async function updateStaffProfile(
  staffId: string,
  fields: { age?: number | null; bio?: string | null },
): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (fields.age !== undefined) patch.age = fields.age;
  if (fields.bio !== undefined) patch.bio = fields.bio;
  if (Object.keys(patch).length === 0) return true;
  const { error } = await supabase.from("staff").update(patch).eq("id", staffId);
  if (error) {
    console.error("updateStaffProfile error:", error);
    return false;
  }
  return true;
}

export interface EngagementPersonInput {
  staff_id: string | null;
  person_name: string | null;
  update_text: string | null;
  trainings: Array<{ product_id: string | null; product_name: string; response: string | null }>;
}

// Replace the full engagement set for a visit (new model, mig 021). Deletes all
// visit_staff rows for the visit (cascades engagement_trainings) then re-inserts
// each person + their trainings. Dual-writes the old columns (was_trained,
// products_trained_on CSV, training_response) so legacy readers/analytics still
// work during the transition.
export async function setVisitEngagements(
  visitId: string,
  people: EngagementPersonInput[],
): Promise<boolean> {
  const { error: delErr } = await supabase
    .from("visit_staff")
    .delete()
    .eq("visit_id", visitId);
  if (delErr) {
    console.error("setVisitEngagements delete error:", delErr);
    return false;
  }

  if (people.length === 0) return true;

  // Every engaged person becomes a store staff record, so they're clickable in
  // the dashboard, appear in the /staff roster, and accumulate history. Resolve
  // each free-typed name to an existing store staff (case-insensitive) or create
  // one. Falls back to a legacy person_name row only if the store can't resolve.
  const storeId = await getStoreIdForVisit(visitId);
  const nameToId = new Map<string, string>();
  if (storeId) {
    const { data: staffRows } = await supabase
      .from("staff")
      .select("id, name")
      .eq("store_id", storeId);
    for (const s of (staffRows ?? []) as { id: string; name: string }[]) {
      nameToId.set(s.name.trim().toLowerCase(), s.id);
    }
  }

  // Resolve + merge: people who collapse to the same staff member (same name
  // typed twice, or a free-typed name matching a roster pick) are combined so the
  // (visit_id, staff_id) unique index can't throw on re-insert.
  interface MergedPerson {
    staff_id: string | null;
    person_name: string | null; // set only when we couldn't resolve to a staff record
    update_text: string | null;
    trainings: EngagementPersonInput["trainings"];
  }
  const byKey = new Map<string, MergedPerson>();
  const order: string[] = [];

  for (const p of people) {
    let staffId = p.staff_id ?? null;
    let personName: string | null = null;

    if (!staffId) {
      const nm = (p.person_name ?? "").trim();
      if (!nm) continue; // no identity at all — skip (the route already validates this)
      if (storeId) {
        const key = nm.toLowerCase();
        staffId = nameToId.get(key) ?? null;
        if (!staffId) {
          const { data: created, error: cErr } = await supabase
            .from("staff")
            .insert({ store_id: storeId, name: nm })
            .select("id")
            .single();
          if (cErr || !created) {
            console.error("setVisitEngagements staff create error:", cErr);
            return false;
          }
          staffId = created.id as string;
          nameToId.set(key, staffId);
        }
      } else {
        personName = nm; // no store id (shouldn't happen) — keep a legacy free-typed row
      }
    }

    const key = staffId ?? `name:${(personName ?? "").toLowerCase()}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.trainings.push(...p.trainings);
      existing.update_text =
        [existing.update_text, p.update_text].filter((t) => t && t.trim()).join(" · ") || null;
    } else {
      byKey.set(key, {
        staff_id: staffId,
        person_name: personName,
        update_text: p.update_text ?? null,
        trainings: [...p.trainings],
      });
      order.push(key);
    }
  }

  for (const key of order) {
    const m = byKey.get(key)!;
    // A merge can repeat a product — dedupe trainings before writing.
    const seen = new Set<string>();
    const trainings = m.trainings.filter((t) => {
      const k = (t.product_id ?? t.product_name).toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const productCsv = trainings.map((t) => t.product_name).filter(Boolean).join(", ");
    const { data: inserted, error: insErr } = await supabase
      .from("visit_staff")
      .insert({
        visit_id: visitId,
        staff_id: m.staff_id,
        person_name: m.staff_id ? null : m.person_name,
        update_text: m.update_text,
        was_trained: trainings.length > 0,
        products_trained_on: productCsv || null,
        training_response: m.update_text, // dual-write for old readers
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      console.error("setVisitEngagements person insert error:", insErr);
      return false;
    }

    if (trainings.length > 0) {
      const trainingRows = trainings.map((t) => ({
        visit_staff_id: inserted.id as string,
        product_id: t.product_id,
        product_name: t.product_name,
        response: t.response,
      }));
      const { error: tErr } = await supabase.from("engagement_trainings").insert(trainingRows);
      if (tErr) {
        console.error("setVisitEngagements trainings insert error:", tErr);
        return false;
      }
    }
  }
  return true;
}

export async function createStoreStaff(storeId: string, name: string): Promise<StoreStaff | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data, error } = await supabase
    .from("staff")
    .insert({ store_id: storeId, name: trimmed })
    .select("id, name")
    .single();
  if (error || !data) {
    console.error("createStoreStaff error:", error);
    return null;
  }
  return { id: data.id as string, name: data.name as string };
}

export async function getStoreIdForVisit(visitId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("visits")
    .select("store_id")
    .eq("id", visitId)
    .single();
  if (error || !data) return null;
  return data.store_id as string;
}

export async function updateVisitText(
  telegramId: number,
  visitId: string,
  fields: Partial<Pick<FullVisit, "good_news" | "people_training" | "competitors" | "display_stock" | "follow_up" | "buzz_plan">>,
): Promise<boolean> {
  const { error } = await supabase
    .from("visits")
    .update({ ...fields, edited_at: new Date().toISOString() })
    .eq("id", visitId)
    .eq("cm_telegram_id", telegramId);
  return !error;
}

export async function insertVisitPhoto(
  visitId: string,
  storagePath: string,
  fileSize?: number,
  sectionKey?: PhotoSectionKey | null,
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from("visit_photos")
    .insert({
      visit_id: visitId,
      storage_path: storagePath,
      ...(fileSize !== undefined && { file_size: fileSize }),
      ...(sectionKey !== undefined && { section_key: sectionKey }),
    })
    .select("id")
    .single();
  if (error || !data) return null;
  return { id: (data as { id: string }).id };
}

// Hard-delete a single visit photo (row + storage object). Scoped by
// (visitId, photoId) so a leaked id can't be used to reach into another visit.
export async function deleteVisitPhoto(
  visitId: string,
  photoId: string,
): Promise<boolean> {
  const { data, error: selErr } = await supabase
    .from("visit_photos")
    .select("storage_path")
    .eq("id", photoId)
    .eq("visit_id", visitId)
    .maybeSingle();
  if (selErr || !data) return false;
  const path = (data as { storage_path: string | null }).storage_path;

  const { error: delErr } = await supabase
    .from("visit_photos")
    .delete()
    .eq("id", photoId)
    .eq("visit_id", visitId);
  if (delErr) return false;

  if (path) {
    const { error: storErr } = await supabase.storage.from("sva-photos").remove([path]);
    if (storErr) console.error("deleteVisitPhoto storage cleanup:", storErr);
  }
  return true;
}

// Update the section_key on a single photo — used by the mini-app editor when
// the CM re-homes an "Other photos" thumb into a structured section.
export async function updateVisitPhotoSection(
  visitId: string,
  photoId: string,
  sectionKey: PhotoSectionKey | null,
): Promise<boolean> {
  const { error } = await supabase
    .from("visit_photos")
    .update({ section_key: sectionKey })
    .eq("id", photoId)
    .eq("visit_id", visitId);
  return !error;
}

export interface StatsActivity {
  visits: { id: string; date: string; store_id: string; store_name: string; store_chain: string }[];
  trainings: { date: string; store_id: string; store_name: string; staff_count: number }[];
  // One entry per person engaged (visit_staff row) — the unit behind "engagements".
  engagements: { date: string; store_id: string; store_name: string }[];
  // One entry per product trained (engagement_trainings row) — drives the
  // product breakdown. A single training session can yield several of these.
  products: { date: string; store_id: string; product_name: string }[];
}

export async function getStatsActivityForCM(
  telegramId: number,
  fromDate?: string,
  toDate?: string,
): Promise<StatsActivity> {
  let q = supabase
    .from("visits")
    .select("id, visit_date, store_id, stores(name, chain), visit_cms!inner(cm_telegram_id)")
    .eq("visit_cms.cm_telegram_id", telegramId)
    .eq("is_locked", true);
  if (fromDate) q = q.gte("visit_date", fromDate);
  if (toDate) q = q.lte("visit_date", toDate);

  const { data: visitRows } = await q
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (visitRows ?? []) as any[];
  if (rows.length === 0) return { visits: [], trainings: [], engagements: [], products: [] };

  const visits = rows.map((r) => ({
    id: r.id as string,
    date: r.visit_date as string,
    store_id: r.store_id as string,
    store_name: (r.stores?.name as string | null) ?? "",
    store_chain: (r.stores?.chain as string | null) ?? "",
  }));
  const visitById = new Map(visits.map((v) => [v.id, v]));

  const visitIds = visits.map((v) => v.id);
  // Every engaged person on these visits — one visit_staff row = one engagement.
  const { data: staffRows } = await supabase
    .from("visit_staff")
    .select("id, visit_id, was_trained")
    .in("visit_id", visitIds);

  const trainedCountByVisit = new Map<string, number>();
  const staffVisitById = new Map<string, string>();
  const engagements: StatsActivity["engagements"] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (staffRows ?? []) as any[]) {
    const vid = r.visit_id as string;
    staffVisitById.set(r.id as string, vid);
    const v = visitById.get(vid);
    if (v) engagements.push({ date: v.date, store_id: v.store_id, store_name: v.store_name });
    if (r.was_trained) trainedCountByVisit.set(vid, (trainedCountByVisit.get(vid) ?? 0) + 1);
  }

  const trainings = visits
    .filter((v) => trainedCountByVisit.has(v.id))
    .map((v) => ({
      date: v.date,
      store_id: v.store_id,
      store_name: v.store_name,
      staff_count: trainedCountByVisit.get(v.id) ?? 0,
    }));

  // Per-product training rows (mig 021). Map each back to its visit's date/store
  // via the owning visit_staff row, so the client can break trainings down by
  // product and filter by period.
  const products: StatsActivity["products"] = [];
  const staffIds = Array.from(staffVisitById.keys());
  if (staffIds.length > 0) {
    const { data: trainingRows } = await supabase
      .from("engagement_trainings")
      .select("visit_staff_id, product_name")
      .in("visit_staff_id", staffIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of (trainingRows ?? []) as any[]) {
      const vid = staffVisitById.get(r.visit_staff_id as string);
      const v = vid ? visitById.get(vid) : undefined;
      if (v) products.push({ date: v.date, store_id: v.store_id, product_name: (r.product_name as string) ?? "" });
    }
  }

  return { visits, trainings, engagements, products };
}

export interface TrainingStats {
  staff_trained_count: number;
  visits_with_training: number;
  recent: { staff_name: string; products: string; visit_date: string; store_name: string }[];
}

export async function getTrainingStatsForCM(
  telegramId: number,
  fromDate?: string,
  toDate?: string,
): Promise<TrainingStats> {
  // Step 1: visit IDs this CM is associated with (lead or co)
  let visitQ = supabase
    .from("visits")
    .select("id, visit_cms!inner(cm_telegram_id)")
    .eq("visit_cms.cm_telegram_id", telegramId)
    .eq("is_locked", true);
  if (fromDate) visitQ = visitQ.gte("visit_date", fromDate);
  if (toDate) visitQ = visitQ.lte("visit_date", toDate);

  const { data: visitIdRows } = await visitQ;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const visitIds = ((visitIdRows ?? []) as any[]).map((r) => r.id as string);
  if (visitIds.length === 0) {
    return { staff_trained_count: 0, visits_with_training: 0, recent: [] };
  }

  // Step 2: trained visit_staff rows for those visits, with staff + store names
  const { data: trainedRows } = await supabase
    .from("visit_staff")
    .select("staff_id, products_trained_on, visit_id, visits(visit_date, stores(name)), staff(name)")
    .eq("was_trained", true)
    .in("visit_id", visitIds);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (trainedRows ?? []) as any[];
  const distinctStaff = new Set<string>();
  const distinctVisits = new Set<string>();
  for (const r of rows) {
    if (r.staff_id) distinctStaff.add(r.staff_id);
    if (r.visit_id) distinctVisits.add(r.visit_id);
  }

  const recent = rows
    .map((r) => ({
      staff_name: (r.staff?.name as string | null) ?? "Unknown",
      products: (r.products_trained_on as string | null) ?? "",
      visit_date: (r.visits?.visit_date as string | null) ?? "",
      store_name: (r.visits?.stores?.name as string | null) ?? "",
    }))
    .filter((r) => r.products)
    .sort((a, b) => (a.visit_date < b.visit_date ? 1 : -1))
    .slice(0, 20);

  return {
    staff_trained_count: distinctStaff.size,
    visits_with_training: distinctVisits.size,
    recent,
  };
}

export async function updateVisitCoCMs(
  visitId: string,
  coTelegramIds: number[],
): Promise<boolean> {
  const { data: leadRow } = await supabase
    .from("visit_cms")
    .select("cm_telegram_id")
    .eq("visit_id", visitId)
    .eq("role", "lead")
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leadId = (leadRow as any)?.cm_telegram_id as number | undefined;

  await supabase
    .from("visit_cms")
    .delete()
    .eq("visit_id", visitId)
    .eq("role", "co");

  const filtered = Array.from(new Set(coTelegramIds)).filter((id) => id !== leadId);
  if (filtered.length === 0) return true;

  const { error } = await supabase
    .from("visit_cms")
    .insert(
      filtered.map((id) => ({ visit_id: visitId, cm_telegram_id: id, role: "co" as const })),
    );
  return !error;
}

export async function signPhotoUrls(
  paths: string[],
  ttlSec = 300,
): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await supabase.storage
    .from("sva-photos")
    .createSignedUrls(paths, ttlSec);
  if (error || !data) return [];
  return data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => d.signedUrl as string)
    .filter((u: string) => Boolean(u));
}

// ─── Managed product catalogue (sva.products, mig 019) ─────────────────────
// Powers the EngagementEditor product picker. Display name = brand + ' ' + name
// (matches the free-typed product strings 1:1), but we keep the id so a picked
// training links back to the product row (denormalize-and-link).
export interface ProductOption {
  id: string;
  brand: string;
  name: string;
}

export async function getActiveProducts(): Promise<ProductOption[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, brand, name")
    .eq("is_active", true)
    .order("brand")
    .order("name");
  if (error || !data) return [];
  return data as ProductOption[];
}

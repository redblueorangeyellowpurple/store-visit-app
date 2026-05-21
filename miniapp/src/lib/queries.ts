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

export interface VisitFollowUpRow {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  status: 'open' | 'done' | 'cancelled';
  closed_at: string | null;
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
  viewer_is_lead: boolean;
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

export async function getStoreTimelineForCM(
  telegramId: number,
  storeId: string,
  options?: { allCMs?: boolean },
): Promise<{ store: Store | null; visits: VisitSummary[] }> {
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

  if (visitRows.length === 0) return { store, visits: [] };

  const ids = visitRows.map((v: any) => v.id); // eslint-disable-line @typescript-eslint/no-explicit-any
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

  return { store, visits };
}

export async function getAllStoresInMarket(
  market: string,
  currentCmTelegramId?: number,
): Promise<AllMarketStore[]> {
  const { data: storeRows } = await supabase
    .from("stores")
    .select("*")
    .eq("market", market)
    .eq("is_active", true)
    .order("name");

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photoRows: VisitPhotoRow[] = ((photos ?? []) as any[])
    .map((p) => ({
      id: p.id as string,
      storage_path: p.storage_path as string,
      section_key: (p.section_key as VisitPhotoRow["section_key"]) ?? null,
    }))
    .filter((p) => Boolean(p.storage_path));

  const photoPaths = photoRows.map((p) => p.storage_path);

  const { data: followUpRows } = await supabase
    .from("visit_follow_ups")
    .select("id, title, notes, due_date, status, closed_at, created_at")
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
  }));

  const viewerIsLead = cms.find((c) => c.role === 'lead')?.telegram_id === telegramId;

  const { data: vsRows } = await supabase
    .from("visit_staff")
    .select("staff_id, products_trained_on, training_response, was_trained, staff(name)")
    .eq("visit_id", visitId)
    .eq("was_trained", true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trainedStaff: VisitTrainedStaff[] = ((vsRows ?? []) as any[])
    .map((r) => ({
      staff_id: r.staff_id as string,
      name: (r.staff?.name as string | null) ?? "Unknown",
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
    viewer_is_lead: viewerIsLead,
  };
}

// ─── Visit follow-ups (mini-app side) ──────────────────────────────────────

export async function createFollowUpsForVisit(
  visitId: string,
  cmTelegramId: number,
  items: Array<{ title: string; notes?: string | null; due_date?: string | null }>,
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
      title: i.title.trim(),
      notes: i.notes && i.notes.trim() ? i.notes.trim() : null,
      due_date: i.due_date && i.due_date.trim() ? i.due_date : null,
    }));
  if (rows.length === 0) return [];

  const { data, error } = await supabase
    .from("visit_follow_ups")
    .insert(rows)
    .select("id, title, notes, due_date, status, closed_at, created_at");
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
  }));
}

export async function listFollowUpsForVisitMA(
  visitId: string,
): Promise<VisitFollowUpRow[]> {
  const { data } = await supabase
    .from("visit_follow_ups")
    .select("id, title, notes, due_date, status, closed_at, created_at")
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
  }));
}

export async function markFollowUpDoneMA(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("visit_follow_ups")
    .update({ status: "done", closed_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
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

export interface FinalizeVisitContext {
  store_name: string;
  store_chain: string | null;
  cm_telegram_id: number;
  cms: { telegram_id: number; role: "lead" | "co"; name: string }[];
}

export async function getFinalizeContext(
  visitId: string,
): Promise<FinalizeVisitContext | null> {
  const { data, error } = await supabase
    .from("visits")
    .select("cm_telegram_id, stores(name, chain)")
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
    cm_telegram_id: v.cm_telegram_id,
    cms,
  };
}

export async function getBroadcastChatIdMA(): Promise<string | null> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "broadcast_chat_id")
    .maybeSingle();
  const dbVal = (data?.value as string | null) ?? null;
  return dbVal ?? process.env.BROADCAST_CHAT_ID ?? null;
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

export async function setVisitTrainedStaff(
  visitId: string,
  trained: Array<{ staff_id: string; products: string | null; response: string | null }>,
): Promise<boolean> {
  // Delete existing trained rows for this visit, then insert the new set.
  const { error: delErr } = await supabase
    .from("visit_staff")
    .delete()
    .eq("visit_id", visitId);
  if (delErr) {
    console.error("setVisitTrainedStaff delete error:", delErr);
    return false;
  }

  if (trained.length === 0) return true;

  const rows = trained.map((t) => ({
    visit_id: visitId,
    staff_id: t.staff_id,
    was_trained: true,
    products_trained_on: t.products && t.products.trim() ? t.products.trim() : null,
    training_response: t.response && t.response.trim() ? t.response.trim() : null,
  }));
  const { error: insErr } = await supabase.from("visit_staff").insert(rows);
  if (insErr) {
    console.error("setVisitTrainedStaff insert error:", insErr);
    return false;
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
  if (rows.length === 0) return { visits: [], trainings: [] };

  const visits = rows.map((r) => ({
    id: r.id as string,
    date: r.visit_date as string,
    store_id: r.store_id as string,
    store_name: (r.stores?.name as string | null) ?? "",
    store_chain: (r.stores?.chain as string | null) ?? "",
  }));

  const visitIds = visits.map((v) => v.id);
  const { data: trainedRows } = await supabase
    .from("visit_staff")
    .select("visit_id")
    .eq("was_trained", true)
    .in("visit_id", visitIds);

  const trainedCountByVisit = new Map<string, number>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of (trainedRows ?? []) as any[]) {
    const vid = r.visit_id as string;
    trainedCountByVisit.set(vid, (trainedCountByVisit.get(vid) ?? 0) + 1);
  }

  const trainings = visits
    .filter((v) => trainedCountByVisit.has(v.id))
    .map((v) => ({
      date: v.date,
      store_id: v.store_id,
      store_name: v.store_name,
      staff_count: trainedCountByVisit.get(v.id) ?? 0,
    }));

  return { visits, trainings };
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

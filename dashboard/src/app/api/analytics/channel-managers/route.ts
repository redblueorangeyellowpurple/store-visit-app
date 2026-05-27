import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisitEntry {
  id: string;
  store_id: string;
  store_name: string;
  chain: string;
  locked_at: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  training: string | null;
}

export interface CMData {
  telegram_id: number;
  full_name: string;
  /** Number of unique stores visited on this date */
  stores_visited: number;
  /**
   * Count of visits where `training` is non-null.
   * TODO (Q2 People & Training): migrate to count of `visit_staff` rows
   * with training tags once per-staff engagement tagging is shipped.
   */
  engagements: number;
  /** All visits, sorted by chain → store_name */
  visits: VisitEntry[];
}

export interface MarketGroup {
  market: "SG" | "MY" | "TH" | "HK";
  total_visits: number;
  total_engagements: number;
  cms: CMData[];
}

export interface AnalyticsResponse {
  date: string;
  markets: MarketGroup[];
}

// ─── Market display order ─────────────────────────────────────────────────────

const MARKET_ORDER: Array<"SG" | "MY" | "TH" | "HK"> = ["SG", "MY", "TH", "HK"];

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  // Fetch all locked visits for this visit_date, joining store + CM info
  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, store_id, cm_telegram_id, locked_at,
      good_news, competitors, display_stock, training,
      stores ( name, chain, market ),
      cms!visits_cm_telegram_id_fkey ( full_name )
    `)
    .eq("is_locked", true)
    .eq("visit_date", date)
    .order("locked_at", { ascending: true });

  if (error) {
    console.error("analytics/channel-managers error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  // ─── Group by market → CM ─────────────────────────────────────────────────

  type MarketKey = "SG" | "MY" | "TH" | "HK";
  const marketMap = new Map<MarketKey, Map<number, CMData>>();

  for (const row of data ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = row as any;
    const market: MarketKey = r.stores?.market ?? "SG";
    const telegramId: number = r.cm_telegram_id;
    const fullName: string = r.cms?.full_name ?? "Unknown";

    if (!marketMap.has(market)) marketMap.set(market, new Map());
    const cmMap = marketMap.get(market)!;

    if (!cmMap.has(telegramId)) {
      cmMap.set(telegramId, {
        telegram_id: telegramId,
        full_name: fullName,
        stores_visited: 0,
        engagements: 0,
        visits: [],
      });
    }

    const cm = cmMap.get(telegramId)!;
    const visit: VisitEntry = {
      id: r.id,
      store_id: r.store_id,
      store_name: r.stores?.name ?? "Unknown Store",
      chain: r.stores?.chain ?? "",
      locked_at: r.locked_at,
      good_news: r.good_news,
      competitors: r.competitors,
      display_stock: r.display_stock,
      training: r.training,
    };

    cm.visits.push(visit);
    cm.stores_visited += 1;
    if (r.training) cm.engagements += 1;
  }

  // ─── Build output: sort visits by chain → store_name, sort CMs alpha ──────

  const markets: MarketGroup[] = MARKET_ORDER
    .filter((m) => marketMap.has(m))
    .map((market) => {
      const cmMap = marketMap.get(market)!;
      const cms: CMData[] = Array.from(cmMap.values())
        .sort((a, b) => a.full_name.localeCompare(b.full_name))
        .map((cm) => ({
          ...cm,
          visits: cm.visits.sort((a, b) =>
            a.chain.localeCompare(b.chain) || a.store_name.localeCompare(b.store_name),
          ),
        }));

      return {
        market,
        total_visits: cms.reduce((s, c) => s + c.stores_visited, 0),
        total_engagements: cms.reduce((s, c) => s + c.engagements, 0),
        cms,
      };
    });

  return Response.json({ date, markets } satisfies AnalyticsResponse);
}

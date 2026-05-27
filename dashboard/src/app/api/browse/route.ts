import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const MARKET_ORDER = ["SG", "MY", "TH", "HK"];

const MARKET_FLAG: Record<string, string> = {
  SG: "🇸🇬",
  MY: "🇲🇾",
  TH: "🇹🇭",
  HK: "🇭🇰",
};

export async function GET(req: NextRequest) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }

  const { data } = await supabase
    .from("stores")
    .select("id, name, chain, market, tier")
    .eq("is_active", true)
    .order("market")
    .order("chain")
    .order("name");

  const rows = (data ?? []) as {
    id: string;
    name: string;
    chain: string;
    market: string;
    tier: string | null;
  }[];

  // Group: market → chain → stores
  const marketMap = new Map<string, Map<string, { id: string; name: string; tier: string | null }[]>>();

  for (const row of rows) {
    if (!marketMap.has(row.market)) marketMap.set(row.market, new Map());
    const chainMap = marketMap.get(row.market)!;
    if (!chainMap.has(row.chain)) chainMap.set(row.chain, []);
    chainMap.get(row.chain)!.push({ id: row.id, name: row.name, tier: row.tier });
  }

  const markets = MARKET_ORDER
    .filter((m) => marketMap.has(m))
    .map((m) => ({
      market: m,
      flag: MARKET_FLAG[m] ?? m,
      chains: [...marketMap.get(m)!.entries()].map(([chain, stores]) => ({ chain, stores })),
    }));

  return Response.json({ markets });
}

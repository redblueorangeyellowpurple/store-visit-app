import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  AdminMarket,
  StoreTier,
  createStore,
  getAllStores,
  updateStore,
} from "@/lib/queries";

const MARKETS = new Set<AdminMarket>(["SG", "MY", "TH", "HK"]);
const TIERS = new Set<StoreTier>(["T1", "T2", "T3", "T4"]);

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const stores = await getAllStores();
  return Response.json({ stores });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const chain = typeof body.chain === "string" ? body.chain.trim() : "";
  const market = body.market as AdminMarket;
  const tier = body.tier === null || body.tier === undefined ? null : (body.tier as StoreTier);
  const address = typeof body.address === "string" ? body.address.trim() || null : null;

  if (!name) return Response.json({ error: "name required" }, { status: 400 });
  if (!chain) return Response.json({ error: "chain required" }, { status: 400 });
  if (!MARKETS.has(market)) return Response.json({ error: "invalid market" }, { status: 400 });
  if (tier !== null && !TIERS.has(tier)) {
    return Response.json({ error: "invalid tier" }, { status: 400 });
  }

  const row = await createStore({ name, chain, market, tier, address });
  if (!row) return Response.json({ error: "create failed (duplicate name+market?)" }, { status: 500 });
  return Response.json({ store: row });
}

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.id !== "string") {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.chain !== undefined) patch.chain = String(body.chain).trim();
  if (body.market !== undefined) {
    if (!MARKETS.has(body.market)) return Response.json({ error: "invalid market" }, { status: 400 });
    patch.market = body.market;
  }
  if (body.tier !== undefined) {
    if (body.tier !== null && !TIERS.has(body.tier)) {
      return Response.json({ error: "invalid tier" }, { status: 400 });
    }
    patch.tier = body.tier;
  }
  if (body.address !== undefined) {
    patch.address = body.address === null ? null : String(body.address).trim() || null;
  }
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }

  const ok = await updateStore(body.id, patch);
  if (!ok) return Response.json({ error: "update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { AdminMarket, AdminRole, approvePendingPerson } from "@/lib/queries";

const ROLES = new Set<AdminRole>(["cm", "cmic", "am", "admin"]);
const MARKETS = new Set<AdminMarket>(["SG", "MY", "TH", "HK"]);

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.telegram_id !== "number") {
    return Response.json({ error: "telegram_id required" }, { status: 400 });
  }
  const market = body.market as AdminMarket;
  if (!MARKETS.has(market)) return Response.json({ error: "invalid market" }, { status: 400 });

  const role = (body.role ?? "cm") as AdminRole;
  if (!ROLES.has(role)) return Response.json({ error: "invalid role" }, { status: 400 });

  const ok = await approvePendingPerson(body.telegram_id, market, role);
  if (!ok) return Response.json({ error: "approve failed" }, { status: 500 });
  return Response.json({ ok: true });
}

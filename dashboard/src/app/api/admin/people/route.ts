import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  AdminMarket,
  AdminRole,
  createPerson,
  getActivePeople,
  getPendingPeople,
  updatePerson,
} from "@/lib/queries";

const ROLES = new Set<AdminRole>(["cm", "cmic", "am", "admin"]);
const MARKETS = new Set<AdminMarket>(["SG", "MY", "TH", "HK"]);

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const [active, pending] = await Promise.all([getActivePeople(), getPendingPeople()]);
  return Response.json({ active, pending });
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const telegramId = Number(body.telegram_id);
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const role = body.role as AdminRole;
  const market = body.market as AdminMarket;

  if (!Number.isInteger(telegramId) || telegramId <= 0) {
    return Response.json({ error: "telegram_id must be a positive integer" }, { status: 400 });
  }
  if (!fullName) return Response.json({ error: "full_name required" }, { status: 400 });
  if (!ROLES.has(role)) return Response.json({ error: "invalid role" }, { status: 400 });
  if (!MARKETS.has(market)) return Response.json({ error: "invalid market" }, { status: 400 });

  const ok = await createPerson({ telegram_id: telegramId, full_name: fullName, role, market });
  if (!ok) return Response.json({ error: "create failed" }, { status: 500 });
  return Response.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.telegram_id !== "number") {
    return Response.json({ error: "telegram_id required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.role !== undefined) {
    if (!ROLES.has(body.role)) return Response.json({ error: "invalid role" }, { status: 400 });
    patch.role = body.role;
  }
  if (body.market !== undefined) {
    if (!MARKETS.has(body.market)) return Response.json({ error: "invalid market" }, { status: 400 });
    patch.market = body.market;
  }
  if (body.am_telegram_id !== undefined) {
    if (body.am_telegram_id !== null && typeof body.am_telegram_id !== "number") {
      return Response.json({ error: "am_telegram_id must be number or null" }, { status: 400 });
    }
    patch.am_telegram_id = body.am_telegram_id;
  }
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (typeof body.is_intelligence_recipient === "boolean") {
    patch.is_intelligence_recipient = body.is_intelligence_recipient;
  }
  if (typeof body.is_join_request_admin === "boolean") {
    patch.is_join_request_admin = body.is_join_request_admin;
  }
  if (typeof body.is_recap_recipient === "boolean") {
    patch.is_recap_recipient = body.is_recap_recipient;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }

  const ok = await updatePerson(body.telegram_id, patch);
  if (!ok) return Response.json({ error: "update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

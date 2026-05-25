import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  AdminMarket,
  IntelligenceMode,
  listAlertGroups,
  setAlertGroup,
} from "@/lib/queries";

const MARKETS = new Set<AdminMarket>(["SG", "MY", "TH", "HK"]);
const MODES = new Set<IntelligenceMode>(["people", "group", "both"]);

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const groups = await listAlertGroups();
  return Response.json({ groups });
}

export async function PATCH(req: NextRequest) {
  const user = requireAdmin(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || !MARKETS.has(body.market)) {
    return Response.json({ error: "invalid market" }, { status: 400 });
  }

  const patch: { chat_id?: number | null; intelligence_mode?: IntelligenceMode } = {};

  if (body.chat_id !== undefined) {
    if (body.chat_id === null || body.chat_id === "") {
      patch.chat_id = null;
    } else {
      const n = Number(body.chat_id);
      if (!Number.isInteger(n)) {
        return Response.json({ error: "chat_id must be an integer or null" }, { status: 400 });
      }
      patch.chat_id = n;
    }
  }

  if (body.intelligence_mode !== undefined) {
    if (!MODES.has(body.intelligence_mode)) {
      return Response.json({ error: "invalid intelligence_mode" }, { status: 400 });
    }
    patch.intelligence_mode = body.intelligence_mode;
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "no fields to update" }, { status: 400 });
  }

  const ok = await setAlertGroup(body.market as AdminMarket, patch, user.id);
  if (!ok) return Response.json({ error: "update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

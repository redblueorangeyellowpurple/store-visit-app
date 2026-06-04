import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getRecapsEnabled, setRecapsEnabled } from "@/lib/queries";

// Master on/off for the daily CM recap (sva.settings 'daily_recaps_enabled').
// This is the runtime kill switch; the 8am cron checks it before sending.
export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const enabled = await getRecapsEnabled();
  return Response.json({ enabled });
}

export async function PATCH(req: NextRequest) {
  const user = requireAdmin(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.enabled !== "boolean") {
    return Response.json({ error: "enabled (boolean) required" }, { status: 400 });
  }
  const ok = await setRecapsEnabled(body.enabled, user.id);
  if (!ok) return Response.json({ error: "update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

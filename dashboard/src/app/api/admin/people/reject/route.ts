import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { rejectPendingPerson } from "@/lib/queries";

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return Response.json({ error: "Not authorised" }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body.telegram_id !== "number") {
    return Response.json({ error: "telegram_id required" }, { status: 400 });
  }
  const ok = await rejectPendingPerson(body.telegram_id);
  if (!ok) return Response.json({ error: "reject failed" }, { status: 500 });
  return Response.json({ ok: true });
}

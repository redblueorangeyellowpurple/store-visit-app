import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { setFollowUpStatus } from "@/lib/queries";

// PATCH { id, done } — mark a store follow-up done / re-open it from the dashboard hub.
export async function PATCH(req: NextRequest) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.id || typeof body.done !== "boolean") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }
  const ok = await setFollowUpStatus(body.id, body.done);
  if (!ok) return Response.json({ error: "Update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

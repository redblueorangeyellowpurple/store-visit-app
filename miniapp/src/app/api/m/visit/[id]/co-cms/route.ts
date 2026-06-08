import { authedCMFromRequest, viewAsReadOnly } from "@/lib/miniapp-auth";
import { getFullVisitForCM, updateVisitCoCMs } from "@/lib/queries";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });
  if (cm.impersonating) return viewAsReadOnly();

  const { id } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  // Only the lead or an elevated role can edit co-CMs
  const isLead = visit.viewer_is_lead;
  const isElevated = cm.role !== "cm";
  if (!isLead && !isElevated) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.co_cm_telegram_ids)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const ids = (body.co_cm_telegram_ids as unknown[])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  const ok = await updateVisitCoCMs(id, ids);
  if (!ok) return Response.json({ error: "Update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

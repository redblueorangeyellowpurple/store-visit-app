import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { getFullVisitForCM, setVisitTrainedStaff, getStoreStaffForVisit } from "@/lib/queries";

interface SetTrainedPayload {
  trained: Array<{ staff_id: string; products: string | null; response: string | null }>;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  const isLead = visit.viewer_is_lead;
  const isElevated = cm.role !== "cm";
  if (!isLead && !isElevated) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as SetTrainedPayload | null;
  if (!body || !Array.isArray(body.trained)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  // Only allow staff that belong to this visit's store.
  const storeStaff = await getStoreStaffForVisit(id);
  if (!storeStaff) return Response.json({ error: "Failed to load staff" }, { status: 500 });
  const validIds = new Set(storeStaff.map((s) => s.id));

  const clean = body.trained
    .filter((t) => t && typeof t.staff_id === "string" && validIds.has(t.staff_id))
    .map((t) => ({
      staff_id: t.staff_id,
      products: typeof t.products === "string" ? t.products : null,
      response: typeof t.response === "string" ? t.response : null,
    }));

  const ok = await setVisitTrainedStaff(id, clean);
  if (!ok) return Response.json({ error: "Update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

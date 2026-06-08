import { authedCMFromRequest, viewAsReadOnly } from "@/lib/miniapp-auth";
import { getFullVisitForCM, createStoreStaff, getStoreIdForVisit } from "@/lib/queries";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });
  if (cm.impersonating) return viewAsReadOnly();

  const { id } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  const isLead = visit.viewer_is_lead;
  const isElevated = cm.role !== "cm";
  if (!isLead && !isElevated) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const name = body?.name;
  if (typeof name !== "string" || !name.trim()) {
    return Response.json({ error: "Missing name" }, { status: 400 });
  }

  const storeId = await getStoreIdForVisit(id);
  if (!storeId) return Response.json({ error: "Store not found" }, { status: 404 });

  const staff = await createStoreStaff(storeId, name);
  if (!staff) return Response.json({ error: "Failed to create" }, { status: 500 });

  return Response.json({ staff });
}

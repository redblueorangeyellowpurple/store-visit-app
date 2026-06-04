import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { getFullVisitForCM, acknowledgeVisitReview } from "@/lib/queries";

// POST — the CM marks the AM review feedback on this visit as seen.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id } = await params;
  // Reuse the visit fetch as the access gate — it returns null unless the CM is
  // on the visit (or elevated).
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  const at = await acknowledgeVisitReview(id, cm.telegram_id);
  if (!at) return Response.json({ error: "Ack failed" }, { status: 500 });
  return Response.json({ ok: true, review_ack_at: at });
}

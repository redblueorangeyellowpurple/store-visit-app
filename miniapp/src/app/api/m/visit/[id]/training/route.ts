import { authedCMFromRequest, viewAsReadOnly } from "@/lib/miniapp-auth";
import {
  getFullVisitForCM,
  getStoreStaffForVisit,
  setVisitEngagements,
  type EngagementPersonInput,
} from "@/lib/queries";

interface TrainingInput {
  product_id?: unknown;
  product_name?: unknown;
  response?: unknown;
}
interface PersonInput {
  staff_id?: unknown;
  person_name?: unknown;
  update_text?: unknown;
  trainings?: unknown;
}
interface SetEngagementsPayload {
  people: PersonInput[];
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

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

  const isLead = visit.viewer_is_lead;
  const isElevated = cm.role !== "cm";
  if (!isLead && !isElevated) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as SetEngagementsPayload | null;
  if (!body || !Array.isArray(body.people)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  // Linked staff must belong to this visit's store; free-typed people (no
  // staff_id) are allowed and resolved later by the intelligence layer.
  const storeStaff = await getStoreStaffForVisit(id);
  if (!storeStaff) return Response.json({ error: "Failed to load staff" }, { status: 500 });
  const validIds = new Set(storeStaff.map((s) => s.id));

  const clean: EngagementPersonInput[] = body.people
    .map((p): EngagementPersonInput | null => {
      const staffId = typeof p.staff_id === "string" && validIds.has(p.staff_id) ? p.staff_id : null;
      const personName = str(p.person_name);
      // A person needs an identity: either a valid linked staff_id or a name.
      if (!staffId && !personName) return null;
      const trainings = Array.isArray(p.trainings)
        ? (p.trainings as TrainingInput[])
            .map((t) => ({
              product_id: typeof t.product_id === "string" ? t.product_id : null,
              product_name: str(t.product_name) ?? "",
              response: str(t.response),
            }))
            .filter((t) => t.product_name.length > 0)
        : [];
      return {
        staff_id: staffId,
        person_name: staffId ? null : personName,
        update_text: str(p.update_text),
        trainings,
      };
    })
    .filter((p): p is EngagementPersonInput => p !== null);

  const ok = await setVisitEngagements(id, clean);
  if (!ok) return Response.json({ error: "Update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

import { authedCMFromRequest } from "@/lib/miniapp-auth";
import {
  getFullVisitForCM,
  signPhotoUrls,
  updateVisitText,
  deleteVisitMA,
} from "@/lib/queries";

const TEXT_FIELDS = [
  "good_news",
  "people_training",
  "competitors",
  "display_stock",
  "follow_up",
  "buzz_plan",
] as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const { id } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) {
    return Response.json({ error: "Visit not found" }, { status: 404 });
  }
  // Photos: signed URLs in same order as visit.photos so the client can group
  // by section_key without re-mapping paths.
  const signedUrls = await signPhotoUrls(visit.photo_paths);
  const photosWithUrls = visit.photos.map((p, i) => ({
    id: p.id,
    storage_path: p.storage_path,
    section_key: p.section_key,
    url: signedUrls[i] ?? null,
  }));
  const canEditCoCMs = visit.viewer_is_lead || cm.role !== "cm";
  const canEditTraining = visit.viewer_is_lead || cm.role !== "cm";
  const canDelete = visit.viewer_is_lead || cm.role === "admin";
  return Response.json({
    visit,
    photoUrls: signedUrls, // back-compat for /edit page
    photos: photosWithUrls,
    canEditCoCMs,
    canEditTraining,
    canDelete,
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  const isLead = visit.cms.find((c) => c.role === "lead")?.telegram_id === cm.telegram_id;
  const isAdmin = cm.role === "admin";
  if (!isLead && !isAdmin) {
    return Response.json({ error: "Not allowed to delete this visit" }, { status: 403 });
  }

  const ok = await deleteVisitMA(id);
  if (!ok) return Response.json({ error: "Delete failed" }, { status: 500 });
  return Response.json({ ok: true });
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

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const fields: Record<string, string | null> = {};
  for (const key of TEXT_FIELDS) {
    if (key in body) {
      const val = body[key];
      fields[key] = typeof val === "string" && val.trim() ? val.trim() : null;
    }
  }

  const ok = await updateVisitText(cm.telegram_id, id, fields);
  if (!ok) return Response.json({ error: "Update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

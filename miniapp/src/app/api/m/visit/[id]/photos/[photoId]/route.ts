import { authedCMFromRequest } from "@/lib/miniapp-auth";
import {
  getFullVisitForCM,
  deleteVisitPhoto,
  updateVisitPhotoSection,
  type PhotoSectionKey,
} from "@/lib/queries";

const SECTION_KEYS: PhotoSectionKey[] = [
  "good_news",
  "people_training",
  "competitor",
  "display_stock",
  "follow_up",
];

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id: visitId, photoId } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, visitId);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  const ok = await deleteVisitPhoto(visitId, photoId);
  if (!ok) return Response.json({ error: "Delete failed" }, { status: 500 });
  return Response.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id: visitId, photoId } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, visitId);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const raw = (body as { section_key?: unknown }).section_key;
  let sectionKey: PhotoSectionKey | null;
  if (raw === null) {
    sectionKey = null;
  } else if (typeof raw === "string" && SECTION_KEYS.includes(raw as PhotoSectionKey)) {
    sectionKey = raw as PhotoSectionKey;
  } else {
    return Response.json({ error: "Invalid section_key" }, { status: 400 });
  }

  const ok = await updateVisitPhotoSection(visitId, photoId, sectionKey);
  if (!ok) return Response.json({ error: "Update failed" }, { status: 500 });
  return Response.json({ ok: true, section_key: sectionKey });
}

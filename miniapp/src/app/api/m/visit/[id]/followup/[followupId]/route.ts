import { authedCMFromRequest } from "@/lib/miniapp-auth";
import {
  getFullVisitForCM,
  updateFollowUpFieldsMA,
  deleteFollowUpMA,
} from "@/lib/queries";

function isCMOnVisit(
  cmTelegramId: number,
  visit: { cms: { telegram_id: number }[] },
): boolean {
  return visit.cms.some((c) => c.telegram_id === cmTelegramId);
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; followupId: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id, followupId } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  if (!isCMOnVisit(cm.telegram_id, visit) && cm.role === "cm") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const fields: {
    title?: string;
    notes?: string | null;
    due_date?: string | null;
    status?: "open" | "done" | "cancelled";
  } = {};

  if (typeof body.title === "string") fields.title = body.title;
  if (body.notes === null || typeof body.notes === "string") fields.notes = body.notes as string | null;
  if (body.due_date === null || typeof body.due_date === "string") fields.due_date = body.due_date as string | null;
  if (body.status === "open" || body.status === "done" || body.status === "cancelled") {
    fields.status = body.status;
  }

  if (Object.keys(fields).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 400 });
  }

  if (fields.title !== undefined && !fields.title.trim()) {
    return Response.json({ error: "Title cannot be empty" }, { status: 400 });
  }

  const updated = await updateFollowUpFieldsMA(id, followupId, fields);
  if (!updated) return Response.json({ error: "Update failed" }, { status: 500 });
  return Response.json({ item: updated });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; followupId: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id, followupId } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  if (!isCMOnVisit(cm.telegram_id, visit) && cm.role === "cm") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const ok = await deleteFollowUpMA(id, followupId);
  if (!ok) return Response.json({ error: "Delete failed" }, { status: 500 });
  return Response.json({ ok: true });
}

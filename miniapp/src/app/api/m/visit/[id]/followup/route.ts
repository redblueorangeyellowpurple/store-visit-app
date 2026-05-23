import { authedCMFromRequest } from "@/lib/miniapp-auth";
import {
  getFullVisitForCM,
  createFollowUpsForVisit,
  listFollowUpsForVisitMA,
  markFollowUpDoneMA,
} from "@/lib/queries";

interface FollowUpItem {
  title: string;
  notes?: string | null;
  due_date?: string | null; // YYYY-MM-DD
  assigned_to_telegram_id?: number | null;
}

function isCMOnVisit(
  cmTelegramId: number,
  visit: { cms: { telegram_id: number }[] },
): boolean {
  return visit.cms.some((c) => c.telegram_id === cmTelegramId);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  const items = await listFollowUpsForVisitMA(id);
  return Response.json({ items });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  // Only CMs on the visit (or elevated roles) may add follow-ups.
  if (!isCMOnVisit(cm.telegram_id, visit) && cm.role === "cm") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const raw = body && typeof body === "object" ? (body.items as unknown) : null;
  if (!Array.isArray(raw)) {
    return Response.json({ error: "Invalid body — items[] required" }, { status: 400 });
  }

  const items: FollowUpItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!title) continue;
    items.push({
      title,
      notes: typeof r.notes === "string" ? r.notes : null,
      due_date: typeof r.due_date === "string" ? r.due_date : null,
      assigned_to_telegram_id:
        typeof r.assigned_to_telegram_id === "number" ? r.assigned_to_telegram_id : null,
    });
  }
  if (items.length === 0) {
    return Response.json({ error: "No valid items" }, { status: 400 });
  }

  const created = await createFollowUpsForVisit(id, cm.telegram_id, items);
  return Response.json({ items: created });
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

  if (!isCMOnVisit(cm.telegram_id, visit) && cm.role === "cm") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const fuId =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).id === "string"
      ? ((body as Record<string, unknown>).id as string)
      : "";
  const action =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).action === "string"
      ? ((body as Record<string, unknown>).action as string)
      : "";
  if (!fuId || action !== "done") {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const ok = await markFollowUpDoneMA(fuId);
  if (!ok) return Response.json({ error: "Update failed" }, { status: 500 });
  return Response.json({ ok: true });
}

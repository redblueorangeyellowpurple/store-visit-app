import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { addPhotoAnnotation, updatePhotoAnnotation, deletePhotoAnnotation } from "@/lib/queries";

function authorName(u: { first_name: string; last_name?: string }) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ");
}

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = requireDashboardRole(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const x = num(b.x), y = num(b.y), w = num(b.w), h = num(b.h);
  if (x === null || y === null || w === null || h === null || !b.note?.trim()) {
    return Response.json({ error: "Invalid annotation" }, { status: 400 });
  }
  const ann = await addPhotoAnnotation(id, { x, y, w, h, note: b.note.trim() }, { telegram_id: user.id, name: authorName(user) });
  if (!ann) return Response.json({ error: "Failed to add annotation" }, { status: 500 });
  return Response.json(ann);
}

export async function PATCH(req: NextRequest) {
  const user = requireDashboardRole(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.annotationId) return Response.json({ error: "Missing annotationId" }, { status: 400 });
  const patch: { note?: string; x?: number; y?: number; w?: number; h?: number } = {};
  if (typeof b.note === "string" && b.note.trim()) patch.note = b.note.trim();
  for (const k of ["x", "y", "w", "h"] as const) {
    if (num(b[k]) !== null) patch[k] = b[k];
  }
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nothing to update" }, { status: 400 });
  const ok = await updatePhotoAnnotation(b.annotationId, patch);
  return Response.json({ ok });
}

export async function DELETE(req: NextRequest) {
  const user = requireDashboardRole(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });
  const { annotationId } = await req.json().catch(() => ({}));
  if (!annotationId) return Response.json({ error: "Missing annotationId" }, { status: 400 });
  const ok = await deletePhotoAnnotation(annotationId);
  return Response.json({ ok });
}

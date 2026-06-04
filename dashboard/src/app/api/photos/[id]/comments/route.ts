import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { addPhotoComment, deletePhotoComment } from "@/lib/queries";

function authorName(u: { first_name: string; last_name?: string }) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = requireDashboardRole(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });
  const { id } = await params;
  const { body } = await req.json().catch(() => ({}));
  if (!body || typeof body !== "string" || !body.trim()) {
    return Response.json({ error: "Empty comment" }, { status: 400 });
  }
  const comment = await addPhotoComment(id, body.trim(), { telegram_id: user.id, name: authorName(user) });
  if (!comment) return Response.json({ error: "Failed to add comment" }, { status: 500 });
  return Response.json(comment);
}

export async function DELETE(req: NextRequest) {
  const user = requireDashboardRole(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });
  const { commentId } = await req.json().catch(() => ({}));
  if (!commentId) return Response.json({ error: "Missing commentId" }, { status: 400 });
  const ok = await deletePhotoComment(commentId);
  if (!ok) return Response.json({ error: "Failed to delete comment" }, { status: 500 });
  return Response.json({ ok: true });
}

import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { setPhotoGrade } from "@/lib/queries";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = requireDashboardRole(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 401 });
  const { id } = await params;
  const { grade } = await req.json().catch(() => ({}));
  if (grade !== null && ![1, 2, 3].includes(grade)) {
    return Response.json({ error: "Invalid grade" }, { status: 400 });
  }
  const ok = await setPhotoGrade(id, grade);
  if (!ok) return Response.json({ error: "Failed to set grade" }, { status: 500 });
  return Response.json({ ok: true });
}

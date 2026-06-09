import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { getVisitDetail } from "@/lib/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const { id } = await params;
  const visit = await getVisitDetail(id);
  if (!visit) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ visit });
}

import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { getStaffDetail } from "@/lib/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }

  const { id } = await params;
  const staff = await getStaffDetail(id);

  if (!staff) {
    return Response.json({ error: "Staff not found" }, { status: 404 });
  }

  return Response.json(staff);
}

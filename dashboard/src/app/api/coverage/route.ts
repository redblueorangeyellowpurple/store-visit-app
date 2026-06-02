import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { getCoverageGrid } from "@/lib/queries";

export async function GET(req: NextRequest) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const grid = await getCoverageGrid();
  return Response.json(grid);
}

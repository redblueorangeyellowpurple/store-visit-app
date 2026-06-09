import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { getWeeklyReport } from "@/lib/weekly";

interface Params { params: Promise<{ week: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const { week } = await params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return Response.json({ error: "Invalid week" }, { status: 400 });
  }

  try {
    const report = await getWeeklyReport(week);
    return Response.json({ report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

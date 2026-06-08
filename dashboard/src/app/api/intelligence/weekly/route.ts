import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { listWeeks } from "@/lib/weekly";

export async function GET(req: NextRequest) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }

  try {
    const weeks = await listWeeks();
    return Response.json({ weeks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { getVisitsFeed } from "@/lib/queries";

export async function GET(req: NextRequest) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }

  const p = req.nextUrl.searchParams;
  const result = await getVisitsFeed({
    cm: p.get("cm") ? Number(p.get("cm")) : undefined,
    store: p.get("store") ?? undefined,
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    market: p.get("market") ?? undefined,
    chain: p.get("chain") ?? undefined,
    offset: p.get("offset") ? Number(p.get("offset")) : 0,
    limit: 50,
  });

  return Response.json(result);
}

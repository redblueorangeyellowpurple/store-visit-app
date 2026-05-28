import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { getVisitsFeed } from "@/lib/queries";

export async function GET(req: NextRequest) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }

  const p = req.nextUrl.searchParams;

  // Parse cm param — supports single ID or comma-separated list for multi-select
  const cmParam = p.get("cm");
  let cmOpts: { cm?: number; cms?: number[] } = {};
  if (cmParam) {
    const parts = cmParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
    if (parts.length === 1) cmOpts = { cm: parts[0] };
    else if (parts.length > 1) cmOpts = { cms: parts };
  }

  const result = await getVisitsFeed({
    ...cmOpts,
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

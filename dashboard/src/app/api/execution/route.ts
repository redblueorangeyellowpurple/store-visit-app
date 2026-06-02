import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { getExecutionGrid } from "@/lib/queries";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Default: the current Mon–Sun week.
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() + (dow === 0 ? -6 : 1 - dow));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}

export async function GET(req: NextRequest) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const url = new URL(req.url);
  const def = defaultRange();
  const fromRaw = url.searchParams.get("from");
  const toRaw = url.searchParams.get("to");
  const from = fromRaw && ISO.test(fromRaw) ? fromRaw : def.from;
  const to = toRaw && ISO.test(toRaw) ? toRaw : def.to;
  const grid = await getExecutionGrid(from, to);
  return Response.json(grid);
}

import { NextRequest } from "next/server";
import { requireDashboardRole } from "@/lib/auth";
import { getCMDetail } from "@/lib/queries";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!requireDashboardRole(req)) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  const { id } = await params;
  const telegramId = Number(id);
  if (isNaN(telegramId)) return Response.json({ error: "Invalid id" }, { status: 400 });
  const result = await getCMDetail(telegramId);
  return Response.json(result);
}

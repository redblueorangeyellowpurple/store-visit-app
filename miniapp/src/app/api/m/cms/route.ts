import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { listCMsInMarket } from "@/lib/queries";

// GET /api/m/cms — list CMs in the caller's market, used by the follow-up
// assignee picker. Returns name + telegram_id only (no contact details).
export async function GET(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const cms = await listCMsInMarket(cm.market);
  return Response.json({ cms });
}

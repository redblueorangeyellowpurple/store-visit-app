import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { getAllStoresInMarket } from "@/lib/queries";

export async function GET(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });
  const marketFilter = cm.role === "admin" ? null : cm.market;
  const stores = await getAllStoresInMarket(marketFilter, cm.telegram_id);
  return Response.json({ stores });
}

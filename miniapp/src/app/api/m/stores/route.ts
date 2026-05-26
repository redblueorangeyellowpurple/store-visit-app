import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { getAllStoresInMarket } from "@/lib/queries";

export async function GET(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });
  // Every CM can browse stores across all markets (Wilson 2026-05-26 —
  // dropped admin-only gate; aligned with the bot's country-first "Other
  // store" flow).
  const stores = await getAllStoresInMarket(null, cm.telegram_id);
  return Response.json({ stores });
}

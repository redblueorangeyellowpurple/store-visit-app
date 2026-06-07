import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { getOpenFollowUpsForCM } from "@/lib/queries";

// Open follow-ups for the authed CM (or another CM, for elevated roles), used by
// the Stats-tab follow-up list. Read-only — closing happens on the visit screen.
export async function GET(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  let targetId = cm.telegram_id;
  const cmIdRaw = new URL(req.url).searchParams.get("cm_telegram_id")?.trim();
  if (cmIdRaw && cm.role !== "cm") {
    const parsed = Number(cmIdRaw);
    if (Number.isFinite(parsed)) targetId = parsed;
  }

  const followUps = await getOpenFollowUpsForCM(targetId);
  return Response.json({ followUps });
}

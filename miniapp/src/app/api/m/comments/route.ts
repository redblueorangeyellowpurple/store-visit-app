import { authedCMFromRequest } from "@/lib/miniapp-auth";
import { getRecentPhotoCommentsForCM } from "@/lib/queries";

// Recent AM/admin review comments on the authed CM's own visit photos, for the
// Visits-tab "Recent comments" feed. Read-only.
export async function GET(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const comments = await getRecentPhotoCommentsForCM(cm.telegram_id);
  return Response.json({ comments });
}

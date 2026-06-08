import { realCMFromRequest } from "@/lib/miniapp-auth";
import { listAllActiveCMs } from "@/lib/queries";

// Admin "view-as" picker data. Entering/exiting view-as is purely client-side
// (the target id lives in sessionStorage and rides requests as the X-View-As
// header — see the root-layout shim + authedCMFromRequest). This route only
// supplies the list of CMs an admin can choose from, gated off the
// cryptographically-verified caller.
export async function GET(req: Request) {
  const real = await realCMFromRequest(req);
  if (!real) return Response.json({ error: "Not authorised" }, { status: 401 });
  if (real.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const cms = await listAllActiveCMs();
  return Response.json({
    cms: cms.filter((c) => c.telegram_id !== real.telegram_id),
  });
}

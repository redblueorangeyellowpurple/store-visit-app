import { authedCMFromRequest, viewAsReadOnly } from "@/lib/miniapp-auth";
import { updateCMNickname } from "@/lib/queries";

export async function GET(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) {
    return Response.json({ error: "Not authorised" }, { status: 401 });
  }
  return Response.json({
    telegram_id: cm.telegram_id,
    name: cm.full_name,
    nickname: cm.nickname,
    role: cm.role,
    market: cm.market,
    impersonating: !!cm.impersonating,
    real: cm.impersonating
      ? { telegram_id: cm.real_telegram_id, name: cm.real_name }
      : null,
  });
}

export async function PATCH(req: Request) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });
  if (cm.impersonating) return viewAsReadOnly();

  let body: { nickname?: string };
  try { body = await req.json(); } catch { return Response.json({ error: "Bad request" }, { status: 400 }); }

  const nickname = body.nickname?.trim() ?? "";
  if (!nickname || nickname.length > 30) {
    return Response.json({ error: "Nickname must be 1–30 characters" }, { status: 400 });
  }

  const ok = await updateCMNickname(cm.telegram_id, nickname);
  if (!ok) return Response.json({ error: "Failed to update" }, { status: 500 });
  return Response.json({ ok: true });
}

import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getActivePeople } from "@/lib/queries";
import { buildTestRecap } from "@/lib/recap";

// Yesterday in SGT (UTC+8, no DST) as YYYY-MM-DD.
function sgtYesterdayISO(): string {
  const sgt = new Date(Date.now() + 8 * 3600_000 - 24 * 3600_000);
  return sgt.toISOString().slice(0, 10);
}

// Build a sample recap and DM it to the requesting admin only. Optionally builds
// from a chosen CM's data (body.cm_telegram_id) so an AM can preview a real
// field CM's recap. Bypasses the master switch + recipient flag — it's a preview.
export async function POST(req: NextRequest) {
  const user = requireAdmin(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { cm_telegram_id?: number };

  let dataForId = user.id;
  let name = user.first_name || "there";
  if (typeof body.cm_telegram_id === "number") {
    const people = await getActivePeople();
    const cm = people.find((p) => p.telegram_id === body.cm_telegram_id);
    if (!cm) return Response.json({ error: "CM not found" }, { status: 400 });
    dataForId = cm.telegram_id;
    name = cm.nickname || cm.full_name;
  }

  const built = await buildTestRecap(dataForId, name, sgtYesterdayISO());
  if (!built) return Response.json({ error: "Couldn't build the recap" }, { status: 500 });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return Response.json({ error: "Bot token not configured" }, { status: 500 });

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: user.id, text: built.message, parse_mode: "Markdown" }),
    });
    const tgData = (await tgRes.json()) as { ok: boolean; description?: string };
    if (!tgData.ok) {
      return Response.json({ error: tgData.description ?? "Telegram send failed" }, { status: 500 });
    }
    return Response.json({ ok: true, empty: built.empty });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Telegram fetch failed" },
      { status: 500 },
    );
  }
}

import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { AdminMarket, listAlertGroups } from "@/lib/queries";

const MARKETS = new Set<AdminMarket>(["SG", "MY", "TH", "HK"]);

export async function POST(req: NextRequest) {
  const user = requireAdmin(req);
  if (!user) return Response.json({ error: "Not authorised" }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body || !MARKETS.has(body.market)) {
    return Response.json({ error: "invalid market" }, { status: 400 });
  }
  const market = body.market as AdminMarket;

  const groups = await listAlertGroups();
  const row = groups.find((g) => g.market === market);
  if (!row || !row.chat_id) {
    return Response.json({ error: `No chat_id set for ${market}` }, { status: 400 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return Response.json({ error: "Bot token not configured" }, { status: 500 });

  const text =
    `✅ SVA test message for ${market}\n` +
    `Sent by ${user.first_name} from the dashboard Admin tab.\n` +
    `If you see this, alerts for ${market} will land here.`;

  try {
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: row.chat_id, text }),
    });
    const tgData = (await tgRes.json()) as { ok: boolean; description?: string };
    if (!tgData.ok) {
      return Response.json({ error: tgData.description ?? "Telegram send failed" }, { status: 500 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Telegram fetch failed" },
      { status: 500 },
    );
  }
}

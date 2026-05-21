import { authedCMFromRequest } from "@/lib/miniapp-auth";
import {
  getFullVisitForCM,
  lockVisitMA,
  countVisitPhotosMA,
  listFollowUpsForVisitMA,
  getFinalizeContext,
  getBroadcastChatIdMA,
} from "@/lib/queries";
import { sendTelegramMessage } from "@/lib/telegram-send";

// POST /api/m/visit/:id/finalize
// Called by the follow-up page's "Save & Done" button. Saves were already
// applied by /followup (or skipped if no items). This route:
//   1. Locks the visit (idempotent — only locks if still open)
//   2. Sends the "🎉 logged ✓" message to the CM
//   3. Broadcasts the lock to the manager group (if configured)
//
// The bot's follow-up wait loop polls isVisitStillOpen() on every iteration
// and exits silently once this route locks the visit. So this endpoint is
// the single source of truth for finalization when the user takes the
// Save & Done path.

function joinNames(names: string[]): string {
  if (names.length === 0) return "Someone";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function buildDoneKeyboard(visitId: string) {
  // Matches the bot's buildDoneKeyboard in src/bot/conversations/visit-flow.ts
  // exactly — same env-var names, same row layout (Open on row 1,
  // Edit + Delete sharing row 2).
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const shortName = process.env.TELEGRAM_MINIAPP_SHORT_NAME || 'miniapp';
  const rows: { text: string; url?: string; callback_data?: string }[][] = [];
  if (botUsername) {
    const base = `https://t.me/${botUsername}/${shortName}`;
    rows.push([{ text: "📱 Open In Mini-App", url: `${base}?startapp=visit_${visitId}` }]);
    rows.push([
      { text: "🗑️ Delete", callback_data: `delete:${visitId}` },
      { text: "✏️ Edit", url: `${base}?startapp=visit_${visitId}_edit` },
    ]);
  } else {
    rows.push([{ text: "🗑️ Delete", callback_data: `delete:${visitId}` }]);
  }
  return { inline_keyboard: rows };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });

  const { id } = await params;
  const visit = await getFullVisitForCM(cm.telegram_id, id, cm.role);
  if (!visit) return Response.json({ error: "Visit not found" }, { status: 404 });

  // Only CMs on the visit may finalize.
  const isOnVisit = visit.cms.some((c) => c.telegram_id === cm.telegram_id);
  if (!isOnVisit && cm.role === "cm") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Idempotency — if already locked, just return success.
  if (visit.is_locked) {
    return Response.json({ ok: true, alreadyLocked: true });
  }

  const locked = await lockVisitMA(id);
  if (!locked) {
    return Response.json({ error: "Failed to finalize" }, { status: 500 });
  }

  // Gather summary stats + addressing info in parallel.
  const [photoCount, followUps, ctx, broadcastChatId] = await Promise.all([
    countVisitPhotosMA(id),
    listFollowUpsForVisitMA(id),
    getFinalizeContext(id),
    getBroadcastChatIdMA(),
  ]);

  if (!ctx) {
    // Already locked above — log and return success so the user isn't stuck.
    console.error("[finalize] getFinalizeContext returned null for", id);
    return Response.json({ ok: true });
  }

  // ── Done message to the CM (matches the bot's existing format) ─────────
  const photoLine =
    photoCount > 0
      ? `\n📸 ${photoCount} ${photoCount === 1 ? "photo" : "photos"} saved`
      : "";
  const followUpLine =
    followUps.length > 0
      ? `\n✅ ${followUps.length} follow-up${followUps.length === 1 ? "" : "s"}`
      : "";
  const doneText = `🎉 *${ctx.store_name}* logged ✓${photoLine}${followUpLine}`;

  await sendTelegramMessage(ctx.cm_telegram_id, doneText, {
    parse_mode: "Markdown",
    reply_markup: buildDoneKeyboard(id),
  });

  // ── Broadcast to manager group (best-effort) ────────────────────────────
  if (broadcastChatId) {
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    const shortName = process.env.TELEGRAM_MINIAPP_SHORT_NAME || 'miniapp';
    const lead = ctx.cms.find((c) => c.role === "lead");
    const cos = ctx.cms.filter((c) => c.role === "co");
    const allNames = [lead?.name ?? "Someone", ...cos.map((c) => c.name)];
    const storeLabel = ctx.store_chain
      ? `${ctx.store_name} @ ${ctx.store_chain}`
      : ctx.store_name;
    const broadcastText = `✅ ${joinNames(allNames)} visited ${storeLabel}`;
    const broadcastKb = botUsername
      ? {
          inline_keyboard: [
            [
              {
                text: "View visit",
                url: `https://t.me/${botUsername}/${shortName}?startapp=visit_${id}`,
              },
            ],
          ],
        }
      : undefined;
    await sendTelegramMessage(broadcastChatId, broadcastText, {
      reply_markup: broadcastKb,
      link_preview_options: { is_disabled: true },
    });
  }

  return Response.json({
    ok: true,
    photoCount,
    followUpCount: followUps.length,
  });
}

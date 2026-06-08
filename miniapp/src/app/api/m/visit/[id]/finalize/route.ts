import { authedCMFromRequest, viewAsReadOnly } from "@/lib/miniapp-auth";
import {
  getFullVisitForCM,
  lockVisitMA,
  countVisitPhotosMA,
  countTrainedStaffMA,
  listFollowUpsForVisitMA,
  getFinalizeContext,
  getAlertGroupChatIdMA,
  getJoinRequestAdminIdsMA,
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
  // Mirrors src/bot/conversations/visit-flow.ts:buildDoneKeyboard exactly.
  // Row 1: 🔄 Log Another Visit (chain-log). Row 2: 🗑️ Delete + ✏️ Edit.
  const botUsername = process.env.TELEGRAM_BOT_USERNAME;
  const shortName = process.env.TELEGRAM_MINIAPP_SHORT_NAME || 'miniapp';
  const rows: { text: string; url?: string; callback_data?: string }[][] = [];
  rows.push([{ text: "🔄 Log Another Visit", callback_data: `nextvisit:${visitId}` }]);
  const row2: { text: string; url?: string; callback_data?: string }[] = [
    { text: "🗑️ Delete", callback_data: `delete:${visitId}` },
  ];
  if (botUsername) {
    const base = `https://t.me/${botUsername}/${shortName}`;
    row2.push({ text: "✏️ Edit", url: `${base}?startapp=visit_${visitId}_edit` });
  }
  rows.push(row2);
  return { inline_keyboard: rows };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const cm = await authedCMFromRequest(req);
  if (!cm) return Response.json({ error: "Not authorised" }, { status: 401 });
  if (cm.impersonating) return viewAsReadOnly();

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
  const [photoCount, trainedCount, followUps, ctx] = await Promise.all([
    countVisitPhotosMA(id),
    countTrainedStaffMA(id),
    listFollowUpsForVisitMA(id),
    getFinalizeContext(id),
  ]);

  if (!ctx) {
    // Already locked above — log and return success so the user isn't stuck.
    console.error("[finalize] getFinalizeContext returned null for", id);
    return Response.json({ ok: true });
  }

  // ── Done message to the CM (matches the bot's existing format) ─────────
  const photoLine =
    photoCount > 0
      ? `\n📸 ${photoCount} ${photoCount === 1 ? "photo" : "photos"} logged`
      : "";
  const trainingLine =
    trainedCount > 0
      ? `\n🎓 ${trainedCount} training${trainedCount === 1 ? "" : "s"} logged`
      : "";
  const followUpLine =
    followUps.length > 0
      ? `\n✅ ${followUps.length} follow-up${followUps.length === 1 ? "" : "s"} logged`
      : "";
  const doneText = `🎉 *${ctx.store_name}* logged ✓${photoLine}${trainingLine}${followUpLine}`;

  await sendTelegramMessage(ctx.cm_telegram_id, doneText, {
    parse_mode: "Markdown",
    reply_markup: buildDoneKeyboard(id),
  });

  // ── Restore the persistent quick-access reply keyboard (🏪 Log Visit · 🔗 Links).
  // Mirrors src/bot/conversations/visit-flow.ts:762-766 so CMs get the same
  // bottom-of-chat shortcut after a mini-app finalize as after a bot finalize.
  await sendTelegramMessage(ctx.cm_telegram_id, "_Ready for your next visit 👇_", {
    parse_mode: "Markdown",
    reply_markup: {
      keyboard: [[{ text: "🏪 Log Visit" }, { text: "🔗 Links" }]],
      resize_keyboard: true,
      is_persistent: true,
    },
  });

  // ── Broadcast to the per-market alert group (mirrors visit-broadcast.ts) ───
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

  const market = ctx.market;
  const chatId = market ? await getAlertGroupChatIdMA(market) : null;
  if (chatId) {
    await sendTelegramMessage(chatId, broadcastText, {
      reply_markup: broadcastKb,
      link_preview_options: { is_disabled: true },
    });
  } else {
    // No market or no chat_id configured — DM the flagged admins so the
    // broadcast isn't silently dropped. Matches notifyAdmins on the bot side.
    const adminIds = await getJoinRequestAdminIdsMA();
    const dmText = market
      ? `⚠️ Visit locked in ${market} but no alert group is configured for that market. ${broadcastText}`
      : `⚠️ Visit locked but the store has no market set. ${broadcastText}`;
    for (const adminId of adminIds) {
      await sendTelegramMessage(adminId, dmText, {
        reply_markup: broadcastKb,
        link_preview_options: { is_disabled: true },
      });
    }
  }

  return Response.json({
    ok: true,
    photoCount,
    trainedCount,
    followUpCount: followUps.length,
  });
}

import { Api, InlineKeyboard } from 'grammy';
import { supabase } from '../db/client.js';
import { config } from '../config.js';
import { getVisitCMs } from '../db/queries/visit-cms.js';
import { getAlertGroup, Market } from '../db/queries/alert-groups.js';
import { getFullVisit } from '../db/queries/visits.js';
import { listFollowUpsForVisit } from '../db/queries/visit-follow-ups.js';
import { getVisitEngagements } from '../db/queries/staff.js';
import { formatVisitSummaryBody, escapeMd } from '../bot/visit-details.js';
import { notifyAdmins } from './admin-notify.js';
import { storeLabel } from '../utils/store-label.js';

interface BroadcastRow {
  id: string;
  stores: { name: string | null; chain: string | null; market: Market | null } | null;
}

function joinNames(names: string[]): string {
  if (names.length === 0) return 'Someone';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

interface AlertTarget {
  chatId: number;
  threadId: number | null;
}

async function resolveChatId(market: Market | null, botApi: Api): Promise<AlertTarget | null> {
  if (market) {
    const group = await getAlertGroup(market);
    if (group?.chat_id) {
      return { chatId: group.chat_id, threadId: group.message_thread_id ?? null };
    }
    await notifyAdmins(
      botApi,
      `⚠️ Visit locked in ${market} but no alert group is configured for that market. Set a chat in the dashboard Admin tab.`,
    );
    return null;
  }
  await notifyAdmins(
    botApi,
    `⚠️ Visit locked but the store has no market set — can't route the alert. Set a market on the store in the dashboard.`,
  );
  return null;
}

export async function broadcastVisitLocked(
  visitId: string,
  botApi: Api,
): Promise<void> {
  if (!config.broadcast.botUsername) {
    console.log('[broadcast] TELEGRAM_BOT_USERNAME not set — skipping');
    return;
  }

  try {
    const [visitRes, cmRows] = await Promise.all([
      supabase
        .from('visits')
        .select('id, stores(name, chain, market)')
        .eq('id', visitId)
        .single(),
      getVisitCMs(visitId),
    ]);

    if (visitRes.error || !visitRes.data) {
      console.error('[broadcast] visit lookup failed:', visitRes.error);
      return;
    }

    const row = visitRes.data as unknown as BroadcastRow;
    const market = row.stores?.market ?? null;

    const target = await resolveChatId(market, botApi);
    if (!target) {
      console.log(`[broadcast] no chat_id for market ${market ?? '(unknown)'} — admins DM'd, skipping group send`);
      return;
    }
    const { chatId, threadId } = target;

    const lead = cmRows.find((r) => r.role === 'lead');
    const cos = cmRows.filter((r) => r.role === 'co');
    const allNames = [
      lead ? (lead.nickname || lead.full_name) : 'Someone',
      ...cos.map((c) => c.nickname || c.full_name),
    ];
    const namesLabel = joinNames(allNames);

    const storeText = storeLabel(row.stores);

    // Full visit as text (no photos — a media-group per lock is slow/rate-limit-
    // prone and clutters the group; photos live behind the View button). Header
    // line stays plain; the body is Markdown.
    const [fullVisit, followUps, engagedPeople] = await Promise.all([
      getFullVisit(visitId),
      listFollowUpsForVisit(visitId),
      getVisitEngagements(visitId),
    ]);

    const header = `✅ *${escapeMd(namesLabel)}* visited *${escapeMd(storeText)}*`;
    const text = fullVisit
      ? `${header}\n\n${formatVisitSummaryBody(fullVisit, followUps, engagedPeople)}`
      : header;

    const deepLink =
      `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}` +
      `?startapp=visit_${visitId}`;

    const opts = {
      parse_mode: 'Markdown' as const,
      reply_markup: new InlineKeyboard().url('📷 View full visit', deepLink),
      link_preview_options: { is_disabled: true },
    };

    try {
      await botApi.sendMessage(chatId, text, {
        ...opts,
        ...(threadId != null ? { message_thread_id: threadId } : {}),
      });
    } catch (err) {
      // A stale/deleted topic returns 400 "message thread not found" — don't let
      // it silently kill the broadcast; retry into the group's General topic.
      if (threadId != null && isThreadNotFound(err)) {
        console.warn(`[broadcast] thread ${threadId} not found for chat ${chatId} — falling back to General`);
        await botApi.sendMessage(chatId, text, opts);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[broadcast] failed:', err);
  }
}

function isThreadNotFound(err: unknown): boolean {
  const desc = (err as { description?: string } | null)?.description ?? '';
  return /thread not found/i.test(desc);
}

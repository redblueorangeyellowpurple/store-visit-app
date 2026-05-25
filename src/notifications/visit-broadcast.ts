import { Api, InlineKeyboard } from 'grammy';
import { supabase } from '../db/client.js';
import { config } from '../config.js';
import { getVisitCMs } from '../db/queries/visit-cms.js';
import { getAlertGroup, Market } from '../db/queries/alert-groups.js';
import { notifyAdmins } from './admin-notify.js';

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

async function resolveChatId(market: Market | null, botApi: Api): Promise<number | null> {
  if (market) {
    const group = await getAlertGroup(market);
    if (group?.chat_id) return group.chat_id;
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

    const chatId = await resolveChatId(market, botApi);
    if (!chatId) {
      console.log(`[broadcast] no chat_id for market ${market ?? '(unknown)'} — admins DM'd, skipping group send`);
      return;
    }

    const lead = cmRows.find((r) => r.role === 'lead');
    const cos = cmRows.filter((r) => r.role === 'co');
    const allNames = [
      lead ? (lead.nickname || lead.full_name) : 'Someone',
      ...cos.map((c) => c.nickname || c.full_name),
    ];
    const namesLabel = joinNames(allNames);

    const storeName = row.stores?.name ?? 'a store';
    const storeChain = row.stores?.chain;
    const storeLabel = storeChain ? `${storeName} @ ${storeChain}` : storeName;

    const text = `✅ ${namesLabel} visited ${storeLabel}`;
    const deepLink =
      `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}` +
      `?startapp=visit_${visitId}`;

    await botApi.sendMessage(chatId, text, {
      reply_markup: new InlineKeyboard().url('View visit', deepLink),
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    console.error('[broadcast] failed:', err);
  }
}

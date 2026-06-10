// Feature test for the intel inbox: injects synthetic Telegram updates into the
// bot (no token, no network — the Telegram API is stubbed via a transformer)
// while writing through to the REAL promotchi schema, then cleans up after
// itself. Run with `npm run inbox:test`.
//
// Walks the full flow: owner gate → forward capture → store search + pick +
// alias teach → promoter rename → date + shift set → done → alias auto-resolve
// on a second forward → discard.
import 'dotenv/config';
import type { Update, UserFromGetMe } from 'grammy/types';
import { createClient } from '@supabase/supabase-js';
import { buildBot } from './bot.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('[test-drive] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in tc-sva-bot/.env — cannot run.');
  process.exit(1);
}

const OWNER = Number(process.env.INTEL_OWNER_ID ?? '806982232');
const LABEL = 'ZZTEST'; // header shorthand that matches no real store
const promotchi = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'promotchi' },
});

const bot = buildBot({
  token: 'test:not-a-real-token',
  ownerId: OWNER,
  supabaseUrl: url,
  supabaseServiceRoleKey: key,
  botInfo: {
    id: 1,
    is_bot: true,
    first_name: 'Intel Inbox (test)',
    username: 'intel_inbox_test_bot',
    can_join_groups: false,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
  } as UserFromGetMe,
});

// Stub every outgoing Telegram call; record it so steps can inspect what the
// bot tried to send (cards, pickers, prompts, edits).
interface Sent {
  method: string;
  payload: Record<string, unknown>;
  resultId?: number;
}
const outbox: Sent[] = [];
let nextMsgId = 5000;
bot.api.config.use(async (_prev, method, payload) => {
  const entry: Sent = { method, payload: payload as Record<string, unknown> };
  let result: unknown = true;
  if (method === 'sendMessage') {
    const p = payload as { chat_id: number; text: string };
    entry.resultId = ++nextMsgId;
    result = { message_id: nextMsgId, date: Math.floor(Date.now() / 1000), chat: { id: p.chat_id, type: 'private' }, text: p.text };
  }
  outbox.push(entry);
  return { ok: true, result } as never;
});

// ── Update factories ───────────────────────────────────────────────────────

let updateSeq = 0;
let inMsgId = 100;
const chat = { id: OWNER, type: 'private' as const };
const wilson = { id: OWNER, is_bot: false, first_name: 'Wilson' };

function forward(text: string, senderName: string, sentAt: Date, fromUser = wilson): Update {
  return {
    update_id: ++updateSeq,
    message: {
      message_id: ++inMsgId,
      date: Math.floor(Date.now() / 1000),
      chat,
      from: fromUser,
      text,
      forward_origin: { type: 'hidden_user', sender_user_name: senderName, date: Math.floor(sentAt.getTime() / 1000) },
    },
  } as Update;
}

function textMsg(text: string): Update {
  return {
    update_id: ++updateSeq,
    message: { message_id: ++inMsgId, date: Math.floor(Date.now() / 1000), chat, from: wilson, text },
  } as Update;
}

function tap(data: string, onMessageId: number): Update {
  return {
    update_id: ++updateSeq,
    callback_query: {
      id: String(updateSeq),
      from: wilson,
      chat_instance: 'test',
      message: { message_id: onMessageId, date: Math.floor(Date.now() / 1000), chat, text: '·' },
      data,
    },
  } as Update;
}

// ── Assertions ─────────────────────────────────────────────────────────────

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`  ${cond ? '✓' : '✗ FAIL:'} ${name}${cond || !extra ? '' : ` — ${extra}`}`);
  if (!cond) failures++;
}

function lastSend(textIncludes?: string): Sent | undefined {
  for (let i = outbox.length - 1; i >= 0; i--) {
    const e = outbox[i];
    if (e.method !== 'sendMessage') continue;
    if (!textIncludes || String(e.payload.text).includes(textIncludes)) return e;
  }
  return undefined;
}

async function fetchRow(id: string): Promise<Record<string, unknown> | null> {
  const { data } = await promotchi.from('intel_updates').select('*').eq('id', id).maybeSingle();
  return data;
}

async function cleanup(): Promise<void> {
  await promotchi.from('intel_updates').delete().eq('store_label', LABEL);
  await promotchi.from('intel_store_aliases').delete().eq('alias', LABEL.toLowerCase());
}

// ── Scenario ───────────────────────────────────────────────────────────────

const SAMPLE = [
  `TestPromoter/${LABEL}`,
  '3pm: Customer looking at Marshall home speaker with FM radio, pitched Stanmore III but no FM — left to compare',
  '5pm: Couple upgrading Liberty 5 Pro, found Shopee cheaper, will think about it',
].join('\n');

async function main(): Promise<void> {
  await cleanup(); // clear leftovers from any earlier crashed run

  console.log('0. Owner gate');
  const before = outbox.length;
  await bot.handleUpdate(forward(`Intruder/${LABEL}`, 'Mallory', new Date(), { id: 999, is_bot: false, first_name: 'Mallory' }));
  check('non-owner forward is ignored (no reply, no row)', outbox.length === before);

  console.log('1. Forward capture');
  const sentAt = new Date('2026-06-08T14:00:00+08:00');
  await bot.handleUpdate(forward(SAMPLE, 'Adena ✨', sentAt));
  const { data: rows } = await promotchi.from('intel_updates').select('*').eq('store_label', LABEL);
  check('one row inserted', rows?.length === 1, `got ${rows?.length}`);
  const row = rows![0];
  const id = row.id as string;
  check('promoter from header', row.promoter_name === 'TestPromoter', String(row.promoter_name));
  check('store unresolved (no alias yet)', row.store_id === null);
  check('shift_date from forward_origin (SGT)', row.shift_date === '2026-06-08', String(row.shift_date));
  check('raw_content intact', row.raw_content === SAMPLE);
  check('submitted_at preserved', new Date(row.submitted_at as string).getTime() === sentAt.getTime());
  const card = lastSend('Promoter update logged');
  check('card sent with tag buttons', !!card?.resultId);
  const cardId = card!.resultId!;

  console.log('2. Store: no match → typed search → pick → alias taught');
  await bot.handleUpdate(tap(`st:${id}`, cardId));
  check('asked to type a store name', !!lastSend('Reply with part of the store name'));
  await bot.handleUpdate(textMsg('causeway'));
  const picker = lastSend('Which store?');
  const kb = (picker?.payload.reply_markup as { inline_keyboard?: { text: string; callback_data: string }[][] })?.inline_keyboard;
  const firstPick = kb?.[0]?.[0];
  check('picker shows candidates', !!firstPick?.callback_data.startsWith(`pk:${id}:`), JSON.stringify(kb?.map((r) => r[0]?.text)));
  await bot.handleUpdate(tap(firstPick!.callback_data, picker!.resultId!));
  const afterPick = await fetchRow(id);
  check(`store set (picked “${firstPick!.text}”)`, afterPick?.store_id != null);
  const { data: alias } = await promotchi.from('intel_store_aliases').select('*').eq('alias', LABEL.toLowerCase()).maybeSingle();
  check('alias taught zztest → picked store', alias?.store_id === afterPick?.store_id);
  check('picker cleaned up', outbox.some((e) => e.method === 'deleteMessage'));
  check('card re-rendered with store', outbox.some((e) => e.method === 'editMessageText' && (e.payload.message_id as number) === cardId));

  console.log('3. Promoter rename');
  await bot.handleUpdate(tap(`pr:${id}`, cardId));
  await bot.handleUpdate(textMsg('Adena Test'));
  check('promoter updated', (await fetchRow(id))?.promoter_name === 'Adena Test');

  console.log('4. Date + shift');
  await bot.handleUpdate(tap(`dt:${id}`, cardId));
  await bot.handleUpdate(tap(`ds:${id}:2026-06-07`, cardId));
  check('shift_date updated via picker', (await fetchRow(id))?.shift_date === '2026-06-07');
  await bot.handleUpdate(tap(`dx:${id}`, cardId));
  await bot.handleUpdate(textMsg('8 jun'));
  check('typed “8 jun” parses', (await fetchRow(id))?.shift_date === '2026-06-08');
  await bot.handleUpdate(tap(`sh:${id}`, cardId));
  await bot.handleUpdate(tap(`sx:${id}:PM`, cardId));
  check('shift_type = PM', (await fetchRow(id))?.shift_type === 'PM');

  console.log('5. Done');
  await bot.handleUpdate(tap(`dn:${id}`, cardId));
  check('card finalised', outbox.some((e) => e.method === 'editMessageText' && String(e.payload.text).includes('saved')));

  console.log('6. Second forward auto-resolves via learned alias');
  await bot.handleUpdate(forward(`TestPromoter/${LABEL}\nQuiet PM, mostly browsers`, 'Adena ✨', new Date()));
  const { data: rows2 } = await promotchi
    .from('intel_updates')
    .select('*')
    .eq('store_label', LABEL)
    .order('created_at', { ascending: false });
  const row2 = rows2![0];
  check('second row inserted', rows2?.length === 2, `got ${rows2?.length}`);
  check('store auto-filled from alias', row2.store_id === afterPick?.store_id);

  console.log('7. Discard (two-step)');
  const card2 = lastSend('Promoter update logged')!;
  await bot.handleUpdate(tap(`dl:${row2.id}`, card2.resultId!));
  await bot.handleUpdate(tap(`dy:${row2.id}`, card2.resultId!));
  check('row deleted', (await fetchRow(row2.id as string)) === null);

  console.log(failures === 0 ? '\nAll checks passed ✅' : `\n${failures} check(s) FAILED ❌`);
}

main()
  .catch((e) => {
    failures++;
    console.error('[test-drive] crashed:', e);
  })
  .finally(async () => {
    await cleanup();
    process.exit(failures === 0 ? 0 : 1);
  });

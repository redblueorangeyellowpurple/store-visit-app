// Intel Inbox — local-only Telegram bot for capturing promoter store updates.
//
// Wilson forwards promoter messages from the group chat; each forward is locked
// into promotchi.intel_updates immediately, then tagged (store / promoter /
// date / shift) via inline buttons. The store picker teaches
// promotchi.intel_store_aliases ("CWP" → Challenger @ Causeway Point) so later
// forwards auto-resolve. No AI here — the 7am intelligence routine parses
// raw_content into intel_interactions later.
//
// Runs on Wilson's Mac via `npm run inbox` (long polling — no webhook, no
// Railway). Telegram queues undelivered updates ~24h, so forwards sent while
// the bot is offline are picked up on next start.

import { Bot, Context, InlineKeyboard } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { createClient } from '@supabase/supabase-js';

export interface InboxOptions {
  token: string;
  ownerId: number;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Preset by the test harness so the bot never calls getMe. */
  botInfo?: UserFromGetMe;
}

interface IntelUpdate {
  id: string;
  promoter_name: string | null;
  store_label: string | null;
  store_id: string | null;
  shift_date: string | null;
  shift_type: string | null;
  raw_content: string;
  submitted_at: string | null;
}

interface StoreOption {
  id: string;
  name: string;
  market: string;
}

interface CardSession {
  chatId: number;
  cardMessageId: number;
  candidates?: StoreOption[];
  pickerMessageId?: number;
}

type AwaitingField = 'store' | 'promoter' | 'date';

const SGT = 'Asia/Singapore';
const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit' });
const labelFmt = new Intl.DateTimeFormat('en-GB', { timeZone: SGT, weekday: 'short', day: 'numeric', month: 'short' });

function sgtDateISO(d: Date): string {
  return isoFmt.format(d);
}

function dateLabel(iso: string): string {
  return labelFmt.format(new Date(`${iso}T12:00:00+08:00`)).replace(',', '');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** "Adena/CWP" header → { name: "Adena", label: "CWP" }. Orientation is a guess;
 *  the alias lookup in handleForward corrects a swapped "CWP/Adena". */
function guessFromHeader(text: string): { name?: string; label?: string } {
  const first = text.split('\n', 1)[0].trim();
  if (first.length > 60 || !first.includes('/')) return {};
  const parts = first.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return {};
  return { name: parts[0], label: parts[1] };
}

/** \b keeps "5pm"-style times from matching — only standalone AM/PM/FD markers. */
function guessShift(text: string): 'AM' | 'PM' | 'FD' | null {
  const first = text.split('\n', 1)[0];
  if (/\bfull\s?day\b|\bfd\b/i.test(first)) return 'FD';
  const m = first.match(/\b(am|pm)\b/i);
  return m ? (m[1].toUpperCase() as 'AM' | 'PM') : null;
}

function parseTypedDate(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (t === 'today') return sgtDateISO(new Date());
  if (t === 'yesterday') return sgtDateISO(new Date(Date.now() - 86_400_000));
  const year = sgtDateISO(new Date()).slice(0, 4);
  const parsed = new Date(`${t} ${year}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return sgtDateISO(parsed);
}

export function buildBot(opts: InboxOptions): Bot {
  const clientOpts = { auth: { autoRefreshToken: false, persistSession: false } };
  const promotchi = createClient(opts.supabaseUrl, opts.supabaseServiceRoleKey, {
    ...clientOpts,
    db: { schema: 'promotchi' },
  });
  const sva = createClient(opts.supabaseUrl, opts.supabaseServiceRoleKey, {
    ...clientOpts,
    db: { schema: 'sva' },
  });

  const bot = new Bot(opts.token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  const sessions = new Map<string, CardSession>(); // updateId → card state (in-memory; buttons degrade gracefully after restart)
  const awaiting = new Map<number, { updateId: string; field: AwaitingField }>(); // chatId → pending text input

  // ── DB helpers ──────────────────────────────────────────────────────────

  async function fetchUpdate(id: string): Promise<IntelUpdate | null> {
    const { data } = await promotchi.from('intel_updates').select('*').eq('id', id).maybeSingle();
    return (data as IntelUpdate | null) ?? null;
  }

  async function patchUpdate(id: string, patch: Record<string, unknown>): Promise<void> {
    const { error } = await promotchi.from('intel_updates').update(patch).eq('id', id);
    if (error) throw new Error(`intel_updates update failed: ${error.message}`);
  }

  async function aliasLookup(label: string): Promise<string | null> {
    const { data } = await promotchi
      .from('intel_store_aliases')
      .select('store_id')
      .eq('alias', label.toLowerCase())
      .maybeSingle();
    return data?.store_id ?? null;
  }

  async function teachAlias(label: string, storeId: string): Promise<void> {
    await promotchi
      .from('intel_store_aliases')
      .upsert({ alias: label.toLowerCase(), store_id: storeId }, { onConflict: 'alias' });
  }

  async function searchStores(term: string): Promise<StoreOption[]> {
    const { data } = await sva
      .from('stores')
      .select('id,name,market')
      .eq('is_active', true)
      .ilike('name', `%${term}%`)
      .order('name')
      .limit(8);
    return (data as StoreOption[] | null) ?? [];
  }

  async function storeNameById(id: string): Promise<string | null> {
    const { data } = await sva.from('stores').select('name').eq('id', id).maybeSingle();
    return data?.name ?? null;
  }

  // ── Card rendering ──────────────────────────────────────────────────────

  async function cardText(u: IntelUpdate, header = '📥 <b>Promoter update logged</b>'): Promise<string> {
    const storeName = u.store_id ? await storeNameById(u.store_id) : null;
    const storeLine = storeName
      ? escapeHtml(storeName)
      : u.store_label
        ? `❓ “${escapeHtml(u.store_label)}” — tap Store to match`
        : '❓ tap Store to set';
    const promoterLine = u.promoter_name ? escapeHtml(u.promoter_name) : '❓ tap Promoter to set';
    const dateLine = `${u.shift_date ? dateLabel(u.shift_date) : '❓'} · ${u.shift_type ?? '—'}`;
    return [
      header,
      '',
      `🏬 ${storeLine}`,
      `👤 ${promoterLine}`,
      `📅 ${dateLine}`,
      `📝 ${u.raw_content.length} chars captured`,
    ].join('\n');
  }

  function cardKeyboard(id: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('🏬 Store', `st:${id}`)
      .text('👤 Promoter', `pr:${id}`)
      .row()
      .text('📅 Date', `dt:${id}`)
      .text('⏰ Shift', `sh:${id}`)
      .row()
      .text('✅ Done', `dn:${id}`)
      .text('🗑 Discard', `dl:${id}`);
  }

  function dateKeyboard(id: string): InlineKeyboard {
    const kb = new InlineKeyboard();
    const prefixes = ['Today · ', 'Yesterday · ', '', ''];
    for (let i = 0; i < 4; i++) {
      const iso = sgtDateISO(new Date(Date.now() - i * 86_400_000));
      kb.text(`${prefixes[i]}${dateLabel(iso)}`, `ds:${id}:${iso}`);
      if (i % 2 === 1) kb.row();
    }
    kb.text('⌨️ Type a date', `dx:${id}`).text('↩ Back', `bk:${id}`);
    return kb;
  }

  function shiftKeyboard(id: string): InlineKeyboard {
    return new InlineKeyboard()
      .text('AM', `sx:${id}:AM`)
      .text('PM', `sx:${id}:PM`)
      .text('FD', `sx:${id}:FD`)
      .row()
      .text('— clear', `sx:${id}:-`)
      .text('↩ Back', `bk:${id}`);
  }

  function discardKeyboard(id: string): InlineKeyboard {
    return new InlineKeyboard().text('🗑 Yes, delete', `dy:${id}`).text('↩ Back', `bk:${id}`);
  }

  function pickerKeyboard(id: string, candidates: StoreOption[]): InlineKeyboard {
    const kb = new InlineKeyboard();
    candidates.forEach((c, i) => kb.text(`${c.name} (${c.market})`, `pk:${id}:${i}`).row());
    return kb.text('🔎 Type to search', `ss:${id}`).text('✖️ Cancel', `px:${id}`);
  }

  /** Card callbacks know their own message; keep the session pointed at it so
   *  later out-of-band edits (typed replies, picker picks) can find the card. */
  function touchSession(id: string, ctx: Context): CardSession {
    const existing = sessions.get(id);
    const session: CardSession = {
      ...existing,
      chatId: ctx.chat?.id ?? existing?.chatId ?? opts.ownerId,
      cardMessageId: ctx.callbackQuery?.message?.message_id ?? existing?.cardMessageId ?? 0,
    };
    sessions.set(id, session);
    return session;
  }

  /** Re-render the card from outside its own callback (typed input / picker pick). */
  async function rerenderCard(id: string): Promise<boolean> {
    const session = sessions.get(id);
    if (!session?.cardMessageId) return false;
    const u = await fetchUpdate(id);
    if (!u) return false;
    try {
      await bot.api.editMessageText(session.chatId, session.cardMessageId, await cardText(u), {
        parse_mode: 'HTML',
        reply_markup: cardKeyboard(id),
      });
      return true;
    } catch {
      return false; // "message is not modified" or card too old — row is updated either way
    }
  }

  async function expired(ctx: Context): Promise<void> {
    await ctx.answerCallbackQuery({ text: 'This update no longer exists — forward it again.' });
    try {
      await ctx.editMessageReplyMarkup();
    } catch {
      /* keyboard already gone */
    }
  }

  async function deletePicker(id: string): Promise<void> {
    const session = sessions.get(id);
    if (!session?.pickerMessageId) return;
    try {
      await bot.api.deleteMessage(session.chatId, session.pickerMessageId);
    } catch {
      /* already deleted */
    }
    session.pickerMessageId = undefined;
  }

  async function showPicker(id: string, chatId: number, candidates: StoreOption[]): Promise<void> {
    const session = sessions.get(id) ?? { chatId, cardMessageId: 0 };
    session.candidates = candidates;
    sessions.set(id, session);
    await deletePicker(id); // never leave two pickers alive for one card
    const sent = await bot.api.sendMessage(chatId, '🏬 Which store?', {
      reply_markup: pickerKeyboard(id, candidates),
    });
    session.pickerMessageId = sent.message_id;
  }

  // ── Owner gate — everyone else is silently ignored ──────────────────────

  bot.use((ctx, next) => {
    if (ctx.from?.id !== opts.ownerId) return;
    return next();
  });

  // ── Commands ────────────────────────────────────────────────────────────

  const HELP = [
    '📥 <b>Intel Inbox</b> — promoter update capture',
    '',
    'Forward me promoter store updates from the group chat. Each one is saved immediately, then you tag it with the buttons:',
    '',
    '🏬 Store — picker learns shorthand (CWP → Challenger @ Causeway Point): teach once, auto-fills forever',
    '👤 Promoter — defaults to the original sender’s name or the “Name/Store” header',
    '📅 Date · ⏰ Shift — default to the day the promoter sent the message',
    '',
    'Photos aren’t stored — text and captions only. Rows land in promotchi.intel_updates; the 7am routine extracts the customer-level insights later.',
    '',
    'I only need to be running when you forward — Telegram queues forwards for ~24h while I’m offline.',
  ].join('\n');

  bot.command(['start', 'help'], (ctx) => ctx.reply(HELP, { parse_mode: 'HTML' }));

  // ── Capture: any forwarded message ──────────────────────────────────────

  async function handleForward(ctx: Context): Promise<void> {
    const msg = ctx.message!;
    const text = msg.text ?? msg.caption;
    if (!text?.trim()) {
      await ctx.reply('⚠️ That forward has no text or caption — nothing captured.');
      return;
    }
    awaiting.delete(msg.chat.id); // a new forward supersedes any pending prompt

    const fo = msg.forward_origin!;
    const submittedAt = new Date(fo.date * 1000);
    const originName =
      fo.type === 'user'
        ? [fo.sender_user.first_name, fo.sender_user.last_name].filter(Boolean).join(' ')
        : fo.type === 'hidden_user'
          ? fo.sender_user_name
          : null;

    const header = guessFromHeader(text);
    let promoterName = header.name ?? originName ?? null;
    let storeLabel = header.label ?? null;
    let storeId: string | null = null;

    if (header.name && header.label) {
      storeId = await aliasLookup(header.label);
      if (!storeId) {
        const swapped = await aliasLookup(header.name);
        if (swapped) {
          // Header was "CWP/Adena" — the alias side is the store
          storeId = swapped;
          storeLabel = header.name;
          promoterName = header.label;
        }
      }
    }
    if (!storeId && storeLabel) {
      // Unambiguous direct hit (e.g. "bugis" → exactly one active store) auto-fills,
      // but aliases are only taught on an explicit pick.
      const matches = await searchStores(storeLabel);
      if (matches.length === 1) storeId = matches[0].id;
    }

    const { data, error } = await promotchi
      .from('intel_updates')
      .insert({
        promoter_name: promoterName,
        store_label: storeLabel,
        store_id: storeId,
        shift_date: sgtDateISO(submittedAt),
        shift_type: guessShift(text),
        raw_content: text,
        source: 'forwarded',
        submitted_at: submittedAt.toISOString(),
      })
      .select('*')
      .single();
    if (error || !data) {
      await ctx.reply(`⚠️ Couldn’t save that update: ${escapeHtml(error?.message ?? 'unknown error')}`, {
        parse_mode: 'HTML',
      });
      return;
    }

    const u = data as IntelUpdate;
    const sent = await ctx.reply(await cardText(u), { parse_mode: 'HTML', reply_markup: cardKeyboard(u.id) });
    sessions.set(u.id, { chatId: msg.chat.id, cardMessageId: sent.message_id });
  }

  // ── Card buttons ────────────────────────────────────────────────────────

  bot.callbackQuery(/^st:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    const session = touchSession(id, ctx);
    const u = await fetchUpdate(id);
    if (!u) return expired(ctx);
    await ctx.answerCallbackQuery();
    const candidates = u.store_label ? await searchStores(u.store_label) : [];
    if (candidates.length > 0) {
      await showPicker(id, session.chatId, candidates);
    } else {
      awaiting.set(session.chatId, { updateId: id, field: 'store' });
      await ctx.reply(
        `Reply with part of the store name${u.store_label ? ` for “${escapeHtml(u.store_label)}”` : ''} — e.g. <i>causeway</i>`,
        { parse_mode: 'HTML' },
      );
    }
  });

  bot.callbackQuery(/^pk:(.+):(\d+)$/, async (ctx) => {
    const m = ctx.match as RegExpMatchArray;
    const id = m[1];
    const session = sessions.get(id);
    const store = session?.candidates?.[Number(m[2])];
    if (!session || !store) {
      await ctx.answerCallbackQuery({ text: 'Picker expired — tap Store again.' });
      return;
    }
    const u = await fetchUpdate(id);
    if (!u) return expired(ctx);
    await patchUpdate(id, { store_id: store.id });
    if (u.store_label) await teachAlias(u.store_label, store.id);
    await ctx.answerCallbackQuery({
      text: u.store_label ? `Learned: ${u.store_label.toLowerCase()} → ${store.name}` : `✓ ${store.name}`,
    });
    await deletePicker(id);
    await rerenderCard(id);
  });

  bot.callbackQuery(/^ss:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    const session = sessions.get(id);
    if (!session) {
      await ctx.answerCallbackQuery({ text: 'Picker expired — tap Store again.' });
      return;
    }
    awaiting.set(session.chatId, { updateId: id, field: 'store' });
    await ctx.answerCallbackQuery();
    await deletePicker(id);
    await ctx.reply('Reply with part of the store name — e.g. <i>causeway</i>', { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^px:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    await ctx.answerCallbackQuery();
    await deletePicker(id);
  });

  bot.callbackQuery(/^pr:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    const session = touchSession(id, ctx);
    if (!(await fetchUpdate(id))) return expired(ctx);
    awaiting.set(session.chatId, { updateId: id, field: 'promoter' });
    await ctx.answerCallbackQuery();
    await ctx.reply('Reply with the promoter’s name.');
  });

  bot.callbackQuery(/^dt:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    touchSession(id, ctx);
    if (!(await fetchUpdate(id))) return expired(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: dateKeyboard(id) });
  });

  bot.callbackQuery(/^ds:(.+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
    const m = ctx.match as RegExpMatchArray;
    const id = m[1];
    touchSession(id, ctx);
    const u = await fetchUpdate(id);
    if (!u) return expired(ctx);
    await patchUpdate(id, { shift_date: m[2] });
    await ctx.answerCallbackQuery({ text: `✓ ${dateLabel(m[2])}` });
    u.shift_date = m[2];
    await ctx.editMessageText(await cardText(u), { parse_mode: 'HTML', reply_markup: cardKeyboard(id) });
  });

  bot.callbackQuery(/^dx:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    const session = touchSession(id, ctx);
    if (!(await fetchUpdate(id))) return expired(ctx);
    awaiting.set(session.chatId, { updateId: id, field: 'date' });
    await ctx.answerCallbackQuery();
    await ctx.reply('Reply with a date — <code>2026-06-08</code> or <code>8 jun</code>', { parse_mode: 'HTML' });
  });

  bot.callbackQuery(/^sh:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    touchSession(id, ctx);
    if (!(await fetchUpdate(id))) return expired(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: shiftKeyboard(id) });
  });

  bot.callbackQuery(/^sx:(.+):(AM|PM|FD|-)$/, async (ctx) => {
    const m = ctx.match as RegExpMatchArray;
    const id = m[1];
    touchSession(id, ctx);
    const u = await fetchUpdate(id);
    if (!u) return expired(ctx);
    const shift = m[2] === '-' ? null : m[2];
    await patchUpdate(id, { shift_type: shift });
    await ctx.answerCallbackQuery({ text: shift ? `✓ ${shift}` : '✓ cleared' });
    u.shift_type = shift;
    await ctx.editMessageText(await cardText(u), { parse_mode: 'HTML', reply_markup: cardKeyboard(id) });
  });

  bot.callbackQuery(/^dn:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    const u = await fetchUpdate(id);
    if (!u) return expired(ctx);
    await ctx.answerCallbackQuery({ text: '✓ Saved' });
    await ctx.editMessageText(await cardText(u, '✅ <b>Promoter update saved</b>'), { parse_mode: 'HTML' });
    await deletePicker(id);
    sessions.delete(id);
  });

  bot.callbackQuery(/^dl:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    touchSession(id, ctx);
    if (!(await fetchUpdate(id))) return expired(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: discardKeyboard(id) });
  });

  bot.callbackQuery(/^dy:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    const { error } = await promotchi.from('intel_updates').delete().eq('id', id);
    if (error) {
      await ctx.answerCallbackQuery({ text: `⚠️ ${error.message}` });
      return;
    }
    await ctx.answerCallbackQuery({ text: '🗑 Discarded' });
    await ctx.editMessageText('🗑 Discarded — forward it again anytime.');
    await deletePicker(id);
    sessions.delete(id);
  });

  bot.callbackQuery(/^bk:(.+)$/, async (ctx) => {
    const id = (ctx.match as RegExpMatchArray)[1];
    touchSession(id, ctx);
    const u = await fetchUpdate(id);
    if (!u) return expired(ctx);
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(await cardText(u), { parse_mode: 'HTML', reply_markup: cardKeyboard(id) });
  });

  // ── Plain messages: forwards capture, replies feed pending prompts ──────

  bot.on('message', async (ctx) => {
    const msg = ctx.message;
    if (msg.forward_origin) return handleForward(ctx);
    const text = msg.text?.trim();
    if (!text) return; // stickers, photos sent directly, etc.

    const wait = awaiting.get(msg.chat.id);
    if (!wait) {
      await ctx.reply('Forward me a promoter store update to capture it. /help');
      return;
    }

    if (wait.field === 'store') {
      const candidates = await searchStores(text);
      if (candidates.length === 0) {
        await ctx.reply(`No active stores matching “${escapeHtml(text)}” — try another word.`, { parse_mode: 'HTML' });
        return; // keep awaiting
      }
      awaiting.delete(msg.chat.id);
      await showPicker(wait.updateId, msg.chat.id, candidates);
      return;
    }

    if (wait.field === 'promoter') {
      awaiting.delete(msg.chat.id);
      await patchUpdate(wait.updateId, { promoter_name: text });
    } else {
      const iso = parseTypedDate(text);
      if (!iso) {
        await ctx.reply('Couldn’t read that date — try <code>2026-06-08</code> or <code>8 jun</code>', {
          parse_mode: 'HTML',
        });
        return; // keep awaiting
      }
      awaiting.delete(msg.chat.id);
      await patchUpdate(wait.updateId, { shift_date: iso });
    }

    const rendered = await rerenderCard(wait.updateId);
    if (rendered) {
      await ctx.react('👍').catch(() => {});
    } else {
      await ctx.reply('✓ Updated.');
    }
  });

  bot.catch((err) => {
    console.error('[intel-inbox] handler error:', err.error);
  });

  return bot;
}

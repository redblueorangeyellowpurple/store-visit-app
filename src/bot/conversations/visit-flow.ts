import { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard, Keyboard } from 'grammy';
import { BotContext } from '../middleware/auth.js';
import { QUICK_ACCESS_KEYBOARD } from '../commands/start.js';
import { getStoresForCM } from '../../db/queries/stores.js';
import {
  searchStoresByName,
  getStoreById,
  getChannelsInMarket,
  getStoresByMarketAndChain,
} from '../../db/queries/stores.js';
import {
  createVisit,
  isVisitStillOpen,
  lockVisit,
  persistVisitSection,
  getFullVisit,
  getLastVisitDatePerStore,
  V2_PROMPT_COLUMN,
  type V2PromptKey,
  type Visit,
} from '../../db/queries/visits.js';
import { deletePhotosBySection } from '../../db/queries/photos.js';
import { countTrainedStaff } from '../../db/queries/staff.js';
import { setVisitCMs } from '../../db/queries/visit-cms.js';
import { getActivePlan, consumePlan } from '../../db/queries/visit-plans.js';
import {
  listFollowUpsForVisit,
  listOpenFollowUpsForStore,
  markFollowUpDone,
  type VisitFollowUp,
} from '../../db/queries/visit-follow-ups.js';
import {
  buildStorePicker,
  buildStoreContextMessage,
  buildCountryPicker,
  buildChannelPicker,
  buildChannelStorePicker,
  buildCountrySearchResultsPicker,
  countryLabel,
} from '../keyboards/store-picker.js';
import {
  startPhotoCollection,
  handleIncomingPhoto,
  setActiveSection,
  awaitPhotoUpload,
  hasPendingUploads,
  adjustSavedCount,
  discardPhotoCollection,
  getBotApi,
} from '../photo-collection.js';
import { sendVisitDetails } from '../visit-details.js';
import { broadcastVisitLocked } from '../../notifications/visit-broadcast.js';
import { config } from '../../config.js';
import { withTimeout } from '../../utils/timeout.js';
import type { SectionKey } from '../../db/queries/photos.js';

type VisitConversation = Conversation<BotContext, BotContext>;

interface PromptDef {
  key: V2PromptKey;
  emoji: string;
  question: string;
  cue: string;
  // Optional italic line rendered at the bottom of the prompt, ABOVE the
  // standardised photo nudge. Used by People & Training to point at the
  // Log Training deep-link button.
  footerHint?: string;
  bullets: string[];
  showTrainingButton?: boolean;
}

// Bullets stay short — leading questions, not literal examples — so they
// invite recall instead of pattern-matching. Each prompt aligns to one
// intelligence pillar:
//   • Good News & Wins   → cross-cutting; warms the CM up
//   • People & Training  → People (heart of CMs)
//   • Competitors & Market → Competitor analysis
//   • Display & Stock     → Market / Store
// formatPrompt appends a standardised "Add a photo at any time" italic line
// at the bottom of every prompt. Per-question footerHint sits above it for
// extras (currently just Log Training on Q2). James, 2026-05-22 SVA feedback:
// instructions belong inside each question, not in the intro banner.
const PROMPTS: PromptDef[] = [
  {
    key: 'good_news',
    emoji: '🎉',
    question: 'Good News & Wins',
    cue: 'Any good news or wins to share with the team — what happened, and what does it mean for us?',
    bullets: [
      'A store staff who closed a sale for us',
      'A new relationship or space conquered',
      'A brand or product gaining momentum',
    ],
  },
  {
    key: 'people_training',
    emoji: '👥',
    question: 'People & Training',
    cue: 'Who did you engage today? Tap below to log each person — an update, and a training if you ran one.',
    footerHint: '📱 Tap "Log people & training" to open the app, then Submit to continue',
    bullets: [
      'A new store staff you got to know',
      'A training and how they responded',
      'Someone who complained or championed us',
    ],
    showTrainingButton: true,
  },
  {
    key: 'competitor',
    emoji: '🕵️',
    question: 'Competitors & Market',
    cue: 'Heard any juicy news about competitors or the market? What does it mean for us?',
    bullets: [
      "A competitor's launch, promo or discount",
      'A great strategy competitors employed',
      'Market chatter from staff or customers',
    ],
  },
  {
    key: 'display_stock',
    emoji: '📦',
    question: 'Display & Stock',
    cue: 'How is our brand experience in store? Take photos of the layout!',
    bullets: [
      'Demo units spoilt or missing',
      'Displays that need refreshing or changing',
      'New space conquered, or space lost',
    ],
  },
];

function trainingDeepLink(visitId: string): string | null {
  if (!config.broadcast.botUsername) return null;
  return (
    `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}` +
    `?startapp=visit_${visitId}_training`
  );
}

function followUpDeepLink(visitId: string): string | null {
  if (!config.broadcast.botUsername) return null;
  return (
    `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}` +
    `?startapp=visit_${visitId}_followup`
  );
}

function buildPromptKeyboard(
  visitId: string,
  prompt: PromptDef,
  showBack: boolean,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (showBack) kb.text('← Back', `prompt:back:${prompt.key}`);
  kb.text('Skip', `prompt:skip:${prompt.key}`);
  if (prompt.showTrainingButton) {
    const link = trainingDeepLink(visitId);
    // .row() drops the URL button onto its own line. Three buttons on one row
    // get truncated on narrow phone widths.
    if (link) kb.row().url('🎓 Log Training', link);
  }
  return kb;
}

// ── Seamless engagement hand-off (people/training step) ─────────────────────
// A reply-keyboard web_app button is the ONLY launch method from which the mini
// app can call Telegram.WebApp.sendData() back to the bot. The CM logs people +
// engagements in the app, taps Next/Skip, the app sendData()s, and the wait loop
// below catches the web_app_data message and advances the flow — no manual
// return to chat. Falls back to the inline deep-link button if MINIAPP_URL is
// unset. The reply keyboard's Back is matched by exact label. No Skip button —
// the CM advances by submitting in the app (even with no one logged).
const ENGAGE_BACK_LABEL = '← Back';

function engageWebAppUrl(visitId: string): string | null {
  if (!config.miniapp.url) return null;
  return `${config.miniapp.url.replace(/\/$/, '')}/m/visit/${visitId}/engage`;
}

function buildEngagementReplyKeyboard(url: string, showBack: boolean): Keyboard {
  const kb = new Keyboard().webApp('📱 Log people & training', url);
  if (showBack) kb.row().text(ENGAGE_BACK_LABEL);
  return kb.resized();
}

// 5-per-page is the sweet spot for thumb-reachable buttons before pagination
// adds enough cognitive load that we'd rather force a swipe than a scroll.
const FOLLOW_UP_PAGE_SIZE = 5;

// Telegram legacy Markdown parses `_ * ` ` `[` in body text. Bullet titles are
// free-text user input — escape so a stray asterisk doesn't 400 the send.
function escapeMarkdown(s: string): string {
  return s.replace(/([_*`\[])/g, '\\$1');
}

function buildFollowUpKeyboard(opts: {
  visitId: string;
  openItems: VisitFollowUp[];
  page: number;
}): InlineKeyboard {
  const { visitId, openItems, page } = opts;
  const totalPages = Math.max(1, Math.ceil(openItems.length / FOLLOW_UP_PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageItems = openItems.slice(clampedPage * FOLLOW_UP_PAGE_SIZE, (clampedPage + 1) * FOLLOW_UP_PAGE_SIZE);

  const kb = new InlineKeyboard();

  // Per-item close buttons (one row each)
  for (const item of pageItems) {
    const label = item.title.length > 36
      ? `✅ ${item.title.slice(0, 36)}…`
      : `✅ ${item.title}`;
    kb.text(label, `followup:complete:${item.id}`).row();
  }

  // Pagination row (only if more than one page)
  if (openItems.length > FOLLOW_UP_PAGE_SIZE) {
    if (clampedPage > 0) kb.text('◀ Prev', `followup:page:${clampedPage - 1}`);
    if (clampedPage < totalPages - 1) kb.text('Next ▶', `followup:page:${clampedPage + 1}`);
    kb.row();
  }

  // Add row: one long button by itself
  const link = followUpDeepLink(visitId);
  if (link) kb.url('📌 Add Follow-Ups in App', link).row();

  // Nav row: Back (left) · Submit (right)
  kb.text('← Back', 'followup:back').text('✓ Submit', 'followup:done');

  return kb;
}

function buildDoneKeyboard(visitId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('🔄 Log Another Visit', `nextvisit:${visitId}`).row();
  kb.text('🗑️ Delete', `delete:${visitId}`);
  if (config.broadcast.botUsername) {
    const base = `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}`;
    kb.url('✏️ Edit', `${base}?startapp=visit_${visitId}_edit`);
  }
  return kb;
}

function formatPrompt(idx: number, p: PromptDef): string {
  const bullets = p.bullets.map((b) => `_• ${b}_`).join('\n');
  const footerLines: string[] = [];
  if (p.footerHint) footerLines.push(`_${p.footerHint}_`);
  footerLines.push('_📸 Add a photo at any time!_');
  return (
    `*Q${idx + 1}*  ${p.emoji}  *${p.question}*\n\n` +
    `${p.cue}\n\n${bullets}\n\n${footerLines.join('\n')}`
  );
}

function buildIntroBanner(storeName: string, total: number): string {
  // Per-question prompts now carry the photo nudge (James, 2026-05-22). We
  // keep the banner deliberately thin — CMs skim it; the durable instructions
  // live in each Q.
  return (
    `📍 *Visit at ${storeName}* — ${total} quick questions.\n\n` +
    `_💾 Answers save as you go_\n` +
    `_← Back on any question to redo the previous one (clears its photos too)_\n` +
    `_/cancel pauses — draft saved for 7 days, run /visit to pick up_`
  );
}

// Visits use the visit_photos.section_key enum 'follow_up' for the close-out
// step; PROMPTS keys map 1:1 except 'competitor' → 'competitor' (singular).
function sectionKeyForPrompt(key: V2PromptKey): SectionKey {
  return key as SectionKey;
}

export async function visitFlow(
  conversation: VisitConversation,
  ctx: BotContext,
  resumeVisitId?: string,
): Promise<void> {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  let visit: Visit | null = null;
  let storeId = '';
  let storeName = '';

  // ── Resume path: skip store-pick, load existing draft ─────────────────────
  if (resumeVisitId) {
    const existing = await conversation.external(() => getFullVisit(resumeVisitId));
    if (!existing || existing.cm_telegram_id !== telegramId) {
      await ctx.reply("Couldn't find your draft visit — give /visit a fresh try 🙏", { reply_markup: QUICK_ACCESS_KEYBOARD });
      return;
    }
    visit = existing;
    storeId = existing.store_id;
    storeName = existing.store_name;
    // Hide quick-access keyboard so accidental taps during the visit don't
    // pollute answers / fire /visit again.
    await ctx.reply(
      `▶️ *Resuming visit at ${storeName}* — picking up where you left off.`,
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } },
    );
  } else {
    // ── Store pick (entry) ────────────────────────────────────────────────────
    // Wrapped in withTimeout: if either Supabase query stalls, the per-user
    // conversation lock would otherwise be held forever — same hang class as
    // the photo upload bug.
    let stores: Awaited<ReturnType<typeof getStoresForCM>>;
    let lastVisits: Awaited<ReturnType<typeof getLastVisitDatePerStore>>;
    // Show "typing…" so the CM sees the bot is working while the store list
    // loads — the first thing they wait on, and the most network-sensitive.
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      [stores, lastVisits] = await conversation.external(async () =>
        withTimeout(
          Promise.all([getStoresForCM(telegramId), getLastVisitDatePerStore(telegramId)]),
          10_000,
          'store pick load',
        ),
      );
    } catch (err) {
      console.error('[visit] store pick load failed:', err instanceof Error ? err.message : err);
      await ctx.reply(
        '⚠️ Something went wrong loading your stores. Please try /visit again in a moment.',
        { reply_markup: QUICK_ACCESS_KEYBOARD },
      );
      return;
    }

    if (stores.length === 0) {
      await ctx.reply("No stores assigned yet — ask your manager to set this up 🙏", { reply_markup: QUICK_ACCESS_KEYBOARD });
      return;
    }

    let page = 0;
    // Split into two messages: first carries remove_keyboard (hides quick-access
    // buttons so accidental taps don't fire /visit again mid-flow), second
    // carries the store picker inline keyboard.
    await ctx.reply(
      buildStoreContextMessage(stores, lastVisits),
      { parse_mode: 'Markdown', reply_markup: { remove_keyboard: true } },
    );
    await ctx.reply(
      `Which store did you visit?\n_/cancel to stop_`,
      { parse_mode: 'Markdown', reply_markup: buildStorePicker(stores, lastVisits, page) },
    );

    storeLoop: while (true) {
      const update = await conversation.wait();

      if (update.message?.text === '/cancel') {
        await ctx.reply("👋 No worries — come back whenever you're ready.", { reply_markup: QUICK_ACCESS_KEYBOARD });
        return;
      }
      if (!update.callbackQuery) continue;

      const data = update.callbackQuery.data ?? '';

      if (data === 'cancel') {
        await update.answerCallbackQuery().catch(() => {});
        await ctx.reply("👋 No worries — come back whenever you're ready.", { reply_markup: QUICK_ACCESS_KEYBOARD });
        return;
      }

      if (data.startsWith('page:')) {
        page = parseInt(data.replace('page:', ''), 10);
        await update.answerCallbackQuery().catch(() => {});
        await update.editMessageReplyMarkup({
          reply_markup: buildStorePicker(stores, lastVisits, page),
        });
        continue;
      }

      if (data === 'search:stores') {
        await update.answerCallbackQuery().catch(() => {});
        // Edit the "Which store did you visit?" message in place — Wilson
        // 2026-05-26: tapping "Other store" should "change the current message"
        // rather than stack a new one.
        await update.editMessageText(
          `📍 *Other Store*\n\nWhich country is the store in?\n\n_Tap a country, then browse channels or type to search._`,
          { parse_mode: 'Markdown', reply_markup: buildCountryPicker() },
        );

        // Country-first browse loop. State is tracked in selectedMarket /
        // selectedChain so that a typed text message any time after a country
        // is picked searches within that country (across all its channels).
        let selectedMarket: string | null = null;
        let selectedChain: string | null = null;

        otherStoreLoop: while (true) {
          const upd = await conversation.wait();

          if (upd.message?.text === '/cancel') {
            await ctx.reply("👋 No worries — come back whenever you're ready.", { reply_markup: QUICK_ACCESS_KEYBOARD });
            return;
          }

          if (upd.callbackQuery) {
            const d = upd.callbackQuery.data ?? '';

            if (d === 'cancel') {
              await upd.answerCallbackQuery().catch(() => {});
              await ctx.reply("👋 No worries — come back whenever you're ready.", { reply_markup: QUICK_ACCESS_KEYBOARD });
              return;
            }

            if (d === 'search:back') {
              // Back from country picker → return to the assigned-store picker.
              await upd.answerCallbackQuery().catch(() => {});
              await upd.editMessageText('Which store did you visit?', {
                reply_markup: buildStorePicker(stores, lastVisits, page),
              });
              continue storeLoop;
            }

            if (d === 'country-back') {
              await upd.answerCallbackQuery().catch(() => {});
              selectedMarket = null;
              selectedChain = null;
              await upd.editMessageText(
                `📍 *Other Store*\n\nWhich country is the store in?\n\n_Tap a country, then browse channels or type to search._`,
                { parse_mode: 'Markdown', reply_markup: buildCountryPicker() },
              );
              continue otherStoreLoop;
            }

            if (d.startsWith('country:')) {
              const market = d.slice('country:'.length);
              selectedMarket = market;
              selectedChain = null;
              await upd.answerCallbackQuery().catch(() => {});
              const channels = await conversation.external(() => getChannelsInMarket(market));
              if (channels.length === 0) {
                await upd.editMessageText(
                  `${countryLabel(market)}\n\n_No stores set up yet._`,
                  {
                    parse_mode: 'Markdown',
                    reply_markup: new InlineKeyboard()
                      .text('← Countries', 'country-back').row()
                      .text('Cancel', 'cancel'),
                  },
                );
                continue otherStoreLoop;
              }
              await upd.editMessageText(
                `${countryLabel(market)} · *Pick a channel*\n\n_Tap a channel to see its stores · or type to search ${countryLabel(market)}_`,
                { parse_mode: 'Markdown', reply_markup: buildChannelPicker(market, channels, 0) },
              );
              continue otherStoreLoop;
            }

            if (d.startsWith('channel-page:')) {
              const rest = d.slice('channel-page:'.length);
              const sep = rest.indexOf(':');
              const market = rest.slice(0, sep);
              const pageNum = parseInt(rest.slice(sep + 1), 10);
              selectedMarket = market;
              await upd.answerCallbackQuery().catch(() => {});
              const channels = await conversation.external(() => getChannelsInMarket(market));
              await upd.editMessageReplyMarkup({
                reply_markup: buildChannelPicker(market, channels, pageNum),
              });
              continue otherStoreLoop;
            }

            if (d.startsWith('channel-back:')) {
              const market = d.slice('channel-back:'.length);
              selectedMarket = market;
              selectedChain = null;
              await upd.answerCallbackQuery().catch(() => {});
              const channels = await conversation.external(() => getChannelsInMarket(market));
              await upd.editMessageText(
                `${countryLabel(market)} · *Pick a channel*\n\n_Tap a channel to see its stores · or type to search ${countryLabel(market)}_`,
                { parse_mode: 'Markdown', reply_markup: buildChannelPicker(market, channels, 0) },
              );
              continue otherStoreLoop;
            }

            if (d.startsWith('channel:')) {
              const rest = d.slice('channel:'.length);
              const sep = rest.indexOf(':');
              const market = rest.slice(0, sep);
              const chain = rest.slice(sep + 1);
              selectedMarket = market;
              selectedChain = chain;
              await upd.answerCallbackQuery().catch(() => {});
              const channelStores = await conversation.external(() =>
                getStoresByMarketAndChain(market, chain),
              );
              await upd.editMessageText(
                `${countryLabel(market)} · *${chain}*\n\n_T1 first · tap a store · or type to search ${countryLabel(market)}_`,
                { parse_mode: 'Markdown', reply_markup: buildChannelStorePicker(market, chain, channelStores, 0) },
              );
              continue otherStoreLoop;
            }

            if (d.startsWith('store-page:')) {
              const rest = d.slice('store-page:'.length);
              const firstSep = rest.indexOf(':');
              const lastSep = rest.lastIndexOf(':');
              const market = rest.slice(0, firstSep);
              const chain = rest.slice(firstSep + 1, lastSep);
              const pageNum = parseInt(rest.slice(lastSep + 1), 10);
              selectedMarket = market;
              selectedChain = chain;
              await upd.answerCallbackQuery().catch(() => {});
              const channelStores = await conversation.external(() =>
                getStoresByMarketAndChain(market, chain),
              );
              await upd.editMessageReplyMarkup({
                reply_markup: buildChannelStorePicker(market, chain, channelStores, pageNum),
              });
              continue otherStoreLoop;
            }

            if (d.startsWith('store:')) {
              storeId = d.slice('store:'.length);
              const found = await conversation.external(() => getStoreById(storeId));
              if (!found) continue otherStoreLoop;
              storeName = found.name;
              await upd.answerCallbackQuery().catch(() => {});
              break storeLoop;
            }

            // Any other callback: ack and ignore.
            await upd.answerCallbackQuery().catch(() => {});
            continue otherStoreLoop;
          }

          // Text input → search within selectedMarket. Until a country is
          // picked, prompt the user to pick one first.
          const term = upd.message?.text?.trim();
          if (!term) continue otherStoreLoop;
          if (!selectedMarket) {
            await ctx.reply('_Tap a country first 👆_', { parse_mode: 'Markdown' });
            continue otherStoreLoop;
          }
          const results = await conversation.external(() =>
            searchStoresByName(selectedMarket, term),
          );
          if (results.length === 0) {
            await ctx.reply(
              `No matches for "${term}" in ${countryLabel(selectedMarket)}.`,
              {
                reply_markup: new InlineKeyboard()
                  .text('← Channels', `channel-back:${selectedMarket}`).row()
                  .text('← Countries', 'country-back').row()
                  .text('Cancel', 'cancel'),
              },
            );
          } else {
            await ctx.reply(
              `${countryLabel(selectedMarket)} · _"${term}"_ — ${results.length} match${results.length === 1 ? '' : 'es'}`,
              {
                parse_mode: 'Markdown',
                reply_markup: buildCountrySearchResultsPicker(selectedMarket, results),
              },
            );
          }
          continue otherStoreLoop;
        }
      }

      if (data.startsWith('store:')) {
        storeId = data.replace('store:', '');
        const found = stores.find(s => s.id === storeId);
        if (found) {
          storeName = found.name;
        } else {
          const fetched = await conversation.external(() => getStoreById(storeId));
          if (!fetched) continue;
          storeName = fetched.name;
        }
        await update.answerCallbackQuery().catch(() => {});
        break;
      }
    }

    // ── Create draft visit upfront so photos + save-as-you-go can stream into it
    visit = await conversation.external(async () => {
      const v = await createVisit({
        store_id: storeId,
        cm_telegram_id: telegramId,
        grade: null,
        grade_comments: null,
      });
      if (!v) return null;
      await setVisitCMs(v.id, telegramId, []);
      return v;
    });

    if (!visit) {
      await ctx.reply("Something went wrong — give /visit another try 🙏", { reply_markup: QUICK_ACCESS_KEYBOARD });
      return;
    }
  }

  // ── Consume active plan if any (silent) ───────────────────────────────────
  const plan = await conversation.external(() => getActivePlan(telegramId, storeId));

  // ── Start photo collection. Photos sent any time during the flow attach to
  //    whatever section is currently active (set per prompt).
  const createdVisitId = visit.id;
  const chatId = ctx.chat?.id ?? telegramId;
  await conversation.external(() => {
    startPhotoCollection(telegramId, createdVisitId, storeId, storeName, chatId, PROMPTS.length);
  });

  // Intro banner — only on fresh visits, not resumes (resume already shown the
  // "▶️ Resuming…" line and the CM knows where they are).
  if (!resumeVisitId) {
    await ctx.reply(buildIntroBanner(storeName, PROMPTS.length), { parse_mode: 'Markdown' });
  }

  // ── 4 prompts ─────────────────────────────────────────────────────────────
  const answers: Partial<Record<V2PromptKey, string | null>> = {
    good_news: visit.good_news,
    people_training: visit.people_training,
    competitor: visit.competitors,
    display_stock: visit.display_stock,
  };

  // Two-phase loop: questions (Q1..Q4) then follow-up close-out. The outer
  // `mainFlow` wrap lets the follow-up step's ← Back rewind into the Q-loop
  // at Q4. `continue mainFlow` from the follow-up body re-enters the Q-loop.
  let i = 0;
  let hasNavigatedBack = false;
  let followUpsAdded = 0;
  let followUpsClosed = 0;

  mainFlow: while (true) {
  while (i < PROMPTS.length) {
    const p = PROMPTS[i];

    // Resume: skip already-filled prompts — but only on the initial forward
    // pass. After a back-nav, re-prompt regardless so the CM lands where they
    // expect.
    if (answers[p.key] && !hasNavigatedBack) {
      i++;
      continue;
    }

    await conversation.external(() => setActiveSection(telegramId, sectionKeyForPrompt(p.key)));

    // People/training step uses the reply-keyboard web_app hand-off when the
    // mini app URL is configured; everything else keeps the inline keyboard.
    const engageUrl = p.showTrainingButton ? engageWebAppUrl(createdVisitId) : null;
    const isEngagementStep = engageUrl !== null;
    await ctx.reply(formatPrompt(i, p), {
      parse_mode: 'Markdown',
      reply_markup: engageUrl
        ? buildEngagementReplyKeyboard(engageUrl, i > 0)
        : buildPromptKeyboard(createdVisitId, p, i > 0),
    });

    let resolved: 'text' | 'skip' | 'cancel' | 'back' = 'text';
    let textValue: string | null = null;

    promptWait: while (true) {
      const upd = await conversation.wait();

      if (upd.message?.text === '/cancel') {
        resolved = 'cancel';
        break;
      }
      // Hand-off: the mini app signalled (done or skip). Engagements are already
      // saved via the API — the payload is just the advance signal.
      if (upd.message?.web_app_data) {
        resolved = 'skip';
        break;
      }
      // Reply-keyboard Back on the engagement step arrives as plain text.
      if (isEngagementStep) {
        const label = upd.message?.text ?? null;
        if (label === ENGAGE_BACK_LABEL) { resolved = 'back'; break; }
        // App-only step: ignore stray text so nothing is saved as a legacy
        // people_training note. (Photos still attach below.)
        if (label) continue;
      }
      if (upd.message?.photo) {
        const arr = upd.message.photo;
        const fileId = arr[arr.length - 1].file_id;
        const mediaGroupId = upd.message.media_group_id;
        // Fire-and-forget: section is pinned synchronously at call time;
        // conversation does not block waiting for the upload to finish.
        await conversation.external(() => {
          void handleIncomingPhoto(telegramId, fileId, mediaGroupId);
        });
        // On the app-only engagement step, attach the photo but never treat its
        // caption as the answer — engagements live in the mini app now.
        const caption = isEngagementStep ? null : (upd.message.caption ?? null);
        if (caption) {
          textValue = caption;
          resolved = 'text';
          break;
        }
        continue;
      }
      if (upd.callbackQuery) {
        const data = upd.callbackQuery.data ?? '';
        if (data === `prompt:skip:${p.key}`) {
          await upd.answerCallbackQuery('Skipped').catch(() => {});
          resolved = 'skip';
          break promptWait;
        }
        if (data === `prompt:back:${p.key}`) {
          await upd.answerCallbackQuery('Going back').catch(() => {});
          resolved = 'back';
          break promptWait;
        }
        // Other callbacks (e.g. Log Training URL button has no callback;
        // viewlast/viewvisit handled at bot.ts level) — ignore politely.
        await upd.answerCallbackQuery().catch(() => {});
        continue;
      }
      const text = upd.message?.caption ?? upd.message?.text ?? null;
      if (text) {
        textValue = text;
        resolved = 'text';
        break;
      }
    }

    // The engagement reply keyboard is persistent + message-independent — clear
    // it before the next step's inline keyboard. (Cancel sends its own keyboard.)
    if (isEngagementStep && resolved !== 'cancel') {
      await ctx.reply(resolved === 'back' ? '↩️ Going back…' : '✓ Logged — continuing.', {
        reply_markup: { remove_keyboard: true },
      });
    }

    if (resolved === 'cancel') {
      // Pause — keep the draft + already-uploaded photos. Clear in-memory
      // collection so stray photos after exit don't attach to this paused
      // visit. The 7-day TTL sweeps it if the CM never returns.
      await conversation.external(() => {
        setActiveSection(telegramId, null);
        discardPhotoCollection(telegramId);
      });
      await ctx.reply("👋 Paused — saved as a draft. Run /visit anytime in the next 7 days to pick up.", { reply_markup: QUICK_ACCESS_KEYBOARD });
      return;
    }
    if (resolved === 'back') {
      // Wipe the previous prompt's photos + answer, then rewind. Q1 hides the
      // Back button (showBack = i > 0), so this branch can't fire when i = 0.
      const target = PROMPTS[i - 1];
      const targetSection = sectionKeyForPrompt(target.key);
      const removed = await conversation.external(() =>
        deletePhotosBySection(createdVisitId, targetSection),
      );
      if (removed > 0) {
        await conversation.external(() => adjustSavedCount(telegramId, -removed));
      }
      await conversation.external(() => persistVisitSection(createdVisitId, target.key, null));
      answers[target.key] = null;
      hasNavigatedBack = true;
      i--;
      continue;
    }
    if (resolved === 'skip') {
      i++;
      continue;
    }
    // text path
    answers[p.key] = textValue;
    await conversation.external(() => persistVisitSection(createdVisitId, p.key, textValue));
    i++;
  }

  // ── Follow-up close-out ───────────────────────────────────────────────────
  await conversation.external(() => setActiveSection(telegramId, 'follow_up'));

  // Fetch all open follow-ups for this store, then exclude tasks created
  // earlier in the same visit (don't let the CM close tasks they just added).
  const allOpenItems = await conversation.external(() =>
    listOpenFollowUpsForStore(storeId),
  );
  let openItems = allOpenItems.filter(item => item.visit_id !== createdVisitId);

  let followUpPage = 0;

  function buildFollowUpText(items: VisitFollowUp[], page: number): string {
    const totalPages = Math.max(1, Math.ceil(items.length / FOLLOW_UP_PAGE_SIZE));
    const clampedPage = Math.min(page, totalPages - 1);
    const pageItems = items.slice(clampedPage * FOLLOW_UP_PAGE_SIZE, (clampedPage + 1) * FOLLOW_UP_PAGE_SIZE);
    const prefix = items.length > 0
      ? `📋 *Tasks Open:*\n` +
        pageItems.map(i => `• ${escapeMarkdown(i.title)}`).join('\n') +
        `\n\n_Tap ✅ below to close!_\n\n`
      : '';
    return (
      prefix +
      `✓ *Follow-ups before we close?*\n\n` +
      `_Anything to act on for this store? Add as tasks in the app — assign owner + due date, the team can see them._`
    );
  }

  const followUpMsg = await ctx.reply(
    buildFollowUpText(openItems, followUpPage),
    {
      parse_mode: 'Markdown',
      reply_markup: buildFollowUpKeyboard({ visitId: createdVisitId, openItems, page: followUpPage }),
    },
  );
  const followUpMessageId = followUpMsg.message_id;

  let hintShown = false;

  followUpLoop: while (true) {
    const upd = await conversation.wait();

    // Mini-app Save & Submit may have finalised this visit out-of-band via
    // /api/visit/:id/finalize. If so, the endpoint already sent the done
    // message — we just exit silently to avoid double-finalising.
    const stillOpen = await conversation.external(() =>
      isVisitStillOpen(createdVisitId),
    );
    if (!stillOpen) return;

    if (upd.message?.text === '/cancel') {
      await conversation.external(() => {
        setActiveSection(telegramId, null);
        discardPhotoCollection(telegramId);
      });
      await ctx.reply("👋 Paused — saved as a draft. Run /visit anytime in the next 7 days to pick up.", { reply_markup: QUICK_ACCESS_KEYBOARD });
      return;
    }
    if (upd.message?.photo) {
      const arr = upd.message.photo;
      const fileId = arr[arr.length - 1].file_id;
      const mediaGroupId = upd.message.media_group_id;
      await conversation.external(() => {
        void handleIncomingPhoto(telegramId, fileId, mediaGroupId);
      });
      continue;
    }
    if (upd.callbackQuery) {
      const data = upd.callbackQuery.data ?? '';
      if (data.startsWith('followup:complete:')) {
        const id = data.slice('followup:complete:'.length);
        // Validate against current in-memory list — guards against stale
        // buttons from prior message edits and against double-tap races
        // (the second tap finds nothing to splice and exits cleanly).
        if (!openItems.some(item => item.id === id)) {
          await upd.answerCallbackQuery('Already closed').catch(() => {});
          continue;
        }
        // Splice + increment SYNCHRONOUSLY before any await so a rapid second
        // tap on the same button hits the membership check above and is a no-op.
        openItems = openItems.filter(item => item.id !== id);
        followUpsClosed++;
        const lastPage = Math.max(0, Math.ceil(openItems.length / FOLLOW_UP_PAGE_SIZE) - 1);
        followUpPage = Math.min(followUpPage, lastPage);
        await conversation.external(() => markFollowUpDone(id, createdVisitId));
        await upd.answerCallbackQuery('Closed ✓').catch(() => {});
        const newText = buildFollowUpText(openItems, followUpPage);
        const newKb = buildFollowUpKeyboard({ visitId: createdVisitId, openItems, page: followUpPage });
        await conversation.external(async () => {
          try {
            await ctx.api.editMessageText(chatId, followUpMessageId, newText, {
              parse_mode: 'Markdown',
              reply_markup: newKb,
            });
          } catch {
            // Message may be too old / identical / already deleted — safe to ignore.
          }
        });
        continue;
      }
      if (data.startsWith('followup:page:')) {
        const n = parseInt(data.slice('followup:page:'.length), 10);
        const lastPage = Math.max(0, Math.ceil(openItems.length / FOLLOW_UP_PAGE_SIZE) - 1);
        followUpPage = Math.max(0, Math.min(n, lastPage));
        await upd.answerCallbackQuery().catch(() => {});
        const newText = buildFollowUpText(openItems, followUpPage);
        const newKb = buildFollowUpKeyboard({ visitId: createdVisitId, openItems, page: followUpPage });
        await conversation.external(async () => {
          try {
            await ctx.api.editMessageText(chatId, followUpMessageId, newText, {
              parse_mode: 'Markdown',
              reply_markup: newKb,
            });
          } catch {
            // Same — Telegram 400 on no-change / stale message; safe to ignore.
          }
        });
        continue;
      }
      if (data === 'followup:back') {
        // Wipe Q4 (last prompt) photos + answer, rewind into the Q-loop.
        const target = PROMPTS[PROMPTS.length - 1];
        const targetSection = sectionKeyForPrompt(target.key);
        const removed = await conversation.external(() =>
          deletePhotosBySection(createdVisitId, targetSection),
        );
        if (removed > 0) {
          await conversation.external(() => adjustSavedCount(telegramId, -removed));
        }
        await conversation.external(() =>
          persistVisitSection(createdVisitId, target.key, null),
        );
        answers[target.key] = null;
        hasNavigatedBack = true;
        i = PROMPTS.length - 1;
        await upd.answerCallbackQuery('Going back').catch(() => {});
        continue mainFlow;
      }
      if (data === 'followup:done') {
        // Single Done path — whether or not the user added follow-ups in
        // the mini-app, this finalises the visit. Reading the rows here
        // gives us a count for the summary message.
        const items = await conversation.external(() =>
          listFollowUpsForVisit(createdVisitId),
        );
        followUpsAdded = items.length;
        await upd.answerCallbackQuery(
          followUpsAdded ? `${followUpsAdded} saved` : 'Done',
        ).catch(() => {});
        break followUpLoop;
      }
      await upd.answerCallbackQuery().catch(() => {});
      continue;
    }
    // Typed follow-ups removed — guide the user to the app. Show the hint
    // once per loop so we don't spam if they keep typing.
    const text = upd.message?.caption ?? upd.message?.text ?? null;
    if (text && !hintShown) {
      hintShown = true;
      await ctx.reply(
        `_Add follow-ups in the app so you can assign an owner and due date 👇_`,
        { parse_mode: 'Markdown' },
      );
    }
  }

  break mainFlow;
  } // end mainFlow

  await conversation.external(() => setActiveSection(telegramId, null));

  // ── Finalize: lock first so the CM gets a response immediately, then drain
  //    the photo queue and fire the team broadcast separately (see below).
  // "typing…" covers the gap while the lock round-trips.
  await ctx.replyWithChatAction('typing').catch(() => {});
  const [trainedCount, photosPending] = await conversation.external(async () => {
    await lockVisit(createdVisitId);
    if (plan) await consumePlan(plan.id);
    return [
      await countTrainedStaff(createdVisitId),
      hasPendingUploads(createdVisitId),
    ] as const;
  });

  const trainingLine = trainedCount > 0
    ? `\n🎓 ${trainedCount} training${trainedCount === 1 ? '' : 's'} logged`
    : '';
  const followUpLine = followUpsAdded > 0
    ? `\n✅ ${followUpsAdded} follow-up${followUpsAdded === 1 ? '' : 's'} logged`
    : '';
  const closedLine = followUpsClosed > 0
    ? `\n✓ ${followUpsClosed} closed`
    : '';

  if (!photosPending) {
    // All uploads already done — include count in the initial message.
    const savedPhotos = await conversation.external(() => awaitPhotoUpload(createdVisitId));
    const photoLine = savedPhotos > 0
      ? `\n📸 ${savedPhotos} ${savedPhotos === 1 ? 'photo' : 'photos'} logged`
      : '';
    await ctx.reply(
      `🎉 *${storeName}* logged ✓` + photoLine + trainingLine + followUpLine + closedLine,
      { parse_mode: 'Markdown', reply_markup: buildDoneKeyboard(createdVisitId) },
    );
  } else {
    // Photos still uploading — send the done message immediately with a saving
    // indicator, then edit in the final count once the uploads drain (≤10s).
    const doneMsg = await ctx.reply(
      `🎉 *${storeName}* logged ✓\n📸 Saving photos...` + trainingLine + followUpLine + closedLine,
      { parse_mode: 'Markdown', reply_markup: buildDoneKeyboard(createdVisitId) },
    );
    const savedPhotos = await conversation.external(() => awaitPhotoUpload(createdVisitId));
    const photoLine = savedPhotos > 0
      ? `\n📸 ${savedPhotos} ${savedPhotos === 1 ? 'photo' : 'photos'} logged`
      : '';
    await ctx.api.editMessageText(
      chatId,
      doneMsg.message_id,
      `🎉 *${storeName}* logged ✓` + photoLine + trainingLine + followUpLine + closedLine,
      { parse_mode: 'Markdown', reply_markup: buildDoneKeyboard(createdVisitId) },
    ).catch(() => {});
  }

  // Team broadcast fires AFTER the CM's confirmation so a slow group send can
  // never hold up their submit (the freeze CMs hit when submitting with photos
  // still uploading on a weak connection). Uses the bot.api singleton, not
  // ctx.api, so it survives the conversation exit; wrapped in external so a
  // replay can't re-fire it and double-post to the group.
  await conversation.external(() => {
    const api = getBotApi();
    if (api) void broadcastVisitLocked(createdVisitId, api).catch(() => {});
  });

  // Restore the quick-access reply keyboard hidden at the start of the flow.
  await ctx.reply('_Ready for your next visit 👇_', {
    parse_mode: 'Markdown',
    reply_markup: QUICK_ACCESS_KEYBOARD,
  });
}

// Re-export for callers that need to inspect prompt keys.
export { PROMPTS as V2_PROMPTS, V2_PROMPT_COLUMN };
export const V2_PROMPT_KEYS = PROMPTS.map((p) => p.key);
// Type guard for tests / external dispatch (kept thin).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeAnchor(): SectionKey { return 'follow_up'; }

import { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '../middleware/auth.js';
import { getStoresForCM } from '../../db/queries/stores.js';
import { searchStoresByName, getStoreById } from '../../db/queries/stores.js';
import {
  createVisit,
  lockVisit,
  persistVisitSection,
  getFullVisit,
  getLastVisitDatePerStore,
  V2_PROMPT_COLUMN,
  type V2PromptKey,
  type Visit,
} from '../../db/queries/visits.js';
import { setVisitCMs } from '../../db/queries/visit-cms.js';
import { getActivePlan, consumePlan } from '../../db/queries/visit-plans.js';
import { listFollowUpsForVisit } from '../../db/queries/visit-follow-ups.js';
import {
  buildStorePicker,
  buildSearchResultsPicker,
  buildStoreContextMessage,
} from '../keyboards/store-picker.js';
import {
  startPhotoCollection,
  handleIncomingPhoto,
  setActiveSection,
  awaitPhotoUpload,
} from '../photo-collection.js';
import { sendVisitDetails } from '../visit-details.js';
import { broadcastVisitLocked } from '../../notifications/visit-broadcast.js';
import { config } from '../../config.js';
import type { SectionKey } from '../../db/queries/photos.js';

type VisitConversation = Conversation<BotContext, BotContext>;

interface PromptDef {
  key: V2PromptKey;
  emoji: string;
  question: string;
  cue: string;
  bullets: string[];
  showTrainingButton?: boolean;
}

// Prompt cues are deliberately written so the three intelligence-report
// pillars surface naturally:
//   • People (heart of CMs) → People & Training
//   • Competitor analysis    → Competition
//   • Market / Store         → Display & Stock
// Keep wording concrete (named SMs, competitor brands, store closures) — vague
// prompts yield vague answers and the digest goes empty.
const PROMPTS: PromptDef[] = [
  {
    key: 'good_news',
    emoji: '🎉',
    question: 'Good News',
    cue: 'Any wins today? Even small ones — share the story.',
    bullets: [
      'A staff sold something and wants to share the story',
      "A customer's eyes lit up because of a great demo",
      'Momentum on something from your last visit',
    ],
  },
  {
    key: 'people_training',
    emoji: '👥',
    question: 'People & Training',
    cue: 'Who did you connect with — and where are their heads at?',
    bullets: [
      'Store Manager / promoter mood — championing us, blocking a brand, asking for help?',
      'Praise from SM or staff — about us, our promoters, a recent demo',
      'Anyone curious or stuck on a product — and how did you coach them through it?',
    ],
    showTrainingButton: true,
  },
  {
    key: 'competitor',
    emoji: '🕵️',
    question: 'Competition',
    cue: 'Bose / Sony / JBL / Denon — what shifted on the floor?',
    bullets: [
      'New launch, promo, POSM, or pricing move (name the product if you saw it)',
      'Competitor staff conquering new space — endcap, hero shelf, demo zone?',
      'Customer reactions — anyone waiting on a competitor discount or comparing?',
    ],
  },
  {
    key: 'display_stock',
    emoji: '📦',
    question: 'Display & Stock',
    cue: 'How is the store doing — and how are we showing up inside it?',
    bullets: [
      'Channel-level signal — TV section quieter, foot traffic shifting, chain restructuring?',
      "Stock — gaps that'll hurt the weekend, or display broken/dusty/pushed back?",
      'New spaces we conquered — or lost — since your last visit',
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
): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('Skip', `prompt:skip:${prompt.key}`);
  if (prompt.showTrainingButton) {
    const link = trainingDeepLink(visitId);
    if (link) kb.url('🎓 Log Training', link);
  }
  return kb;
}

function buildFollowUpKeyboard(visitId: string): InlineKeyboard {
  // Push 1: keep Done as honest interim. Push 2 wires auto-finalize when
  // user closes mini-app (mini-app→bot HTTP signal), then Done goes away.
  const kb = new InlineKeyboard();
  kb.text('Skip', 'followup:skip').text('✅ Done', 'followup:done').row();
  const link = followUpDeepLink(visitId);
  if (link) kb.url('📌 Add Follow-Ups in App', link);
  return kb;
}

function buildDoneKeyboard(visitId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (config.broadcast.botUsername) {
    const base = `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}`;
    kb.url('📱 Open in mini-app', `${base}?startapp=visit_${visitId}`).row();
    // Edit deep-links into the mini-app editor (4 sections + photos +
    // follow-ups), bypassing the legacy bot-side step picker / template-paste.
    kb.url('✏️ Edit', `${base}?startapp=visit_${visitId}_edit`);
  }
  kb.text('🗑️ Delete', `delete:${visitId}`);
  return kb;
}

function formatPrompt(idx: number, total: number, p: PromptDef): string {
  const bullets = p.bullets.map((b) => `• ${b}`).join('\n');
  return (
    `*Q${idx + 1} of ${total}*  ${p.emoji}  *${p.question}*\n\n` +
    `_${p.cue}_\n\n${bullets}`
  );
}

function buildIntroBanner(storeName: string, total: number): string {
  return (
    `📍 *Visit at ${storeName}* — ${total} quick questions.\n\n` +
    `_📸 Photos welcome anytime · 💾 Answers save as you go_\n` +
    `_/cancel pauses and saves a draft_`
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
      await ctx.reply("Couldn't find your draft visit — give /visit a fresh try 🙏");
      return;
    }
    visit = existing;
    storeId = existing.store_id;
    storeName = existing.store_name;
    await ctx.reply(
      `▶️ *Resuming visit at ${storeName}* — picking up where you left off.`,
      { parse_mode: 'Markdown' },
    );
  } else {
    // ── Store pick (entry) ────────────────────────────────────────────────────
    const [stores, lastVisits] = await conversation.external(async () => {
      const s = await getStoresForCM(telegramId);
      const lv = await getLastVisitDatePerStore(telegramId);
      return [s, lv] as const;
    });

    if (stores.length === 0) {
      await ctx.reply("No stores assigned yet — ask your manager to set this up 🙏");
      return;
    }

    let page = 0;
    await ctx.reply(
      `${buildStoreContextMessage(stores, lastVisits)}\n\nWhich store did you visit?\n_/cancel to stop_`,
      { parse_mode: 'Markdown', reply_markup: buildStorePicker(stores, lastVisits, page) },
    );

    storeLoop: while (true) {
      const update = await conversation.wait();

      if (update.message?.text === '/cancel') {
        await ctx.reply("👋 No worries — come back whenever you're ready.");
        return;
      }
      if (!update.callbackQuery) continue;

      const data = update.callbackQuery.data ?? '';

      if (data === 'cancel') {
        await update.answerCallbackQuery();
        await ctx.reply("👋 No worries — come back whenever you're ready.");
        return;
      }

      if (data.startsWith('page:')) {
        page = parseInt(data.replace('page:', ''), 10);
        await update.answerCallbackQuery();
        await update.editMessageReplyMarkup({
          reply_markup: buildStorePicker(stores, lastVisits, page),
        });
        continue;
      }

      if (data === 'search:stores') {
        await update.answerCallbackQuery();
        await ctx.reply('Type part of the store name:');

        while (true) {
          const searchMsg = await conversation.wait();
          if (searchMsg.message?.text === '/cancel') {
            await ctx.reply("👋 No worries — come back whenever you're ready.");
            return;
          }
          const term = searchMsg.message?.text?.trim();
          if (!term) continue;

          const market = ctx.user?.market ?? 'SG';
          const results = await conversation.external(() => searchStoresByName(market, term));

          if (results.length === 0) {
            await ctx.reply("No stores found — try a different search term.", {
              reply_markup: new InlineKeyboard()
                .text('← Back to my stores', 'search:back').row()
                .text('Cancel', 'cancel'),
            });
          } else {
            await ctx.reply('Pick a store:', { reply_markup: buildSearchResultsPicker(results) });
          }

          const pick = await conversation.wait();

          if (pick.message?.text === '/cancel') {
            await ctx.reply("👋 No worries — come back whenever you're ready.");
            return;
          }
          if (!pick.callbackQuery) continue;

          const pickData = pick.callbackQuery.data ?? '';

          if (pickData === 'cancel') {
            await pick.answerCallbackQuery();
            await ctx.reply("👋 No worries — come back whenever you're ready.");
            return;
          }
          if (pickData === 'search:back') {
            await pick.answerCallbackQuery();
            await ctx.reply('Which store did you visit?', {
              reply_markup: buildStorePicker(stores, lastVisits, page),
            });
            continue storeLoop;
          }
          if (pickData.startsWith('store:')) {
            storeId = pickData.replace('store:', '');
            const found = await conversation.external(() => getStoreById(storeId));
            if (!found) continue;
            storeName = found.name;
            await pick.answerCallbackQuery();
            break storeLoop;
          }
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
        await update.answerCallbackQuery();
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
      await ctx.reply("Something went wrong — give /visit another try 🙏");
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

  for (let i = 0; i < PROMPTS.length; i++) {
    const p = PROMPTS[i];

    // Resume: skip already-filled prompts
    if (answers[p.key]) {
      continue;
    }

    await conversation.external(() => setActiveSection(telegramId, sectionKeyForPrompt(p.key)));

    await ctx.reply(formatPrompt(i, PROMPTS.length, p), {
      parse_mode: 'Markdown',
      reply_markup: buildPromptKeyboard(createdVisitId, p),
    });

    let resolved: 'text' | 'skip' | 'cancel' = 'text';
    let textValue: string | null = null;

    promptWait: while (true) {
      const upd = await conversation.wait();

      if (upd.message?.text === '/cancel') {
        resolved = 'cancel';
        break;
      }
      if (upd.message?.photo) {
        const arr = upd.message.photo;
        const fileId = arr[arr.length - 1].file_id;
        await conversation.external(() => handleIncomingPhoto(telegramId, fileId));
        continue;
      }
      if (upd.callbackQuery) {
        const data = upd.callbackQuery.data ?? '';
        if (data === `prompt:skip:${p.key}`) {
          await upd.answerCallbackQuery('Skipped');
          resolved = 'skip';
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

    if (resolved === 'cancel') {
      await conversation.external(() => setActiveSection(telegramId, null));
      await ctx.reply("👋 No worries — saved as draft. Run /visit anytime to pick up where you left off.");
      return;
    }
    if (resolved === 'skip') {
      continue;
    }
    // text path
    answers[p.key] = textValue;
    await conversation.external(() => persistVisitSection(createdVisitId, p.key, textValue));
  }

  // ── Follow-up close-out ───────────────────────────────────────────────────
  await conversation.external(() => setActiveSection(telegramId, 'follow_up'));

  await ctx.reply(
    `✓ *Follow-ups before we close?*\n\n` +
      `_Anything to act on for this store? Add as tasks in the app — assign owner + due date, the team can see them._`,
    {
      parse_mode: 'Markdown',
      reply_markup: buildFollowUpKeyboard(createdVisitId),
    },
  );

  let followUpsAdded = 0;
  let hintShown = false;

  followUpLoop: while (true) {
    const upd = await conversation.wait();

    if (upd.message?.text === '/cancel') {
      await conversation.external(() => setActiveSection(telegramId, null));
      await ctx.reply("👋 No worries — saved as draft. Run /visit anytime to pick up where you left off.");
      return;
    }
    if (upd.message?.photo) {
      const arr = upd.message.photo;
      const fileId = arr[arr.length - 1].file_id;
      await conversation.external(() => handleIncomingPhoto(telegramId, fileId));
      continue;
    }
    if (upd.callbackQuery) {
      const data = upd.callbackQuery.data ?? '';
      if (data === 'followup:skip') {
        await upd.answerCallbackQuery('Skipped');
        break followUpLoop;
      }
      if (data === 'followup:done') {
        // Pick up rows the user added via the mini-app.
        const items = await conversation.external(() =>
          listFollowUpsForVisit(createdVisitId),
        );
        followUpsAdded = items.length;
        await upd.answerCallbackQuery(
          followUpsAdded ? `${followUpsAdded} saved` : 'Done',
        );
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

  await conversation.external(() => setActiveSection(telegramId, null));

  // ── Finalize: lock, broadcast, drain photo queue, send Done message ──────
  const savedPhotos = await conversation.external(async () => {
    await lockVisit(createdVisitId);
    if (plan) await consumePlan(plan.id);
    await broadcastVisitLocked(createdVisitId, ctx.api).catch(() => {});
    return await awaitPhotoUpload(createdVisitId);
  });

  const photoLine = savedPhotos > 0
    ? `\n📸 ${savedPhotos} ${savedPhotos === 1 ? 'photo' : 'photos'} saved`
    : '';
  const followUpLine = followUpsAdded > 0
    ? `\n✅ ${followUpsAdded} follow-up${followUpsAdded === 1 ? '' : 's'}`
    : '';

  await ctx.reply(
    `🎉 *${storeName}* logged ✓` + photoLine + followUpLine,
    {
      parse_mode: 'Markdown',
      reply_markup: buildDoneKeyboard(createdVisitId),
    },
  );
}

// Re-export for callers that need to inspect prompt keys.
export { PROMPTS as V2_PROMPTS, V2_PROMPT_COLUMN };
export const V2_PROMPT_KEYS = PROMPTS.map((p) => p.key);
// Type guard for tests / external dispatch (kept thin).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeAnchor(): SectionKey { return 'follow_up'; }

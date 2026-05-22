import { Conversation } from '@grammyjs/conversations';
import { InlineKeyboard } from 'grammy';
import { BotContext } from '../middleware/auth.js';
import { getStoresForCM } from '../../db/queries/stores.js';
import { searchStoresByName, getStoreById } from '../../db/queries/stores.js';
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
  adjustSavedCount,
  discardPhotoCollection,
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
    cue: 'Who did you engage today — how was the engagement, did you execute the buzz plan, and what did you train them on?',
    footerHint: '🎓 Tap "Log Training" below to capture training details',
    bullets: [
      'A new store staff that you got to know',
      'A staff training with good response',
      'A person complained/championed us',
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

function buildFollowUpKeyboard(visitId: string): InlineKeyboard {
  // ← Back rewinds to Q4. ✓ Done finalises the visit. Mini-app Save & Submit
  // does the same finalisation via /api/visit/:id/finalize, so this Done
  // button and the mini-app are interchangeable end-states.
  const kb = new InlineKeyboard();
  kb.text('← Back', 'followup:back').text('✓ Done', 'followup:done').row();
  const link = followUpDeepLink(visitId);
  if (link) kb.url('📌 Add Follow-Ups in App', link);
  return kb;
}

function buildDoneKeyboard(visitId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (config.broadcast.botUsername) {
    const base = `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}`;
    kb.url('📱 Open In Mini-App', `${base}?startapp=visit_${visitId}`).row();
    // Edit deep-links into the mini-app editor (4 sections + photos +
    // follow-ups), bypassing the legacy bot-side step picker / template-paste.
    kb.text('🗑️ Delete', `delete:${visitId}`);
    kb.url('✏️ Edit', `${base}?startapp=visit_${visitId}_edit`);
  } else {
    kb.text('🗑️ Delete', `delete:${visitId}`);
  }
  return kb;
}

function formatPrompt(idx: number, p: PromptDef): string {
  const bullets = p.bullets.map((b) => `• ${b}`).join('\n');
  const footerLines: string[] = [];
  if (p.footerHint) footerLines.push(`_${p.footerHint}_`);
  footerLines.push('_📸 Add a photo at any time!_');
  return (
    `*Q${idx + 1}*  ${p.emoji}  *${p.question}*\n\n` +
    `_${p.cue}_\n\n${bullets}\n\n${footerLines.join('\n')}`
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

  // Two-phase loop: questions (Q1..Q4) then follow-up close-out. The outer
  // `mainFlow` wrap lets the follow-up step's ← Back rewind into the Q-loop
  // at Q4. `continue mainFlow` from the follow-up body re-enters the Q-loop.
  let i = 0;
  let hasNavigatedBack = false;
  let followUpsAdded = 0;

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

    await ctx.reply(formatPrompt(i, p), {
      parse_mode: 'Markdown',
      reply_markup: buildPromptKeyboard(createdVisitId, p, i > 0),
    });

    let resolved: 'text' | 'skip' | 'cancel' | 'back' = 'text';
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
        const mediaGroupId = upd.message.media_group_id;
        await conversation.external(() =>
          handleIncomingPhoto(telegramId, fileId, mediaGroupId),
        );
        const caption = upd.message.caption ?? null;
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
          await upd.answerCallbackQuery('Skipped');
          resolved = 'skip';
          break promptWait;
        }
        if (data === `prompt:back:${p.key}`) {
          await upd.answerCallbackQuery('Going back');
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

    if (resolved === 'cancel') {
      // Pause — keep the draft + already-uploaded photos. Clear in-memory
      // collection so stray photos after exit don't attach to this paused
      // visit. The 7-day TTL sweeps it if the CM never returns.
      await conversation.external(() => {
        setActiveSection(telegramId, null);
        discardPhotoCollection(telegramId);
      });
      await ctx.reply("👋 Paused — saved as a draft. Run /visit anytime in the next 7 days to pick up.");
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

  await ctx.reply(
    `✓ *Follow-ups before we close?*\n\n` +
      `_Anything to act on for this store? Add as tasks in the app — assign owner + due date, the team can see them._`,
    {
      parse_mode: 'Markdown',
      reply_markup: buildFollowUpKeyboard(createdVisitId),
    },
  );

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
      await ctx.reply("👋 Paused — saved as a draft. Run /visit anytime in the next 7 days to pick up.");
      return;
    }
    if (upd.message?.photo) {
      const arr = upd.message.photo;
      const fileId = arr[arr.length - 1].file_id;
      const mediaGroupId = upd.message.media_group_id;
      await conversation.external(() =>
        handleIncomingPhoto(telegramId, fileId, mediaGroupId),
      );
      continue;
    }
    if (upd.callbackQuery) {
      const data = upd.callbackQuery.data ?? '';
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
        await upd.answerCallbackQuery('Going back');
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

  break mainFlow;
  } // end mainFlow

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

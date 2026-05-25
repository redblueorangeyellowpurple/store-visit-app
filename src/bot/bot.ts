import { Bot, InlineKeyboard, session } from 'grammy';
import { conversations, createConversation } from '@grammyjs/conversations';
import { config } from '../config.js';
import { BotContext, authMiddleware, requireAuth } from './middleware/auth.js';
import { escapeHatchMiddleware } from './middleware/escape-hatch.js';
import { handleStart } from './commands/start.js';
import { handleHelp } from './commands/help.js';
import { handleLinks } from './commands/links.js';
import { handleMyVisits } from './commands/myvisits.js';
import { handleNickname } from './commands/nickname.js';
import { handleMyProfile, handleProfileStores, handleProfileVisits, handleProfileBack } from './commands/myprofile.js';
import { handleCancel } from './commands/cancel.js';
import { handleGrantAccess } from './commands/admin/grant.js';
import { handleRevokeAccess } from './commands/admin/revoke.js';
import { handleListAccess } from './commands/admin/list.js';
import { handleRunIntelligence } from './commands/admin/runintelligence.js';
import { handleDashboard } from './commands/dashboard.js';
import { visitFlow } from './conversations/visit-flow.js';
import { joinRequestFlow } from './conversations/join-request.js';
import { initPhotoCollection, isCollecting, handleIncomingPhoto } from './photo-collection.js';
import { startEditSession, isEditing, getEditSession, clearEditSession } from './edit-session.js';
import { getVisitInfo, updateVisitSections, updateVisitGrade, updateVisitGradeComments, deleteVisit, getDraftVisit, purgeStaleDrafts } from '../db/queries/visits.js';
import { approvePendingCM, rejectPendingCM, getCMRecord, type CM } from '../db/queries/cms.js';
import { parseTemplate, filledCount } from '../utils/parse-template.js';
import { sendVisitDetails } from './visit-details.js';

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(config.telegram.botToken);
  initPhotoCollection(bot.api);

  bot.use(session({ initial: () => ({}) }));
  bot.use(conversations());
  bot.use(authMiddleware);
  bot.use(escapeHatchMiddleware);

  bot.use(createConversation(visitFlow));
  bot.use(createConversation(joinRequestFlow));

  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('links', handleLinks);
  bot.command('myvisits', handleMyVisits);
  bot.command('nickname', handleNickname);
  bot.command('myprofile', handleMyProfile);
  bot.command('cancel', handleCancel);

  bot.command('dashboard', handleDashboard);

  async function startVisitFlow(ctx: BotContext): Promise<void> {
    const user = requireAuth(ctx);
    if (!user || !ctx.from) return;
    // Sweep abandoned drafts older than the resume window. Silent — no value
    // was ever locked, so the CM doesn't need to know.
    await purgeStaleDrafts(ctx.from.id).catch((e) => console.error('purgeStaleDrafts:', e));
    const draft = await getDraftVisit(ctx.from.id);
    if (draft) {
      await ctx.reply(
        `You have an open visit at *${draft.store_name}*.\nResume or start fresh?`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .text('▶️ Resume', `visit:resume:${draft.id}`)
            .text('🆕 Start fresh', `visit:discard:${draft.id}`),
        },
      );
      return;
    }
    await ctx.conversation.enter('visitFlow');
  }

  bot.command('visit', startVisitFlow);

  // Quick-access reply keyboard buttons (shown after /start)
  // 🏪 = "after the store" (log visit) · 🔗 = "in store" (currently links, future checklists)
  bot.hears('🏪 Log Visit', startVisitFlow);

  bot.callbackQuery(/^visit:resume:/, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('visit:resume:', '');
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.conversation.enter('visitFlow', visitId);
  });

  bot.callbackQuery(/^visit:discard:/, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('visit:discard:', '');
    await deleteVisit(visitId);
    await ctx.answerCallbackQuery('Started fresh');
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.conversation.enter('visitFlow');
  });

  // Chain-log: 🔄 Log Another Visit on the done message
  bot.callbackQuery(/^nextvisit:/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await startVisitFlow(ctx);
  });

  bot.hears('🔗 Links', handleLinks);

  // Photo debounce handler — runs after conversation exits, catches album photos
  bot.on('message:photo', async (ctx) => {
    const telegramId = ctx.from?.id ?? 0;
    if (!isCollecting(telegramId)) return;
    const p = ctx.message?.photo;
    if (p) {
      await handleIncomingPhoto(
        telegramId,
        p[p.length - 1].file_id,
        ctx.message?.media_group_id,
      );
    }
  });

  // Edit mode: CM resends filled template (notes) or comment (grade-comment)
  // after tapping ✏️ Edit → step.
  bot.on(['message:text', 'message:caption'], async (ctx, next) => {
    const telegramId = ctx.from?.id ?? 0;
    if (!isEditing(telegramId)) return next();

    const session = getEditSession(telegramId);
    if (!session) return next();

    const text = ctx.message?.caption ?? ctx.message?.text ?? '';

    if (text === '/cancel') {
      clearEditSession(telegramId);
      await ctx.reply("Edit cancelled — no changes made 👍");
      return;
    }

    clearEditSession(telegramId);

    if (session.mode === 'notes') {
      const sections = parseTemplate(text);
      const filled = filledCount(sections);
      const ok = await updateVisitSections(session.visitId, sections);
      if (ok) {
        await ctx.reply(`✅ Updated — ${session.storeName} · ${filled}/6 sections`);
      } else {
        await ctx.reply("Something went wrong — give it another try 🙏");
      }
    } else if (session.mode === 'grade-comment') {
      const ok = await updateVisitGradeComments(session.visitId, text);
      if (ok) {
        await ctx.reply(`✅ Grade comment saved.`);
      } else {
        await ctx.reply("Something went wrong — give it another try 🙏");
      }
    }
  });

  // View full last visit — fired from the pre-visit context block
  bot.callbackQuery(/^viewlast:/, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('viewlast:', '');
    await ctx.answerCallbackQuery();
    await sendVisitDetails(ctx, visitId);
  });

  // View a specific visit — fired from /myvisits and /storevisits inline buttons
  bot.callbackQuery(/^viewvisit:/, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('viewvisit:', '');
    await ctx.answerCallbackQuery();
    await sendVisitDetails(ctx, visitId);
  });

  // /myprofile inline expansions
  bot.callbackQuery('profile:stores', handleProfileStores);
  bot.callbackQuery('profile:visits', handleProfileVisits);
  bot.callbackQuery('profile:back', handleProfileBack);

  // Confirm button — visit is already saved; this closes the action bar
  bot.callbackQuery(/^confirm_visit:/, async (ctx) => {
    await ctx.answerCallbackQuery('Confirmed ✅');
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
  });

  // Edit button — show step picker (Notes / Grade / Training)
  bot.callbackQuery(/^edit:[0-9a-f-]{36}$/i, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('edit:', '');
    const info = await getVisitInfo(visitId);

    if (!info) {
      await ctx.answerCallbackQuery('Visit not found.');
      return;
    }
    if (info.cm_telegram_id !== ctx.from?.id) {
      await ctx.answerCallbackQuery('Not your visit.');
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(
      `✏️ *Editing — ${info.store_name}*\n\nWhich step do you want to change?`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('📝 Notes', `edit:notes:${visitId}`).row()
          .text('📊 Grade', `edit:grade:${visitId}`).row()
          .text('🎓 Training', `edit:training:${visitId}`).row()
          .text('Cancel', 'cancel_action'),
      },
    );
  });

  // Edit Notes — same template-paste flow as before
  bot.callbackQuery(/^edit:notes:/, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('edit:notes:', '');
    const info = await getVisitInfo(visitId);
    if (!info || info.cm_telegram_id !== ctx.from?.id) {
      await ctx.answerCallbackQuery('Not allowed.');
      return;
    }
    startEditSession(ctx.from.id, visitId, info.store_name, 'notes');
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(
      `📝 *Editing Notes — ${info.store_name}*\n\nSend your updated notes and I'll swap them in 🔄\n\n` +
      `\`\`\`\n🌟 Good News\n\n\n🔍 Competitors' Insights\n\n\n📦 Display & Stock\n\n\n✅ What to Follow Up\n\n\n⚡ Buzz Plan\n\`\`\`\n\n_/cancel to stop_`,
      { parse_mode: 'Markdown' },
    );
  });

  // Edit Grade — show 1/2/3 picker
  bot.callbackQuery(/^edit:grade:[0-9a-f-]{36}$/i, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('edit:grade:', '');
    const info = await getVisitInfo(visitId);
    if (!info || info.cm_telegram_id !== ctx.from?.id) {
      await ctx.answerCallbackQuery('Not allowed.');
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(
      `📊 *Re-grade — ${info.store_name}*\n\nTap the new grade:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('1', `edit:grade:set:${visitId}:1`)
          .text('2', `edit:grade:set:${visitId}:2`)
          .text('3', `edit:grade:set:${visitId}:3`),
      },
    );
  });

  bot.callbackQuery(/^edit:grade:set:[0-9a-f-]{36}:[123]$/i, async (ctx) => {
    const rest = ctx.callbackQuery.data.replace('edit:grade:set:', '');
    const [visitId, gradeStr] = rest.split(':');
    const grade = Number(gradeStr) as 1 | 2 | 3;
    const info = await getVisitInfo(visitId);
    if (!info || info.cm_telegram_id !== ctx.from?.id) {
      await ctx.answerCallbackQuery('Not allowed.');
      return;
    }
    const ok = await updateVisitGrade(visitId, grade);
    if (!ok) {
      await ctx.answerCallbackQuery('Failed.');
      return;
    }
    startEditSession(ctx.from.id, visitId, info.store_name, 'grade-comment');
    await ctx.answerCallbackQuery(`Grade ${grade} ✓`);
    await ctx.editMessageText(
      `📊 *Grade ${grade} ✓* — ${info.store_name}\n\nAdd a comment for this grade? Type it, or tap Skip.`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().text('Skip', `edit:grade:skipcomment:${visitId}`),
      },
    );
  });

  bot.callbackQuery(/^edit:grade:skipcomment:/, async (ctx) => {
    clearEditSession(ctx.from?.id ?? 0);
    await ctx.answerCallbackQuery('Skipped');
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply('✅ Grade updated.');
  });

  // Edit Training — deep-link to mini-app training editor
  bot.callbackQuery(/^edit:training:/, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('edit:training:', '');
    const info = await getVisitInfo(visitId);
    if (!info || info.cm_telegram_id !== ctx.from?.id) {
      await ctx.answerCallbackQuery('Not allowed.');
      return;
    }
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

    if (!config.broadcast.botUsername) {
      await ctx.reply(
        `🎓 Open the visit in the mini-app to edit training.`,
      );
      return;
    }

    const deepLink =
      `https://t.me/${config.broadcast.botUsername}/${config.miniapp.shortName}` +
      `?startapp=visit_${visitId}_training`;
    await ctx.reply(
      `🎓 *Edit Training — ${info.store_name}*\n\nOpens the training editor in the mini-app:`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard().url('📝 Open training editor', deepLink),
      },
    );
  });

  // Delete button — ask for confirmation
  bot.callbackQuery(/^delete:/, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('delete:', '');
    const info = await getVisitInfo(visitId);

    if (!info) {
      await ctx.answerCallbackQuery('Visit not found.');
      return;
    }
    if (info.cm_telegram_id !== ctx.from?.id) {
      await ctx.answerCallbackQuery('Not your visit.');
      return;
    }

    await ctx.answerCallbackQuery();
    await ctx.reply(`Delete the visit to *${info.store_name}*? This can't be undone\\.`, {
      parse_mode: 'MarkdownV2',
      reply_markup: new InlineKeyboard()
        .text('Yes, delete', `confirm_delete:${visitId}`)
        .text('Cancel', 'cancel_action'),
    });
  });

  // Confirm delete
  bot.callbackQuery(/^confirm_delete:/, async (ctx) => {
    const visitId = ctx.callbackQuery.data.replace('confirm_delete:', '');
    const info = await getVisitInfo(visitId);

    if (info && info.cm_telegram_id !== ctx.from?.id) {
      await ctx.answerCallbackQuery('Not your visit.');
      return;
    }

    const ok = await deleteVisit(visitId);
    await ctx.answerCallbackQuery();

    if (ok) {
      await ctx.editMessageText('🗑️ Visit deleted.');
    } else {
      await ctx.reply("Something went wrong — give it another try 🙏");
    }
  });

  // Cancel delete confirmation
  bot.callbackQuery('cancel_action', async (ctx) => {
    await ctx.answerCallbackQuery('Cancelled.');
    await ctx.deleteMessage().catch(() => {});
  });

  // ── Join request flow ─────────────────────────────────────────────────────

  bot.callbackQuery('join:request', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    if (ctx.user) {
      await ctx.reply("You're already in 👍 Use /start to see your commands.");
      return;
    }
    await ctx.conversation.enter('joinRequestFlow');
  });

  bot.callbackQuery('join:later', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply("All good — message me /start whenever you're ready 👋");
  });

  function canApprove(user: CM | undefined): boolean {
    return !!user && user.role === 'admin';
  }

  bot.callbackQuery(/^join:approve:(\d+):(SG|MY|HK|TH)$/, async (ctx) => {
    if (!canApprove(ctx.user)) {
      await ctx.answerCallbackQuery({ text: 'Only admins can approve join requests.', show_alert: true });
      return;
    }
    const m = ctx.callbackQuery.data.match(/^join:approve:(\d+):(SG|MY|HK|TH)$/)!;
    const targetId = parseInt(m[1], 10);
    const market = m[2] as CM['market'];

    const existing = await getCMRecord(targetId);
    if (!existing) {
      await ctx.answerCallbackQuery({ text: 'Request not found.', show_alert: true });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return;
    }
    if (existing.is_active) {
      await ctx.answerCallbackQuery({ text: 'Already active.', show_alert: true });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return;
    }

    const approved = await approvePendingCM(targetId, market);
    if (!approved) {
      await ctx.answerCallbackQuery({ text: 'Failed to approve.', show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery(`Approved as cm · ${market}`);
    const approverName = ctx.user?.nickname ?? ctx.user?.full_name ?? 'a manager';
    const original = ctx.callbackQuery.message?.text ?? '';
    await ctx.editMessageText(`${original}\n\n✅ Approved as cm · ${market} by ${approverName}`).catch(() => {});

    await ctx.api.sendMessage(
      targetId,
      `🎉 You're in! Welcome to the SVA bot.\n\n` +
      `You've been added as *cm · ${market}*.\n\n` +
      `Type /start to see your commands.`,
      { parse_mode: 'Markdown' },
    ).catch((err) => console.error('[join] failed to DM approved user:', err));
  });

  bot.callbackQuery(/^join:reject:(\d+)$/, async (ctx) => {
    if (!canApprove(ctx.user)) {
      await ctx.answerCallbackQuery({ text: 'Only admins can reject join requests.', show_alert: true });
      return;
    }
    const m = ctx.callbackQuery.data.match(/^join:reject:(\d+)$/)!;
    const targetId = parseInt(m[1], 10);

    const existing = await getCMRecord(targetId);
    if (!existing || existing.is_active) {
      await ctx.answerCallbackQuery({ text: 'Not pending.', show_alert: true });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      return;
    }

    const ok = await rejectPendingCM(targetId);
    if (!ok) {
      await ctx.answerCallbackQuery({ text: 'Failed to reject.', show_alert: true });
      return;
    }

    await ctx.answerCallbackQuery('Rejected');
    const rejecterName = ctx.user?.nickname ?? ctx.user?.full_name ?? 'a manager';
    const original = ctx.callbackQuery.message?.text ?? '';
    await ctx.editMessageText(`${original}\n\n❌ Rejected by ${rejecterName}`).catch(() => {});

    // Optional courtesy DM. Silent if user blocked the bot.
    await ctx.api.sendMessage(
      targetId,
      `Your request to join wasn't approved this time. If you think this was a mistake, please reach out to your manager directly.`,
    ).catch(() => {});
  });

  // Admin commands
  bot.command('grantaccess', handleGrantAccess);
  bot.command('revokeaccess', handleRevokeAccess);
  bot.command('listaccess', handleListAccess);
  bot.command('runintelligence', handleRunIntelligence);

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error handling update ${ctx.update.update_id}:`, err.error);

    const message =
      err.error instanceof Error && err.error.message === 'CANCELLED'
        ? 'Action cancelled.'
        : 'Something went wrong. Try again or type /cancel to reset.';

    ctx.reply(message).catch(console.error);
  });

  return bot;
}
